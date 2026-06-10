// Facebook Page HTML trend report (thin v1). Visual language matches the
// Instagram trend report (Inter font, two-tier eyebrow + title header,
// header-info card, KPI cards with Chart.js sparklines, sortable posts
// table, dark-mode-aware palette) so an operator comparing platforms sees
// a consistent dashboard.
//
// What this renders today:
//   - Two-tier report header (eyebrow date + Page display name)
//   - Header-info card (Generated / Latest Snapshot / Comparing To)
//   - App Review banner (styled as a glossary-style call-out)
//   - Account section: 3 KPI cards (Followers, Fans, Posts Captured) with
//     Chart.js sparklines, deltas, descriptions
//   - Posts section: sortable content-inventory table with collapsible
//     message previews
//
// What this does NOT render (gated by Meta App Review — see APP_REVIEW.md):
//   - Engagement KPI cards (reach, page views, CTA clicks, follows, etc.)
//   - Audience donuts (FB Page demographics are also permanently deprecated)
//   - Reactions/comments/shares/per-post-reach columns in the Posts table
//   - Likes-per-post-across-window evolution chart
//
// When App Review approves the app, the audit captures engagement data and
// the additional sections can be wired in alongside the existing KPI grid.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "../../core/db/client.js";
import {
  toEtTimestamp,
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
import {
  CAPTION_PREVIEW_CHARS,
  HASHTAGS_PER_ROW,
  extractHashtags,
  truncateCaption,
} from "../../core/reports/_shared.js";
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

// Visible KPI cards in the Account section. Keeping the structure parallel
// to IG's ACCOUNT_METRICS so the rendering code can share a template.
type KpiKey = "followers_count" | "fan_count" | "posts_captured";
type KpiDef = {
  key: KpiKey;
  label: string;
  sparkId: string;
  description: string;
};
const KPI_DEFS: readonly KpiDef[] = [
  {
    key: "followers_count",
    label: "Followers",
    sparkId: "spark-followers",
    description:
      "People who follow this Page. The modern, engagement-relevant audience number.",
  },
  {
    key: "fan_count",
    label: "Fans (legacy Page Likes)",
    sparkId: "spark-fans",
    description:
      "The legacy 'Page Likes' count. Often matches followers but tracks separately. Kept for continuity with older Meta tooling.",
  },
  {
    key: "posts_captured",
    label: "Posts Captured",
    sparkId: "spark-posts",
    description:
      "Number of posts pulled into this snapshot. Up to 50 most recent are scanned; supplemental rows fill when fewer than 5 are in the lookback window.",
  },
];

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

  const chronological = [...snapshots].reverse();
  // Multi-line chart x-axis labels: Chart.js renders each array element on
  // its own line. Top line is the snapshot identifier, bottom line is the
  // capture date in long form.
  const chronoLabels: string[][] = chronological.map((s) => [
    `Snapshot #${s.id}`,
    `- ${toLongDateEt(s.captured_at)} -`,
  ]);

  const kpiCards = KPI_DEFS.map((m) => renderKpiCard(m, input)).join("");

  const sparkSeries = Object.fromEntries(
    KPI_DEFS.map((m) => [
      m.sparkId,
      chronological.map((s) => accountById.get(s.id)?.[m.key] ?? 0),
    ]),
  );

  const generatedAtIso = new Date().toISOString();
  const generatedReadable = toReadableEtTimestamp(generatedAtIso);
  const generatedCompact = toEtTimestamp(generatedAtIso);
  const eyebrowDate = toLongDateEt(latest.captured_at);
  const latestAcct = accountById.get(latest.id);
  const headerSubtitle =
    latestAcct?.page_name && latestAcct.page_name !== client.display_name
      ? latestAcct.page_name
      : null;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Facebook Page Audit — ${escapeHtml(client.display_name)} (Trend)</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root {
    color-scheme: light dark;
    --border: #d8dadf;
    --muted: #6b7280;
    --pos: #1f8a55;
    --neg: #c4452a;
    --zero: #6b7280;
    --card-bg: rgba(127,127,127,0.04);
    --accent: #4e79a7;
    --warn-bg: #fff7ed;
    --warn-border: #fdba74;
    --warn-text: #9a3412;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --border: #3a3d44; --muted: #9ba1ab; --card-bg: rgba(255,255,255,0.04);
      --accent: #82a8d3;
      --warn-bg: rgba(154,52,18,0.16); --warn-border: #b45309; --warn-text: #fdba74;
    }
  }
  body { font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         max-width: 1180px; margin: 2rem auto; padding: 0 1.25rem; line-height: 1.55;
         font-feature-settings: "cv11", "ss01"; }
  /* Two-tier report header — eyebrow + title, accent-colored, matches IG. */
  .report-header { margin: 0 0 1.5rem; padding-bottom: 1.1rem;
                   border-bottom: 1px solid var(--border); }
  .report-eyebrow { margin: 0 0 0.6rem; font-size: 0.98rem; font-weight: 600;
                    text-transform: uppercase; letter-spacing: 0.14em;
                    color: var(--accent); }
  .report-title { margin: 0; font-size: 2.7rem; font-weight: 700;
                  letter-spacing: -0.02em; line-height: 1.05;
                  color: var(--accent); }
  .report-subtitle { margin: 0.3rem 0 0; font-size: 1rem; font-weight: 500;
                     color: var(--muted); }
  h2 { margin: 2.5rem 0 0.75rem; font-size: 1.35rem; }
  h3 { margin: 1.75rem 0 0.75rem; font-size: 1.05rem; color: var(--muted);
       text-transform: uppercase; letter-spacing: 0.04em; }
  p { margin: 0.5rem 0; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  .header-info { border: 1px solid var(--border); background: var(--card-bg);
                 border-radius: 8px; padding: 0.85rem 1rem; margin: 0.5rem 0 1.5rem;
                 font-size: 0.95rem; }
  .header-info > div { margin: 0.2rem 0; }
  .header-info strong { color: var(--muted); font-weight: 600; }

  /* App Review banner — same visual weight as the IG glossary card but
     warning-colored so its blocking nature is obvious. */
  .app-review-banner { border: 1px solid var(--warn-border); background: var(--warn-bg);
                       color: var(--warn-text); border-left: 4px solid var(--warn-border);
                       border-radius: 8px; padding: 0.85rem 1rem 0.95rem;
                       margin: 1rem 0 2rem; font-size: 0.92rem; line-height: 1.55; }
  .app-review-banner strong { color: var(--warn-text); }
  .app-review-banner code { background: rgba(127,127,127,0.18); padding: 0.05rem 0.3rem;
                            border-radius: 3px; font-size: 0.9em; }

  .section-intro { color: var(--muted); margin: 0.25rem 0 1rem; font-size: 0.95rem; }
  .section-intro strong { color: inherit; }

  .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
              gap: 0.75rem; }
  .kpi-card { border: 1px solid var(--border); background: var(--card-bg);
              padding: 0.85rem 1rem; border-radius: 8px; display: flex;
              flex-direction: column; gap: 0.45rem; }
  .kpi-label { font-size: 0.75rem; color: var(--muted); text-transform: uppercase;
               letter-spacing: 0.05em; }
  .kpi-current { font-size: 1.75rem; font-weight: 600; font-variant-numeric: tabular-nums;
                 line-height: 1.1; }
  .kpi-delta-row { font-size: 0.85rem; font-variant-numeric: tabular-nums;
                   display: flex; align-items: baseline; gap: 0.4rem; }
  .kpi-delta-label { color: var(--muted); font-size: 0.8rem; }
  .kpi-delta.pos { color: var(--pos); font-weight: 600; }
  .kpi-delta.neg { color: var(--neg); font-weight: 600; }
  .kpi-delta.zero { color: var(--zero); }
  .kpi-spark { height: 36px; position: relative; }
  .kpi-spark-empty { height: 36px; color: var(--muted); font-size: 0.75rem;
                     display: flex; align-items: center; font-style: italic; }
  .kpi-desc { font-size: 0.78rem; color: var(--muted); line-height: 1.4; margin-top: 0.15rem; }

  .pending-section { border: 1px dashed var(--border); background: var(--card-bg);
                     border-radius: 8px; padding: 1rem 1.25rem; margin: 1rem 0 0;
                     color: var(--muted); font-size: 0.92rem; line-height: 1.55;
                     font-style: italic; }
  .pending-section strong { color: var(--muted); }

  .posts-summary { color: var(--muted); margin-bottom: 0.75rem; font-size: 0.9rem; }
  .posts-table-wrap { overflow-x: auto; margin: 0.5rem 0; }
  table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums;
          font-size: 0.9rem; min-width: 720px; }
  thead th { font-size: 0.78rem; color: var(--muted); text-transform: uppercase;
             letter-spacing: 0.04em; font-weight: 600; }
  thead th[data-sort-key] { cursor: pointer; user-select: none; }
  thead th[data-sort-key]:hover { color: var(--accent); }
  thead th[data-sort-key]::after { content: "⇅"; display: inline-block;
                                    margin-left: 0.3em; opacity: 0.35; font-size: 0.85em; }
  thead th[data-sort-key].sort-asc::after  { content: "↑"; opacity: 1; color: var(--accent); }
  thead th[data-sort-key].sort-desc::after { content: "↓"; opacity: 1; color: var(--accent); }
  th, td { padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--border);
           text-align: left; vertical-align: top; }
  .supp-marker { color: var(--muted); font-weight: 600; width: 1.5em; text-align: center; }

  .message-cell, .hashtag-cell { max-width: 280px; }
  .message-cell summary, .hashtag-cell summary { cursor: pointer; list-style: revert;
                                                  font-size: 0.9rem; }
  .message-cell .message-full { margin-top: 0.4rem; padding: 0.4rem 0.6rem;
                                 background: var(--card-bg); border-radius: 4px;
                                 white-space: pre-wrap; font-size: 0.88rem; }
  .message-empty { color: var(--muted); font-style: italic; font-size: 0.85rem; }
  .hashtag-cell .hashtag-summary-inner { display: flex; flex-wrap: wrap;
                                          gap: 0.25rem 0.4rem; }
  .hashtag-cell .hashtag-more-list { margin-top: 0.4rem; padding: 0.4rem 0.6rem;
                                     background: var(--card-bg); border-radius: 4px;
                                     display: flex; flex-wrap: wrap; gap: 0.25rem 0.4rem; }
  .hashtag-cell a { font-size: 0.85rem; }
  .hashtag-more-badge { font-size: 0.8rem; color: var(--muted);
                        background: rgba(127,127,127,0.12); padding: 0.05rem 0.4rem;
                        border-radius: 10px; }
  .hashtag-empty { color: var(--muted); }

  footer { margin-top: 3rem; color: var(--muted); font-size: 0.85rem;
           border-top: 1px solid var(--border); padding-top: 1rem; }
