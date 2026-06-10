// Exhaustive demographic-metric probe. Goal: confirm or refute the claim
// that page_views_by_*_unique style metrics still work in some form. Tests
// every plausible spelling, parameter combo, batch shape, and period
// against the same page, on both v22.0 and v25.0 paths.
//
// Run with: npm run debug:facebook-page -- --client <short-name>

import { Command } from "commander";
import { db } from "../../core/db/client.js";

const V25 = "https://graph.facebook.com/v25.0";
const V22 = "https://graph.facebook.com/v22.0";

const program = new Command();
program.requiredOption("--client <shortName>");
program.parse();
const opts = program.opts() as { client: string };

type ClientRow = { id: number };
const client = db
  .prepare("SELECT id FROM clients WHERE short_name = ?")
  .get(opts.client) as ClientRow | undefined;
if (!client) process.exit(1);

type PaRow = { external_account_id: string; credentials: string };
const pa = db
  .prepare(
    `SELECT external_account_id, credentials FROM platform_accounts
       WHERE client_id = ? AND platform = 'facebook_page'`,
  )
  .get(client.id) as PaRow | undefined;
if (!pa) process.exit(1);

const token = (JSON.parse(pa.credentials) as { page_access_token: string })
  .page_access_token;
const pageId = pa.external_account_id;

const now = Math.floor(Date.now() / 1000);
const weekAgo = now - 7 * 24 * 60 * 60;
const ninetyDaysAgo = now - 89 * 24 * 60 * 60;

type Outcome =
  | { kind: "ok"; entryCount: number; firstEntry?: unknown }
  | { kind: "empty-200" }
  | { kind: "invalid-metric" }
  | { kind: "permission-denied" }
  | { kind: "other-error"; message: string; code: number | undefined };

async function probe(url: string): Promise<Outcome> {
  const res = await fetch(url);
  const body = (await res.json().catch(() => null)) as
    | { data?: unknown[]; error?: { message?: string; code?: number } }
    | null;
  if (res.ok) {
    const data = body?.data ?? [];
    if (data.length === 0) return { kind: "empty-200" };
    return { kind: "ok", entryCount: data.length, firstEntry: data[0] };
  }
  const code = body?.error?.code;
  const msg = body?.error?.message ?? "";
  if (code === 100 && /must be a valid insights metric/i.test(msg)) {
    return { kind: "invalid-metric" };
  }
  if (code === 10) return { kind: "permission-denied" };
  return { kind: "other-error", message: msg, code };
}

function fmtOutcome(o: Outcome): string {
  switch (o.kind) {
    case "ok":
      return `✓✓ HTTP 200 with ${o.entryCount} entry/entries — DATA RETURNED. First entry: ${JSON.stringify(o.firstEntry).slice(0, 220)}`;
    case "empty-200":
      return `✓  HTTP 200 with data: [] (metric exists; either no data this window or App Review gated silently)`;
    case "invalid-metric":
      return `✗  code 100 "invalid insights metric" (metric does not exist in Meta's registry)`;
    case "permission-denied":
      return `?  code 10 permission denied (metric exists but needs more permissions)`;
    case "other-error":
      return `?  code ${o.code ?? "?"}: ${o.message}`;
  }
}

type Test = { label: string; url: string };

const tests: Test[] = [];

// ─── Block A: spelling variants of the canonical names ────────────────────
const SPELLING_VARIANTS = [
  // Canonical (per the cited source)
  "page_views_by_age_gender_unique",
  "page_views_by_country_unique",
  "page_views_by_city_unique",
  "page_views_by_referers_unique",   // source spelling (one 'r')
  "page_views_by_referrers_unique",  // alternative spelling (two 'r')
  // Singular "view"
  "page_view_by_age_gender_unique",
  "page_view_by_country_unique",
  "page_view_by_city_unique",
  // Without "by"
  "page_views_age_gender_unique",
  "page_views_country_unique",
  "page_views_city_unique",
  // Total / unique-users prefix variants
  "page_total_views_by_age_gender_unique",
  "page_users_by_age_gender_unique",
  "page_unique_users_by_age_gender",
  // Audience / demographic prefix variants
  "page_audience_age_gender",
  "page_audience_country",
  "page_audience_city",
  "page_demographics_age_gender",
  "page_demographics_country",
  "page_demographics_city",
  // IG-name mirrors (in case Meta unified to a shared naming convention)
  "page_audience_demographics_age_gender",
  "page_engaged_audience_demographics_age_gender",
  "page_follower_demographics_age_gender",
  // Reach-style mirrors
  "page_reach_by_age_gender_unique",
  "page_reach_by_country_unique",
  "page_reach_by_city_unique",
];

