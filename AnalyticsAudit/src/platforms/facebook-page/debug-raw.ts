// Diagnostic: dumps raw JSON for the FB Page calls that returned empty in
// live-test, so we can see exactly what Meta is sending back. One-off,
// delete after Phase F1 is debugged. Run with:
//   npm run debug:facebook-page -- --client <short-name>

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

async function dump(label: string, url: string): Promise<unknown> {
  console.log(`\n=== ${label} ===`);
  console.log(`URL: ${url.replace(token, "***TOKEN***")}`);
  const res = await fetch(url);
  const body = await res.json();
  console.log(`Status: ${res.status}`);
  console.log(JSON.stringify(body, null, 2));
  return body;
}

// 1. Batched page-scalar call (what live-test failed on)
await dump(
  "batched page scalars (live-test pattern)",
  `${BASE_URL}/${pageId}/insights?` +
    `metric=page_impressions_unique,page_views_total,page_follows&` +
    `period=day&since=${weekAgo}&until=${now}&access_token=${token}`,
);

// 2. Single metric, same window — to compare with batched
await dump(
  "single metric: page_impressions_unique",
  `${BASE_URL}/${pageId}/insights?` +
    `metric=page_impressions_unique&` +
    `period=day&since=${weekAgo}&until=${now}&access_token=${token}`,
);

// 3. Single metric with metric_type=total_value (IG-style)
await dump(
  "single metric + metric_type=total_value",
  `${BASE_URL}/${pageId}/insights?` +
    `metric=page_impressions_unique&` +
    `period=day&metric_type=total_value&since=${weekAgo}&until=${now}&access_token=${token}`,
);

// 4. The post object-counts call that failed
type PostsResp = { data?: { id: string }[] };
const postsRes = await fetch(
  `${BASE_URL}/${pageId}/posts?fields=id&limit=1&access_token=${token}`,
);
const postId = ((await postsRes.json()) as PostsResp).data?.[0]?.id;
if (postId !== undefined) {
  await dump(
    "post object counts (live-test pattern)",
    `${BASE_URL}/${postId}?` +
      `fields=shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)&` +
      `access_token=${token}`,
  );
  await dump(
    "post object counts — simpler fields",
    `${BASE_URL}/${postId}?fields=shares,reactions.summary(total_count),comments.summary(total_count)&access_token=${token}`,
  );
  await dump(
    "post object — message only (sanity check)",
    `${BASE_URL}/${postId}?fields=id,message&access_token=${token}`,
  );
}

// 5. Try a few demographic-metric candidates to find what survived
const DEMO_CANDIDATES = [
  "page_fans_gender_age",
  "page_fans_country",
  "page_fans_city",
  "page_fans_locale",
  "page_fans",
  "page_fans_by_country",
  "page_fans_by_gender",
];
console.log("\n=== Demographic metric probe ===");
for (const m of DEMO_CANDIDATES) {
  const url = `${BASE_URL}/${pageId}/insights?metric=${m}&period=lifetime&access_token=${token}`;
  const res = await fetch(url);
  const body = (await res.json()) as { error?: { message?: string; code?: number }; data?: unknown[] };
  if (res.ok) {
    const n = body.data?.length ?? 0;
    console.log(`  ✓ ${m}: ${n} entry/entries`);
  } else {
    console.log(`  ✗ ${m}: ${body.error?.message ?? "?"} (code ${body.error?.code ?? "?"})`);
  }
}

// 6. Year-wide window — if metrics return data here but not for 7d, the
// metric is fine, the page is just dormant.
const yearAgo = now - 365 * 24 * 60 * 60;
await dump(
  "year-wide page_views_total (proves metric works if data exists)",
  `${BASE_URL}/${pageId}/insights?` +
    `metric=page_views_total&period=day&since=${yearAgo}&until=${now}&access_token=${token}`,
);

// 7. /debug_token — confirms what permissions the page token actually carries.
// Uses the env-level META_APP_ID/SECRET as the app access token.
const envMod = await import("../../core/lib/env.js");
const appAccessToken = `${envMod.env.META_APP_ID}|${envMod.env.META_APP_SECRET}`;
await dump(
  "/debug_token on current Page Token",
  `${BASE_URL}/debug_token?input_token=${token}&access_token=${appAccessToken}`,
);

// 8. Try post object fields one at a time to isolate which specific field
// trips the permission check.
const postId2 = postId;
if (postId2 !== undefined) {
  for (const f of [
    "id,message,created_time,permalink_url",
    "shares",
    "reactions.summary(total_count)",
    "comments.summary(total_count)",
    "like_count",
    "reactions{type}",
  ]) {
    await dump(
      `post field isolation: ${f}`,
      `${BASE_URL}/${postId2}?fields=${encodeURIComponent(f)}&access_token=${token}`,
    );
  }
}

console.log("\nDebug dump complete.");
