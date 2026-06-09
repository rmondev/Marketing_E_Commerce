import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  toEtTimestamp,
  toLongDateEt,
  toReadableEtTimestamp,
} from "../lib/time.js";

// Catalog (index.html) generator for the per-platform trend/ directory.
// Each successful `report:trend` run writes a new timestamped HTML AND
// updates trend/manifest.json with its metadata; then this module
// regenerates index.html as the navigation entry point.
//
// The catalog renders all manifest entries grouped two ways:
//   1. Quick Access (rolling time windows: Latest / Last Week / Month /
//      Quarter / Year) — handy for "show me the most recent thing"
//   2. Browse By Date (year → month accordion) — handy for historical
//      navigation across years
// All collapsibility uses native <details>/<summary>; no JS needed.

const MANIFEST_NAME = "manifest.json";

export type ManifestEntry = {
  filename: string;
  generated_at: string; // ISO; when the HTML was written
  snapshot_id: number;
  snapshot_captured_at: string; // ISO; when the data was captured
  lookback_days: number;
};

type Manifest = { entries: ManifestEntry[] };

export function upsertManifestEntry(
  trendDir: string,
  entry: ManifestEntry,
): void {
  const path = resolve(trendDir, MANIFEST_NAME);
  let manifest: Manifest = { entries: [] };
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "entries" in parsed &&
        Array.isArray((parsed as Manifest).entries)
      ) {
        manifest = parsed as Manifest;
      }
    } catch {
      // Corrupt manifest — start fresh. We don't try to recover; the catalog
      // will lose history for prior runs whose files happen to still be on
      // disk but that's acceptable for a personal tool.
    }
  }

  // Dedupe by snapshot_id: "one snapshot = one HTML". If we already had an
  // HTML file for this snapshot under a different name (e.g. an earlier
  // re-render at a different timestamp), delete the old file and drop its
  // manifest entry before adding the new one. Multiple files for the same
  // snapshot would just be redundant copies of the same data.
  const superseded = manifest.entries.filter(
    (e) =>
      e.snapshot_id === entry.snapshot_id && e.filename !== entry.filename,
  );
  for (const old of superseded) {
    const oldFile = resolve(trendDir, old.filename);
    if (existsSync(oldFile)) {
      unlinkSync(oldFile);
      console.log(
        `  Removed older render of snapshot #${entry.snapshot_id}: ${old.filename}`,
      );
    }
  }
  manifest.entries = manifest.entries.filter(
    (e) =>
      e.snapshot_id !== entry.snapshot_id || e.filename === entry.filename,
  );

  const idx = manifest.entries.findIndex((e) => e.filename === entry.filename);
  if (idx >= 0) {
    manifest.entries[idx] = entry;
  } else {
    manifest.entries.push(entry);
  }
  writeFileSync(path, JSON.stringify(manifest, null, 2), "utf-8");
}

// Self-heal pass: if the manifest has multiple entries pointing at the same
// snapshot_id (e.g. left over from before upsertManifestEntry started
// deduping), collapse them to the newest by generated_at and delete the
// rest from disk. Idempotent — no-op once clean. Called at the top of
// generateCatalog.
function dedupeManifestBySnapshot(
  trendDir: string,
  manifest: Manifest,
): Manifest {
  const bySnapshot = new Map<number, ManifestEntry[]>();
  for (const e of manifest.entries) {
    if (!bySnapshot.has(e.snapshot_id)) bySnapshot.set(e.snapshot_id, []);
    bySnapshot.get(e.snapshot_id)!.push(e);
  }
  const kept: ManifestEntry[] = [];
  let cleaned = 0;
  for (const group of bySnapshot.values()) {
    if (group.length === 1) {
      kept.push(group[0]!);
      continue;
    }
    // Multiple entries for one snapshot — keep newest generation, delete rest.
    const sorted = [...group].sort(
      (a, b) =>
        new Date(b.generated_at).getTime() -
        new Date(a.generated_at).getTime(),
    );
    kept.push(sorted[0]!);
    for (const old of sorted.slice(1)) {
      const oldFile = resolve(trendDir, old.filename);
      if (existsSync(oldFile)) {
        unlinkSync(oldFile);
        cleaned++;
      }
    }
  }
  if (cleaned > 0) {
    console.log(
      `  Catalog: removed ${cleaned} older duplicate HTML(s) (one snapshot = one HTML).`,
    );
    const path = resolve(trendDir, MANIFEST_NAME);
    writeFileSync(
      path,
      JSON.stringify({ entries: kept }, null, 2),
      "utf-8",
    );
  }
  return { entries: kept };
}