</style>
</head>
<body>
  <header class="report-header">
    <p class="report-eyebrow">Facebook Page Audit Report · ${escapeHtml(eyebrowDate)}</p>
    <h1 class="report-title">${escapeHtml(client.display_name)}</h1>
    ${headerSubtitle ? `<p class="report-subtitle">${escapeHtml(headerSubtitle)}</p>` : ""}
  </header>

  ${renderHeaderInfo(generatedReadable, latest, prior, snapshots.length)}

  ${renderAppReviewBanner()}

  <h2>Account</h2>
  <p class="section-intro">Snapshot of the Page at this point in time. <strong>Followers</strong> is the modern engagement-relevant count; <strong>Fans</strong> is the legacy "Page Likes" number, kept for continuity. <strong>Posts Captured</strong> reflects how many posts the audit pulled into this snapshot (not the lifetime total).</p>
  <div class="kpi-grid">${kpiCards}</div>

  <h2>Audience</h2>
  <div class="pending-section">
    <strong>Audience demographics unavailable.</strong> Page-level demographic metrics (fan country / city / age / gender) were removed by Meta in Graph v22+. Unlike the engagement metrics below, these will <em>not</em> return after App Review — the data is only viewable in Meta Business Suite. See <code>docs/APP_REVIEW.md</code>.
  </div>

  <h2>Posts</h2>
  ${renderPostsSection(latestPosts)}
  <div class="pending-section" style="margin-top: 1rem;">
    <strong>Engagement columns pending Meta App Review.</strong> Reactions, comments, shares, per-post reach, and ER will appear here once our app is approved for <code>pages_read_engagement</code>.
  </div>

  <footer>Generated by AnalyticsAudit v0.1.0 · ${escapeHtml(generatedCompact)}</footer>

