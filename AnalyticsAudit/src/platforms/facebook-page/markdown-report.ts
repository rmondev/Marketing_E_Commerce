// Facebook Page Markdown rolling report (thin v1).
//
// Shape mirrors the IG report (per-snapshot sections with deltas, archive
// split at the 12-snapshot rolling boundary) but the content is intentionally
// minimal — see audit.ts and docs/APP_REVIEW.md for why engagement data is
// absent until App Review.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "../../core/db/client.js";
import {
  toReadableEtDate,
  toReadableEtTimestamp,
  toShortReadableEt,
} from "../../core/lib/time.js";
import { migrateLegacyOrphans } from "../../core/reports/catalog.js";
import { CAPTION_PREVIEW_CHARS, truncateCaption } from "../../core/reports/_shared.js";
import type { ClientRef, GenerateReportResult } from "../instagram/markdown-report.js";

type Snapshot = {
  id: number;
  captured_at: string;
  lookback_days: number;
};

type AccountRow = {
  followers_count: number;
  follows_count: number;
  posts_count: number;
  platform_extras: string | null;
};

type FacebookPageAccountExtras = {
  fan_count?: number;
  page_name?: string;
  engagement_pending_app_review?: boolean;
};

type AccountSummary = {
  followers_count: number;
  fan_count: number;
  posts_captured: number;
  page_name: string | null;
  engagement_pending: boolean;
};

type PostRow = {
  external_post_id: string;
  media_type: string;
  caption: string | null;
  permalink: string;
  published_at: string;
  is_supplemental: number;
};

const REPORTS_DIR = resolve("reports");
const ROLLING_WINDOW = 12;
const MESSAGE_PREVIEW_CHARS = CAPTION_PREVIEW_CHARS;

function parseAccount(row: AccountRow): AccountSummary {
  const extras = (
    row.platform_extras ? JSON.parse(row.platform_extras) : {}
  ) as FacebookPageAccountExtras;
  return {
    followers_count: row.followers_count,
    fan_count: extras.fan_count ?? 0,
    posts_captured: row.posts_count,
    page_name: extras.page_name ?? null,
    engagement_pending: extras.engagement_pending_app_review === true,
  };
}

export function generateFacebookPageReport(
  client: ClientRef,
): GenerateReportResult {
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
  lines.push(`# Facebook Page Audit — ${client.display_name}`);
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
  lines.push(renderAppReviewBanner());
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
  lines.push(`# Facebook Page Audit — ${client.display_name} (Archive)`);
  lines.push("");
  lines.push(`**Generated On:** ${toReadableEtTimestamp(generatedAtIso)}`);
  lines.push("");
  lines.push(
    `*Snapshots older than the most recent ${ROLLING_WINDOW}. See \`rolling.md\` for current.*`,
  );
  lines.push("");
  lines.push(sections.join("\n"));
  lines.push("---");
  lines.push(
    `*Generated by AnalyticsAudit v0.1.0 · ${toReadableEtTimestamp(generatedAtIso)}*`,
  );
  lines.push("");
  return lines.join("\n");
}

function renderAppReviewBanner(): string {
  return [
    "> **⚠ Engagement data pending Meta App Review.** This thin v1 report captures Page profile (followers, fans) and post inventory (id, type, message, timestamp, permalink). Reactions, comments, shares, per-post reach, and page-level insights require Meta to approve our app for `pages_read_engagement`. See [APP_REVIEW.md](../../../docs/APP_REVIEW.md) for the unblock path. Page demographics were removed by Meta in Graph v22+ and won't return even after review.",
  ].join("\n");
}