export function generateCatalog(input: {
  trendDir: string;
  client: { short_name: string; display_name: string };
  platform: string;
}): string {
  const { trendDir, client, platform } = input;
  const manifestPath = resolve(trendDir, MANIFEST_NAME);
  let manifest: Manifest = { entries: [] };
  if (existsSync(manifestPath)) {
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, "utf-8")) as unknown;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "entries" in parsed &&
        Array.isArray((parsed as Manifest).entries)
      ) {
        manifest = parsed as Manifest;
      }
    } catch {
      manifest = { entries: [] };
    }
  }

  // Self-heal: collapse any duplicate-snapshot entries left over from before
  // upsertManifestEntry started deduping. Writes the cleaned manifest back
  // and deletes the redundant files.
  manifest = dedupeManifestBySnapshot(trendDir, manifest);

  // Drop entries whose files were manually deleted from disk.
  const validEntries = manifest.entries.filter((e) =>
    existsSync(resolve(trendDir, e.filename)),
  );

  // Sort by SNAPSHOT capture time (when the data was from), not by file
  // generation time. If you re-render an old snapshot's HTML today, the
  // catalog still treats it as that older report.
  validEntries.sort(
    (a, b) =>
      new Date(b.snapshot_captured_at).getTime() -
      new Date(a.snapshot_captured_at).getTime(),
  );

  const html = renderCatalog(client, platform, validEntries);
  const indexPath = resolve(trendDir, "index.html");
  writeFileSync(indexPath, html, "utf-8");
  return indexPath;
}

// Move pre-Phase-C orphan report files (reports/<client>.md,
// reports/<client>_archive.md, reports/<client>_trend.html) to
// reports/_legacy/ so they don't clutter the new per-client tree. Idempotent
// — running on an already-clean directory is a no-op. Returns the count
// of files moved.
export function migrateLegacyOrphans(reportsRoot: string): number {
  if (!existsSync(reportsRoot)) return 0;
  const entries = readdirSync(reportsRoot, { withFileTypes: true });
  const orphans = entries.filter((e) => {
    if (!e.isFile()) return false;
    // Top-level .md or _trend.html files match the pre-Phase-C pattern.
    // The new layout never writes files at the top level.
    return /\.md$/.test(e.name) || /_trend\.html$/.test(e.name);
  });
  if (orphans.length === 0) return 0;
  const legacyDir = resolve(reportsRoot, "_legacy");
  mkdirSync(legacyDir, { recursive: true });
  let moved = 0;
  for (const e of orphans) {
    const from = resolve(reportsRoot, e.name);
    const to = resolve(legacyDir, e.name);
    renameSync(from, to);
    moved++;
  }
  if (moved > 0) {
    console.log(
      `Migrated ${moved} pre-Phase-C orphan report file(s) to reports/_legacy/`,
    );
  }
  return moved;
}

// ─────────────────────────────────────────────────────────────────────
// HTML rendering
// ─────────────────────────────────────────────────────────────────────

// Extract { year, month, monthName, day } from an ISO timestamp in ET so
// year/month buckets align to the operator's local calendar, not UTC.
function etDateParts(iso: string): {
  year: number;
  month: number;
  monthName: string;
  day: number;
} {
  const dateFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string): string =>
    dateFmt.find((p) => p.type === type)?.value ?? "";
  const monthName = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
  }).format(new Date(iso));
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    monthName,
    day: Number(get("day")),
  };
}

// Compact day-of-week + month + day used as the primary row label.
function dayLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