<script>
const sparkSeries = ${JSON.stringify(sparkSeries)};
const sparkLabels = ${JSON.stringify(chronoLabels)};

const sparkOpts = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  scales: { x: { display: false }, y: { display: false } },
  animation: false,
  elements: { point: { radius: 0 }, line: { borderWidth: 1.5, tension: 0.25 } },
};

for (const [id, data] of Object.entries(sparkSeries)) {
  const canvas = document.getElementById(id);
  if (!canvas || data.length < 2) continue;
  new Chart(canvas, {
    type: "line",
    data: { labels: sparkLabels, datasets: [{ data, borderColor: "#4e79a7", fill: false }] },
    options: sparkOpts,
  });
}

// Click-to-sort on the Posts table. Same pattern as the IG report.
(function setupPostsSort() {
  const table = document.querySelector(".posts-table");
  if (!table) return;
  const tbody = table.querySelector("tbody");
  const headers = Array.from(table.querySelectorAll("thead th"));
  let currentTh = null;
  let currentDir = "asc";

  headers.forEach((th, colIdx) => {
    if (!th.dataset.sortKey) return;
    th.addEventListener("click", () => {
      const type = th.dataset.sortType || "text";
      const dir = th === currentTh && currentDir === "asc" ? "desc" : "asc";
      headers.forEach((h) => h.classList.remove("sort-asc", "sort-desc"));
      th.classList.add(dir === "asc" ? "sort-asc" : "sort-desc");
      currentTh = th;
      currentDir = dir;

      const rows = Array.from(tbody.querySelectorAll("tr"));
      rows.sort((a, b) => {
        const av = a.children[colIdx].dataset.sortValue ?? "";
        const bv = b.children[colIdx].dataset.sortValue ?? "";
        if (av === "" && bv === "") return 0;
        if (av === "") return 1;
        if (bv === "") return -1;
        let cmp;
        if (type === "number") {
          cmp = parseFloat(av) - parseFloat(bv);
        } else if (type === "date") {
          cmp = new Date(av).getTime() - new Date(bv).getTime();
        } else {
          cmp = av.localeCompare(bv);
        }
        return dir === "asc" ? cmp : -cmp;
      });
      rows.forEach((r) => tbody.appendChild(r));
    });
  });
})();
</script>
</body>
</html>
`;
}

function renderHeaderInfo(
  generatedReadable: string,
  latest: Snapshot,
  prior: Snapshot | undefined,
  windowCount: number,
): string {
  const lines: string[] = [];
  lines.push(
    `<div><strong>Generated On:</strong> ${escapeHtml(generatedReadable)}</div>`,
  );
  lines.push(
    `<div><strong>Latest Snapshot:</strong> #${latest.id} — Captured on ${escapeHtml(toReadableEtTimestamp(latest.captured_at))}</div>`,
  );
  if (prior) {
    lines.push(
      `<div><strong>Comparing To Snapshot:</strong> #${prior.id} — Captured on ${escapeHtml(toReadableEtTimestamp(prior.captured_at))}</div>`,
    );
  } else {
    lines.push(
      `<div><strong>Comparing To Snapshot:</strong> <em>None — first snapshot for this client.</em></div>`,
    );
  }
  if (windowCount < WINDOW_SIZE) {
    lines.push(
      `<div><strong>Window:</strong> ${windowCount}/${WINDOW_SIZE} snapshots available — trend visuals will be richer once more snapshots accumulate.</div>`,
    );
  }
  return `<div class="header-info">${lines.join("\n  ")}</div>`;
}

