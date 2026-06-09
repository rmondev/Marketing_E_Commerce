import { Command } from "commander";
import {
  getAccountInsights,
  getAccountProfile,
  getAudienceDemographics,
  getMediaInsights,
  listRecentMedia,
} from "../platforms/instagram/api.js";
import { db } from "../core/db/client.js";
import { toEtTimestamp } from "../core/lib/time.js";
import { generateReport } from "../platforms/instagram/markdown-report.js";
import {
  AUDIENCE_TYPES,
  DEMOGRAPHIC_DIMENSIONS,
  resolveMediaType,
  type AudienceType,
  type DemographicDimension,
  type MediaItem,
  type MediaType,
} from "../platforms/instagram/types.js";

// Account-level insights are always a 7-day window — that is the meaning of
// the `account_metrics.reach` and `account_metrics.profile_views` columns
// per CONTEXT.md. Changing this would change what the column *means* across
// snapshots, breaking longitudinal comparisons.
const ACCOUNT_INSIGHTS_WINDOW_DAYS = 7;

// Media inclusion window is configurable via --lookback-days. Used only to
// decide which posts get a row in post_metrics — does not affect account
// metrics.
const DEFAULT_LOOKBACK_DAYS = 7;
const MAX_POSTS_TO_SCAN = 50;

// The Posts section of the rolling report always shows at most this many
// posts. When the lookback window contains fewer than this, the audit pulls
// the most recent posts from outside the window to fill — those rows are
// flagged is_supplemental=1 so the report can mark them visually.
const POSTS_PER_REPORT = 5;

const program = new Command();
program
  .name("audit")
  .description("Capture a weekly engagement snapshot for one client.")
  .requiredOption(
    "--client <shortName>",
    "Client short_name from the clients table",
  )
  .option(
    "--lookback-days <days>",
    `Days to look back for media inclusion in post_metrics (default: ${DEFAULT_LOOKBACK_DAYS}). Account insights always use a fixed 7-day window.`,
  );
program.parse();

const rawOpts = program.opts() as { client: string; lookbackDays?: string };
const shortName = rawOpts.client;

let lookbackDays = DEFAULT_LOOKBACK_DAYS;
if (rawOpts.lookbackDays !== undefined) {
  const parsed = Number(rawOpts.lookbackDays);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) {
    console.error(
      `Invalid --lookback-days '${rawOpts.lookbackDays}': must be a positive integer (1-3650).`,
    );
    process.exit(1);
  }
  lookbackDays = parsed;
}

// Joins clients to its Instagram platform_account. Audit is currently
// IG-only; once Phase D's registry lands, audit.ts will iterate over a
// client's configured platforms and dispatch per-platform.
type ClientRow = {
  client_id: number;
  short_name: string;
  display_name: string;
  platform_account_id: number;
  external_account_id: string;
  credentials: string;
};
type InstagramCredentials = {
  page_access_token: string;
  fb_page_id?: string;
};

const client = db
  .prepare(
    `SELECT c.id AS client_id, c.short_name, c.display_name,
            pa.id AS platform_account_id, pa.external_account_id, pa.credentials
       FROM clients c
       JOIN platform_accounts pa ON pa.client_id = c.id
       WHERE c.short_name = ? AND pa.platform = 'instagram'`,
  )
  .get(shortName) as ClientRow | undefined;

if (!client) {
  console.error(
    `No Instagram platform_account for client '${shortName}'.`,
  );
  console.error("  Use 'npm run client:list' to see configured clients.");
  process.exit(1);
}

const igCreds = JSON.parse(client.credentials) as InstagramCredentials;
const igAccountId = client.external_account_id;
const pageAccessToken = igCreds.page_access_token;

console.log(`Auditing ${client.display_name} (${client.short_name})`);
console.log(`  ig_business_account_id: ${igAccountId}`);

