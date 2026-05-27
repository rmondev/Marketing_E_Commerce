import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "../db/client.js";
import { toEtDate, toEtTimestamp } from "../lib/time.js";
import type { ClientRef } from "./generator.js";

// v0 testing mode: take the most recent N snapshots regardless of when they
// were captured. Calendar-month + ISO-week selection will replace this later.
const MONTHLY_WINDOW_SIZE = 4;

type Snapshot = {
  id: number;
  captured_at: string;
};

type AccountRow = {
  snapshot_id: number;
  followers_count: number;
  follows_count: number;
  media_count: number;
  reach: number;
  profile_views: number;
};

type PostRow = {
  snapshot_id: number;
  ig_media_id: string;
  media_type: string;
  permalink: string;
  published_at: string;
  like_count: number;
  comments_count: number;
  reach: number | null;
  saved: number | null;
  shares: number | null;
  video_views: number | null;
};

type AccountSeriesPoint = {
  snapshotId: number;
  capturedAt: string;
  label: string;
  followers: number;
  follows: number;
  mediaCount: number;
  reach: number;
  profileViews: number;
};

const REPORTS_DIR = resolve("reports");

export function generateMonthlyReport(client: ClientRef): string | null {
  const snapshots = db
    .prepare(
      `SELECT id, captured_at
         FROM snapshots
         WHERE client_id = ?
         ORDER BY id DESC
         LIMIT ?`,
    )
    .all(client.id, MONTHLY_WINDOW_SIZE) as Snapshot[];

  if (snapshots.length === 0) return null;

  // Chronological order (oldest → newest) so charts read left-to-right.
  snapshots.reverse();

  const ids = snapshots.map((s) => s.id);
  const accountRows = db
    .prepare(
      `SELECT snapshot_id, followers_count, follows_count, media_count,
              reach, profile_views
         FROM account_metrics
         WHERE snapshot_id IN (${ids.map(() => "?").join(",")})`,
    )
    .all(...ids) as AccountRow[];

  const postRows = db
    .prepare(
      `SELECT snapshot_id, ig_media_id, media_type, permalink, published_at,
              like_count, comments_count, reach, saved, shares, video_views
         FROM post_metrics
         WHERE snapshot_id IN (${ids.map(() => "?").join(",")})
         ORDER BY published_at DESC, snapshot_id ASC`,
    )
    .all(...ids) as PostRow[];

  const accountByid = new Map(accountRows.map((r) => [r.snapshot_id, r]));
  const series: AccountSeriesPoint[] = snapshots.map((s) => {
    const a = accountByid.get(s.id);
    return {
      snapshotId: s.id,
      capturedAt: s.captured_at,
      label: `#${s.id} · ${toEtDate(s.captured_at)}`,
      followers: a?.followers_count ?? 0,
      follows: a?.follows_count ?? 0,
      mediaCount: a?.media_count ?? 0,
      reach: a?.reach ?? 0,
      profileViews: a?.profile_views ?? 0,
    };
  });

  const html = renderHtml(client, series, snapshots, postRows);

  mkdirSync(REPORTS_DIR, { recursive: true });
  const filePath = resolve(REPORTS_DIR, `${client.short_name}_monthly.html`);
  writeFileSync(filePath, html, "utf-8");
  return filePath;
}