function renderAppReviewBanner(): string {
  return `<div class="app-review-banner">
  <strong>⚠ Engagement data pending Meta App Review.</strong> This thin v1
  report shows Page identity (followers, fans) and a content inventory of
  recent posts. Reactions, comments, shares, per-post reach, page-level
  insights (impressions, CTA clicks, engagement actions), and audience
  demographics require Meta to approve our app for
  <code>pages_read_engagement</code>. See <code>docs/APP_REVIEW.md</code>
  for the unblock path.
</div>`;
}

function renderKpiCard(metric: KpiDef, input: RenderInput): string {
  const { latest, prior, accountById, snapshots } = input;
  const currentVal = accountById.get(latest.id)?.[metric.key];
  const priorVal = prior ? accountById.get(prior.id)?.[metric.key] : undefined;

  const currentDisplay =
    currentVal === undefined ? "—" : currentVal.toLocaleString("en-US");
  const delta = renderDelta(currentVal, priorVal);

  const sparkHtml =
    snapshots.length >= 2
      ? `<div class="kpi-spark"><canvas id="${metric.sparkId}"></canvas></div>`
      : `<div class="kpi-spark-empty">trend needs ≥2 snapshots</div>`;

  return `
  <div class="kpi-card">
    <div class="kpi-label">${escapeHtml(metric.label)}</div>
    <div class="kpi-current">${escapeHtml(currentDisplay)}</div>
    <div class="kpi-delta-row">
      <span class="kpi-delta-label">Change:</span>
      <span class="kpi-delta ${delta.cls}">${escapeHtml(delta.text)}</span>
    </div>
    ${sparkHtml}
    <div class="kpi-desc">${escapeHtml(metric.description)}</div>
  </div>`;
}

