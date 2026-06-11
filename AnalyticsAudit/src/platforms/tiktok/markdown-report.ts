// TikTok Markdown rolling report (Phase G3).
//
// Unlike the Facebook Page thin-v1 report (engagement blocked by Meta App
// Review), TikTok's granted scopes return REAL per-video engagement, so this
// mirrors the richer Instagram report: per-snapshot sections with account
// deltas and a populated posts table (views / likes / comments / shares / ER).
//
// Differences from Instagram:
//   - TikTok content is always video, so there's no media-type column.
//   - There is no Reach or Saved metric. Engagement Rate uses Views as the
//     denominator — TikTok's natural "of the people who saw it, how many
//     engaged" measure: ER = (Likes + Comments + Shares) / Views × 100.
//   - The Audience section is a permanent empty-state: TikTok's Display API
//     exposes no demographics (age/gender/geo) — those need the gated
//     Research API. We say so in plain language rather than rendering blanks.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "../../core/db/client.js";
import {
  toReadableEtDate,
  toReadableEtTimestamp,
  toShortReadableEt,
} from "../../core/lib/time.js";
import { migrateLegacyOrphans } from "../../core/reports/catalog.js";
import {
  CAPTION_PREVIEW_CHARS,
  HASHTAGS_PER_ROW,
  extractHashtags,
  truncateCaption,
} from "../../core/reports/_shared.js";
import type {
  ClientRef,
  GenerateReportResult,
} from "../instagram/markdown-report.js";

type Snapshot = {
  id: number;
  captured_at: string;
  lookback_days: number;
};

// JSON stored in account_metrics.platform_extras for TikTok.
type TikTokAccountExtras = {
  likes_count?: number | null; // total lifetime likes across all videos
  is_verified?: boolean | null;
  display_name?: string | null;
  username?: string | null;
  profile_deep_link?: string | null;
  manual_token?: boolean;
  stats_withheld?: boolean; // true when user.info.stats scope returned nothing
};

type AccountMetricsRow = {
  followers_count: number;
  follows_count: number;
  posts_count: number;
  platform_extras: string | null;
};

type AccountSummary = {
  followers_count: number;
  following_count: number;
  video_count: number;
  likes_count: number | null;
  display_name: string | null;
  username: string | null;
  is_verified: boolean;
  manual_token: boolean;
  stats_withheld: boolean;
};

// JSON stored in post_metrics.platform_extras for TikTok.
type TikTokPostExtras = {
  duration?: number | null; // seconds
};

type PostMetricRow = {
  external_post_id: string;
  caption: string | null;
  permalink: string;
  published_at: string;
  like_count: number;
  comments_count: number;
  shares: number | null;
  views: number | null;
  is_supplemental: number;
  platform_extras: string | null;
};

type Post = {
  caption: string | null;
  permalink: string;
  published_at: string;
  like_count: number;
  comments_count: number;
  shares: number | null;
  views: number | null;
  duration: number | null;
  is_supplemental: number;
};

const REPORTS_DIR = resolve("reports");
const ROLLING_WINDOW = 12;

function parseAccount(row: AccountMetricsRow): AccountSummary {
  const extras = (
    row.platform_extras ? JSON.parse(row.platform_extras) : {}
  ) as TikTokAccountExtras;
  return {
    followers_count: row.followers_count,
    following_count: row.follows_count,
    video_count: row.posts_count,
    likes_count: extras.likes_count ?? null,
    display_name: extras.display_name ?? null,
    username: extras.username ?? null,
    is_verified: extras.is_verified === true,
    manual_token: extras.manual_token === true,
    stats_withheld: extras.stats_withheld === true,
  };
}

function parsePost(row: PostMetricRow): Post {
  const extras = (
    row.platform_extras ? JSON.parse(row.platform_extras) : {}
  ) as TikTokPostExtras;
  return {
    caption: row.caption,
    permalink: row.permalink,
    published_at: row.published_at,
    like_count: row.like_count,
    comments_count: row.comments_count,
    shares: row.shares,
    views: row.views,
    duration: extras.duration ?? null,
    is_supplemental: row.is_supplemental,
  };
}

