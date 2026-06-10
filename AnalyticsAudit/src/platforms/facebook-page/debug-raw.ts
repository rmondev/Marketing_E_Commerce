// One-off diagnostic. Probes the v22+ page-views-by-* demographic metrics
// (the replacements for the deprecated page_fans_* metrics) and reports
// which return real data vs. (a) deprecated (code 100) (b) silently empty
// in dev mode (data: []).
//
// Run with: npm run debug:facebook-page -- --client <short-name>

import { Command } from "commander";
import { db } from "../../core/db/client.js";

const BASE_URL = "https://graph.facebook.com/v25.0";

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
const ninetyDaysAgo = now - 89 * 24 * 60 * 60; // stay under the 90-day cap

async function dump(label: string, url: string): Promise<void> {
  console.log(`\n=== ${label} ===`);
  console.log(`URL: ${url.replace(token, "***TOKEN***")}`);
  const res = await fetch(url);
  const body = await res.json();
  console.log(`Status: ${res.status}`);
  console.log(JSON.stringify(body, null, 2));
}

// v22+ demographic candidates — the view-based replacements for the
// deprecated page_fans_* metrics. Per Meta docs (and 2026 changelogs),
// demographics now go through Reach / View metrics.
const DEMO_CANDIDATES = [
  // Age + gender combined (F.18-24, M.25-34, etc.)
  "page_views_by_age_gender_unique",
  // Country (ISO two-letter codes)
  "page_views_by_country_unique",
  // City + state/region
  "page_views_by_city_unique",
  // Site referrer (bonus — for completeness, "where do views come from")
  "page_views_by_referers_unique",
  // The other obvious naming pattern just in case
  "page_impressions_by_age_gender_unique",
  "page_impressions_by_country_unique",
  "page_impressions_by_city_unique",
];

console.log(`Probing v22+ demographic metric names against page ${pageId}`);
console.log(`Token type/scopes already verified — issue under test is dev-mode access vs deprecation.`);

console.log("\n--- 7-day window ---");
for (const m of DEMO_CANDIDATES) {
  await dump(
    `${m} (period=day, 7d)`,
    `${BASE_URL}/${pageId}/insights?metric=${m}&period=day&since=${weekAgo}&until=${now}&access_token=${token}`,
  );
}

console.log("\n--- 90-day window (max allowed by Meta) ---");
for (const m of DEMO_CANDIDATES) {
  await dump(
    `${m} (period=day, 89d)`,
    `${BASE_URL}/${pageId}/insights?metric=${m}&period=day&since=${ninetyDaysAgo}&until=${now}&access_token=${token}`,
  );
}

// ─── v22.0 path probe ──────────────────────────────────────────────────────
// The source we're checking specifically said GET /v22.0/<page-id>/insights.
// Test whether v22.0 still serves these metrics even though they're gone
// from v25.0. Also test a known-good v25 metric on v22.0 to confirm the
// v22.0 endpoint itself responds (vs being unsupported entirely).
const V22_BASE = "https://graph.facebook.com/v22.0";

console.log("\n\n=================================================");
console.log("--- v22.0 path tests (the source mentioned this explicit version) ---");
console.log("=================================================");

await dump(
  "v22.0 sanity: page_impressions_unique (known-good metric, 7d)",
  `${V22_BASE}/${pageId}/insights?metric=page_impressions_unique&period=day&since=${weekAgo}&until=${now}&access_token=${token}`,
);

for (const m of DEMO_CANDIDATES) {
  await dump(
    `v22.0 ${m} (period=day, 89d)`,
    `${V22_BASE}/${pageId}/insights?metric=${m}&period=day&since=${ninetyDaysAgo}&until=${now}&access_token=${token}`,
  );
}

console.log("\nDebug dump complete.");