for (const m of SPELLING_VARIANTS) {
  tests.push({
    label: `[A] ${m} (period=day, 7d)`,
    url: `${V25}/${pageId}/insights?metric=${m}&period=day&since=${weekAgo}&until=${now}&access_token=${token}`,
  });
}

// ─── Block B: parameter variations on the canonical name ──────────────────
const CANONICAL = "page_views_by_age_gender_unique";
const PARAM_VARIANTS = [
  { label: "period=days_28, 89d", qs: `period=days_28&since=${ninetyDaysAgo}&until=${now}` },
  { label: "period=week, 89d", qs: `period=week&since=${ninetyDaysAgo}&until=${now}` },
  { label: "period=lifetime", qs: `period=lifetime` },
  { label: "period=day, metric_type=total_value, 89d", qs: `period=day&metric_type=total_value&since=${ninetyDaysAgo}&until=${now}` },
  { label: "period=day, metric_type=time_series, 89d", qs: `period=day&metric_type=time_series&since=${ninetyDaysAgo}&until=${now}` },
  { label: "period=day, no since/until", qs: `period=day` },
  { label: "no period at all", qs: `` },
];

for (const v of PARAM_VARIANTS) {
  const qs = v.qs ? `&${v.qs}` : "";
  tests.push({
    label: `[B] ${CANONICAL} ${v.label}`,
    url: `${V25}/${pageId}/insights?metric=${CANONICAL}${qs}&access_token=${token}`,
  });
}

// ─── Block C: source's exact URL pattern (batched) ────────────────────────
tests.push({
  label: `[C] batched source URL pattern, v25 (period=day, 7d)`,
  url: `${V25}/${pageId}/insights?metric=page_views_by_age_gender_unique,page_views_by_country_unique,page_views_by_city_unique&period=day&since=${weekAgo}&until=${now}&access_token=${token}`,
});
tests.push({
  label: `[C] batched source URL pattern, v22 (period=day, 7d)`,
  url: `${V22}/${pageId}/insights?metric=page_views_by_age_gender_unique,page_views_by_country_unique,page_views_by_city_unique&period=day&since=${weekAgo}&until=${now}&access_token=${token}`,
});

// ─── Block D: known-good sanity calls ─────────────────────────────────────
tests.push({
  label: "[D] sanity: page_impressions_unique (known-good, v25, 7d)",
  url: `${V25}/${pageId}/insights?metric=page_impressions_unique&period=day&since=${weekAgo}&until=${now}&access_token=${token}`,
});
tests.push({
  label: "[D] sanity: page_impressions_unique (known-good, v22, 7d)",
  url: `${V22}/${pageId}/insights?metric=page_impressions_unique&period=day&since=${weekAgo}&until=${now}&access_token=${token}`,
});

// ─── Run + tabulate ───────────────────────────────────────────────────────

console.log(`Page: ${pageId}`);
console.log(`Total tests: ${tests.length}\n`);

const results: { label: string; outcome: Outcome }[] = [];
for (const t of tests) {
  const o = await probe(t.url);
  results.push({ label: t.label, outcome: o });
  console.log(`  ${fmtOutcome(o).slice(0, 4)} ${t.label}`);
}

console.log("\n=================================================");
console.log("SUMMARY BY OUTCOME");
console.log("=================================================\n");

const grouped: Record<string, string[]> = {
  "✓✓ DATA RETURNED": [],
  "✓ HTTP 200 with empty data": [],
  "✗ invalid metric (code 100)": [],
  "? permission denied (code 10)": [],
  "? other error": [],
};
for (const r of results) {
  if (r.outcome.kind === "ok") grouped["✓✓ DATA RETURNED"]!.push(r.label);
  else if (r.outcome.kind === "empty-200")
    grouped["✓ HTTP 200 with empty data"]!.push(r.label);
  else if (r.outcome.kind === "invalid-metric")
    grouped["✗ invalid metric (code 100)"]!.push(r.label);
  else if (r.outcome.kind === "permission-denied")
    grouped["? permission denied (code 10)"]!.push(r.label);
  else grouped["? other error"]!.push(r.label);
}

for (const [bucket, labels] of Object.entries(grouped)) {
  if (labels.length === 0) continue;
  console.log(`\n${bucket}: ${labels.length}`);
  for (const l of labels) console.log(`  - ${l}`);
}

console.log("\nProbe complete.");