function renderDelta(
  current: number | undefined,
  prior: number | undefined,
): { text: string; cls: string } {
  if (current === undefined || prior === undefined) {
    return { text: "—", cls: "zero" };
  }
  const d = current - prior;
  if (d === 0) return { text: "0 (—)", cls: "zero" };
  const sign = d > 0 ? "+" : "";
  const cls = d > 0 ? "pos" : "neg";
  if (prior === 0) return { text: `${sign}${d.toLocaleString("en-US")} (—)`, cls };
  const pct = (d / prior) * 100;
  const pctSign = pct >= 0 ? "+" : "";
  return {
    text: `${sign}${d.toLocaleString("en-US")} (${pctSign}${pct.toFixed(1)}%)`,
    cls,
  };
}

function renderPostsSection(posts: PostDbRow[]): string {
  if (posts.length === 0) {
    return `<p class="posts-summary">No posts captured in this snapshot.</p>`;
  }
  const supplementalCount = posts.filter((p) => p.is_supplemental === 1).length;
  const inWindowCount = posts.length - supplementalCount;
  const summary = `${posts.length} post(s) captured — ${inWindowCount} in-window, ${supplementalCount} supplemental (marked <span class="supp-marker">†</span>).`;
  const rows = posts.map(renderPostRow).join("");
  return `
  <p class="posts-summary">${summary}</p>
  <div class="posts-table-wrap">
    <table class="posts-table">
      <thead>
        <tr>
          <th></th>
          <th data-sort-key="type" data-sort-type="text">Type</th>
          <th data-sort-key="posted" data-sort-type="date">Posted</th>
          <th>Message</th>
          <th data-sort-key="hashtags" data-sort-type="number">Hashtags</th>
          <th>Link</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderPostRow(p: PostDbRow): string {
  const supMark = p.is_supplemental === 1 ? "†" : "";
  const messageCell = renderMessageCell(p.caption);
  const hashtagCount = extractHashtags(p.caption).length;
  const link = p.permalink
    ? `<a href="${escapeHtml(p.permalink)}" target="_blank" rel="noopener">view</a>`
    : `<span class="message-empty">—</span>`;
  return `<tr>
    <td class="supp-marker">${supMark}</td>
    <td data-sort-value="${escapeHtml(p.media_type)}">${escapeHtml(p.media_type)}</td>
    <td data-sort-value="${escapeHtml(p.published_at)}">${escapeHtml(toShortReadableEt(p.published_at))}</td>
    <td class="message-cell">${messageCell}</td>
    <td data-sort-value="${hashtagCount}">${renderHashtagsCell(p.caption)}</td>
    <td>${link}</td>
  </tr>`;
}

// Hashtag URL pattern for Facebook. Distinct from IG's
// instagram.com/explore/tags/<tag>/; FB uses facebook.com/hashtag/<tag>.
function fbHashtagSearchUrl(tag: string): string {
  const stripped = tag.startsWith("#") ? tag.slice(1) : tag;
  return `https://www.facebook.com/hashtag/${encodeURIComponent(stripped)}`;
}

function renderHashtagsCell(caption: string | null): string {
  const tags = extractHashtags(caption);
  if (tags.length === 0) return `<span class="hashtag-empty">—</span>`;
  const linkHtml = (t: string): string =>
    `<a href="${escapeHtml(fbHashtagSearchUrl(t))}" target="_blank" rel="noopener">${escapeHtml(t)}</a>`;
  const shown = tags.slice(0, HASHTAGS_PER_ROW);
  const extra = tags.slice(HASHTAGS_PER_ROW);
  if (extra.length === 0) {
    return `<div class="hashtag-summary-inner">${shown.map(linkHtml).join(" ")}</div>`;
  }
  return `<details class="hashtag-cell">
        <summary>
          <span class="hashtag-summary-inner">${shown.map(linkHtml).join(" ")} <span class="hashtag-more-badge">+${extra.length} more</span></span>
        </summary>
        <div class="hashtag-more-list">${extra.map(linkHtml).join(" ")}</div>
      </details>`;
}

function renderMessageCell(caption: string | null): string {
  if (!caption || caption.trim() === "") {
    return `<span class="message-empty">(no message)</span>`;
  }
  const preview = truncateCaption(caption, MESSAGE_PREVIEW_CHARS);
  const isTruncated = caption.length > MESSAGE_PREVIEW_CHARS;
  if (!isTruncated) {
    return escapeHtml(preview);
  }
  return `<details>
    <summary>${escapeHtml(preview)}</summary>
    <div class="message-full">${escapeHtml(caption)}</div>
  </details>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