const now = new Date();
const nowUnix = Math.floor(now.getTime() / 1000);
const accountSinceUnix = nowUnix - ACCOUNT_INSIGHTS_WINDOW_DAYS * 24 * 60 * 60;
const mediaSinceUnix = nowUnix - lookbackDays * 24 * 60 * 60;
const mediaSinceDate = new Date(mediaSinceUnix * 1000);
console.log(
  `  account insights window: ${toEtTimestamp(new Date(accountSinceUnix * 1000).toISOString())} → ${toEtTimestamp(now.toISOString())} (${ACCOUNT_INSIGHTS_WINDOW_DAYS}d, fixed)`,
);
console.log(
  `  media window:            ${toEtTimestamp(mediaSinceDate.toISOString())} → ${toEtTimestamp(now.toISOString())} (${lookbackDays}d)`,
);

// All Graph API calls happen here, before any DB writes. We never hold a
// transaction across network I/O.

console.log("\nFetching account profile...");
const profile = await getAccountProfile(
  igAccountId,
  pageAccessToken,
);
console.log(
  `  followers=${profile.followers_count}  follows=${profile.follows_count}  media=${profile.media_count}`,
);

console.log("\nFetching account insights...");
const accountInsights = await getAccountInsights(
  igAccountId,
  pageAccessToken,
  accountSinceUnix,
  nowUnix,
  ["reach", "profile_views"],
);
const reachValue = accountInsights.reach;
const profileViewsValue = accountInsights.profile_views;
if (reachValue === undefined || profileViewsValue === undefined) {
  console.error(
    `Account insights response missing required metrics. Got: ${Object.keys(accountInsights).join(", ") || "(empty)"}`,
  );
  process.exit(1);
}
console.log(`  reach=${reachValue}  profile_views=${profileViewsValue}`);

