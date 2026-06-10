// TikTok HTML trend report (Phase G3). Visual language matches the Instagram
// and Facebook Page trend reports (Inter font, two-tier header, header-info
// card, KPI cards with Chart.js sparklines, sortable posts table, custom
// post-evolution chart, dark-mode-aware palette) so an operator comparing
// platforms sees a consistent dashboard.
//
// TikTok specifics vs Instagram:
//   - KPIs are Followers / Following / Total Videos / Total Likes (lifetime).
//   - Posts table carries REAL engagement (views/likes/comments/shares + ER).
//     ER = (Likes + Comments + Shares) / Views × 100 — Views is the
//     denominator (TikTok's reach analogue). No media-type column (all video);
//     a Length column shows duration instead.
//   - The post-evolution chart tracks Views Per Post (TikTok's headline
//     distribution metric) rather than Instagram's likes.
//   - The Audience section is a permanent empty state: TikTok's Display API
//     exposes no demographics (those need the gated Research API).

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
  formatEr,
  truncateCaption,
} from "../../core/reports/_shared.js";
import type { ClientRef } from "../instagram/markdown-report.js";
import type { GenerateTrendResult } from "../instagram/trend-report.js";

const WINDOW_SIZE = 4;

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
};

type AccountMetricsDbRow = {
  snapshot_id: number;
  followers_count: number;
  follows_count: number;
  posts_count: number;
  platform_extras: string | null;
};
type TikTokAccountExtras = {
  likes_count?: number | null;
  display_name?: string | null;
  username?: string | null;
  is_verified?: boolean | null;
  manual_token?: boolean;
  stats_withheld?: boolean;
};
type AccountRow = {
  snapshot_id: number;
  followers_count: number;
  following_count: number;
  video_count: number;
  likes_count: number;
  stats_withheld: boolean;
};

type PostMetricsDbRow = {
  snapshot_id: number;
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
type TikTokPostExtras = { duration?: number | null };
type PostRow = {
  snapshot_id: number;
  video_id: string;
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

function accountRowFromDb(r: AccountMetricsDbRow): AccountRow {
  const extras = (
    r.platform_extras ? JSON.parse(r.platform_extras) : {}
  ) as TikTokAccountExtras;
  return {
    snapshot_id: r.snapshot_id,
    followers_count: r.followers_count,
    following_count: r.follows_count,
    video_count: r.posts_count,
    likes_count: extras.likes_count ?? 0,
    stats_withheld: extras.stats_withheld === true,
  };
}

function postRowFromDb(r: PostMetricsDbRow): PostRow {
  const extras = (
    r.platform_extras ? JSON.parse(r.platform_extras) : {}
  ) as TikTokPostExtras;
  return {
    snapshot_id: r.snapshot_id,
    video_id: r.external_post_id,
    caption: r.caption,
    permalink: r.permalink,
    published_at: r.published_at,
    like_count: r.like_count,
    comments_count: r.comments_count,
    shares: r.shares,
    views: r.views,
    duration: extras.duration ?? null,
    is_supplemental: r.is_supplemental,
  };
}

// TikTok engagement rate, mirroring markdown-report.ts.
function computeTikTokEr(p: PostRow): number | null {
  if (p.views === null || p.views === 0) return null;
  const engagement = p.like_count + p.comments_count + (p.shares ?? 0);
  return (engagement / p.views) * 100;
}

type AccountMetricKey =
  | "followers_count"
  | "following_count"
  | "video_count"
  | "likes_count";
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
    key: "following_count",
    label: "Following",
    sparkId: "spark_following",
    description: "Accounts this profile follows back.",
  },
  {
    key: "video_count",
    label: "Total Videos",
    sparkId: "spark_videos",
    description:
      "Cumulative count of every video ever published. Only goes up.",
  },
  {
    key: "likes_count",
    label: "Total Likes",
    sparkId: "spark_likes",
    description:
      "Lifetime likes summed across every video. A slow-moving cumulative metric; per-video likes below are the actionable signal.",
  },
];

const REPORTS_DIR = resolve("reports");

