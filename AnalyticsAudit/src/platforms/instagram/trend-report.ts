import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "../../core/db/client.js";
import {
  toEtTimestamp,
  toLongDateEt,
  toReadableEtTimestamp,
  toShortReadableEt,
} from "../../core/lib/time.js";
import type { ClientRef } from "./markdown-report.js";
import {
  DEMOGRAPHIC_DIMENSIONS_ORDER,
  HASHTAGS_PER_ROW,
  CAPTION_PREVIEW_CHARS,
  computeEngagementRate,
  dimensionDescription,
  dimensionLabel,
  expandBucketLabel,
  extractHashtags,
  formatEr,
  hashtagSearchUrl,
  topNplusOther,
  truncateCaption,
} from "../../core/reports/_shared.js";

const WINDOW_SIZE = 4;

const DONUT_PALETTE = [
  "#4e79a7",
  "#f28e2b",
  "#e15759",
  "#76b7b2",
  "#59a14f",
  "#edc948",
];

const POST_PALETTE = [
  "#4e79a7",
  "#f28e2b",
  "#e15759",
  "#76b7b2",
  "#59a14f",
  "#edc948",
  "#b07aa1",
  "#ff9da7",
  "#9c755f",
  "#bab0ac",
];

type Snapshot = {
  id: number;
  captured_at: string;
  demographics_attempted: number;
};

// DB row shape for account_metrics (the multi-platform schema). Translates
// into the IG-shaped AccountRow used by the rest of this module.
type AccountMetricsDbRow = {
  snapshot_id: number;
  followers_count: number;
  follows_count: number;
  posts_count: number;
  platform_extras: string | null; // JSON
};
type InstagramAccountExtras = {
  reach: number;
  profile_views: number;
  website_clicks?: number | null;
};
type AccountRow = {
  snapshot_id: number;
  followers_count: number;
  follows_count: number;
  media_count: number;
  reach: number;
  profile_views: number;
};