// "9:10 AM EDT" — same compact form trend-report uses elsewhere.
function timeLabel(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).formatToParts(new Date(iso));
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("hour")}:${get("minute")} ${get("dayPeriod")} ${get("timeZoneName")}`;
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

function renderReportRow(e: ManifestEntry): string {
  return `
        <a class="report-row" href="${escapeHtml(e.filename)}">
          <span class="report-day">${escapeHtml(dayLabel(e.snapshot_captured_at))}</span>
          <span class="report-time">${escapeHtml(timeLabel(e.snapshot_captured_at))}</span>
          <span class="report-lookback">${e.lookback_days}-day lookback</span>
          <span class="report-link">view ›</span>
        </a>`;
}

function renderEmpty(message: string): string {
  return `<div class="empty-state-row">${escapeHtml(message)}</div>`;
}

function renderQuickAccessSection(
  label: string,
  entries: ManifestEntry[],
  openByDefault: boolean,
  emptyMsg: string,
): string {
  const open = openByDefault ? " open" : "";
  const countSuffix =
    entries.length === 1 ? "1 report" : `${entries.length} reports`;
  const body =
    entries.length === 0
      ? renderEmpty(emptyMsg)
      : entries.map(renderReportRow).join("");
  return `
    <details class="catalog-section"${open}>
      <summary>${escapeHtml(label)} <span class="count">${countSuffix}</span></summary>
      <div class="report-list">${body}
      </div>
    </details>`;
}

function renderCatalog(
  client: { short_name: string; display_name: string },
  platform: string,
  entries: ManifestEntry[],
): string {
  const generatedAtIso = new Date().toISOString();
  const platformDisplay = platform.charAt(0).toUpperCase() + platform.slice(1);

  // Quick Access categories (rolling windows relative to "now").
  const nowMs = Date.now();
  const oneDay = 86_400_000;
  const inWindow = (e: ManifestEntry, days: number): boolean =>
    new Date(e.snapshot_captured_at).getTime() >= nowMs - days * oneDay;
  const latestTop3 = entries.slice(0, 3);
  const lastWeek = entries.filter((e) => inWindow(e, 7));
  const lastMonth = entries.filter((e) => inWindow(e, 30));
  const lastQuarter = entries.filter((e) => inWindow(e, 90));
  const lastYear = entries.filter((e) => inWindow(e, 365));

  // Browse By Date: group entries by ET year, then by ET month within year.
  type MonthBucket = { month: number; monthName: string; entries: ManifestEntry[] };
  type YearBucket = { year: number; months: MonthBucket[]; total: number };
  const yearMap = new Map<number, Map<number, MonthBucket>>();
  for (const e of entries) {
    const { year, month, monthName } = etDateParts(e.snapshot_captured_at);
    if (!yearMap.has(year)) yearMap.set(year, new Map());
    const monthsForYear = yearMap.get(year)!;
    if (!monthsForYear.has(month)) {
      monthsForYear.set(month, { month, monthName, entries: [] });
    }
    monthsForYear.get(month)!.entries.push(e);
  }
  const years: YearBucket[] = [...yearMap.entries()]
    .map(([year, monthsMap]) => {
      const months = [...monthsMap.values()].sort((a, b) => b.month - a.month);
      const total = months.reduce((s, m) => s + m.entries.length, 0);
      return { year, months, total };
    })
    .sort((a, b) => b.year - a.year);

  // Default-open the year+month that holds the most recent report.
  const newest = entries[0];
  const newestParts = newest ? etDateParts(newest.snapshot_captured_at) : null;

  const summaryLine =
    entries.length === 0
      ? "No reports yet — generate one with <code>npm run report:trend</code>."
      : `${entries.length} report${entries.length === 1 ? "" : "s"} captured · ` +
        `Earliest: ${toLongDateEt(entries[entries.length - 1]!.snapshot_captured_at)} · ` +
        `Latest: ${toLongDateEt(newest!.snapshot_captured_at)}`;

  const quickAccessHtml = [
    renderQuickAccessSection(
      "Latest",
      latestTop3,
      true,
      "No reports yet.",
    ),
    renderQuickAccessSection(
      "Last Week",
      lastWeek,
      false,
      "No reports captured in the past 7 days.",
    ),
    renderQuickAccessSection(
      "Last Month",
      lastMonth,
      false,
      "No reports captured in the past 30 days.",
    ),
    renderQuickAccessSection(
      "Last Quarter",
      lastQuarter,
      false,
      "No reports captured in the past 90 days.",
    ),
    renderQuickAccessSection(
      "Last Year",
      lastYear,
      false,
      "No reports captured in the past 365 days.",
    ),
  ].join("");

  const browseHtml = years
    .map((y) => {
      const yearIsNewest = newestParts !== null && y.year === newestParts.year;
      const yearOpen = yearIsNewest ? " open" : "";
      const monthsHtml = y.months
        .map((m) => {
          const monthIsNewest =
            newestParts !== null &&
            y.year === newestParts.year &&
            m.month === newestParts.month;
          const monthOpen = monthIsNewest ? " open" : "";
          return `
        <details class="catalog-month"${monthOpen}>
          <summary>${escapeHtml(m.monthName)} <span class="count">${m.entries.length} report${m.entries.length === 1 ? "" : "s"}</span></summary>
          <div class="report-list">${m.entries.map(renderReportRow).join("")}
          </div>
        </details>`;
        })
        .join("");
      return `
    <details class="catalog-year"${yearOpen}>
      <summary>${y.year} <span class="count">${y.total} report${y.total === 1 ? "" : "s"}</span></summary>
      <div class="month-list">${monthsHtml}
      </div>
    </details>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Instagram Analytics Audit Reports — ${escapeHtml(client.display_name)} (Archive)</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root {
    color-scheme: light dark;
    --border: #d8dadf;
    --muted: #6b7280;
    --card-bg: rgba(127,127,127,0.04);
    --accent: #4e79a7;
    --row-hover: rgba(127,127,127,0.06);
  }
  @media (prefers-color-scheme: dark) {
    :root { --border: #3a3d44; --muted: #9ba1ab; --card-bg: rgba(255,255,255,0.04);
            --accent: #82a8d3; --row-hover: rgba(255,255,255,0.05); }
  }
  body { font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         max-width: 1100px; margin: 2rem auto; padding: 0 1.25rem; line-height: 1.55;
         font-feature-settings: "cv11", "ss01"; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  .report-header { margin: 0 0 1.5rem; padding-bottom: 1.1rem;
                   border-bottom: 1px solid var(--border); }
  .report-eyebrow { margin: 0 0 0.6rem; font-size: 0.98rem; font-weight: 600;
                    text-transform: uppercase; letter-spacing: 0.14em;
                    color: var(--accent); }
  .report-title { margin: 0; font-size: 2.7rem; font-weight: 700;
                  letter-spacing: -0.02em; line-height: 1.05;
                  color: var(--accent); }

  .summary-line { color: var(--muted); margin: 0 0 2rem; font-size: 0.95rem; }
  .summary-line code { background: rgba(127,127,127,0.12); padding: 0.05rem 0.3rem;
                       border-radius: 3px; font-size: 0.9em; }

  h2 { margin: 2.5rem 0 1rem; font-size: 0.85rem; font-weight: 600;
       color: var(--muted); text-transform: uppercase; letter-spacing: 0.12em; }

  details.catalog-section, details.catalog-year { border: 1px solid var(--border);
                                                   background: var(--card-bg);
                                                   border-radius: 8px;
                                                   margin: 0.55rem 0;
                                                   overflow: hidden; }
  details.catalog-section > summary,
  details.catalog-year > summary { padding: 0.85rem 1rem; cursor: pointer;
                                    user-select: none; font-weight: 600;
                                    font-size: 1.05rem; color: var(--accent);
                                    list-style: revert; }
  details.catalog-section[open] > summary,
  details.catalog-year[open] > summary { border-bottom: 1px solid var(--border); }
  details.catalog-year > summary { font-size: 1.2rem; }

  details.catalog-month { margin: 0; border-top: 1px solid var(--border); }
  details.catalog-month:first-child { border-top: none; }
  details.catalog-month > summary { padding: 0.65rem 1rem 0.65rem 2.25rem;
                                     cursor: pointer; user-select: none;
                                     font-weight: 600; font-size: 0.95rem;
                                     color: inherit; list-style: revert; }
  details.catalog-month[open] > summary { border-bottom: 1px solid var(--border); }

  .count { color: var(--muted); font-weight: 400; font-size: 0.85em;
           margin-left: 0.5em; }

  .report-list { padding: 0; }
  .month-list { padding: 0; }

  .report-row { display: grid;
                grid-template-columns: 1.4fr 1fr 1fr auto;
                gap: 0.75rem 1rem; padding: 0.6rem 1rem;
                padding-left: 2.5rem;
                text-decoration: none; color: inherit;
                border-bottom: 1px solid var(--border);
                align-items: center; font-size: 0.92rem; }
  details.catalog-section .report-row { padding-left: 1.25rem; }
  .report-row:last-child { border-bottom: none; }
  .report-row:hover { background: var(--row-hover); }
  .report-day { font-weight: 600; }
  .report-time { color: var(--muted); font-variant-numeric: tabular-nums; }
  .report-lookback { color: var(--muted); font-size: 0.88rem; }
  .report-link { color: var(--accent); font-size: 0.9rem; }
  @media (max-width: 720px) {
    .report-row { grid-template-columns: 1fr auto;
                  grid-template-areas: "day link" "time link" "lookback link"; }
    .report-day { grid-area: day; }
    .report-time { grid-area: time; }
    .report-lookback { grid-area: lookback; }
    .report-link { grid-area: link; }
  }

  .empty-state-row { padding: 0.75rem 1rem 0.75rem 2.5rem;
                     color: var(--muted); font-style: italic;
                     font-size: 0.92rem; }
  details.catalog-section .empty-state-row { padding-left: 1.25rem; }

  footer { margin-top: 3rem; color: var(--muted); font-size: 0.85rem;
           border-top: 1px solid var(--border); padding-top: 1rem; }
</style>
</head>
<body>
  <header class="report-header">
    <p class="report-eyebrow">${escapeHtml(platformDisplay)} Analytics Audit · Archive</p>
    <h1 class="report-title">${escapeHtml(client.display_name)}</h1>
  </header>

  <p class="summary-line">${summaryLine}</p>

  <h2>Quick Access</h2>
  ${quickAccessHtml}

  <h2>Browse By Date</h2>
  ${browseHtml || `<p class="summary-line">No reports yet.</p>`}

  <footer>Generated by AnalyticsAudit v0.1.0 · ${escapeHtml(toEtTimestamp(generatedAtIso))}</footer>
</body>
</html>
`;
}

// Re-export for callers that want to format the catalog's own timestamp the
// way trend-report does (used in dev tooling and tests).
export { toReadableEtTimestamp };