export function generateTikTokTrendReport(
  client: ClientRef,
): GenerateTrendResult | null {
  const snapshots = db
    .prepare(
      `SELECT id, captured_at
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

  const accountById = new Map(
    (
      db
        .prepare(
          `SELECT snapshot_id, followers_count, follows_count, posts_count, platform_extras
             FROM account_metrics
             WHERE snapshot_id IN (${placeholders})`,
        )
        .all(...ids) as AccountMetricsDbRow[]
    )
      .map(accountRowFromDb)
      .map((r) => [r.snapshot_id, r] as const),
  );

  const latestPosts = (
    db
      .prepare(
        `SELECT snapshot_id, external_post_id, caption, permalink, published_at,
                like_count, comments_count, shares, views, is_supplemental,
                platform_extras
           FROM post_metrics
           WHERE snapshot_id = ?
           ORDER BY published_at DESC`,
      )
      .all(latest.id) as PostMetricsDbRow[]
  ).map(postRowFromDb);

  const allWindowPosts = (
    db
      .prepare(
        `SELECT snapshot_id, external_post_id, caption, permalink, published_at,
                like_count, comments_count, shares, views, is_supplemental,
                platform_extras
           FROM post_metrics
           WHERE snapshot_id IN (${placeholders})`,
      )
      .all(...ids) as PostMetricsDbRow[]
  ).map(postRowFromDb);

  const html = renderHtml({
    client,
    snapshots,
    latest,
    prior,
    accountById,
    latestPosts,
    allWindowPosts,
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
  accountById: Map<number, AccountRow>;
  latestPosts: PostRow[];
  allWindowPosts: PostRow[];
};

function renderHtml(input: RenderInput): string {
  const { client, snapshots, latest, prior, accountById, latestPosts, allWindowPosts } =
    input;

  const chronological = [...snapshots].reverse();
  const chronoLabels: string[][] = chronological.map((s) => [
    `Snapshot #${s.id}`,
    `- ${toLongDateEt(s.captured_at)} -`,
  ]);

  const latestAccount = accountById.get(latest.id);
  const statsWithheld = latestAccount?.stats_withheld === true;

  const kpiCards = statsWithheld
    ? ""
    : ACCOUNT_METRICS.map((m) => renderKpiCard(m, input)).join("");

  const sparkSeries = Object.fromEntries(
    ACCOUNT_METRICS.map((m) => [
      m.sparkId,
      chronological.map((s) => accountById.get(s.id)?.[m.key] ?? 0),
    ]),
  );

  const postsSection = renderPostsSection(
    latestPosts,
    allWindowPosts,
    chronological,
    chronoLabels,
  );

  const generatedAtIso = new Date().toISOString();
  const generatedReadable = toReadableEtTimestamp(generatedAtIso);
  const generatedCompact = toEtTimestamp(generatedAtIso);
  const eyebrowDate = toLongDateEt(latest.captured_at);

  const accountSection = statsWithheld
    ? `<div class="empty-state">TikTok did not return account stats for the latest snapshot — the <code>user.info.stats</code> scope may not be granted on this token. Re-authorize with the four read-only scopes (see <code>docs/TIKTOK_SETUP.md</code>) to populate followers, total likes, and video count.</div>`
    : `<div class="kpi-grid">${kpiCards}</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>TikTok Analytics Audit — ${escapeHtml(client.display_name)} (Trend)</title>
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

  .empty-state { font-style: italic; color: var(--muted); padding: 0.75rem 1rem;
                 border-left: 3px solid var(--border); background: var(--card-bg);
                 border-radius: 4px; margin: 0.5rem 0; font-size: 0.92rem; }
  .empty-state code { font-style: normal; background: rgba(127,127,127,0.12);
                      padding: 0.05rem 0.3rem; border-radius: 3px; font-size: 0.9em; }

  .posts-summary { color: var(--muted); margin-bottom: 0.75rem; font-size: 0.9rem; }
  .posts-table-wrap { overflow-x: auto; margin: 0.5rem 0; }
  table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums;
          font-size: 0.9rem; min-width: 980px; }
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
  th:nth-child(1), td:nth-child(1), th:nth-child(2), td:nth-child(2),
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
  .posts-evolution-legend { list-style: none; padding: 0; margin: 0.5rem 0 0;
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
    <p class="report-eyebrow">TikTok Analytics Audit Report · ${escapeHtml(eyebrowDate)}</p>
    <h1 class="report-title">${escapeHtml(client.display_name)}</h1>
  </header>

  ${renderHeaderInfo(generatedReadable, latest, prior, snapshots.length)}

  ${renderGlossary()}

  <h2>Account</h2>
  <p class="section-intro">Snapshot of the account at this point in time — audience size, posting volume, and lifetime likes.</p>
  ${accountSection}

  <h2>Audience</h2>
  <p class="section-intro">Who is watching, by demographic.</p>
  <div class="empty-state">TikTok's Display API exposes no audience demographics — age, gender, and geographic breakdowns are only available through TikTok's separately-gated Research API, an institutional-review program outside this audit's scope. Account-level reach is reflected in per-video Views below.</div>

  <h2>Posts</h2>
  ${postsSection.html}

  <footer>Generated by AnalyticsAudit v0.1.0 · ${escapeHtml(generatedCompact)}</footer>

<script>
const sparkSeries = ${JSON.stringify(sparkSeries)};
const sparkLabels = ${JSON.stringify(chronoLabels)};
const postsEvolution = ${JSON.stringify(postsSection.chartData)};

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
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } },
      },
    });
  }
}

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
    <li><strong>Following</strong> — Accounts this profile follows back.</li>
    <li><strong>Total Videos</strong> — Cumulative count of every video ever published. Only goes up — if it grew by 3 since the prior snapshot, 3 videos were posted that week.</li>
    <li><strong>Total Likes</strong> — Lifetime likes summed across every video. A slow-moving cumulative metric; the per-video likes below are the actionable signal.</li>
  </ul>

  <h4>Per-Video</h4>
  <ul>
    <li><strong>Views</strong> — Total times the video was played. TikTok's reach analogue and the denominator for ER.</li>
    <li><strong>Likes</strong> — Hearts on the video. Baseline engagement signal.</li>
    <li><strong>Comments</strong> — Comments left on the video. Higher commitment than a like.</li>
    <li><strong>Shares</strong> — Times the video was shared (to DMs, other apps, or reposted). The strongest distribution signal — shares drive the algorithm.</li>
    <li><strong>ER</strong> (Engagement Rate) — Percentage of viewers who engaged. Formula: <code>(Likes + Comments + Shares) / Views × 100</code>. Divided by Views (not Followers) because TikTok's For You feed shows videos far beyond the follower base. Rough benchmarks: <strong>&lt;3%</strong> below average, <strong>3–6%</strong> solid, <strong>6–9%</strong> strong, <strong>9%+</strong> excellent.</li>
    <li><strong>Length</strong> — Video duration (mm:ss).</li>
  </ul>

  <h4>Audience</h4>
  <p style="font-size: 0.9rem; margin: 0.3rem 0;">TikTok's Display API returns no demographic breakdowns (age / gender / location). Those live behind TikTok's Research API, a separate institutional-review program outside this audit's scope. The report says so plainly rather than rendering empty charts.</p>
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

type PostsEvolutionData = {
  id: string;
  labels: string[][];
  datasets: Array<{ label: string; data: (number | null)[] }>;
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
      html: `<div class="empty-state">No videos captured for the latest snapshot.</div>`,
      chartData: null,
    };
  }

  const inWindow = latestPosts.filter((p) => p.is_supplemental === 0);
  const supplemental = latestPosts.filter((p) => p.is_supplemental === 1);

  const sectionIntro = `<p class="section-intro">Videos published in the last 7 days are shown first. If fewer were published in that window, the most recent older videos are pulled in as <strong>supplemental</strong> rows (marked with <strong>†</strong>) so the table is never empty. Engagement Rate is (Likes + Comments + Shares) / Views × 100 — see the glossary above for why Views is the denominator.</p>`;

  const summaryParts: string[] = [
    `${latestPosts.length} video(s) in latest snapshot`,
  ];
  if (supplemental.length === 0) {
    summaryParts.push("all within the 7-day window");
  } else if (inWindow.length === 0) {
    summaryParts.push(
      `none within the 7-day window; ${supplemental.length} supplemental (older videos pulled in to keep the table populated; marked †)`,
    );
  } else {
    summaryParts.push(
      `${inWindow.length} within window, ${supplemental.length} supplemental (marked †)`,
    );
  }

  const rows = latestPosts
    .map((p) => {
      const marker = p.is_supplemental === 1 ? "†" : "";
      const erValue = computeTikTokEr(p);
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
        <td data-sort-value="${p.duration ?? ""}">${escapeHtml(formatDuration(p.duration))}</td>
        <td data-sort-value="${hashtagCount}">${renderHashtagsCell(p.caption)}</td>
        <td data-sort-value="${p.views ?? ""}">${formatNullable(p.views)}</td>
        <td data-sort-value="${p.like_count}">${p.like_count.toLocaleString("en-US")}</td>
        <td data-sort-value="${p.comments_count}">${p.comments_count.toLocaleString("en-US")}</td>
        <td data-sort-value="${p.shares ?? ""}">${formatNullable(p.shares)}</td>
        <td data-sort-value="${erValue ?? ""}">${escapeHtml(er)}</td>
        <td><a href="${escapeHtml(p.permalink)}" target="_blank" rel="noopener">view</a></td>
      </tr>`;
    })
    .join("");

  const footnote =
    supplemental.length > 0
      ? `<p class="section-intro" style="margin-top: 0.5rem;"><strong>†</strong> Supplemental — posted before the 7-day window. Included so the Posts table is never empty when no videos were posted in window.</p>`
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
          <th data-sort-key="length" data-sort-type="number">Length</th>
          <th data-sort-key="hashtags" data-sort-type="number">Hashtags</th>
          <th data-sort-key="views" data-sort-type="number">Views</th>
          <th data-sort-key="likes" data-sort-type="number">Likes</th>
          <th data-sort-key="comments" data-sort-type="number">Comments</th>
          <th data-sort-key="shares" data-sort-type="number">Shares</th>
          <th data-sort-key="er" data-sort-type="number">ER</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  ${footnote}`;

  // A video is "currently outside the window" if it's supplemental in the
  // latest snapshot or no longer present in it at all.
  const supplementalById = new Map<string, boolean>(
    latestPosts.map((p) => [p.video_id, p.is_supplemental === 1]),
  );
  const isSupplementalNow = (videoId: string): boolean =>
    supplementalById.get(videoId) ?? true;

  let chartData: PostsEvolutionData = null;
  let chartHtml = "";
  if (chronological.length >= 2) {
    const byVideo = groupPostsByVideo(allWindowPosts, chronological);
    if (byVideo.length > 0) {
      const seriesLabels = byVideo.map((p) => {
        const marker = isSupplementalNow(p.videoId) ? "† " : "";
        return `${marker}${toShortReadableEt(p.publishedAt)}`;
      });
      chartData = {
        id: "posts_evolution",
        labels: chronoLabels,
        datasets: byVideo.map((p, i) => ({
          label: seriesLabels[i]!,
          data: p.viewsPerSnapshot,
        })),
        legendItems: byVideo.map((p, i) => ({
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
      const supplementalCount = byVideo.filter((p) =>
        isSupplementalNow(p.videoId),
      ).length;
      const supplementalNote =
        supplementalCount > 0
          ? ` Videos marked <strong>†</strong> were published before the current 7-day window — included so the chart isn't empty when no recent videos exist.`
          : "";
      chartHtml = `
  <h3>Views Per Video Across Window</h3>
  <p class="section-intro">Each line is one video; the dots are its view count at each snapshot. Reveals which videos kept earning views after publication — TikTok's long-tail "the algorithm picked it back up" signal.${supplementalNote}</p>
  <div class="posts-evolution-wrap"><canvas id="posts_evolution"></canvas></div>
  <ul class="posts-evolution-legend">${legendHtml}
  </ul>`;
    } else {
      chartHtml = `<div class="empty-state">No tracked videos across the window — evolution chart unavailable.</div>`;
    }
  } else {
    chartHtml = `<div class="empty-state">Video evolution chart needs ≥2 snapshots; window holds ${chronological.length}.</div>`;
  }

  return { html: tableHtml + chartHtml, chartData };
}