type PostMetricsDbRow = {
  snapshot_id: number;
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
type InstagramPostExtras = {
  reach: number | null;
  saved: number | null;
};
type PostRow = {
  snapshot_id: number;
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

function accountRowFromDb(r: AccountMetricsDbRow): AccountRow {
  const extras = (
    r.platform_extras ? JSON.parse(r.platform_extras) : {}
  ) as Partial<InstagramAccountExtras>;
  return {
    snapshot_id: r.snapshot_id,
    followers_count: r.followers_count,
    follows_count: r.follows_count,
    media_count: r.posts_count,
    reach: extras.reach ?? 0,
    profile_views: extras.profile_views ?? 0,
  };
}

function postRowFromDb(r: PostMetricsDbRow): PostRow {
  const extras = (
    r.platform_extras ? JSON.parse(r.platform_extras) : {}
  ) as Partial<InstagramPostExtras>;
  return {
    snapshot_id: r.snapshot_id,
    ig_media_id: r.external_post_id,
    media_type: r.media_type,
    caption: r.caption,
    permalink: r.permalink,
    published_at: r.published_at,
    like_count: r.like_count,
    comments_count: r.comments_count,
    reach: extras.reach ?? null,
    saved: extras.saved ?? null,
    shares: r.shares,
    video_views: r.views,
    is_supplemental: r.is_supplemental,
  };
}

type DemographicRow = {
  audience_type: string;
  dimension: string;
  bucket: string;
  value: number;
};

type AccountMetricKey =
  | "followers_count"
  | "follows_count"
  | "media_count"
  | "reach"
  | "profile_views";

type MetricDef = {
  key: AccountMetricKey;
  label: string;
  sparkId: string;
  description: string;
};

const ACCOUNT_METRICS: MetricDef[] = [
  {
    key: "followers_count",
    label: "Followers",
    sparkId: "spark_followers",
    description: "Accounts currently following this profile.",
  },
  {
    key: "follows_count",
    label: "Following",
    sparkId: "spark_follows",
    description: "Accounts this profile follows back.",
  },
  {
    key: "media_count",
    label: "Total Media",
    sparkId: "spark_media",
    description:
      "Cumulative count of every post ever published. Only goes up.",
  },
  {
    key: "reach",
    label: "Reach (7d)",
    sparkId: "spark_reach",
    description:
      "Unique people who saw any of this account's content in the last 7 days. Each person counted once.",
  },
  {
    key: "profile_views",
    label: "Profile Views (7d)",
    sparkId: "spark_profile_views",
    description:
      "Times the profile page itself was viewed in the last 7 days. A leading indicator of follower growth.",
  },
];

const REPORTS_DIR = resolve("reports");

export function generateTrendReport(client: ClientRef): string | null {
  const snapshots = db
    .prepare(
      `SELECT id, captured_at, demographics_attempted
         FROM snapshots
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

  const accountDbRows = db
    .prepare(
      `SELECT snapshot_id, followers_count, follows_count, posts_count,
              platform_extras
         FROM account_metrics
         WHERE snapshot_id IN (${placeholders})`,
    )
    .all(...ids) as AccountMetricsDbRow[];
  const accountRows = accountDbRows.map(accountRowFromDb);
  const accountById = new Map(accountRows.map((r) => [r.snapshot_id, r]));

  const latestPostDbRows = db
    .prepare(
      `SELECT snapshot_id, external_post_id, media_type, caption, permalink,
              published_at, like_count, comments_count, shares, views,
              is_supplemental, platform_extras
         FROM post_metrics
         WHERE snapshot_id = ?
         ORDER BY published_at DESC`,
    )
    .all(latest.id) as PostMetricsDbRow[];
  const latestPosts = latestPostDbRows.map(postRowFromDb);

  const allWindowPostDbRows = db
    .prepare(
      `SELECT snapshot_id, external_post_id, media_type, caption, permalink,
              published_at, like_count, comments_count, shares, views,
              is_supplemental, platform_extras
         FROM post_metrics
         WHERE snapshot_id IN (${placeholders})`,
    )
    .all(...ids) as PostMetricsDbRow[];
  const allWindowPosts = allWindowPostDbRows.map(postRowFromDb);

  const demographicRows = db
    .prepare(
      `SELECT audience_type, dimension, bucket, value
         FROM demographic_breakdowns
         WHERE snapshot_id = ?`,
    )
    .all(latest.id) as DemographicRow[];

  const html = renderHtml({
    client,
    snapshots,
    latest,
    prior,
    accountById,
    latestPosts,
    allWindowPosts,
    demographicRows,
  });

  mkdirSync(REPORTS_DIR, { recursive: true });
  const filePath = resolve(REPORTS_DIR, `${client.short_name}_trend.html`);
  writeFileSync(filePath, html, "utf-8");
  return filePath;
}

type RenderInput = {
  client: ClientRef;
  snapshots: Snapshot[];
  latest: Snapshot;
  prior: Snapshot | undefined;
  accountById: Map<number, AccountRow>;
  latestPosts: PostRow[];
  allWindowPosts: PostRow[];
  demographicRows: DemographicRow[];
};

function renderHtml(input: RenderInput): string {
  const {
    client,
    snapshots,
    latest,
    prior,
    accountById,
    latestPosts,
    allWindowPosts,
    demographicRows,
  } = input;

  const chronological = [...snapshots].reverse();
  // Multi-line chart x-axis labels: Chart.js renders each array element on
  // its own line. Top line is the snapshot identifier, bottom line is the
  // capture date in long form ("June 5, 2026").
  const chronoLabels: string[][] = chronological.map((s) => [
    `Snapshot #${s.id}`,
    `- ${toLongDateEt(s.captured_at)} -`,
  ]);

  const kpiCards = ACCOUNT_METRICS.map((m) =>
    renderKpiCard(m, input),
  ).join("");

  const sparkSeries = Object.fromEntries(
    ACCOUNT_METRICS.map((m) => [
      m.sparkId,
      chronological.map((s) => accountById.get(s.id)?.[m.key] ?? 0),
    ]),
  );

  const followerDonuts = buildDonutSection(demographicRows, "follower");
  const engagedDonuts = buildDonutSection(demographicRows, "engaged");

  const postsSection = renderPostsSection(
    latestPosts,
    allWindowPosts,
    chronological,
    chronoLabels,
  );

  const generatedAtIso = new Date().toISOString();
  const generatedReadable = toReadableEtTimestamp(generatedAtIso);
  const generatedCompact = toEtTimestamp(generatedAtIso);
  // Eyebrow date reflects the latest snapshot (when the data is from), not
  // when the HTML was generated. Falls back to generated date only if the
  // snapshot is somehow missing a captured_at, which shouldn't happen.
  const eyebrowDate = toLongDateEt(latest.captured_at);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Instagram Analytics Audit — ${escapeHtml(client.display_name)} (Trend)</title>
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
  }
  @media (prefers-color-scheme: dark) {
    :root { --border: #3a3d44; --muted: #9ba1ab; --card-bg: rgba(255,255,255,0.04); --accent: #82a8d3; }
  }
  body { font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         max-width: 1180px; margin: 2rem auto; padding: 0 1.25rem; line-height: 1.55;
         font-feature-settings: "cv11", "ss01"; }
  /* Two-tier report header. Eyebrow line names the report type + capture
     date in small uppercase accent-colored text; title is the client
     display name in a softly-accented large weight. Thin divider line
     beneath separates the header block from the meta-info card below. */
  .report-header { margin: 0 0 1.5rem; padding-bottom: 1.1rem;
                   border-bottom: 1px solid var(--border); }
  .report-eyebrow { margin: 0 0 0.6rem; font-size: 0.98rem; font-weight: 600;
                    text-transform: uppercase; letter-spacing: 0.14em;
                    color: var(--accent); }
  .report-title { margin: 0; font-size: 2.7rem; font-weight: 700;
                  letter-spacing: -0.02em; line-height: 1.05;
                  color: var(--accent); }
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

  .glossary { border: 1px solid var(--border); background: var(--card-bg);
              border-radius: 8px; padding: 0.6rem 1rem; margin: 1rem 0 2rem; }
  .glossary > summary { cursor: pointer; font-size: 0.95rem; padding: 0.25rem 0;
                        list-style: revert; }
  .glossary[open] > summary { margin-bottom: 0.5rem; border-bottom: 1px solid var(--border);
                              padding-bottom: 0.5rem; }
  .glossary h4 { margin: 1rem 0 0.4rem; font-size: 0.95rem; color: var(--accent);
                 text-transform: uppercase; letter-spacing: 0.05em; }
  .glossary ul { margin: 0.3rem 0 0.6rem 1.25rem; padding: 0; }
  .glossary li { margin: 0.25rem 0; font-size: 0.92rem; }
  .glossary code { background: rgba(127,127,127,0.12); padding: 0.05rem 0.3rem;
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

  .audience-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
                   gap: 1.25rem; }
  @media (max-width: 720px) { .audience-grid { grid-template-columns: 1fr; } }
  .donut-card { border: 1px solid var(--border); background: var(--card-bg);
                padding: 0.9rem; border-radius: 8px; }
  .donut-title { font-size: 0.9rem; color: var(--accent); margin-bottom: 0.2rem;
                 text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
  .donut-desc { font-size: 0.8rem; color: var(--muted); margin-bottom: 0.55rem;
                line-height: 1.4; }
  .donut-wrap { height: 240px; position: relative; }

  .empty-state { font-style: italic; color: var(--muted); padding: 0.75rem 1rem;
                 border-left: 3px solid var(--border); background: var(--card-bg);
                 border-radius: 4px; margin: 0.5rem 0; font-size: 0.92rem; }

  .posts-summary { color: var(--muted); margin-bottom: 0.75rem; font-size: 0.9rem; }
  .posts-table-wrap { overflow-x: auto; margin: 0.5rem 0; }
  table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums;
          font-size: 0.9rem; min-width: 1100px; }
  thead th { font-size: 0.78rem; color: var(--muted); text-transform: uppercase;
             letter-spacing: 0.04em; font-weight: 600; }
  thead th[data-sort-key] { cursor: pointer; user-select: none; }
  thead th[data-sort-key]:hover { color: var(--accent); }
  thead th[data-sort-key]::after { content: "⇅"; display: inline-block;
                                    margin-left: 0.3em; opacity: 0.35; font-size: 0.85em; }
  thead th[data-sort-key].sort-asc::after  { content: "↑"; opacity: 1; color: var(--accent); }
  thead th[data-sort-key].sort-desc::after { content: "↓"; opacity: 1; color: var(--accent); }
  th, td { padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--border);
           text-align: right; vertical-align: top; }
  th:first-child, td:first-child, th:nth-child(2), td:nth-child(2),
  th:nth-child(3), td:nth-child(3), th:nth-child(4), td:nth-child(4),
  th:nth-child(5), td:nth-child(5), th:last-child, td:last-child {
    text-align: left;
  }
  .supp-marker { color: var(--muted); font-weight: 600; width: 1.5em; }

  .caption-cell, .hashtag-cell { max-width: 280px; }
  .caption-cell summary, .hashtag-cell summary { cursor: pointer; list-style: revert;
                                                  font-size: 0.9rem; }
  .caption-cell .caption-full { margin-top: 0.4rem; padding: 0.4rem 0.6rem;
                                background: var(--card-bg); border-radius: 4px;
                                white-space: pre-wrap; font-size: 0.88rem; }
  .caption-empty { color: var(--muted); font-style: italic; font-size: 0.85rem; }
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

  .posts-evolution-wrap { height: 380px; margin-top: 1.5rem; position: relative; }
  .posts-evolution-legend { list-style: none; padding: 0;
                            margin: 0.5rem 0 0;
                            display: grid;
                            grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
                            gap: 0.35rem 1.25rem; font-size: 0.88rem; }
  .posts-evolution-legend li { display: flex; align-items: center; gap: 0.55rem; }
  .posts-evolution-legend .evolution-swatch { width: 14px; height: 14px;
                                              border-radius: 3px; flex-shrink: 0; }
  .posts-evolution-legend .evolution-date { color: var(--muted);
                                            font-variant-numeric: tabular-nums; }
  footer { margin-top: 3rem; color: var(--muted); font-size: 0.85rem;
           border-top: 1px solid var(--border); padding-top: 1rem; }
</style>
</head>
<body>
  <header class="report-header">
    <p class="report-eyebrow">Instagram Analytics Audit Report · ${escapeHtml(eyebrowDate)}</p>
    <h1 class="report-title">${escapeHtml(client.display_name)}</h1>
  </header>

  ${renderHeaderInfo(generatedReadable, latest, prior, snapshots.length)}

  ${renderGlossary()}

  <h2>Account</h2>
  <p class="section-intro">Snapshot of the account at this point in time. Five numbers describing audience size, posting cadence, and recent reach.</p>
  <div class="kpi-grid">${kpiCards}</div>

  <h2>Audience</h2>
  <p class="section-intro">Who is paying attention to this account, by demographic. <strong>Lifetime Followers</strong> = everyone currently following. <strong>Engaged Audience</strong> = the smaller, more dynamic group who actually interacted with the account in the last month. The engaged side is the better signal of who the content is actually working for.</p>

  ${renderAudienceBlock("Followers (Lifetime)", followerDonuts, latest, accountById, "follower")}
  ${renderAudienceBlock("Engaged Audience (This Month)", engagedDonuts, latest, accountById, "engaged")}

  <h2>Posts</h2>
  ${postsSection.html}

  <footer>Generated by AnalyticsAudit v0.1.0 · ${escapeHtml(generatedCompact)}</footer>

<script>
const sparkSeries = ${JSON.stringify(sparkSeries)};
const sparkLabels = ${JSON.stringify(chronoLabels)};
const followerDonuts = ${JSON.stringify(followerDonuts.charts)};
const engagedDonuts = ${JSON.stringify(engagedDonuts.charts)};
const postsEvolution = ${JSON.stringify(postsSection.chartData)};
const palette = ${JSON.stringify(DONUT_PALETTE)};

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

function buildDonut(canvasId, chart) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const total = chart.data.reduce((s, v) => s + v, 0);
  new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: chart.labels,
      datasets: [{ data: chart.data, backgroundColor: palette, borderWidth: 1 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: "55%",
      plugins: {
        legend: { position: "right", labels: { boxWidth: 14, font: { size: 13 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed;
              const pct = total > 0 ? Math.round((v / total) * 100) : 0;
              return ctx.label + ": " + pct + "%";
            },
          },
        },
      },
    },
  });
}

