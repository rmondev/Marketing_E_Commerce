// Facebook Page HTML trend report (thin v1).
//
// What this renders:
//   - Header with Page name + Generated timestamp + the App Review banner
//   - 3 KPI cards (Followers, Fans, Posts Captured This Snapshot) with inline
//     SVG sparklines across the most recent WINDOW_SIZE snapshots
//   - Posts table — content inventory for the latest snapshot
//
// What this does NOT render (gated by Meta App Review — see APP_REVIEW.md):
//   - Audience donuts (FB Page demographics are also deprecated by Meta)
//   - Engagement KPI cards (reach, post engagements, CTA clicks, reactions)
//   - Per-post engagement columns (reactions, comments, shares, reach)
//   - Likes-per-post-across-window chart
//
// When App Review approves the app, the audit captures engagement data; flip
// the flags inside renderHtml to render the additional sections.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "../../core/db/client.js";
import {
  toFilenameSafeTimestampEt,
  toLongDateEt,
  toReadableEtTimestamp,
  toShortReadableEt,
} from "../../core/lib/time.js";
import {
  generateCatalog,
  migrateLegacyOrphans,
  upsertManifestEntry,
} from "../../core/reports/catalog.js";
import { CAPTION_PREVIEW_CHARS, truncateCaption } from "../../core/reports/_shared.js";
import type { ClientRef } from "../instagram/markdown-report.js";
import type { GenerateTrendResult } from "../instagram/trend-report.js";

const REPORTS_DIR = resolve("reports");
const WINDOW_SIZE = 4;
const MESSAGE_PREVIEW_CHARS = CAPTION_PREVIEW_CHARS;

type Snapshot = {
  id: number;
  captured_at: string;
};

type AccountDbRow = {
  snapshot_id: number;
  followers_count: number;
  posts_count: number;
  platform_extras: string | null;
};

type AccountSummary = {
  snapshot_id: number;
  followers_count: number;
  fan_count: number;
  posts_captured: number;
  page_name: string | null;
  engagement_pending: boolean;
};

type PostDbRow = {
  external_post_id: string;
  media_type: string;
  caption: string | null;
  permalink: string;
  published_at: string;
  is_supplemental: number;
};

type FacebookPageExtras = {
  fan_count?: number;
  page_name?: string;
  engagement_pending_app_review?: boolean;
};

function parseAccount(row: AccountDbRow): AccountSummary {
  const extras = (
    row.platform_extras ? JSON.parse(row.platform_extras) : {}
  ) as FacebookPageExtras;
  return {
    snapshot_id: row.snapshot_id,
    followers_count: row.followers_count,
    fan_count: extras.fan_count ?? 0,
    posts_captured: row.posts_count,
    page_name: extras.page_name ?? null,
    engagement_pending: extras.engagement_pending_app_review === true,
  };
}

export function generateFacebookPageTrendReport(
  client: ClientRef,
): GenerateTrendResult | null {
  const snapshots = db
    .prepare(
      `SELECT id, captured_at FROM snapshots
         WHERE platform_account_id = ?
         ORDER BY id DESC
         LIMIT ?`,
    )
    .all(client.platform_account_id, WINDOW_SIZE) as Snapshot[];
  if (snapshots.length === 0) return null;

  const latest = snapshots[0]!;
  const prior = snapshots[1];
  const ids = snapshots.map((s) => s.id);
  const placeholders = ids.map(() => "?").join(",");

  const accountRows = (
    db
      .prepare(
        `SELECT snapshot_id, followers_count, posts_count, platform_extras
           FROM account_metrics
           WHERE snapshot_id IN (${placeholders})`,
      )
      .all(...ids) as AccountDbRow[]
  ).map(parseAccount);
  const accountById = new Map(accountRows.map((r) => [r.snapshot_id, r]));

  const latestPosts = db
    .prepare(
      `SELECT external_post_id, media_type, caption, permalink, published_at, is_supplemental
         FROM post_metrics
         WHERE snapshot_id = ?
         ORDER BY published_at DESC`,
    )
    .all(latest.id) as PostDbRow[];

  const html = renderHtml({
    client,
    snapshots,
    latest,
    prior,
    accountById,
    latestPosts,
  });

  migrateLegacyOrphans(REPORTS_DIR);
  const trendDir = resolve(
    REPORTS_DIR,
    client.short_name,
    client.platform,
    "trend",
  );
  mkdirSync(trendDir, { recursive: true });

  const generatedAtIso = new Date().toISOString();
  const filename = `${toFilenameSafeTimestampEt(generatedAtIso)}.html`;
  const trendPath = resolve(trendDir, filename);
  writeFileSync(trendPath, html, "utf-8");

  upsertManifestEntry(trendDir, {
    filename,
    generated_at: generatedAtIso,
    snapshot_id: latest.id,
    snapshot_captured_at: latest.captured_at,
    lookback_days: 7,
  });

  const catalogPath = generateCatalog({
    trendDir,
    client: {
      short_name: client.short_name,
      display_name: client.display_name,
    },
    platform: client.platform,
  });

  return { trendPath, catalogPath };
}