console.log("\nListing recent media...");
const allMedia = await listRecentMedia(
  igAccountId,
  pageAccessToken,
  MAX_POSTS_TO_SCAN,
);
// Sort newest-first so the supplemental fill picks the most recent
// out-of-window posts. Meta's /media endpoint already returns newest-first,
// but we do not want capture correctness to depend on that.
const sortedMedia = [...allMedia].sort(
  (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
);
const inWindow = sortedMedia.filter(
  (m) => new Date(m.timestamp) >= mediaSinceDate,
);
const outOfWindow = sortedMedia.filter(
  (m) => new Date(m.timestamp) < mediaSinceDate,
);
const supplementalNeeded = Math.max(0, POSTS_PER_REPORT - inWindow.length);
const supplemental = outOfWindow.slice(0, supplementalNeeded);
console.log(
  `  ${allMedia.length} returned, ${inWindow.length} within last ${lookbackDays} days, ${supplemental.length} supplemental (to reach ${POSTS_PER_REPORT})`,
);

type MediaWithInsights = {
  item: MediaItem;
  kind: MediaType;
  insights: Record<string, number> | null;
  isSupplemental: boolean;
};
const mediaWithInsights: MediaWithInsights[] = [];
const mediaToCapture: { item: MediaItem; isSupplemental: boolean }[] = [
  ...inWindow.map((item) => ({ item, isSupplemental: false })),
  ...supplemental.map((item) => ({ item, isSupplemental: true })),
];
if (mediaToCapture.length > 0) console.log("\nFetching per-media insights...");
for (const { item, isSupplemental } of mediaToCapture) {
  const kind = resolveMediaType(item);
  const insights = await getMediaInsights(
    item.id,
    kind,
    pageAccessToken,
  );
  mediaWithInsights.push({ item, kind, insights, isSupplemental });
}
const withInsightsCount = mediaWithInsights.filter(
  (m) => m.insights !== null,
).length;

console.log("\nFetching audience demographics...");
type DemographicCapture = {
  audienceType: AudienceType;
  dimension: DemographicDimension;
  buckets: Record<string, number>;
};
const demographicCaptures: DemographicCapture[] = [];
for (const audienceType of AUDIENCE_TYPES) {
  for (const dimension of DEMOGRAPHIC_DIMENSIONS) {
    const buckets = await getAudienceDemographics(
      igAccountId,
      audienceType,
      dimension,
      pageAccessToken,
    );
    if (buckets !== null) {
      demographicCaptures.push({ audienceType, dimension, buckets });
    }
  }
}
const demographicRowCount = demographicCaptures.reduce(
  (sum, c) => sum + Object.keys(c.buckets).length,
  0,
);
console.log(
  `  ${demographicCaptures.length}/${AUDIENCE_TYPES.length * DEMOGRAPHIC_DIMENSIONS.length} breakdowns returned, ${demographicRowCount} bucket row(s)`,
);

const insertSnapshot = db.prepare(
  "INSERT INTO snapshots (platform_account_id, captured_at, lookback_days, demographics_attempted, notes) VALUES (?, ?, ?, ?, ?)",
);
const insertAccountMetrics = db.prepare(`
  INSERT INTO account_metrics (
    snapshot_id, followers_count, follows_count, posts_count, platform_extras
  ) VALUES (?, ?, ?, ?, ?)
`);
const insertPostMetric = db.prepare(`
  INSERT INTO post_metrics (
    snapshot_id, external_post_id, media_type, caption, permalink,
    published_at, like_count, comments_count, shares, views,
    is_supplemental, platform_extras
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertDemographicBreakdown = db.prepare(`
  INSERT INTO demographic_breakdowns (
    snapshot_id, audience_type, dimension, bucket, value
  ) VALUES (?, ?, ?, ?, ?)
`);

const persist = db.transaction((): number => {
  const snapResult = insertSnapshot.run(
    client.platform_account_id,
    now.toISOString(),
    lookbackDays,
    1, // demographics_attempted — this build always tries the 2x4 grid above
    null,
  );
  const snapshotId = Number(snapResult.lastInsertRowid);

  // Instagram-specific account extras (reach, profile_views, website_clicks)
  // live in the platform_extras JSON. Other platforms will store their own
  // shape; readers parse this column with knowledge of which platform the
  // snapshot belongs to.
  insertAccountMetrics.run(
    snapshotId,
    profile.followers_count,
    profile.follows_count,
    profile.media_count,
    JSON.stringify({
      reach: reachValue,
      profile_views: profileViewsValue,
      website_clicks: null, // not fetched in v0
    }),
  );

  for (const { item, kind, insights, isSupplemental } of mediaWithInsights) {
    insertPostMetric.run(
      snapshotId,
      item.id,
      kind,
      // Full caption stored — reports extract hashtags from it; Instagram
      // captions cap at 2,200 chars which is well within SQLite TEXT limits.
      item.caption,
      item.permalink,
      item.timestamp,
      item.like_count,
      item.comments_count,
      insights?.shares ?? null,
      insights?.views ?? null,
      isSupplemental ? 1 : 0,
      JSON.stringify({
        reach: insights?.reach ?? null,
        saved: insights?.saved ?? null,
      }),
    );
  }

  for (const { audienceType, dimension, buckets } of demographicCaptures) {
    for (const [bucket, value] of Object.entries(buckets)) {
      insertDemographicBreakdown.run(
        snapshotId,
        audienceType,
        dimension,
        bucket,
        value,
      );
    }
  }

  return snapshotId;
});

const snapshotId = persist();
const supplementalCount = mediaWithInsights.filter(
  (m) => m.isSupplemental,
).length;

console.log(`\nSnapshot saved (id=${snapshotId}) at ${toEtTimestamp(now.toISOString())}`);
console.log("  account_metrics:         1 row");
console.log(
  `  post_metrics:            ${mediaWithInsights.length} row(s) (${withInsightsCount} with insights, ${mediaWithInsights.length - withInsightsCount} without, ${supplementalCount} supplemental)`,
);
console.log(
  `  demographic_breakdowns:  ${demographicRowCount} row(s) across ${demographicCaptures.length} breakdown(s)`,
);

const { rollingPath, archivePath } = generateReport({
  client_id: client.client_id,
  platform_account_id: client.platform_account_id,
  short_name: client.short_name,
  display_name: client.display_name,
});
console.log(`\nReport: ${rollingPath}`);
if (archivePath) {
  console.log(`Archive: ${archivePath}`);
}
