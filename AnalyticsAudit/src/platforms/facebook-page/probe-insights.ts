// Empirical probe of Facebook Page Insights metrics that may still return
// demographic data — built from a research brief produced after our earlier
// post-mortem (debug-raw.ts) ruled out the page_views_by_*_unique family.
//
// Three tiers, run individually (not batched — batching masks which name
// triggers the error):
//
//   Tier 1: page_follows_country, page_follows_city — Meta's named
//           geographic replacements when the page_fans_* series died.
//           Never previously tested.
//
//   Tier 2: post_video_view_time_by_age_bucket_and_gender / _country_id /
//           _region_id — the only place page-relevant age/gender data
//           still survives anywhere in Meta's docs, but it lives at the
//           video-post level (proxy for viewer composition, not follower).
//           Only meaningful if the Page has native video posts. Probed
//           against the first eligible video post we find.
//
//   Tier 3: Sanity-map a handful of currently-documented live page metrics
//           so the final findings can distinguish "demographics gone" from
//           "endpoint broken".
//
// Each call is classified into exactly one verdict (WORKS / VALID_EMPTY /
// INVALID_METRIC / PERMISSION / OTHER). Token is loaded from the existing
// platform_accounts.credentials JSON; we never log or persist the token.
//
// Run with: npm run probe:fb-insights -- --client <short-name>

import { Command } from "commander";
import { db } from "../../core/db/client.js";
import { env } from "../../core/lib/env.js";

const BASE_URL = "https://graph.facebook.com/v25.0";
const REQUEST_DELAY_MS = 250;

type Verdict =
  | { kind: "WORKS"; sample: string }
  | { kind: "VALID_EMPTY"; note?: string }
  | { kind: "INVALID_METRIC" }
  | { kind: "PERMISSION"; code: number; message: string }
  | { kind: "OTHER"; code: number | undefined; subcode: number | undefined; message: string };

type ProbeResult = {
  metric: string;
  level: "page" | "post";
  period: string;
  verdict: Verdict;
  notes?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function redactToken(url: string, token: string): string {
  return url.replace(token, "***TOKEN***");
}

async function callInsightsRaw(url: string): Promise<{
  status: number;
  body: unknown;
}> {
  const res = await fetch(url);
  const body = (await res.json().catch(() => null)) as unknown;
  return { status: res.status, body };
}

function classify(status: number, body: unknown): Verdict {
  type ErrBody = {
    error?: { message?: string; code?: number; error_subcode?: number };
  };
  type OkBody = {
    data?: Array<{
      values?: Array<{ value?: unknown; end_time?: string }>;
      total_value?: { value?: unknown };
      name?: string;
    }>;
  };
  if (status >= 200 && status < 300) {
    const ok = body as OkBody | null;
    const data = ok?.data ?? [];
    if (data.length === 0) return { kind: "VALID_EMPTY", note: "data: []" };
    // Determine whether the data array actually carries values.
    let nonEmpty = false;
    let sample = "";
    for (const entry of data) {
      const values = entry.values ?? [];
      for (const v of values) {
        const val = v.value;
        if (val !== undefined && val !== null) {
          // Object-shaped values (e.g. {bucket: count}) count as data if any key.
          if (typeof val === "object") {
            if (Object.keys(val as Record<string, unknown>).length > 0) {
              nonEmpty = true;
            }
          } else if (typeof val === "number") {
            if (val !== 0) nonEmpty = true;
            // even zero counts as "metric exists and returned a value"; but
            // we want WORKS to mean genuinely-useful data. Mark zeros as
            // VALID_EMPTY downstream.
          } else {
            nonEmpty = true;
          }
        }
      }
      if (entry.total_value !== undefined) {
        const tv = entry.total_value.value;
        if (
          tv !== undefined &&
          tv !== null &&
          !(typeof tv === "number" && tv === 0)
        )
          nonEmpty = true;
      }
      if (sample === "") sample = JSON.stringify(entry).slice(0, 240);
    }
    if (nonEmpty) return { kind: "WORKS", sample };
    return { kind: "VALID_EMPTY", note: "values all zero/null" };
  }
  // Error path
  const err = (body as ErrBody | null)?.error ?? {};
  const code = err.code;
  const subcode = err.error_subcode;
  const message = err.message ?? "(no message)";
  if (code === 100 && /must be a valid insights metric/i.test(message)) {
    return { kind: "INVALID_METRIC" };
  }
  if (code === 200 || code === 10) {
    return { kind: "PERMISSION", code, message };
  }
  return { kind: "OTHER", code, subcode, message };
}

async function probe(
  metric: string,
  level: "page" | "post",
  targetId: string,
  period: string,
  token: string,
  sinceUnix?: number,
  untilUnix?: number,
  notes?: string,
): Promise<ProbeResult> {
  const params = new URLSearchParams({ metric, access_token: token });
  if (period) params.set("period", period);
  if (sinceUnix !== undefined) params.set("since", String(sinceUnix));
  if (untilUnix !== undefined) params.set("until", String(untilUnix));
  const url = `${BASE_URL}/${targetId}/insights?${params.toString()}`;
  // 80001 rate-limit retry: one short backoff is enough at our call volume.
  let verdict: Verdict | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { status, body } = await callInsightsRaw(url);
    const v = classify(status, body);
    if (
      v.kind === "OTHER" &&
      (v.subcode === 80001 || /rate limit/i.test(v.message))
    ) {
      await sleep(2000);
      continue;
    }
    verdict = v;
    break;
  }
  // Use the raw URL only for the labelled console output; never log the
  // resolved-token form.
  void redactToken;
  await sleep(REQUEST_DELAY_MS);
  const result: ProbeResult = {
    metric,
    level,
    period,
    verdict: verdict ?? { kind: "OTHER", code: undefined, subcode: undefined, message: "no response" },
  };
  if (notes !== undefined) result.notes = notes;
  return result;
}