for (const chart of followerDonuts) buildDonut(chart.id, chart);
for (const chart of engagedDonuts) buildDonut(chart.id, chart);

if (postsEvolution) {
  const canvas = document.getElementById(postsEvolution.id);
  if (canvas) {
    new Chart(canvas, {
      type: "line",
      data: {
        labels: postsEvolution.labels,
        datasets: postsEvolution.datasets.map((d, i) => ({
          ...d,
          borderColor: ${JSON.stringify(POST_PALETTE)}[i % ${POST_PALETTE.length}],
          backgroundColor: ${JSON.stringify(POST_PALETTE)}[i % ${POST_PALETTE.length}],
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.2,
          spanGaps: true,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "nearest", intersect: false },
        // Built-in legend hidden; we render a custom HTML legend below the
        // canvas with clickable "view" links to each post's permalink.
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } },
      },
    });
  }
}

// Click-to-sort on the Posts table. Numeric/date columns read from
// data-sort-value (raw value, not display text) so commas and "—" don't
// break sorting. Nulls (empty data-sort-value) always pile at the end
// regardless of direction.
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

function renderGlossary(): string {
  return `<details class="glossary">
  <summary><strong>What The Metrics Mean</strong> (click to expand)</summary>

  <h4>Account</h4>
  <ul>
    <li><strong>Followers</strong> — Accounts currently following this profile. The headline "is this growing?" number.</li>
    <li><strong>Following</strong> — Accounts this profile follows back. The ratio of Followers to Following can hint at perceived authority.</li>
    <li><strong>Total Media</strong> — Cumulative count of every post ever published. Only goes up — doesn't reset weekly. If it grew by 3 since the prior snapshot, the account posted 3 things that week.</li>
    <li><strong>Reach (7d)</strong> — Unique people who saw any of this account's content in the last 7 days. Counts each person once, even if they saw 10 posts.</li>
    <li><strong>Profile Views (7d)</strong> — Times the profile page itself was viewed in the last 7 days. Signals curiosity. A strong leading indicator of follower growth.</li>
  </ul>

  <h4>Per-Post</h4>
  <ul>
    <li><strong>Likes</strong> — Hearts tapped on the post. Lowest commitment, easiest engagement.</li>
    <li><strong>Comments</strong> — Comments left on the post. Higher commitment than a like.</li>
    <li><strong>Reach</strong> — Unique people who saw this specific post.</li>
    <li><strong>Saved</strong> — People who bookmarked the post. Very strong value signal — people only save what they want to come back to.</li>
    <li><strong>Shares</strong> — Times the post was shared via DM, sent in a story, or had its link copied.</li>
    <li><strong>Views</strong> — Total times the post was viewed or played. Higher than Reach because one person can view a post multiple times.</li>
    <li><strong>ER</strong> (Engagement Rate) — Percentage of people who saw the post and engaged with it. Formula: <code>(Likes + Comments + Saves + Shares) / Reach × 100</code>. Divided by Reach (not Followers) because most followers don't see most posts — the algorithm decides. ER measures the post against the people who actually had the chance to engage. Rough benchmarks: <strong>&lt;1%</strong> below average, <strong>1–3%</strong> average, <strong>3–6%</strong> strong, <strong>6%+</strong> excellent.</li>
  </ul>

  <h4>Audience</h4>
  <ul>
    <li><strong>Lifetime Followers</strong> — Everyone currently following the account, broken down by demographic. Stable; changes slowly.</li>
    <li><strong>Engaged Audience (This Month)</strong> — Just the people who actually interacted with the content (liked, commented, saved, shared) in the last month. Smaller, more dynamic, and a much better signal of who the content is actually working for.</li>
    <li><strong>Age</strong> — Distribution across age brackets. Reveals which generation(s) the content resonates with.</li>
    <li><strong>Gender</strong> — Self-reported gender distribution. "Undisclosed" means the user didn't specify a gender on their Instagram profile.</li>
    <li><strong>Top Countries</strong> — Which countries the audience lives in. Useful for spotting unexpected international reach.</li>
    <li><strong>Top Cities</strong> — Metro areas the audience clusters around. Most actionable for local businesses.</li>
  </ul>

  <p style="font-size: 0.85rem; color: var(--muted); margin-top: 0.75rem;">Meta withholds demographic breakdowns when the underlying audience is below ~100 unique people (a privacy threshold). When that happens, sections show a plain-language message instead of empty charts.</p>
</details>`;
}

