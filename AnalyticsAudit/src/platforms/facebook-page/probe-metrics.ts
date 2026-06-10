// Diagnostic probe: try each page-level and per-post insights metric
// individually against the live Graph API and report which are still valid
// in the current API version. Use when Meta deprecates metric names (which
// they do regularly — most of the v15 list was gone by v22).
//
// Run with:  npm run probe:facebook-page -- --client <short-name>
//
// Output is a list of ✓ / ✗ per metric. Take the ✓ list and update
// PAGE_SCALAR_METRICS / POST_SCALAR_METRICS / POST_VIDEO_METRICS in types.ts.

import { Command } from "commander";
import { db } from "../../core/db/client.js";
import { FacebookApiError } from "./api.js";

const BASE_URL = "https://graph.facebook.com/v25.0";

// Broad candidate list — anything we might want, including deprecated names
// so we can confirm what's gone. Some metrics return at different periods;
// we try `day` first, fall back to `lifetime`.
const PAGE_METRIC_CANDIDATES = [
  // Reach / impressions
  "page_impressions",
  "page_impressions_unique",
  "page_impressions_paid",
  "page_impressions_paid_unique",
  "page_impressions_organic",
  "page_impressions_organic_unique",
  // Views / actions (most of these were removed in v17-v22 cleanup)
  "page_views_total",
  "page_total_actions",
  "page_cta_clicks_logged_in_total",
  // Engagement
  "page_post_engagements",
  "page_engaged_users",
  "page_consumptions",
  "page_consumptions_unique",
  "page_actions_post_reactions_total",
  "page_actions_post_reactions_like_total",
  // Fan / follower changes
  "page_fans",
  "page_fan_adds",
  "page_fan_adds_unique",
  "page_fan_removes",
  "page_fan_removes_unique",
  "page_follows",
  // Negative feedback
  "page_negative_feedback",
  "page_negative_feedback_unique",
  // Video (page-level)
  "page_video_views",
  "page_video_views_paid",
  "page_video_complete_views_30s",
] as const;

const POST_METRIC_CANDIDATES = [
  // Reach / impressions
  "post_impressions",
  "post_impressions_unique",
  "post_impressions_paid",
  "post_impressions_organic",
  // Engagement
  "post_engaged_users",
  "post_clicks",
  "post_clicks_unique",
  "post_reactions_by_type_total",
  "post_reactions_like_total",
  "post_reactions_love_total",
  "post_reactions_wow_total",
  "post_reactions_haha_total",
  "post_reactions_sorry_total",
  "post_reactions_anger_total",
  // Negative feedback
  "post_negative_feedback",
  "post_negative_feedback_unique",
  // Video (per-post)
  "post_video_views",
  "post_video_views_unique",
  "post_video_views_organic",
  "post_video_complete_views_30s",
  "post_video_avg_time_watched",
  "post_video_view_time",
  "post_video_view_time_organic",
] as const;

const program = new Command();
program
  .name("probe:facebook-page")
  .description("Probe FB Page metric names against current Graph API version.")
  .requiredOption("--client <shortName>", "Client with a facebook_page platform_account");
program.parse();
const opts = program.opts() as { client: string };

type ClientRow = { id: number };
const client = db
  .prepare("SELECT id FROM clients WHERE short_name = ?")
  .get(opts.client) as ClientRow | undefined;
if (!client) {
  console.error(`No client '${opts.client}'.`);
  process.exit(1);
}
type PaRow = { external_account_id: string; credentials: string };
const pa = db
  .prepare(
    `SELECT external_account_id, credentials FROM platform_accounts
       WHERE client_id = ? AND platform = 'facebook_page'`,
  )
  .get(client.id) as PaRow | undefined;
if (!pa) {
  console.error(`No facebook_page platform_account for '${opts.client}'.`);
  process.exit(1);
}
const token = (JSON.parse(pa.credentials) as { page_access_token: string })
  .page_access_token;
const pageId = pa.external_account_id;

const now = Math.floor(Date.now() / 1000);
const weekAgo = now - 7 * 24 * 60 * 60;

async function probe(
  endpoint: string,
  metric: string,
  params: Record<string, string>,
): Promise<{ ok: boolean; reason?: string }> {
  const url = new URL(`${BASE_URL}${endpoint}/insights`);
  url.searchParams.set("metric", metric);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  try {
    const res = await fetch(url.toString());
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => null)) as
      | { error?: { message?: string; code?: number } }
      | null;
    const msg = body?.error?.message ?? `HTTP ${res.status}`;
    return { ok: false, reason: `${msg} (code ${body?.error?.code ?? "?"})` };
  } catch (err) {
    if (err instanceof FacebookApiError) {
      return { ok: false, reason: `${err.message} (code ${err.apiCode ?? "?"})` };
    }
    return { ok: false, reason: String(err) };
  }
}

console.log(`Page ID: ${pageId}\n`);

console.log("=== Page-level metrics ===");
console.log("Trying each with period=day, then period=lifetime if day fails.\n");
for (const metric of PAGE_METRIC_CANDIDATES) {
  let result = await probe(`/${pageId}`, metric, {
    period: "day",
    since: String(weekAgo),
    until: String(now),
  });
  let periodUsed = "day";
  if (!result.ok) {
    const fallback = await probe(`/${pageId}`, metric, { period: "lifetime" });
    if (fallback.ok) {
      result = fallback;
      periodUsed = "lifetime";
    }
  }
  if (result.ok) {
    console.log(`  ✓ ${metric.padEnd(45)} (period=${periodUsed})`);
  } else {
    console.log(`  ✗ ${metric.padEnd(45)} ${result.reason}`);
  }
}

// Pick a post to test per-post metrics against.
console.log("\n=== Picking a recent post for per-post probe ===");
const postsRes = await fetch(
  `${BASE_URL}/${pageId}/posts?fields=id&limit=1&access_token=${token}`,
);
const postsJson = (await postsRes.json()) as { data?: { id: string }[] };
const postId = postsJson.data?.[0]?.id;
if (!postId) {
  console.log("  No posts on Page; skipping per-post probe.");
} else {
  console.log(`  Using post ${postId}\n`);
  console.log("=== Per-post metrics ===");
  for (const metric of POST_METRIC_CANDIDATES) {
    const result = await probe(`/${postId}`, metric, {});
    if (result.ok) {
      console.log(`  ✓ ${metric}`);
    } else {
      console.log(`  ✗ ${metric.padEnd(45)} ${result.reason}`);
    }
  }
}

console.log("\nProbe complete.");