// TikTok engagement rate: (likes + comments + shares) / views × 100. Views is
// the denominator because, like Instagram's reach, it measures the post
// against the people who actually saw it rather than the whole follower base.
function computeTikTokEr(p: Post): number | null {
  if (p.views === null || p.views === 0) return null;
  const engagement = p.like_count + p.comments_count + (p.shares ?? 0);
  return (engagement / p.views) * 100;
}

export function generateTikTokReport(client: ClientRef): GenerateReportResult {
  const snapshots = db
    .prepare(
      `SELECT id, captured_at, lookback_days
         FROM snapshots
         WHERE platform_account_id = ?
         ORDER BY id DESC`,
    )
    .all(client.platform_account_id) as Snapshot[];

  const rollingSnapshots = snapshots.slice(0, ROLLING_WINDOW);
  const archiveSnapshots = snapshots.slice(ROLLING_WINDOW);

  const sectionsRolling = rollingSnapshots.map((snap, i) => {
    const prior = rollingSnapshots[i + 1] ?? archiveSnapshots[0] ?? undefined;
    return renderSnapshotSection(snap, prior);
  });
  const sectionsArchive = archiveSnapshots.map((snap, i) => {
    const prior = archiveSnapshots[i + 1] ?? undefined;
    return renderSnapshotSection(snap, prior);
  });

  migrateLegacyOrphans(REPORTS_DIR);
  const platformDir = resolve(REPORTS_DIR, client.short_name, client.platform);
  mkdirSync(platformDir, { recursive: true });

  const generatedAtIso = new Date().toISOString();

  const rollingPath = resolve(platformDir, "rolling.md");
  writeFileSync(
    rollingPath,
    renderRolling(
      client,
      sectionsRolling,
      archiveSnapshots.length,
      rollingSnapshots[0],
      rollingSnapshots[1] ?? archiveSnapshots[0],
      generatedAtIso,
    ),
    "utf-8",
  );

  let archivePath: string | null = null;
  if (archiveSnapshots.length > 0) {
    archivePath = resolve(platformDir, "archive.md");
    writeFileSync(
      archivePath,
      renderArchive(client, sectionsArchive, generatedAtIso),
      "utf-8",
    );
  }

  return { rollingPath, archivePath };
}

function renderRolling(
  client: ClientRef,
  sections: string[],
  archivedCount: number,
  latest: Snapshot | undefined,
  prior: Snapshot | undefined,
  generatedAtIso: string,
): string {
  const lines: string[] = [];
  lines.push(`# TikTok Analytics Audit — ${client.display_name}`);
  lines.push("");
  lines.push(`**Generated On:** ${toReadableEtTimestamp(generatedAtIso)}  `);
  if (latest) {
    lines.push(
      `**Latest Snapshot:** #${latest.id} — Captured on ${toReadableEtTimestamp(latest.captured_at)}  `,
    );
    if (prior) {
      lines.push(
        `**Comparing To Snapshot:** #${prior.id} — Captured on ${toReadableEtTimestamp(prior.captured_at)}`,
      );
    } else {
      lines.push(
        `**Comparing To Snapshot:** *None — first snapshot for this client.*`,
      );
    }
  }
  lines.push("");
  if (sections.length === 0) {
    lines.push("*No snapshots yet — run `npm run audit` to capture one.*");
    lines.push("");
  } else {
    const tail =
      archivedCount > 0
        ? ` Older entries (${archivedCount}) archived in \`archive.md\`.`
        : "";
    lines.push(
      `*Rolling report — last ${sections.length} of the most recent ${ROLLING_WINDOW} snapshot(s).${tail}*`,
    );
    lines.push("");
    lines.push(renderMetricsGlossary());
    lines.push("");
    lines.push(sections.join("\n"));
  }
  lines.push("---");
  lines.push(
    `*Generated by AnalyticsAudit v0.1.0 · ${toReadableEtTimestamp(generatedAtIso)}*`,
  );
  lines.push("");
  return lines.join("\n");
}

