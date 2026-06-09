// Instagram-specific audit: fetches profile, account insights, media list,
// per-media insights, and audience demographics from the Graph API, then
// persists a snapshot + child rows and regenerates the markdown report.
//
// Originally lived inside cli/audit.ts; extracted here in Phase D so the
// CLI can dispatch through the platform registry instead of importing IG
// internals directly.

import { db } from "../../core/db/client.js";
import { toEtTimestamp } from "../../core/lib/time.js";
import type {
  PlatformAuditInput,
  PlatformAuditResult,
} from "../_registry.js";
import {
  getAccountInsights,
  getAccountProfile,
  getAudienceDemographics,
  getMediaInsights,
  listRecentMedia,
} from "./api.js";
import { generateReport } from "./markdown-report.js";
import {
  AUDIENCE_TYPES,
  DEMOGRAPHIC_DIMENSIONS,
  resolveMediaType,
  type AudienceType,
  type DemographicDimension,
  type MediaItem,
  type MediaType,
} from "./types.js";

// Account-level insights are always a 7-day window — that is the meaning of
// the `account_metrics.platform_extras.reach` / `.profile_views` values per
// CONTEXT.md. Changing this would change what those values *mean* across
// snapshots, breaking longitudinal comparisons.
const ACCOUNT_INSIGHTS_WINDOW_DAYS = 7;

const MAX_POSTS_TO_SCAN = 50;

// The Posts section of the rolling report always shows at most this many
// posts. When the lookback window contains fewer than this, the audit
// pulls the most recent posts from outside the window to fill — those
// rows are flagged is_supplemental=1 so the report can mark them visually.
const POSTS_PER_REPORT = 5;

type InstagramCredentials = {
  page_access_token: string;
  fb_page_id?: string;
};

export async function runInstagramAudit(
  input: PlatformAuditInput,
): Promise<PlatformAuditResult> {
  const { platformAccount, client, lookbackDays } = input;

  const creds = JSON.parse(platformAccount.credentials) as InstagramCredentials;
  const igAccountId = platformAccount.external_account_id;
  const pageAccessToken = creds.page_access_token;

  console.log(`  ig_business_account_id: ${igAccountId}`);

  const now = new Date();
  const nowUnix = Math.floor(now.getTime() / 1000);
  const accountSinceUnix =
    nowUnix - ACCOUNT_INSIGHTS_WINDOW_DAYS * 24 * 60 * 60;
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

  console.log("\n  Fetching account profile...");
  const profile = await getAccountProfile(igAccountId, pageAccessToken);
  console.log(
    `    followers=${profile.followers_count}  follows=${profile.follows_count}  media=${profile.media_count}`,
  );

  console.log("\n  Fetching account insights...");
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
    throw new Error(
      `Account insights response missing required metrics. Got: ${Object.keys(accountInsights).join(", ") || "(empty)"}`,
    );
  }
  console.log(`    reach=${reachValue}  profile_views=${profileViewsValue}`);

  console.log("\n  Listing recent media...");
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
    `    ${allMedia.length} returned, ${inWindow.length} within last ${lookbackDays} days, ${supplemental.length} supplemental (to reach ${POSTS_PER_REPORT})`,
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
  if (mediaToCapture.length > 0) {
    console.log("\n  Fetching per-media insights...");
  }
  for (const { item, isSupplemental } of mediaToCapture) {
    const kind = resolveMediaType(item);
    const insights = await getMediaInsights(item.id, kind, pageAccessToken);
    mediaWithInsights.push({ item, kind, insights, isSupplemental });
  }
  const withInsightsCount = mediaWithInsights.filter(
    (m) => m.insights !== null,
  ).length;

  console.log("\n  Fetching audience demographics...");
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
    `    ${demographicCaptures.length}/${AUDIENCE_TYPES.length * DEMOGRAPHIC_DIMENSIONS.length} breakdowns returned, ${demographicRowCount} bucket row(s)`,
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
      platformAccount.id,
      now.toISOString(),
      lookbackDays,
      1, // demographics_attempted — this build always tries the 2x4 grid
      null,
    );
    const snapshotId = Number(snapResult.lastInsertRowid);

    // Instagram-specific account extras (reach, profile_views,
    // website_clicks) live in the platform_extras JSON. Other platforms
    // will store their own shape; readers parse this column with knowledge
    // of which platform the snapshot belongs to.
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
        // captions cap at 2,200 chars which is well within SQLite TEXT
        // limits.
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

  console.log(
    `\n  Snapshot saved (id=${snapshotId}) at ${toEtTimestamp(now.toISOString())}`,
  );
  console.log("    account_metrics:         1 row");
  console.log(
    `    post_metrics:            ${mediaWithInsights.length} row(s) (${withInsightsCount} with insights, ${mediaWithInsights.length - withInsightsCount} without, ${supplementalCount} supplemental)`,
  );
  console.log(
    `    demographic_breakdowns:  ${demographicRowCount} row(s) across ${demographicCaptures.length} breakdown(s)`,
  );

  const { rollingPath, archivePath } = generateReport({
    client_id: client.id,
    platform_account_id: platformAccount.id,
    platform: platformAccount.platform,
    short_name: client.short_name,
    display_name: client.display_name,
  });
  console.log(`  Markdown report: ${rollingPath}`);
  if (archivePath) {
    console.log(`  Archive: ${archivePath}`);
  }

  return { snapshotId, rollingPath, archivePath };
}