function verdictLabel(v: Verdict): string {
  switch (v.kind) {
    case "WORKS":
      return "✓✓ WORKS";
    case "VALID_EMPTY":
      return `✓  VALID_EMPTY (${v.note ?? ""})`;
    case "INVALID_METRIC":
      return "✗  INVALID_METRIC (code 100)";
    case "PERMISSION":
      return `?  PERMISSION (code ${v.code}: ${v.message.slice(0, 90)})`;
    case "OTHER":
      return `?  OTHER (code ${v.code ?? "?"}/${v.subcode ?? "?"}: ${v.message.slice(0, 90)})`;
  }
}

async function debugTokenCheck(
  token: string,
  appId: string,
  appSecret: string,
): Promise<{ ok: boolean; scopes: string[]; profileId: string | undefined }> {
  const appAccessToken = `${appId}|${appSecret}`;
  const url = `${BASE_URL}/debug_token?input_token=${token}&access_token=${appAccessToken}`;
  const { status, body } = await callInsightsRaw(url);
  if (status !== 200) return { ok: false, scopes: [], profileId: undefined };
  type DebugBody = {
    data?: {
      is_valid?: boolean;
      type?: string;
      scopes?: string[];
      profile_id?: string;
    };
  };
  const d = (body as DebugBody).data ?? {};
  return {
    ok: d.is_valid === true && d.type === "PAGE",
    scopes: d.scopes ?? [],
    profileId: d.profile_id,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

const program = new Command();
program
  .name("probe:fb-insights")
  .description(
    "Empirical probe for FB Page Insights metrics — Tiers 1/2/3 per the 2026-06 research brief.",
  )
  .requiredOption(
    "--client <shortName>",
    "Client short_name with a facebook_page platform_account",
  );
program.parse();
const opts = program.opts() as { client: string };

type ClientRow = { id: number; short_name: string };
const client = db
  .prepare("SELECT id, short_name FROM clients WHERE short_name = ?")
  .get(opts.client) as ClientRow | undefined;
if (!client) {
  console.error(`No client with short_name '${opts.client}'.`);
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

const creds = JSON.parse(pa.credentials) as { page_access_token: string };
const token = creds.page_access_token;
const pageId = pa.external_account_id;

console.log(`Probing Page ${pageId} (client: ${client.short_name})\n`);

// ─── Token sanity (debug_token) ─────────────────────────────────────────────
const dbg = await debugTokenCheck(token, env.META_APP_ID, env.META_APP_SECRET);
if (!dbg.ok) {
  console.error(
    "Token invalid or wrong type (expected PAGE). Aborting probe.",
  );
  process.exit(1);
}
console.log(`Token: PAGE, is_valid=true, profile_id=${dbg.profileId ?? "?"}`);
console.log(`Scopes: ${dbg.scopes.join(", ")}`);
const hasReadInsights = dbg.scopes.includes("read_insights");
const hasPagesReadEngagement = dbg.scopes.includes("pages_read_engagement");
if (!hasReadInsights) {
  console.warn(
    "  ⚠ Token does NOT carry `read_insights` scope. Some Page Insights endpoints may reject regardless of metric name.",
  );
}
if (!hasPagesReadEngagement) {
  console.warn(
    "  ⚠ Token does NOT carry `pages_read_engagement` scope. Engagement metrics may reject.",
  );
}
console.log("");

const now = Math.floor(Date.now() / 1000);
const weekAgo = now - 7 * 24 * 60 * 60;
const monthAgo = now - 28 * 24 * 60 * 60;

const results: ProbeResult[] = [];

// ─── Tier 1: documented November-2025 replacements (geographic) ────────────
console.log("─── Tier 1: page_follows_country / page_follows_city ───");
console.log("(documented as replacements when page_fans_* died; never previously tested)\n");

for (const metric of ["page_follows_country", "page_follows_city"]) {
  // Try period=day first
  let r = await probe(metric, "page", pageId, "day", token, weekAgo, now);
  console.log(`  ${verdictLabel(r.verdict)} ${metric} period=day (7d)`);
  results.push(r);
  // If empty or invalid, retry with week then days_28
  if (r.verdict.kind === "VALID_EMPTY") {
    r = await probe(metric, "page", pageId, "week", token, weekAgo, now);
    console.log(`  ${verdictLabel(r.verdict)} ${metric} period=week (7d)`);
    results.push(r);
    r = await probe(metric, "page", pageId, "days_28", token, monthAgo, now);
    console.log(`  ${verdictLabel(r.verdict)} ${metric} period=days_28 (28d)`);
    results.push(r);
  }
}

// ─── Tier 2: video-post-level breakdowns (only if Page has video posts) ────
console.log("\n─── Tier 2: video-post-level age/gender/geo breakdowns ───");
console.log("(only meaningful if Page has native video posts)\n");

type PostListEntry = {
  id: string;
  attachments?: { data: Array<{ media_type?: string; type?: string }> };
  status_type?: string;
};
type PostListResp = { data?: PostListEntry[] };
const postsListRes = await fetch(
  `${BASE_URL}/${pageId}/posts?fields=id,status_type,attachments{media_type,type}&limit=25&access_token=${token}`,
);
const postsListBody = (await postsListRes.json()) as PostListResp;
const allPosts = postsListBody.data ?? [];

function isVideo(p: PostListEntry): boolean {
  const att = p.attachments?.data[0];
  const mt = att?.media_type?.toLowerCase() ?? "";
  const t = att?.type?.toLowerCase() ?? "";
  if (mt === "video" || mt === "reel") return true;
  if (
    t.includes("reel") ||
    t === "video_inline" ||
    t === "video_autoplay" ||
    t === "video_share"
  ) {
    return true;
  }
  if (p.status_type === "added_video") return true;
  return false;
}

const videoPosts = allPosts.filter(isVideo);
if (videoPosts.length === 0) {
  console.log(
    `  ⚠ No video posts found in the last ${allPosts.length} posts — Tier 2 metrics are UNTESTABLE on this Page.`,
  );
  console.log(
    "  Recording the three Tier 2 metrics as 'untestable — no video content'.",
  );
  for (const metric of [
    "post_video_view_time_by_age_bucket_and_gender",
    "post_video_view_time_by_country_id",
    "post_video_view_time_by_region_id",
  ]) {
    results.push({
      metric,
      level: "post",
      period: "lifetime",
      verdict: { kind: "OTHER", code: undefined, subcode: undefined, message: "untestable — no video content" },
      notes: "Page has no native video posts; metric not probed.",
    });
  }
} else {
  const videoPost = videoPosts[0]!;
  console.log(`  Using video post ${videoPost.id}\n`);
  for (const metric of [
    "post_video_view_time_by_age_bucket_and_gender",
    "post_video_view_time_by_country_id",
    "post_video_view_time_by_region_id",
  ]) {
    const r = await probe(metric, "post", videoPost.id, "lifetime", token);
    console.log(`  ${verdictLabel(r.verdict)} ${metric} period=lifetime`);
    results.push(r);
  }
}

// ─── Tier 3: sanity-map currently-documented live metrics ──────────────────
console.log("\n─── Tier 3: sanity-map currently-documented live metrics ───\n");

const tier3Probes: Array<{ metric: string; period: string }> = [
  { metric: "page_follows", period: "day" },
  { metric: "page_daily_follows_unique", period: "day" },
  { metric: "page_total_media_view_unique", period: "day" },
  { metric: "page_media_view", period: "day" },
  { metric: "page_impressions_unique", period: "day" }, // control
];

for (const { metric, period } of tier3Probes) {
  const r = await probe(metric, "page", pageId, period, token, weekAgo, now);
  console.log(`  ${verdictLabel(r.verdict)} ${metric} period=${period} (7d)`);
  results.push(r);
}

// ─── Results table ────────────────────────────────────────────────────────
console.log("\n=================================================");
console.log("RESULTS TABLE");
console.log("=================================================\n");

console.log(
  "| metric | level | period | verdict | notes |\n|---|---|---|---|---|",
);
for (const r of results) {
  const v =
    r.verdict.kind === "WORKS"
      ? "✓✓ WORKS"
      : r.verdict.kind === "VALID_EMPTY"
        ? "✓ VALID_EMPTY"
        : r.verdict.kind === "INVALID_METRIC"
          ? "✗ INVALID_METRIC"
          : r.verdict.kind === "PERMISSION"
            ? `? PERMISSION (code ${r.verdict.code})`
            : `? OTHER (code ${r.verdict.code ?? "?"})`;
  const notes =
    r.notes ??
    (r.verdict.kind === "WORKS"
      ? r.verdict.sample.slice(0, 60)
      : r.verdict.kind === "VALID_EMPTY"
        ? r.verdict.note ?? ""
        : r.verdict.kind === "PERMISSION" || r.verdict.kind === "OTHER"
          ? r.verdict.message.slice(0, 60)
          : "");
  console.log(
    `| ${r.metric} | ${r.level} | ${r.period} | ${v} | ${notes.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`,
  );
}

// ─── Definitive findings per dimension ────────────────────────────────────
console.log("\n=================================================");
console.log("DEFINITIVE FINDINGS BY DIMENSION");
console.log("=================================================\n");

const findingsByDimension = (
  metric: string,
): { dim: string; verdict: Verdict } | undefined => {
  const r = results.find((x) => x.metric === metric);
  if (!r) return undefined;
  return { dim: metric, verdict: r.verdict };
};

function summarize(verdict: Verdict): string {
  switch (verdict.kind) {
    case "WORKS":
      return "REACHABLE via API";
    case "VALID_EMPTY":
      return "metric exists but data was empty/zero on this Page (likely below 100-person threshold or no activity)";
    case "INVALID_METRIC":
      return "NOT in Meta's registry — unreachable";
    case "PERMISSION":
      return `permission-gated (code ${verdict.code})`;
    case "OTHER":
      return verdict.message;
  }
}

const country = findingsByDimension("page_follows_country");
const city = findingsByDimension("page_follows_city");
const videoAg = findingsByDimension("post_video_view_time_by_age_bucket_and_gender");
const videoCountry = findingsByDimension("post_video_view_time_by_country_id");
const videoRegion = findingsByDimension("post_video_view_time_by_region_id");

console.log(
  `- age/gender → ${
    videoAg
      ? `video-post level: ${summarize(videoAg.verdict)}`
      : "no page-level path (Meta deprecated all *_by_age_gender_* in March 2024)"
  }`,
);
console.log(
  `- country → page level (page_follows_country): ${
    country ? summarize(country.verdict) : "not probed"
  }${videoCountry ? `; video-post level (post_video_view_time_by_country_id): ${summarize(videoCountry.verdict)}` : ""}`,
);
console.log(
  `- city / region → page level (page_follows_city): ${
    city ? summarize(city.verdict) : "not probed"
  }${videoRegion ? `; video-post level (post_video_view_time_by_region_id): ${summarize(videoRegion.verdict)}` : ""}`,
);
console.log("- language / locale → no surviving page-level metric");

// ─── Risk note ────────────────────────────────────────────────────────────
console.log("\n=================================================");
console.log("RISK NOTE");
console.log("=================================================\n");
console.log(
  "Meta's /insights/ reference flags a further deprecation wave around 2026-06-15.",
);
console.log(
  "Any WORKS metric should be considered short-lived — record results with a",
);
console.log(
  "captured_at timestamp and tolerate disappearance gracefully in the schema.",
);
console.log("");
console.log("References:");
console.log(
  "  - https://developers.facebook.com/docs/platforminsights/page/deprecated-metrics",
);
console.log(
  "  - https://developers.facebook.com/docs/graph-api/reference/insights/",
);

console.log("\nProbe complete.");