function renderArchive(
  client: ClientRef,
  sections: string[],
  generatedAtIso: string,
): string {
  const lines: string[] = [];
  lines.push(`# TikTok Analytics Audit — ${client.display_name} (Archive)`);
  lines.push("");
  lines.push(`**Generated On:** ${toReadableEtTimestamp(generatedAtIso)}`);
  lines.push("");
  lines.push(
    `*Snapshots older than the most recent ${ROLLING_WINDOW}. See \`rolling.md\` for current.*`,
  );
  lines.push("");
  lines.push(renderMetricsGlossary());
  lines.push("");
  lines.push(sections.join("\n"));
  lines.push("---");
  lines.push(
    `*Generated by AnalyticsAudit v0.1.0 · ${toReadableEtTimestamp(generatedAtIso)}*`,
  );
  lines.push("");
  return lines.join("\n");
}

function renderSnapshotSection(
  snapshot: Snapshot,
  prior: Snapshot | undefined,
): string {
  const accountRow = db
    .prepare(
      `SELECT followers_count, follows_count, posts_count, platform_extras
         FROM account_metrics WHERE snapshot_id = ?`,
    )
    .get(snapshot.id) as AccountMetricsRow | undefined;
  const account = accountRow ? parseAccount(accountRow) : undefined;

  const priorAccountRow = prior
    ? (db
        .prepare(
          `SELECT followers_count, follows_count, posts_count, platform_extras
             FROM account_metrics WHERE snapshot_id = ?`,
        )
        .get(prior.id) as AccountMetricsRow | undefined)
    : undefined;
  const priorAccount = priorAccountRow ? parseAccount(priorAccountRow) : undefined;

  const posts = (
    db
      .prepare(
        `SELECT external_post_id, caption, permalink, published_at,
                like_count, comments_count, shares, views, is_supplemental,
                platform_extras
           FROM post_metrics
           WHERE snapshot_id = ?
           ORDER BY published_at DESC`,
      )
      .all(snapshot.id) as PostMetricRow[]
  ).map(parsePost);

  const priorPostCount = prior
    ? (
        db
          .prepare("SELECT COUNT(*) AS c FROM post_metrics WHERE snapshot_id = ?")
          .get(prior.id) as { c: number }
      ).c
    : 0;

  const lines: string[] = [];
  lines.push(
    `## ${toReadableEtDate(snapshot.captured_at)} — Snapshot #${snapshot.id}`,
  );
  lines.push("");
  lines.push(`- **Captured:** ${toReadableEtTimestamp(snapshot.captured_at)}`);
  if (prior) {
    const elapsed = formatElapsed(prior.captured_at, snapshot.captured_at);
    lines.push(
      `- **Prior:** #${prior.id} captured ${toReadableEtTimestamp(prior.captured_at)} (${elapsed} earlier)`,
    );
  } else {
    lines.push("- **Prior:** *(none — first snapshot for this client)*");
  }
  lines.push("");

  if (account) {
    lines.push(renderAccountSection(account, priorAccount));
    lines.push("");
  }

  lines.push(renderPostsSection(snapshot, posts, prior, priorPostCount));
  lines.push("");

  lines.push("### Audience");
  lines.push("");
  lines.push(renderAudienceSection());
  lines.push("");

  return lines.join("\n");
}

