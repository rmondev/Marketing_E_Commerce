import { Command } from "commander";
import {
  getAccountInsights,
  getAccountProfile,
  getAudienceDemographics,
  getMediaInsights,
  listRecentMedia,
} from "../api/instagram.js";
import { db } from "../db/client.js";
import { toEtTimestamp } from "../lib/time.js";
import { generateReport } from "../reports/generator.js";
import {
  AUDIENCE_TYPES,
  DEMOGRAPHIC_DIMENSIONS,
  resolveMediaType,
  type AudienceType,
  type DemographicDimension,
  type MediaItem,
  type MediaType,
} from "../types/instagram.js";

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

type ClientRow = {
  id: number;
  short_name: string;
  display_name: string;
  ig_business_account_id: string;
  fb_page_id: string;
  page_access_token: string;
};

const client = db
  .prepare(
    `SELECT id, short_name, display_name, ig_business_account_id,
            fb_page_id, page_access_token
       FROM clients
       WHERE short_name = ?`,
  )
  .get(shortName) as ClientRow | undefined;

if (!client) {
  console.error(`No client with short_name '${shortName}'.`);
  console.error("  Use 'npm run client:list' to see configured clients.");
  process.exit(1);
}

console.log(`Auditing ${client.display_name} (${client.short_name})`);
console.log(`  ig_business_account_id: ${client.ig_business_account_id}`);

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
  client.ig_business_account_id,
  client.page_access_token,
);
console.log(
  `  followers=${profile.followers_count}  follows=${profile.follows_count}  media=${profile.media_count}`,
);

console.log("\nFetching account insights...");
const accountInsights = await getAccountInsights(
  client.ig_business_account_id,
  client.page_access_token,
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
  client.ig_business_account_id,
  client.page_access_token,
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
    client.page_access_token,
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
      client.ig_business_account_id,
      audienceType,
      dimension,
      client.page_access_token,
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
  "INSERT INTO snapshots (client_id, captured_at, lookback_days, demographics_attempted, notes) VALUES (?, ?, ?, ?, ?)",
);
const insertAccountMetrics = db.prepare(`
  INSERT INTO account_metrics (
    snapshot_id, followers_count, follows_count, media_count,
    reach, profile_views, website_clicks
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const insertPostMetric = db.prepare(`
  INSERT INTO post_metrics (
    snapshot_id, ig_media_id, media_type, caption, permalink, published_at,
    like_count, comments_count, reach, saved, shares, video_views,
    is_supplemental
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertDemographicBreakdown = db.prepare(`
  INSERT INTO demographic_breakdowns (
    snapshot_id, audience_type, dimension, bucket, value
  ) VALUES (?, ?, ?, ?, ?)
`);

const persist = db.transaction((): number => {
  const snapResult = insertSnapshot.run(
    client.id,
    now.toISOString(),
    lookbackDays,
    1, // demographics_attempted — this build always tries the 2x4 grid above
    null,
  );
  const snapshotId = Number(snapResult.lastInsertRowid);

  insertAccountMetrics.run(
    snapshotId,
    profile.followers_count,
    profile.follows_count,
    profile.media_count,
    reachValue,
    profileViewsValue,
    null, // website_clicks not fetched in v0
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
      insights?.reach ?? null,
      insights?.saved ?? null,
      insights?.shares ?? null,
      // Graph v25 returns the metric as "views"; we keep the schema column
      // name "video_views" to match the original brief.
      insights?.views ?? null,
      isSupplemental ? 1 : 0,
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
  id: client.id,
  short_name: client.short_name,
  display_name: client.display_name,
});
console.log(`\nReport: ${rollingPath}`);
if (archivePath) {
  console.log(`Archive: ${archivePath}`);
}
