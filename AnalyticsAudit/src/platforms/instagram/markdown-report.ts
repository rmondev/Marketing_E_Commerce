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
  DEMOGRAPHIC_DIMENSIONS_ORDER,
  DEMOGRAPHIC_TOP_N,
  HASHTAGS_PER_ROW,
  computeEngagementRate,
  dimensionLabel,
  expandBucketLabel,
  extractHashtags,
  formatEr,
  hashtagSearchUrl,
  truncateCaption,
} from "../../core/reports/_shared.js";

// Identifies a (business + platform account) pair. Reports live at
// reports/<short_name>/<platform>/...; the `platform` field is what drives
// the second path segment.
export type ClientRef = {
  client_id: number;
  platform_account_id: number;
  platform: string;
  short_name: string;
  display_name: string;
};

type Snapshot = {
  id: number;
  platform_account_id: number;
  captured_at: string;
  lookback_days: number;
  demographics_attempted: number;
};

// Shape of the JSON stored in account_metrics.platform_extras for Instagram.
type InstagramAccountExtras = {
  reach: number;
  profile_views: number;
  website_clicks: number | null;
};

type AccountMetricsRow = {
  followers_count: number;
  follows_count: number;
  posts_count: number;
  platform_extras: string | null; // JSON
};

type AccountMetrics = {
  followers_count: number;
  follows_count: number;
  media_count: number; // mapped from posts_count for display continuity
  reach: number;
  profile_views: number;
  website_clicks: number | null;
};

// Shape of the JSON stored in post_metrics.platform_extras for Instagram.
type InstagramPostExtras = {
  reach: number | null;
  saved: number | null;
};

type PostMetricRow = {
  external_post_id: string;
  media_type: string;
  caption: string | null;
  permalink: string;
  published_at: string;
  like_count: number;
  comments_count: number;
  shares: number | null;
  views: number | null;
  is_supplemental: number;
  platform_extras: string | null; // JSON
};

type PostMetric = {
  ig_media_id: string;
  media_type: string;
  caption: string | null;
  permalink: string;
  published_at: string;
  like_count: number;
  comments_count: number;
  reach: number | null;
  saved: number | null;
  shares: number | null;
  video_views: number | null;
  is_supplemental: number;
};

function parseAccountMetrics(row: AccountMetricsRow): AccountMetrics {
  const extras = (
    row.platform_extras ? JSON.parse(row.platform_extras) : {}
  ) as Partial<InstagramAccountExtras>;
  return {
    followers_count: row.followers_count,
    follows_count: row.follows_count,
    media_count: row.posts_count,
    reach: extras.reach ?? 0,
    profile_views: extras.profile_views ?? 0,
    website_clicks: extras.website_clicks ?? null,
  };
}

function parsePostMetric(row: PostMetricRow): PostMetric {
  const extras = (
    row.platform_extras ? JSON.parse(row.platform_extras) : {}
  ) as Partial<InstagramPostExtras>;
  return {
    ig_media_id: row.external_post_id,
    media_type: row.media_type,
    caption: row.caption,
    permalink: row.permalink,
    published_at: row.published_at,
    like_count: row.like_count,
    comments_count: row.comments_count,
    reach: extras.reach ?? null,
    saved: extras.saved ?? null,
    shares: row.shares,
    video_views: row.views,
    is_supplemental: row.is_supplemental,
  };
}

type DemographicRow = {
  audience_type: string;
  dimension: string;
  bucket: string;
  value: number;
};

const REPORTS_DIR = resolve("reports");
const ROLLING_WINDOW = 12;

export type GenerateReportResult = {
  rollingPath: string;
  archivePath: string | null;
};

