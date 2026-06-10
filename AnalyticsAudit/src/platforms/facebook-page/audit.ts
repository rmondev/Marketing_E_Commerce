// Facebook Page audit (thin v1, dev-mode only).
//
// What this captures TODAY:
//   - Page name, followers_count, fan_count (the legacy "Page Likes" number)
//   - Up to MAX_POSTS_TO_SCAN recent posts; each post's id, type, message,
//     created_time, permalink_url
//
// What this DOES NOT capture today (blocked by Meta App Review — see
// docs/APP_REVIEW.md):
//   - Per-post like/reaction/comment/share counts
//   - Per-post reach, clicks, video metrics
//   - Page-level insights (reach, page views, CTA clicks, engagement)
//   - Demographics (also fully removed from Graph v25 — even App Review
//     can't recover these)
//
// When App Review passes for pages_read_engagement, the audit code below
// gains additional Graph calls behind the `INSIGHTS_AVAILABLE` constant
// without any schema changes (post_metrics has nullable shares/views, and
// platform_extras JSON absorbs reactions breakdowns + CTA clicks).

import { db } from "../../core/db/client.js";
import { toEtTimestamp } from "../../core/lib/time.js";
import type {
  PlatformAuditInput,
  PlatformAuditResult,
} from "../_registry.js";
import { getPageProfile, listRecentPosts } from "./api.js";
import { generateFacebookPageReport } from "./markdown-report.js";
import { resolvePostType, type PostItem, type FacebookPostType } from "./types.js";

const MAX_POSTS_TO_SCAN = 50;
const POSTS_PER_REPORT = 5;

// Once Meta App Review approves pages_read_engagement, flip this constant
// (and re-enable the insights/reactions calls in the audit body — they're
// commented as "// AFTER APP REVIEW"). Keeping the gate in code rather than
// configuration so it's obvious at a glance what depends on it.
const INSIGHTS_AVAILABLE = false;

type FacebookPageCredentials = {
  page_access_token: string;
};