function renderHtml(
  client: ClientRef,
  series: AccountSeriesPoint[],
  snapshots: Snapshot[],
  posts: PostRow[],
): string {
  const generatedAt = toEtTimestamp(new Date().toISOString());

  const accountChartData = {
    labels: series.map((p) => p.label),
    datasets: [
      { label: "Followers", data: series.map((p) => p.followers) },
      { label: "Following", data: series.map((p) => p.follows) },
      { label: "Total media", data: series.map((p) => p.mediaCount) },
    ],
  };
  const reachChartData = {
    labels: series.map((p) => p.label),
    datasets: [
      { label: "Reach (7d)", data: series.map((p) => p.reach) },
      { label: "Profile views (7d)", data: series.map((p) => p.profileViews) },
    ],
  };

  const postsByMedia = groupPostsByMedia(posts, snapshots);
  const postsChartData = {
    labels: snapshots.map((s) => `#${s.id} · ${toEtDate(s.captured_at)}`),
    datasets: postsByMedia.map((m) => ({
      label: `${toEtDate(m.publishedAt)} · ${m.shortId}`,
      data: m.likesPerSnapshot,
    })),
  };

  const snapshotTableRows = series
    .map(
      (p) => `
      <tr>
        <td>#${p.snapshotId}</td>
        <td>${toEtTimestamp(p.capturedAt)}</td>
        <td>${p.followers.toLocaleString("en-US")}</td>
        <td>${p.follows.toLocaleString("en-US")}</td>
        <td>${p.mediaCount.toLocaleString("en-US")}</td>
        <td>${p.reach.toLocaleString("en-US")}</td>
        <td>${p.profileViews.toLocaleString("en-US")}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>AnalyticsAudit — ${escapeHtml(client.display_name)} (monthly)</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         max-width: 1040px; margin: 2rem auto; padding: 0 1.25rem; line-height: 1.5; }
  h1 { margin: 0 0 0.25rem; }
  h2 { margin-top: 2rem; }
  .meta { color: #666; font-size: 0.9rem; }
  .chart-wrap { margin: 1rem 0 2rem; }
  table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
  th, td { padding: 0.4rem 0.7rem; border-bottom: 1px solid #e5e5e5; text-align: right; }
  th:first-child, td:first-child, th:nth-child(2), td:nth-child(2) { text-align: left; }
  footer { margin-top: 3rem; color: #888; font-size: 0.85rem; }
</style>
</head>
<body>
  <h1>AnalyticsAudit — ${escapeHtml(client.display_name)}</h1>
  <p class="meta">Monthly comparison · last ${series.length} of ${MONTHLY_WINDOW_SIZE} snapshots · generated ${generatedAt}</p>

  <h2>Account size</h2>
  <div class="chart-wrap"><canvas id="accountChart" height="120"></canvas></div>

  <h2>Reach &amp; profile views (rolling 7d)</h2>
  <div class="chart-wrap"><canvas id="reachChart" height="120"></canvas></div>

  ${postsByMedia.length > 0 ? `
  <h2>Likes per post</h2>
  <div class="chart-wrap"><canvas id="postsChart" height="160"></canvas></div>
  ` : ""}

  <h2>Snapshot data</h2>
  <table>
    <thead>
      <tr>
        <th>Snapshot</th><th>Captured (ET)</th><th>Followers</th><th>Following</th>
        <th>Media</th><th>Reach (7d)</th><th>Profile views (7d)</th>
      </tr>
    </thead>
    <tbody>${snapshotTableRows}</tbody>
  </table>

  <footer>Generated by AnalyticsAudit v0.1.0</footer>

<script>
const accountChartData = ${JSON.stringify(accountChartData)};
const reachChartData = ${JSON.stringify(reachChartData)};
const postsChartData = ${JSON.stringify(postsChartData)};

const baseOpts = {
  responsive: true,
  interaction: { mode: "index", intersect: false },
  scales: { y: { beginAtZero: true } },
};

new Chart(document.getElementById("accountChart"), {
  type: "line", data: accountChartData, options: baseOpts,
});
new Chart(document.getElementById("reachChart"), {
  type: "line", data: reachChartData, options: baseOpts,
});
${
  postsByMedia.length > 0
    ? `new Chart(document.getElementById("postsChart"), {
  type: "bar", data: postsChartData, options: baseOpts,
});`
    : ""
}
</script>
</body>
</html>
`;
}

type MediaSeries = {
  igMediaId: string;
  shortId: string;
  publishedAt: string;
  likesPerSnapshot: (number | null)[];
};

function groupPostsByMedia(
  posts: PostRow[],
  snapshots: Snapshot[],
): MediaSeries[] {
  const orderedIds = snapshots.map((s) => s.id);
  const byMedia = new Map<string, { post: PostRow; bySnap: Map<number, number> }>();
  for (const p of posts) {
    let entry = byMedia.get(p.ig_media_id);
    if (!entry) {
      entry = { post: p, bySnap: new Map() };
      byMedia.set(p.ig_media_id, entry);
    }
    entry.bySnap.set(p.snapshot_id, p.like_count);
  }
  // Sort newest-published first so the legend reads top-down by recency.
  return [...byMedia.values()]
    .sort(
      (a, b) =>
        new Date(b.post.published_at).getTime() -
        new Date(a.post.published_at).getTime(),
    )
    .map((entry) => ({
      igMediaId: entry.post.ig_media_id,
      shortId: shortenMediaId(entry.post.ig_media_id),
      publishedAt: entry.post.published_at,
      likesPerSnapshot: orderedIds.map((sid) => entry.bySnap.get(sid) ?? null),
    }));
}

function shortenMediaId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 6)}…${id.slice(-3)}` : id;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return c;
    }
  });
}