function renderAccountSection(
  account: AccountSummary,
  prior: AccountSummary | undefined,
): string {
  const lines: string[] = [];
  lines.push("### Account");
  lines.push("");
  if (account.display_name !== null) {
    const handle = account.username !== null ? ` (@${account.username})` : "";
    const verified = account.is_verified ? " ✓" : "";
    lines.push(`**Profile:** ${account.display_name}${handle}${verified}`);
    lines.push("");
  }

  if (account.stats_withheld) {
    lines.push(
      "*TikTok did not return account stats for this snapshot — the `user.info.stats` scope may not have been granted on this token. Re-authorize with the four read-only scopes (see docs/TIKTOK_SETUP.md) to populate followers, total likes, and video count.*",
    );
    return lines.join("\n");
  }

  lines.push("| Metric          | Current | Prior    | Change      |");
  lines.push("|-----------------|--------:|---------:|-------------|");
  const rows: Array<[string, number, number | undefined]> = [
    ["Followers", account.followers_count, prior?.followers_count],
    ["Following", account.following_count, prior?.following_count],
    ["Total Videos", account.video_count, prior?.video_count],
  ];
  if (account.likes_count !== null) {
    rows.push(["Total Likes", account.likes_count, prior?.likes_count ?? undefined]);
  }
  for (const [label, current, previous] of rows) {
    const cur = formatNumber(current).padStart(7);
    const prev = (previous !== undefined ? formatNumber(previous) : "—").padStart(8);
    const change = formatDelta(current, previous).padEnd(11);
    lines.push(`| ${label.padEnd(15)} | ${cur} | ${prev} | ${change} |`);
  }
  if (account.manual_token) {
    lines.push("");
    lines.push(
      "*This account was onboarded from a pasted token (manual-token mode), so token lifetimes are best-effort estimates. See docs/TIKTOK_SETUP.md.*",
    );
  }
  return lines.join("\n");
}

function renderPostsSection(
  snapshot: Snapshot,
  posts: Post[],
  prior: Snapshot | undefined,
  priorPostCount: number,
): string {
  const lines: string[] = [];
  lines.push("### Posts");
  lines.push("");
  const inWindow = posts.filter((p) => p.is_supplemental === 0);
  const supplemental = posts.filter((p) => p.is_supplemental === 1);
  lines.push(
    `*Videos published in the last ${snapshot.lookback_days} days are shown first. If fewer were published in that window, the most recent older videos are pulled in as supplemental rows (marked with †) so the table is never empty. Engagement Rate (ER) = (Likes + Comments + Shares) / Views × 100 — see the glossary above.*`,
  );
  lines.push("");
  if (posts.length === 0) {
    lines.push("*No videos captured for this snapshot.*");
  } else if (supplemental.length === 0) {
    lines.push(
      `- This snapshot: ${posts.length} video(s) — all within the ${snapshot.lookback_days}-day window`,
    );
  } else if (inWindow.length === 0) {
    lines.push(
      `- This snapshot: ${posts.length} video(s) — none within the ${snapshot.lookback_days}-day window; ${supplemental.length} supplemental (older videos pulled in to keep the table populated; marked †)`,
    );
  } else {
    lines.push(
      `- This snapshot: ${posts.length} video(s) — ${inWindow.length} within the ${snapshot.lookback_days}-day window, ${supplemental.length} supplemental (marked †)`,
    );
  }
  lines.push(
    prior
      ? `- Prior snapshot (#${prior.id}): ${priorPostCount} video(s)`
      : "- Prior snapshot: —",
  );
  lines.push("");

  if (posts.length > 0) {
    lines.push(
      "|   | Caption                            | Posted                  | Length | Hashtags                       | Views | Likes | Comments | Shares | ER    | Link |",
    );
    lines.push(
      "|---|------------------------------------|-------------------------|-------:|--------------------------------|------:|------:|---------:|-------:|------:|------|",
    );
    for (const p of posts) {
      const marker = p.is_supplemental === 1 ? "†" : " ";
      const captionPreview = truncateCaption(p.caption, CAPTION_PREVIEW_CHARS);
      const posted = toShortReadableEt(p.published_at);
      const length = formatDuration(p.duration);
      const hashtags = renderHashtagsMarkdown(p.caption);
      const er = formatEr(computeTikTokEr(p));
      const cells = [
        marker,
        captionPreview.padEnd(34),
        posted.padEnd(23),
        length.padStart(6),
        hashtags.padEnd(30),
        formatNullable(p.views).padStart(5),
        formatNumber(p.like_count).padStart(5),
        formatNumber(p.comments_count).padStart(8),
        formatNullable(p.shares).padStart(6),
        er.padStart(5),
        p.permalink ? `[view](${p.permalink})` : "—",
      ];
      lines.push(`| ${cells.join(" | ")} |`);
    }
    if (supplemental.length > 0) {
      lines.push("");
      lines.push(
        `*† Supplemental — posted before the ${snapshot.lookback_days}-day window. Included so the Posts table is never empty when no videos were posted in window.*`,
      );
    }
  }
  return lines.join("\n");
}