export async function runFacebookPageAudit(
  input: PlatformAuditInput,
): Promise<PlatformAuditResult> {
  const { platformAccount, client, lookbackDays } = input;

  const creds = JSON.parse(
    platformAccount.credentials,
  ) as FacebookPageCredentials;
  const pageId = platformAccount.external_account_id;
  const pageAccessToken = creds.page_access_token;

  console.log(`  fb_page_id: ${pageId}`);

  const now = new Date();
  const mediaSinceUnix =
    Math.floor(now.getTime() / 1000) - lookbackDays * 24 * 60 * 60;
  const mediaSinceDate = new Date(mediaSinceUnix * 1000);
  console.log(
    `  media window:            ${toEtTimestamp(mediaSinceDate.toISOString())} → ${toEtTimestamp(now.toISOString())} (${lookbackDays}d)`,
  );

  if (!INSIGHTS_AVAILABLE) {
    console.log(
      "  (engagement metrics + demographics gated by Meta App Review — see docs/APP_REVIEW.md)",
    );
  }

  // ─── Fetch profile ──────────────────────────────────────────────────────

  console.log("\n  Fetching page profile...");
  const profile = await getPageProfile(pageId, pageAccessToken);
  const followersCount = profile.followers_count ?? 0;
  const fanCount = profile.fan_count ?? 0;
  console.log(
    `    name="${profile.name}"  followers=${followersCount}  fans=${fanCount}`,
  );

  // ─── Fetch posts ────────────────────────────────────────────────────────

  console.log("\n  Listing recent posts...");
  const allPosts = await listRecentPosts(
    pageId,
    pageAccessToken,
    MAX_POSTS_TO_SCAN,
  );
  const sortedPosts = [...allPosts].sort(
    (a, b) =>
      new Date(b.created_time).getTime() - new Date(a.created_time).getTime(),
  );
  const inWindow = sortedPosts.filter(
    (p) => new Date(p.created_time) >= mediaSinceDate,
  );
  const outOfWindow = sortedPosts.filter(
    (p) => new Date(p.created_time) < mediaSinceDate,
  );
  const supplementalNeeded = Math.max(0, POSTS_PER_REPORT - inWindow.length);
  const supplemental = outOfWindow.slice(0, supplementalNeeded);
  console.log(
    `    ${allPosts.length} returned, ${inWindow.length} within last ${lookbackDays} days, ${supplemental.length} supplemental (to reach ${POSTS_PER_REPORT})`,
  );

  type PostToCapture = { item: PostItem; isSupplemental: boolean; type: FacebookPostType };
  const postsToCapture: PostToCapture[] = [
    ...inWindow.map((item) => ({
      item,
      isSupplemental: false,
      type: resolvePostType(item),
    })),
    ...supplemental.map((item) => ({
      item,
      isSupplemental: true,
      type: resolvePostType(item),
    })),
  ];

  // ─── AFTER APP REVIEW: insights + reactions go here ─────────────────────
  // For each post, call getPostObjectCounts (likes/reactions/comments/shares),
  // getPostScalarInsights (reach/clicks), getPostVideoMetrics (videos only).
  // For the page, call getPageScalarInsights (reach/views/CTA/follows) and
  // getPageReactionsBreakdown. Store insights in post_metrics fields +
  // post_metrics.platform_extras / account_metrics.platform_extras.

  // ─── Persist ────────────────────────────────────────────────────────────

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

  const persist = db.transaction((): number => {
    const snapResult = insertSnapshot.run(
      platformAccount.id,
      now.toISOString(),
      lookbackDays,
      0, // demographics_attempted — FB Page never attempts (deprecated by Meta)
      null,
    );
    const snapshotId = Number(snapResult.lastInsertRowid);

    // FB-specific account extras. fan_count is the legacy "Page Likes" number
    // (kept distinct from followers_count even though they often match).
    // page_name is stored for report headers without needing another fetch.
    // engagement_pending_app_review tells the report renderer to show the
    // App Review banner instead of zero-valued KPI cards.
    insertAccountMetrics.run(
      snapshotId,
      followersCount,
      0, // follows_count — Pages don't follow
      postsToCapture.length, // posts captured in this snapshot (not lifetime page total)
      JSON.stringify({
        fan_count: fanCount,
        page_name: profile.name,
        engagement_pending_app_review: !INSIGHTS_AVAILABLE,
      }),
    );

    for (const { item, type, isSupplemental } of postsToCapture) {
      insertPostMetric.run(
        snapshotId,
        item.id,
        type,
        // Store the full message as caption for downstream report use; FB has
        // no enforced length limit on posts but most fit comfortably.
        item.message ?? null,
        item.permalink_url ?? "",
        item.created_time,
        0, // like_count — not fetchable in dev mode (App Review gated)
        0, // comments_count — same
        null, // shares — same (post_metrics.shares is nullable)
        null, // views — same
        isSupplemental ? 1 : 0,
        JSON.stringify({
          status_type: item.status_type ?? null,
          engagement_pending_app_review: !INSIGHTS_AVAILABLE,
        }),
      );
    }

    return snapshotId;
  });

  const snapshotId = persist();
  const supplementalCount = postsToCapture.filter(
    (p) => p.isSupplemental,
  ).length;

  console.log(
    `\n  Snapshot saved (id=${snapshotId}) at ${toEtTimestamp(now.toISOString())}`,
  );
  console.log("    account_metrics:         1 row");
  console.log(
    `    post_metrics:            ${postsToCapture.length} row(s) (0 with engagement, ${postsToCapture.length} pending App Review, ${supplementalCount} supplemental)`,
  );
  console.log("    demographic_breakdowns:  0 row(s) (Meta removed FB Page demographics in v22+)");

  const { rollingPath, archivePath } = generateFacebookPageReport({
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