export function generateReport(client: ClientRef): GenerateReportResult {
  const snapshots = db
    .prepare(
      `SELECT id, platform_account_id, captured_at, lookback_days, demographics_attempted
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

  // Phase C layout: reports/<client>/<platform>/{rolling,archive}.md.
  // Multi-platform-safe: a TikTok report won't collide with an IG one
  // because they live in sibling directories. Before writing, sweep any
  // pre-Phase-C orphan files at the top of reports/ into _legacy/.
  migrateLegacyOrphans(REPORTS_DIR);
  const platformDir = resolve(
    REPORTS_DIR,
    client.short_name,
    client.platform,
  );
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
  lines.push(`# Instagram Analytics Audit — ${client.display_name}`);
  lines.push("");
  // Trailing two spaces force soft-break newlines in standard Markdown so
  // the three header lines render as a block, not joined into one paragraph.
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
  lines.push(`# Instagram Analytics Audit — ${client.display_name} (Archive)`);
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
  const accountMetricsRow = db
    .prepare(
      `SELECT followers_count, follows_count, posts_count, platform_extras
         FROM account_metrics WHERE snapshot_id = ?`,
    )
    .get(snapshot.id) as AccountMetricsRow;
  const accountMetrics = parseAccountMetrics(accountMetricsRow);

  const priorAccountMetricsRow = prior
    ? (db
        .prepare(
          `SELECT followers_count, follows_count, posts_count, platform_extras
             FROM account_metrics WHERE snapshot_id = ?`,
        )
        .get(prior.id) as AccountMetricsRow | undefined)
    : undefined;
  const priorAccountMetrics = priorAccountMetricsRow
    ? parseAccountMetrics(priorAccountMetricsRow)
    : undefined;

  const postRows = db
    .prepare(
      `SELECT external_post_id, media_type, caption, permalink, published_at,
              like_count, comments_count, shares, views, is_supplemental,
              platform_extras
         FROM post_metrics
         WHERE snapshot_id = ?
         ORDER BY published_at DESC`,
    )
    .all(snapshot.id) as PostMetricRow[];
  const posts = postRows.map(parsePostMetric);

  const demographicRows = db
    .prepare(
      `SELECT audience_type, dimension, bucket, value
         FROM demographic_breakdowns
         WHERE snapshot_id = ?`,
    )
    .all(snapshot.id) as DemographicRow[];

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

  lines.push("### Account");
  lines.push("");
  lines.push("| Metric             | Current | Prior    | Change      |");
  lines.push("|--------------------|--------:|---------:|-------------|");
  const accountRows: Array<[string, number, number | undefined]> = [
    [
      "Followers",
      accountMetrics.followers_count,
      priorAccountMetrics?.followers_count,
    ],
    [
      "Following",
      accountMetrics.follows_count,
      priorAccountMetrics?.follows_count,
    ],
    [
      "Total Media",
      accountMetrics.media_count,
      priorAccountMetrics?.media_count,
    ],
    ["Reach (7d)", accountMetrics.reach, priorAccountMetrics?.reach],
    [
      "Profile Views (7d)",
      accountMetrics.profile_views,
      priorAccountMetrics?.profile_views,
    ],
  ];
  for (const [label, current, previous] of accountRows) {
    const cur = formatNumber(current).padStart(7);
    const prev = (previous !== undefined ? formatNumber(previous) : "—").padStart(8);
    const change = formatDelta(current, previous).padEnd(11);
    lines.push(`| ${label.padEnd(18)} | ${cur} | ${prev} | ${change} |`);
  }
  lines.push("");

  lines.push("### Posts");
  lines.push("");
  const inWindow = posts.filter((p) => p.is_supplemental === 0);
  const supplemental = posts.filter((p) => p.is_supplemental === 1);
  const noInsights = posts.filter((p) => p.reach === null).length;
  lines.push(
    `*Posts published in the last ${snapshot.lookback_days} days are shown first. If fewer were published in that window, the most recent older posts are pulled in as supplemental rows (marked with †) so the table is never empty. Each row's Engagement Rate (ER) = (Likes + Comments + Saves + Shares) / Reach × 100 — see the glossary above for why Reach is the denominator.*`,
  );
  lines.push("");
  if (posts.length === 0) {
    lines.push("*No posts captured for this snapshot.*");
  } else if (supplemental.length === 0) {
    lines.push(
      `- This snapshot: ${posts.length} post(s) — all within the ${snapshot.lookback_days}-day window`,
    );
  } else if (inWindow.length === 0) {
    lines.push(
      `- This snapshot: ${posts.length} post(s) — none within the ${snapshot.lookback_days}-day window; ${supplemental.length} supplemental (older posts pulled in to keep the table populated; marked †)`,
    );
  } else {
    lines.push(
      `- This snapshot: ${posts.length} post(s) — ${inWindow.length} within the ${snapshot.lookback_days}-day window, ${supplemental.length} supplemental (marked †)`,
    );
  }
  lines.push(
    prior
      ? `- Prior snapshot (#${prior.id}): ${priorPostCount} post(s)`
      : "- Prior snapshot: —",
  );
  if (noInsights > 0) {
    lines.push(
      `- ${noInsights} post(s) returned no insights (likely pre-business-conversion media)`,
    );
  }
  lines.push("");

  if (posts.length > 0) {
    lines.push(
      "|   | Caption                            | Posted                  | Type    | Hashtags                       | Likes | Comments | Reach | Saved | Shares | Views | ER    | Link |",
    );
    lines.push(
      "|---|------------------------------------|-------------------------|---------|--------------------------------|------:|---------:|------:|------:|-------:|------:|------:|------|",
    );
    for (const p of posts) {
      const marker = p.is_supplemental === 1 ? "†" : " ";
      const captionPreview = truncateCaption(p.caption, CAPTION_PREVIEW_CHARS);
      const posted = toShortReadableEt(p.published_at);
      const hashtags = renderHashtagsMarkdown(p.caption);
      const er = formatEr(computeEngagementRate(p));
      const cells = [
        marker,
        captionPreview.padEnd(34),
        posted.padEnd(23),
        p.media_type.padEnd(7),
        hashtags.padEnd(30),
        formatNumber(p.like_count).padStart(5),
        formatNumber(p.comments_count).padStart(8),
        formatNullable(p.reach).padStart(5),
        formatNullable(p.saved).padStart(5),
        formatNullable(p.shares).padStart(6),
        formatNullable(p.video_views).padStart(5),
        er.padStart(5),
        `[view](${p.permalink})`,
      ];
      lines.push(`| ${cells.join(" | ")} |`);
    }
    if (supplemental.length > 0) {
      lines.push("");
      lines.push(
        `*† Supplemental — posted before the ${snapshot.lookback_days}-day window. Included so the Posts table is never empty when no posts were made in window.*`,
      );
    }
    lines.push("");
  }

  lines.push("### Audience");
  lines.push("");
  lines.push(
    "*Who is paying attention to this account, by demographic. **Lifetime Followers** = everyone currently following. **Engaged Audience** = the smaller, more dynamic group who actually interacted with the account in the last month. The engaged side is the better signal of who the content is actually working for.*",
  );
  lines.push("");
  lines.push(renderAudienceSection(snapshot, demographicRows, accountMetrics));
  lines.push("");

  return lines.join("\n");
}

function renderAudienceSection(
  snapshot: Snapshot,
  demographicRows: DemographicRow[],
  accountMetrics: AccountMetrics,
): string {
  if (snapshot.demographics_attempted === 0) {
    return "*Demographic breakdowns were not captured for this snapshot (pre-dates the demographics feature).*";
  }

  const lines: string[] = [];
  const follower = demographicRows.filter((r) => r.audience_type === "follower");
  const engaged = demographicRows.filter((r) => r.audience_type === "engaged");

  lines.push("**Followers (Lifetime):**");
  lines.push("");
  if (follower.length === 0) {
    lines.push(
      `*Meta did not release follower demographics for this snapshot — typically because the account has fewer than ~100 followers (${formatNumber(accountMetrics.followers_count)} on record). The breakdown returns once the account crosses Meta's privacy threshold.*`,
    );
  } else {
    for (const dim of DEMOGRAPHIC_DIMENSIONS_ORDER) {
      const buckets = follower
        .filter((r) => r.dimension === dim)
        .map((r) => ({
          bucket: expandBucketLabel(dim, r.bucket),
          value: r.value,
        }));
      lines.push(`- ${dimensionLabel(dim)}: ${formatBucketList(buckets)}`);
    }
  }
  lines.push("");

  lines.push("**Engaged Audience (This Month):**");
  lines.push("");
  if (engaged.length === 0) {
    lines.push(
      "*Meta did not release engaged-audience demographics for this snapshot — most commonly because fewer than ~100 unique users engaged with the account in the timeframe. The breakdown returns once monthly engagement crosses Meta's privacy threshold.*",
    );
  } else {
    for (const dim of DEMOGRAPHIC_DIMENSIONS_ORDER) {
      const buckets = engaged
        .filter((r) => r.dimension === dim)
        .map((r) => ({
          bucket: expandBucketLabel(dim, r.bucket),
          value: r.value,
        }));
      lines.push(`- ${dimensionLabel(dim)}: ${formatBucketList(buckets)}`);
    }
  }

  return lines.join("\n");
}

function renderMetricsGlossary(): string {
  return `<details>
<summary><strong>What The Metrics Mean</strong> (click to expand)</summary>

### Account

- **Followers** — How many accounts currently follow this profile. The headline "is this growing?" number.
- **Following** — How many other accounts this profile follows back. Less interesting on its own; the ratio of Followers to Following can hint at perceived authority.
- **Total Media** — Cumulative count of every post this account has ever published. It only goes up — doesn't reset weekly. If it grew by 3 since the prior snapshot, the account posted 3 things that week.
- **Reach (7d)** — Unique people who saw any of this account's content in the last 7 days. Counts each person once, even if they saw 10 posts.
- **Profile Views (7d)** — How many times the profile page itself was viewed in the last 7 days. Signals curiosity — people clicking through to see who you are. A strong leading indicator of follower growth.

### Per-Post

- **Likes** — Hearts tapped on the post. Baseline engagement signal — lowest commitment.
- **Comments** — Comments left on the post. Higher commitment than a like; someone took time to type something.
- **Reach** — Unique people who saw this specific post.
- **Saved** — People who bookmarked the post to their saved collection. Very strong value signal — people only save what they want to come back to.
- **Shares** — Times the post was shared via DM, sent in a story, or had its link copied.
- **Views** — Total times the post was viewed or played. Higher than Reach because one person can view the same post multiple times.
- **ER** (Engagement Rate) — Percentage of people who saw the post and engaged with it. Formula: **(Likes + Comments + Saves + Shares) / Reach × 100**. Divided by Reach (not Followers) because most followers don't see most posts — the algorithm decides. ER measures the post against the people who actually had the chance to engage. Rough benchmarks: <1% below average, 1–3% average, 3–6% strong, 6%+ excellent.

### Audience

- **Lifetime Followers** — Everyone currently following the account, broken down by demographic. Stable; changes slowly.
- **Engaged Audience (This Month)** — Just the people who actually interacted with the content (liked, commented, saved, shared) in the last month. Smaller, more dynamic, and a much better signal of who the content is actually working for.

Per-dimension:

- **Age** — Distribution across age brackets (13–17, 18–24, 25–34, 35–44, 45–54, 55–64, 65+). Reveals which generation(s) the content resonates with.
- **Gender** — Self-reported gender distribution. "Undisclosed" means the user didn't specify a gender on their Instagram profile.
- **Top Countries** — Which countries the audience lives in. Useful for spotting unexpected international reach.
- **Top Cities** — Metro areas the audience clusters around. Most actionable for local businesses.

Meta withholds demographic breakdowns when the underlying audience is below ~100 unique people (a privacy threshold). When that happens the section shows a plain-language message instead of empty charts.

</details>`;
}

// Sort descending by value, take top N, lump the tail into "and M more".
// Percentages are of the released total (sum of values present), not of
// total followers/engaged — Meta filters low-count buckets out before
// releasing, so released-sum is the only meaningful denominator.
function formatBucketList(
  buckets: { bucket: string; value: number }[],
): string {
  if (buckets.length === 0) return "*(no buckets returned)*";
  const sorted = [...buckets].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((s, b) => s + b.value, 0);
  if (total === 0) return "*(all buckets zero)*";

  const head = sorted.slice(0, DEMOGRAPHIC_TOP_N);
  const tail = sorted.slice(DEMOGRAPHIC_TOP_N);
  const formatPart = (b: { bucket: string; value: number }): string =>
    `${b.bucket} (${formatNumber(b.value)}, ${Math.round((b.value / total) * 100)}%)`;
  const parts = head.map(formatPart);
  if (tail.length > 0) {
    const tailSum = tail.reduce((s, b) => s + b.value, 0);
    parts.push(
      `and ${tail.length} more (${formatNumber(tailSum)}, ${Math.round((tailSum / total) * 100)}%)`,
    );
  }
  return parts.join(", ");
}

function renderHashtagsMarkdown(caption: string | null): string {
  const tags = extractHashtags(caption);
  if (tags.length === 0) return "—";
  const shown = tags.slice(0, HASHTAGS_PER_ROW);
  const links = shown.map((t) => `[${t}](${hashtagSearchUrl(t)})`);
  const extra = tags.length - shown.length;
  return extra > 0 ? `${links.join(" ")} +${extra} more` : links.join(" ");
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