function renderSnapshotSection(
  snap: Snapshot,
  prior: Snapshot | undefined,
): string {
  const account = db
    .prepare(
      `SELECT followers_count, follows_count, posts_count, platform_extras
         FROM account_metrics WHERE snapshot_id = ?`,
    )
    .get(snap.id) as AccountRow | undefined;
  const posts = db
    .prepare(
      `SELECT external_post_id, media_type, caption, permalink, published_at, is_supplemental
         FROM post_metrics
         WHERE snapshot_id = ?
         ORDER BY published_at DESC`,
    )
    .all(snap.id) as PostRow[];

  const priorAccount = prior
    ? (db
        .prepare(
          `SELECT followers_count, follows_count, posts_count, platform_extras
             FROM account_metrics WHERE snapshot_id = ?`,
        )
        .get(prior.id) as AccountRow | undefined)
    : undefined;

  const lines: string[] = [];
  lines.push(
    `## ${toReadableEtDate(snap.captured_at)} — Snapshot #${snap.id}`,
  );
  lines.push("");
  lines.push(`- **Captured:** ${toReadableEtTimestamp(snap.captured_at)}`);
  if (prior) {
    lines.push(
      `- **Prior:** #${prior.id} captured ${toReadableEtTimestamp(prior.captured_at)} (${relativeAge(snap.captured_at, prior.captured_at)})`,
    );
  } else {
    lines.push("- **Prior:** *(none — first snapshot for this client)*");
  }
  lines.push("");

  if (account) {
    const summary = parseAccount(account);
    const priorSummary = priorAccount ? parseAccount(priorAccount) : undefined;
    lines.push(renderAccountTable(summary, priorSummary));
    lines.push("");
  }

  lines.push(renderPostsTable(posts));
  lines.push("");

  return lines.join("\n");
}

function renderAccountTable(
  summary: AccountSummary,
  prior: AccountSummary | undefined,
): string {
  const lines: string[] = [];
  lines.push("### Account");
  lines.push("");
  if (summary.page_name !== null) {
    lines.push(`**Page Name:** ${summary.page_name}`);
    lines.push("");
  }
  lines.push("| Metric | Current | Change |");
  lines.push("|---|---:|---:|");
  lines.push(
    `| Followers | ${formatNumber(summary.followers_count)} | ${formatDelta(summary.followers_count, prior?.followers_count)} |`,
  );
  lines.push(
    `| Fans (legacy "Page Likes") | ${formatNumber(summary.fan_count)} | ${formatDelta(summary.fan_count, prior?.fan_count)} |`,
  );
  lines.push(
    `| Posts Captured This Snapshot | ${formatNumber(summary.posts_captured)} | — |`,
  );
  if (summary.engagement_pending) {
    lines.push("");
    lines.push(
      "*Engagement metrics (reach, reactions, comments, shares, CTA clicks) pending Meta App Review.*",
    );
  }
  return lines.join("\n");
}

function renderPostsTable(posts: PostRow[]): string {
  const lines: string[] = [];
  lines.push("### Posts");
  lines.push("");
  if (posts.length === 0) {
    lines.push("*No posts captured in this snapshot.*");
    return lines.join("\n");
  }
  const supplementalCount = posts.filter((p) => p.is_supplemental === 1).length;
  const inWindowCount = posts.length - supplementalCount;
  lines.push(
    `Captured ${posts.length} post(s): ${inWindowCount} in-window, ${supplementalCount} supplemental (marked \`†\`).`,
  );
  lines.push("");
  lines.push("| | Type | Posted | Message | Link |");
  lines.push("|---|---|---|---|---|");
  for (const p of posts) {
    const supMark = p.is_supplemental === 1 ? "†" : "";
    const messagePreview = truncateCaption(p.caption, MESSAGE_PREVIEW_CHARS);
    const posted = toShortReadableEt(p.published_at);
    const link = p.permalink
      ? `[view](${p.permalink})`
      : "—";
    lines.push(
      `| ${supMark} | ${p.media_type} | ${posted} | ${escapeTableCell(messagePreview)} | ${link} |`,
    );
  }
  lines.push("");
  lines.push(
    "*Engagement columns (Reactions / Comments / Shares / Reach) will appear here once Meta App Review is approved.*",
  );
  return lines.join("\n");
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatDelta(current: number, prior: number | undefined): string {
  if (prior === undefined) return "—";
  const diff = current - prior;
  if (diff === 0) return "0 (—)";
  const pct = prior === 0 ? "—" : `${((diff / prior) * 100).toFixed(1)}%`;
  const sign = diff > 0 ? "+" : "";
  const pctText = pct === "—" ? "—" : `${sign}${pct}`;
  return `${sign}${formatNumber(diff)} (${pctText})`;
}

function relativeAge(currentIso: string, priorIso: string): string {
  const ms =
    new Date(currentIso).getTime() - new Date(priorIso).getTime();
  const mins = Math.round(ms / 1000 / 60);
  if (mins < 60) return `${mins} min earlier`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr earlier`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} earlier`;
}

function escapeTableCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