function renderAudienceSection(): string {
  return "*TikTok's Display API exposes no audience demographics — age, gender, and geographic breakdowns are only available through TikTok's separately-gated Research API, which requires an institutional review unrelated to this audit. Account-level reach is reflected in per-video Views above.*";
}

function renderMetricsGlossary(): string {
  return `<details>
<summary><strong>What The Metrics Mean</strong> (click to expand)</summary>

### Account

- **Followers** — How many accounts currently follow this profile. The headline "is this growing?" number.
- **Following** — How many other accounts this profile follows back.
- **Total Videos** — Cumulative count of every video this account has published. Only goes up; if it grew by 3 since the prior snapshot, 3 videos were posted that week.
- **Total Likes** — Lifetime likes summed across every video the account has ever posted. A slow-moving cumulative vanity metric; the per-video Likes below are the actionable signal.

### Per-Video

- **Views** — Total times the video was played. TikTok's reach analogue and the denominator for ER.
- **Likes** — Hearts on the video. Baseline engagement signal.
- **Comments** — Comments left on the video. Higher commitment than a like.
- **Shares** — Times the video was shared (to DMs, other apps, or reposted). The strongest distribution signal — shares drive the algorithm.
- **ER** (Engagement Rate) — Percentage of viewers who engaged. Formula: **(Likes + Comments + Shares) / Views × 100**. Divided by Views (not Followers) because TikTok's For You feed shows videos far beyond the follower base — ER measures the video against everyone who actually saw it. Rough benchmarks: <3% below average, 3–6% solid, 6–9% strong, 9%+ excellent (TikTok ER runs higher than Instagram).
- **Length** — Video duration (mm:ss). Useful context for watch-through and ER comparisons.

### Audience

TikTok's Display API returns no demographic breakdowns (age / gender / location). Those live behind TikTok's Research API, a separate institutional-review program outside this audit's scope. The report says so plainly rather than rendering empty charts.

</details>`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return "—";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function renderHashtagsMarkdown(caption: string | null): string {
  const tags = extractHashtags(caption);
  if (tags.length === 0) return "—";
  const shown = tags.slice(0, HASHTAGS_PER_ROW);
  const links = shown.map((t) => `[${t}](${tiktokHashtagSearchUrl(t)})`);
  const extra = tags.length - shown.length;
  return extra > 0 ? `${links.join(" ")} +${extra} more` : links.join(" ");
}

// TikTok hashtag landing page. Distinct from IG's explore/tags and FB's
// /hashtag/ — TikTok uses tiktok.com/tag/<tag>.
function tiktokHashtagSearchUrl(tag: string): string {
  const stripped = tag.startsWith("#") ? tag.slice(1) : tag;
  return `https://www.tiktok.com/tag/${encodeURIComponent(stripped)}`;
}

function formatEr(rate: number | null): string {
  return rate === null ? "—" : `${rate.toFixed(1)}%`;
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatNullable(n: number | null): string {
  return n === null ? "—" : formatNumber(n);
}

function formatDelta(current: number, previous: number | undefined): string {
  if (previous === undefined) return "—";
  const delta = current - previous;
  if (delta === 0) return "0 (—)";
  const sign = delta > 0 ? "+" : "";
  if (previous === 0) return `${sign}${formatNumber(delta)} (—)`;
  const pct = (delta / previous) * 100;
  const pctSign = pct >= 0 ? "+" : "";
  return `${sign}${formatNumber(delta)} (${pctSign}${pct.toFixed(1)}%)`;
}

function formatElapsed(fromIso: string, toIso: string): string {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr`;
  const days = Math.floor(hours / 24);
  return `${days} day(s)`;
}