function renderKpiCard(metric: MetricDef, input: RenderInput): string {
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

type DonutChart = {
  id: string;
  title: string;
  labels: string[];
  data: number[];
  description: string;
};
type DonutSection = { charts: DonutChart[]; hasData: boolean };

function buildDonutSection(
  rows: DemographicRow[],
  audienceType: "follower" | "engaged",
): DonutSection {
  const ofType = rows.filter((r) => r.audience_type === audienceType);
  if (ofType.length === 0) return { charts: [], hasData: false };
  const charts: DonutChart[] = [];
  for (const dim of DEMOGRAPHIC_DIMENSIONS_ORDER) {
    const buckets = ofType
      .filter((r) => r.dimension === dim)
      .map((r) => ({
        bucket: expandBucketLabel(dim, r.bucket),
        value: r.value,
      }));
    if (buckets.length === 0) continue;
    const { head, otherValue, otherCount } = topNplusOther(buckets);
    const finalBuckets =
      otherCount > 0
        ? [
            ...head,
            {
              bucket: `Other (${otherCount} more)`,
              value: otherValue,
            },
          ]
        : head;
    // Legend labels include the count, e.g. "Canada (606)".
    const labels = finalBuckets.map(
      (b) => `${b.bucket} (${b.value.toLocaleString("en-US")})`,
    );
    const data = finalBuckets.map((b) => b.value);
    charts.push({
      id: `donut_${audienceType}_${dim}`,
      title: dimensionLabel(dim),
      description: dimensionDescription(dim),
      labels,
      data,
    });
  }
  return { charts, hasData: charts.length > 0 };
}

function renderAudienceBlock(
  heading: string,
  section: DonutSection,
  latest: Snapshot,
  accountById: Map<number, AccountRow>,
  audienceType: "follower" | "engaged",
): string {
  const lines: string[] = [`<h3>${escapeHtml(heading)}</h3>`];

  if (latest.demographics_attempted === 0) {
    lines.push(
      `<div class="empty-state">Demographic breakdowns were not captured for this snapshot (pre-dates the demographics feature).</div>`,
    );
    return lines.join("\n  ");
  }

  if (!section.hasData) {
    const followersOnRecord =
      accountById.get(latest.id)?.followers_count ?? 0;
    if (audienceType === "follower") {
      lines.push(
        `<div class="empty-state">Meta did not release follower demographics for this snapshot — typically because the account has fewer than ~100 followers (${followersOnRecord.toLocaleString("en-US")} on record). The breakdown returns once the account crosses Meta's privacy threshold.</div>`,
      );
    } else {
      lines.push(
        `<div class="empty-state">Meta did not release engaged-audience demographics for this snapshot — most commonly because fewer than ~100 unique users engaged with the account in the timeframe. The breakdown returns once monthly engagement crosses Meta's privacy threshold.</div>`,
      );
    }
    return lines.join("\n  ");
  }

  const donutMarkup = section.charts
    .map(
      (c) => `
    <div class="donut-card">
      <div class="donut-title">${escapeHtml(c.title)}</div>
      <div class="donut-desc">${escapeHtml(c.description)}</div>
      <div class="donut-wrap"><canvas id="${c.id}"></canvas></div>
    </div>`,
    )
    .join("");
  lines.push(`<div class="audience-grid">${donutMarkup}</div>`);
  return lines.join("\n  ");
}

type PostsEvolutionData = {
  id: string;
  // Each label is an array of strings — Chart.js stacks them as separate
  // lines on the x-axis.
  labels: string[][];
  datasets: Array<{ label: string; data: (number | null)[] }>;
  // Custom HTML legend rendered below the canvas. Each item maps 1:1 to a
  // dataset (same order, same color index) and carries the post permalink
  // so the legend doubles as a "view this post" jump list.
  legendItems: Array<{ label: string; permalink: string }>;
} | null;

function renderPostsSection(
  latestPosts: PostRow[],
  allWindowPosts: PostRow[],
  chronological: Snapshot[],
  chronoLabels: string[][],
): { html: string; chartData: PostsEvolutionData } {
  if (latestPosts.length === 0) {
    return {
      html: `<p class="section-intro">No posts were captured for the latest snapshot.</p>
  <div class="empty-state">No posts captured for the latest snapshot.</div>`,
      chartData: null,
    };
  }

  const inWindow = latestPosts.filter((p) => p.is_supplemental === 0);
  const supplemental = latestPosts.filter((p) => p.is_supplemental === 1);
  const noInsights = latestPosts.filter((p) => p.reach === null).length;

  const sectionIntro = `<p class="section-intro">Posts published in the last 7 days are shown first. If fewer were published in that window, the most recent older posts are pulled in as <strong>supplemental</strong> rows (marked with <strong>†</strong>) so the table is never empty. Each row's Engagement Rate is computed as (Likes + Comments + Saves + Shares) / Reach × 100 — see the glossary above for why Reach is the denominator.</p>`;

  const summaryParts: string[] = [
    `${latestPosts.length} post(s) in latest snapshot`,
  ];
  if (supplemental.length === 0) {
    summaryParts.push("all within the 7-day window");
  } else if (inWindow.length === 0) {
    summaryParts.push(
      `none within the 7-day window; ${supplemental.length} supplemental (older posts pulled in to keep the table populated; marked †)`,
    );
  } else {
    summaryParts.push(
      `${inWindow.length} within window, ${supplemental.length} supplemental (marked †)`,
    );
  }
  if (noInsights > 0) {
    summaryParts.push(
      `${noInsights} post(s) returned no insights (likely pre-business-conversion media)`,
    );
  }

  const rows = latestPosts
    .map((p) => {
      const marker = p.is_supplemental === 1 ? "†" : "";
      const erValue = computeEngagementRate(p);
      const er = formatEr(erValue);
      const captionSortKey = (p.caption ?? "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
      const hashtagCount = extractHashtags(p.caption).length;
      return `
      <tr>
        <td class="supp-marker" data-sort-value="${p.is_supplemental}">${marker}</td>
        <td data-sort-value="${escapeHtml(captionSortKey)}">${renderCaptionCell(p.caption)}</td>
        <td data-sort-value="${escapeHtml(p.published_at)}">${escapeHtml(toShortReadableEt(p.published_at))}</td>
        <td data-sort-value="${escapeHtml(p.media_type)}">${escapeHtml(p.media_type)}</td>
        <td data-sort-value="${hashtagCount}">${renderHashtagsCell(p.caption)}</td>
        <td data-sort-value="${p.like_count}">${p.like_count.toLocaleString("en-US")}</td>
        <td data-sort-value="${p.comments_count}">${p.comments_count.toLocaleString("en-US")}</td>
        <td data-sort-value="${p.reach ?? ""}">${formatNullable(p.reach)}</td>
        <td data-sort-value="${p.saved ?? ""}">${formatNullable(p.saved)}</td>
        <td data-sort-value="${p.shares ?? ""}">${formatNullable(p.shares)}</td>
        <td data-sort-value="${p.video_views ?? ""}">${formatNullable(p.video_views)}</td>
        <td data-sort-value="${erValue ?? ""}">${escapeHtml(er)}</td>
        <td><a href="${escapeHtml(p.permalink)}" target="_blank" rel="noopener">view</a></td>
      </tr>`;
    })
    .join("");

  const footnote =
    supplemental.length > 0
      ? `<p class="section-intro" style="margin-top: 0.5rem;"><strong>†</strong> Supplemental — posted before the 7-day window. Included so the Posts table is never empty when no posts were made in window.</p>`
      : "";

  const tableHtml = `
  ${sectionIntro}
  <div class="posts-summary">${summaryParts.map(escapeHtml).join(" · ")}</div>
  <div class="posts-table-wrap">
    <table class="posts-table">
      <thead>
        <tr>
          <th data-sort-key="supp" data-sort-type="number" title="Sort by supplemental flag"></th>
          <th data-sort-key="caption" data-sort-type="text">Caption</th>
          <th data-sort-key="posted" data-sort-type="date">Posted</th>
          <th data-sort-key="type" data-sort-type="text">Type</th>
          <th data-sort-key="hashtags" data-sort-type="number">Hashtags</th>
          <th data-sort-key="likes" data-sort-type="number">Likes</th>
          <th data-sort-key="comments" data-sort-type="number">Comments</th>
          <th data-sort-key="reach" data-sort-type="number">Reach</th>
          <th data-sort-key="saved" data-sort-type="number">Saved</th>
          <th data-sort-key="shares" data-sort-type="number">Shares</th>
          <th data-sort-key="views" data-sort-type="number">Views</th>
          <th data-sort-key="er" data-sort-type="number">ER</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  ${footnote}`;

  // Per-post supplemental flag from the *latest* snapshot. A post in the
  // chart is "currently outside the 7-day window" if either:
  //   (a) it's in the latest snapshot with is_supplemental=1, or
  //   (b) it's no longer in the latest snapshot at all (older than the
  //       window AND past the top-50 media cap).
  const supplementalById = new Map<string, boolean>(
    latestPosts.map((p) => [p.ig_media_id, p.is_supplemental === 1]),
  );
  const isSupplementalNow = (mediaId: string): boolean =>
    supplementalById.get(mediaId) ?? true;

  let chartData: PostsEvolutionData = null;
  let chartHtml = "";
  if (chronological.length >= 2) {
    const byPost = groupPostsByMedia(allWindowPosts, chronological);
    if (byPost.length > 0) {
      const seriesLabels = byPost.map((p) => {
        const marker = isSupplementalNow(p.igMediaId) ? "† " : "";
        return `${marker}${toShortReadableEt(p.publishedAt)}`;
      });
      chartData = {
        id: "posts_evolution",
        labels: chronoLabels,
        datasets: byPost.map((p, i) => ({
          label: seriesLabels[i]!,
          data: p.likesPerSnapshot,
        })),
        legendItems: byPost.map((p, i) => ({
          label: seriesLabels[i]!,
          permalink: p.permalink,
        })),
      };
      const legendHtml = chartData.legendItems
        .map(
          (item, i) => `
        <li>
          <span class="evolution-swatch" style="background:${POST_PALETTE[i % POST_PALETTE.length]}"></span>
          <span class="evolution-date">${escapeHtml(item.label)}</span>
          <a href="${escapeHtml(item.permalink)}" target="_blank" rel="noopener">view</a>
        </li>`,
        )
        .join("");
      const supplementalCount = byPost.filter((p) =>
        isSupplementalNow(p.igMediaId),
      ).length;
      const supplementalNote =
        supplementalCount > 0
          ? ` Posts marked <strong>†</strong> were published before the current 7-day window — included so the chart isn't empty when no recent posts exist.`
          : "";
      chartHtml = `
  <h3>Likes Per Post Across Window</h3>
  <p class="section-intro">Each line is one post; the dots are its like count at each snapshot. Reveals which posts kept earning likes after publication.${supplementalNote}</p>
  <div class="posts-evolution-wrap"><canvas id="posts_evolution"></canvas></div>
  <ul class="posts-evolution-legend">${legendHtml}
  </ul>`;
    } else {
      chartHtml = `<div class="empty-state">No tracked posts across the window — evolution chart unavailable.</div>`;
    }
  } else {
    chartHtml = `<div class="empty-state">Post evolution chart needs ≥2 snapshots; window holds ${chronological.length}.</div>`;
  }

  return { html: tableHtml + chartHtml, chartData };
}

function renderCaptionCell(caption: string | null): string {
  if (!caption || caption.trim() === "") {
    return `<span class="caption-empty">(no caption)</span>`;
  }
  const preview = truncateCaption(caption, CAPTION_PREVIEW_CHARS);
  const flat = caption.trim();
  // If caption is short enough to fully fit in the preview, no need for a
  // collapsible — just render the full text inline.
  if (flat.length <= CAPTION_PREVIEW_CHARS) {
    return `<span>${escapeHtml(flat)}</span>`;
  }
  return `<details class="caption-cell">
        <summary>${escapeHtml(preview)}</summary>
        <div class="caption-full">${escapeHtml(flat)}</div>
      </details>`;
}

function renderHashtagsCell(caption: string | null): string {
  const tags = extractHashtags(caption);
  if (tags.length === 0) return `<span class="hashtag-empty">—</span>`;
  const linkHtml = (t: string): string =>
    `<a href="${escapeHtml(hashtagSearchUrl(t))}" target="_blank" rel="noopener">${escapeHtml(t)}</a>`;
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

type MediaSeries = {
  igMediaId: string;
  publishedAt: string;
  permalink: string;
  likesPerSnapshot: (number | null)[];
};

function groupPostsByMedia(
  posts: PostRow[],
  chronological: Snapshot[],
): MediaSeries[] {
  const orderedIds = chronological.map((s) => s.id);
  const byMedia = new Map<
    string,
    { post: PostRow; bySnap: Map<number, number> }
  >();
  for (const p of posts) {
    let entry = byMedia.get(p.ig_media_id);
    if (!entry) {
      entry = { post: p, bySnap: new Map() };
      byMedia.set(p.ig_media_id, entry);
    }
    entry.bySnap.set(p.snapshot_id, p.like_count);
  }
  return [...byMedia.values()]
    .sort(
      (a, b) =>
        new Date(b.post.published_at).getTime() -
        new Date(a.post.published_at).getTime(),
    )
    .map((entry) => ({
      igMediaId: entry.post.ig_media_id,
      publishedAt: entry.post.published_at,
      permalink: entry.post.permalink,
      likesPerSnapshot: orderedIds.map(
        (sid) => entry.bySnap.get(sid) ?? null,
      ),
    }));
}

function formatNullable(n: number | null): string {
  return n === null ? "—" : n.toLocaleString("en-US");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return c;
    }
  });
}
