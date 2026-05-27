import { Command } from "commander";
import {
  getAccountInsights,
  getAccountProfile,
  getMediaInsights,
  listRecentMedia,
} from "../api/instagram.js";
import { db } from "../db/client.js";
import { toEtTimestamp } from "../lib/time.js";
import { generateReport } from "../reports/generator.js";
import {
  resolveMediaType,
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
const recentMedia = allMedia.filter(
  (m) => new Date(m.timestamp) >= mediaSinceDate,
);
console.log(
  `  ${allMedia.length} returned, ${recentMedia.length} within last ${lookbackDays} days`,
);

type MediaWithInsights = {
  item: MediaItem;
  kind: MediaType;
  insights: Record<string, number> | null;
};
const mediaWithInsights: MediaWithInsights[] = [];
if (recentMedia.length > 0) console.log("\nFetching per-media insights...");
for (const item of recentMedia) {
  const kind = resolveMediaType(item);
  const insights = await getMediaInsights(
    item.id,
    kind,
    client.page_access_token,
  );
  mediaWithInsights.push({ item, kind, insights });
}
const withInsightsCount = mediaWithInsights.filter(
  (m) => m.insights !== null,
).length;

const insertSnapshot = db.prepare(
  "INSERT INTO snapshots (client_id, captured_at, notes) VALUES (?, ?, ?)",
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
    like_count, comments_count, reach, saved, shares, video_views
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const persist = db.transaction((): number => {
  const snapResult = insertSnapshot.run(client.id, now.toISOString(), null);
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

  for (const { item, kind, insights } of mediaWithInsights) {
    insertPostMetric.run(
      snapshotId,
      item.id,
      kind,
      item.caption ? item.caption.slice(0, 500) : null,
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
    );
  }

  return snapshotId;
});

const snapshotId = persist();

console.log(`\nSnapshot saved (id=${snapshotId}) at ${toEtTimestamp(now.toISOString())}`);
console.log("  account_metrics: 1 row");
console.log(
  `  post_metrics:    ${mediaWithInsights.length} row(s) (${withInsightsCount} with insights, ${mediaWithInsights.length - withInsightsCount} without)`,
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