type RenderInput = {
  client: ClientRef;
  snapshots: Snapshot[];
  latest: Snapshot;
  prior: Snapshot | undefined;
  accountById: Map<number, AccountSummary>;
  latestPosts: PostDbRow[];
};

function renderHtml(input: RenderInput): string {
  const { client, snapshots, latest, prior, accountById, latestPosts } = input;
  const latestAcct = accountById.get(latest.id);
  const priorAcct = prior ? accountById.get(prior.id) : undefined;
  // Series for sparklines: oldest → newest (reverse the desc-ordered list).
  const seriesAsc = [...snapshots].reverse();

  const followersSeries = seriesAsc.map(
    (s) => accountById.get(s.id)?.followers_count ?? 0,
  );
  const fansSeries = seriesAsc.map(
    (s) => accountById.get(s.id)?.fan_count ?? 0,
  );
  const postsSeries = seriesAsc.map(
    (s) => accountById.get(s.id)?.posts_captured ?? 0,
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Facebook Page Audit — ${escapeHtml(client.display_name)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #fafafa;
    --card: #ffffff;
    --border: #e5e7eb;
    --text: #111827;
    --text-muted: #6b7280;
    --accent: #1877f2;
    --warn-bg: #fff7ed;
    --warn-border: #fdba74;
    --warn-text: #9a3412;
  }
  * { box-sizing: border-box; }
  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    margin: 0; padding: 32px 24px; background: var(--bg); color: var(--text);
    max-width: 1100px; margin-left: auto; margin-right: auto;
    -webkit-font-smoothing: antialiased;
  }
  .eyebrow {
    font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--text-muted); font-weight: 600;
  }
  h1 { margin: 4px 0 8px; font-size: 28px; font-weight: 700; }
  .meta { color: var(--text-muted); font-size: 14px; margin-bottom: 24px; }
  .banner {
    background: var(--warn-bg); border-left: 4px solid var(--warn-border);
    color: var(--warn-text); padding: 16px 20px; border-radius: 8px;
    font-size: 14px; line-height: 1.55; margin-bottom: 28px;
  }
  .banner strong { color: var(--warn-text); }
  .banner a { color: var(--warn-text); }
  .kpi-grid {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;
    margin-bottom: 32px;
  }
  .kpi {
    background: var(--card); border: 1px solid var(--border); border-radius: 12px;
    padding: 20px;
  }
  .kpi-label {
    font-size: 12px; color: var(--text-muted); font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.06em;
  }
  .kpi-value {
    font-size: 32px; font-weight: 700; margin: 8px 0 4px;
    font-variant-numeric: tabular-nums;
  }
  .kpi-delta {
    font-size: 13px; color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .kpi-delta.up { color: #15803d; }
  .kpi-delta.down { color: #b91c1c; }
  .kpi-spark { margin-top: 12px; height: 36px; }
  .kpi-desc {
    margin-top: 10px; font-size: 12px; color: var(--text-muted);
    line-height: 1.45;
  }
  section { margin-bottom: 36px; }
  h2 {
    font-size: 18px; font-weight: 600; margin: 0 0 14px;
    padding-bottom: 8px; border-bottom: 1px solid var(--border);
  }
  table {
    width: 100%; border-collapse: collapse; background: var(--card);
    border: 1px solid var(--border); border-radius: 12px; overflow: hidden;
    font-size: 14px;
  }
  th, td { padding: 12px 14px; text-align: left; }
  thead th {
    background: #f9fafb; font-weight: 600; color: var(--text-muted);
    border-bottom: 1px solid var(--border); font-size: 12px;
    text-transform: uppercase; letter-spacing: 0.05em;
  }
  tbody tr + tr { border-top: 1px solid var(--border); }
  td.sup { color: var(--text-muted); text-align: center; width: 24px; }
  td.type {
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 12px; color: var(--text-muted);
  }
  td a { color: var(--accent); text-decoration: none; }
  td a:hover { text-decoration: underline; }
  .pending-note {
    font-size: 12px; color: var(--text-muted); margin-top: 12px;
    font-style: italic;
  }
  footer {
    margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--border);
    font-size: 12px; color: var(--text-muted); text-align: center;
  }
</style>
</head>
<body>
  <div class="eyebrow">Facebook Page Audit</div>
  <h1>${escapeHtml(client.display_name)}${
    latestAcct?.page_name && latestAcct.page_name !== client.display_name
      ? ` <span style="color:var(--text-muted);font-weight:500">· ${escapeHtml(latestAcct.page_name)}</span>`
      : ""
  }</h1>
  <div class="meta">
    Generated ${toReadableEtTimestamp(new Date().toISOString())} · Latest snapshot #${latest.id} captured ${toLongDateEt(latest.captured_at)}
  </div>

  <div class="banner">
    <strong>⚠ Engagement data pending Meta App Review.</strong> This thin v1 report
    shows Page identity (followers, fans) and a content inventory of recent posts.
    Reactions, comments, shares, per-post reach, page-level insights (impressions,
    CTA clicks, engagement actions), and audience demographics require Meta to
    approve our app for <code>pages_read_engagement</code>. See <code>docs/APP_REVIEW.md</code>
    for the unblock path. Page demographics were removed by Meta in Graph v22+ and
    won't return even after review.
  </div>

  <section>
    <h2>Account</h2>
    <div class="kpi-grid">
      ${renderKpi("Followers", latestAcct?.followers_count ?? 0, priorAcct?.followers_count, followersSeries, "People who follow this Page (the modern engagement-relevant count).")}
      ${renderKpi("Fans (legacy Page Likes)", latestAcct?.fan_count ?? 0, priorAcct?.fan_count, fansSeries, "The legacy \"Page Likes\" count. Often matches followers but tracks separately.")}
      ${renderKpi("Posts Captured", latestAcct?.posts_captured ?? 0, priorAcct?.posts_captured, postsSeries, "Number of posts pulled into this snapshot. Up to 50 most recent, fills supplementally when fewer than 5 in the lookback window.")}
    </div>
  </section>

  <section>
    <h2>Posts</h2>
    ${renderPostsTable(latestPosts)}
    <div class="pending-note">
      Engagement columns (Reactions, Comments, Shares, Reach, ER) will appear here once Meta App Review approves <code>pages_read_engagement</code>.
    </div>
  </section>

  <footer>
    AnalyticsAudit v0.1.0 · Snapshot #${latest.id} · ${toReadableEtTimestamp(latest.captured_at)}
  </footer>
</body>
</html>`;
}

function renderKpi(
  label: string,
  current: number,
  prior: number | undefined,
  series: number[],
  description: string,
): string {
  const delta = formatKpiDelta(current, prior);
  return `
    <div class="kpi">
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="kpi-value">${current.toLocaleString("en-US")}</div>
      <div class="kpi-delta ${delta.dirClass}">${escapeHtml(delta.text)}</div>
      <div class="kpi-spark">${renderSparkline(series)}</div>
      <div class="kpi-desc">${escapeHtml(description)}</div>
    </div>
  `.trim();
}

function formatKpiDelta(
  current: number,
  prior: number | undefined,
): { text: string; dirClass: string } {
  if (prior === undefined) return { text: "first snapshot", dirClass: "" };
  const diff = current - prior;
  if (diff === 0) return { text: "Change: 0", dirClass: "" };
  const sign = diff > 0 ? "+" : "";
  const pct = prior === 0 ? "—" : `${((diff / prior) * 100).toFixed(1)}%`;
  const dirClass = diff > 0 ? "up" : "down";
  const pctText = pct === "—" ? "—" : `${sign}${pct}`;
  return { text: `Change: ${sign}${diff.toLocaleString("en-US")} (${pctText})`, dirClass };
}

// Inline SVG sparkline — no JS framework needed for 3 small charts.
function renderSparkline(series: number[]): string {
  if (series.length === 0) return "";
  const W = 220;
  const H = 36;
  const PAD = 2;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const step = (W - 2 * PAD) / Math.max(1, series.length - 1);
  const points = series
    .map((v, i) => {
      const x = PAD + i * step;
      const y = PAD + (H - 2 * PAD) * (1 - (v - min) / range);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const lastX = PAD + (series.length - 1) * step;
  const lastY =
    PAD + (H - 2 * PAD) * (1 - (series[series.length - 1]! - min) / range);
  return `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:${H}px;display:block">
      <polyline fill="none" stroke="#1877f2" stroke-width="2" points="${points}" />
      <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="2.5" fill="#1877f2" />
    </svg>
  `.trim();
}

function renderPostsTable(posts: PostDbRow[]): string {
  if (posts.length === 0) {
    return `<p style="color:var(--text-muted)">No posts captured in this snapshot.</p>`;
  }
  const rows = posts
    .map((p) => {
      const sup = p.is_supplemental === 1 ? "†" : "";
      const message = truncateCaption(p.caption, MESSAGE_PREVIEW_CHARS);
      const link = p.permalink
        ? `<a href="${escapeHtml(p.permalink)}" target="_blank" rel="noopener">view</a>`
        : "—";
      return `<tr>
        <td class="sup">${sup}</td>
        <td class="type">${escapeHtml(p.media_type)}</td>
        <td>${escapeHtml(toShortReadableEt(p.published_at))}</td>
        <td>${escapeHtml(message)}</td>
        <td>${link}</td>
      </tr>`;
    })
    .join("");
  return `
    <table>
      <thead>
        <tr><th></th><th>Type</th><th>Posted</th><th>Message</th><th>Link</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `.trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