function renderCaptionCell(caption: string | null): string {
  if (!caption || caption.trim() === "") {
    return `<span class="caption-empty">(no caption)</span>`;
  }
  const preview = truncateCaption(caption, CAPTION_PREVIEW_CHARS);
  const flat = caption.trim();
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
    `<a href="${escapeHtml(tiktokHashtagSearchUrl(t))}" target="_blank" rel="noopener">${escapeHtml(t)}</a>`;
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

// TikTok hashtag landing page (distinct from IG's explore/tags and FB's /hashtag/).
function tiktokHashtagSearchUrl(tag: string): string {
  const stripped = tag.startsWith("#") ? tag.slice(1) : tag;
  return `https://www.tiktok.com/tag/${encodeURIComponent(stripped)}`;
}

type VideoSeries = {
  videoId: string;
  publishedAt: string;
  permalink: string;
  viewsPerSnapshot: (number | null)[];
};

function groupPostsByVideo(
  posts: PostRow[],
  chronological: Snapshot[],
): VideoSeries[] {
  const orderedIds = chronological.map((s) => s.id);
  const byVideo = new Map<
    string,
    { post: PostRow; bySnap: Map<number, number | null> }
  >();
  for (const p of posts) {
    let entry = byVideo.get(p.video_id);
    if (!entry) {
      entry = { post: p, bySnap: new Map() };
      byVideo.set(p.video_id, entry);
    }
    entry.bySnap.set(p.snapshot_id, p.views);
  }
  return [...byVideo.values()]
    .sort(
      (a, b) =>
        new Date(b.post.published_at).getTime() -
        new Date(a.post.published_at).getTime(),
    )
    .map((entry) => ({
      videoId: entry.post.video_id,
      publishedAt: entry.post.published_at,
      permalink: entry.post.permalink,
      viewsPerSnapshot: orderedIds.map((sid) => entry.bySnap.get(sid) ?? null),
    }));
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return "—";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
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
