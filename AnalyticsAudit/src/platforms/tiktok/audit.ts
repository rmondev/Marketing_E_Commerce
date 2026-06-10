// TikTok audit (Phase G3).
//
// Captures a snapshot of a TikTok account from the Display API:
//   - Account: followers, following, total videos, total lifetime likes
//     (+ profile display name / username / verified flag).
//   - Posts: recent videos with per-video views / likes / comments / shares.
//
// Token handling: TikTok access tokens last ~24h. Before any data fetch the
// audit checks expiry and refreshes inline using the (rotating) refresh
// token, persisting the new pair back to platform_accounts.credentials. This
// is the primary refresh path — there's no manual `token:refresh` step for
// TikTok during normal weekly use (see docs/TIKTOK_SETUP.md).
//
// No demographics: TikTok's Display API exposes none (age/gender/geo live
// behind the gated Research API), so demographic_breakdowns is left empty and
// the report renders an empty-state explanation.

import { db } from "../../core/db/client.js";
import { env } from "../../core/lib/env.js";
import { toEtTimestamp } from "../../core/lib/time.js";
import type {
  PlatformAccount,
  PlatformAuditInput,
  PlatformAuditResult,
} from "../_registry.js";
import { getUserInfo, listVideos } from "./api.js";
import { generateTikTokReport } from "./markdown-report.js";
import {
  refreshTokens,
  tokensNeedRefresh,
  type TikTokTokens,
} from "./oauth.js";
import { TIKTOK_MEDIA_TYPE, type TikTokCredentials } from "./types.js";

// Scan more videos than we render so the lookback-window filter has material
// to work with even on prolific accounts; render a small, focused set.
const MAX_VIDEOS_TO_SCAN = 50;
const POSTS_PER_REPORT = 5;

export async function runTikTokAudit(
  input: PlatformAuditInput,
): Promise<PlatformAuditResult> {
  const { platformAccount, client, lookbackDays } = input;

  const creds = JSON.parse(platformAccount.credentials) as TikTokCredentials;
  console.log(`  open_id: ${platformAccount.external_account_id}`);

  // ─── Ensure a fresh access token ────────────────────────────────────────
  const accessToken = await ensureFreshToken(platformAccount, creds);

  const now = new Date();
  const mediaSinceMs = now.getTime() - lookbackDays * 24 * 60 * 60 * 1000;
  const mediaSinceDate = new Date(mediaSinceMs);
  console.log(
    `  media window:            ${toEtTimestamp(mediaSinceDate.toISOString())} → ${toEtTimestamp(now.toISOString())} (${lookbackDays}d)`,
  );

  // ─── Fetch account stats ────────────────────────────────────────────────
  console.log("\n  Fetching account info...");
  const user = await getUserInfo(accessToken);
  const statsWithheld = user.follower_count === undefined;
  const followersCount = user.follower_count ?? 0;
  const followingCount = user.following_count ?? 0;
  const videoCount = user.video_count ?? 0;
  console.log(
    statsWithheld
      ? "    (account stats withheld — user.info.stats scope not granted on this token)"
      : `    @${user.username ?? "?"}  followers=${followersCount}  following=${followingCount}  videos=${videoCount}  likes=${user.likes_count ?? "?"}`,
  );

  // ─── Fetch videos ───────────────────────────────────────────────────────
  console.log("\n  Listing recent videos...");
  const allVideos = await listVideos(accessToken, {
    maxVideos: MAX_VIDEOS_TO_SCAN,
  });
  // create_time is unix SECONDS. Sort newest-first defensively (TikTok already
  // returns newest-first, but don't rely on it).
  const sorted = [...allVideos].sort((a, b) => b.create_time - a.create_time);
  const inWindow = sorted.filter((v) => v.create_time * 1000 >= mediaSinceMs);
  const outOfWindow = sorted.filter((v) => v.create_time * 1000 < mediaSinceMs);
  const supplementalNeeded = Math.max(0, POSTS_PER_REPORT - inWindow.length);
  const supplemental = outOfWindow.slice(0, supplementalNeeded);
  console.log(
    `    ${allVideos.length} returned, ${inWindow.length} within last ${lookbackDays} days, ${supplemental.length} supplemental (to reach ${POSTS_PER_REPORT})`,
  );

  const videosToCapture = [
    ...inWindow.map((video) => ({ video, isSupplemental: false })),
    ...supplemental.map((video) => ({ video, isSupplemental: true })),
  ];

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
      0, // demographics_attempted — TikTok's Display API exposes none
      null,
    );
    const snapshotId = Number(snapResult.lastInsertRowid);

    insertAccountMetrics.run(
      snapshotId,
      followersCount,
      followingCount,
      videoCount,
      JSON.stringify({
        likes_count: user.likes_count ?? null,
        is_verified: user.is_verified ?? null,
        display_name: user.display_name ?? null,
        username: user.username ?? null,
        profile_deep_link: user.profile_deep_link ?? null,
        manual_token: creds.manual_token === true,
        stats_withheld: statsWithheld,
      }),
    );

    for (const { video, isSupplemental } of videosToCapture) {
      const caption = video.title ?? video.video_description ?? null;
      insertPostMetric.run(
        snapshotId,
        video.id,
        TIKTOK_MEDIA_TYPE,
        caption,
        video.share_url ?? "",
        new Date(video.create_time * 1000).toISOString(),
        video.like_count ?? 0,
        video.comment_count ?? 0,
        video.share_count ?? null,
        video.view_count ?? null,
        isSupplemental ? 1 : 0,
        JSON.stringify({ duration: video.duration ?? null }),
      );
    }

    return snapshotId;
  });

  const snapshotId = persist();
  const supplementalCount = videosToCapture.filter(
    (v) => v.isSupplemental,
  ).length;

  console.log(
    `\n  Snapshot saved (id=${snapshotId}) at ${toEtTimestamp(now.toISOString())}`,
  );
  console.log("    account_metrics:         1 row");
  console.log(
    `    post_metrics:            ${videosToCapture.length} row(s) (${supplementalCount} supplemental)`,
  );

  const { rollingPath, archivePath } = generateTikTokReport({
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

// Returns a usable access token, refreshing inline (and persisting the rotated
// pair) when the current one is within the expiry buffer. Falls back to the
// existing token when no refresh is possible, letting the API call surface a
// clear error rather than failing silently here.
async function ensureFreshToken(
  platformAccount: PlatformAccount,
  creds: TikTokCredentials,
): Promise<string> {
  if (!tokensNeedRefresh({ expires_at_iso: creds.expires_at_iso })) {
    return creds.access_token;
  }

  if (creds.refresh_token === undefined || creds.refresh_token === "") {
    console.log(
      "  ⚠ Access token is near/at expiry but no refresh_token is stored — proceeding with the existing token (it may be rejected). Re-onboard to restore auto-refresh.",
    );
    return creds.access_token;
  }
  if (
    env.TIKTOK_CLIENT_KEY === undefined ||
    env.TIKTOK_CLIENT_KEY === "" ||
    env.TIKTOK_CLIENT_SECRET === undefined ||
    env.TIKTOK_CLIENT_SECRET === ""
  ) {
    throw new Error(
      "TikTok access token expired and TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET are not set in .env.local, so it can't be refreshed. See docs/TIKTOK_SETUP.md.",
    );
  }

  console.log("  Access token near expiry — refreshing...");
  const tokens: TikTokTokens = await refreshTokens({
    clientKey: env.TIKTOK_CLIENT_KEY,
    clientSecret: env.TIKTOK_CLIENT_SECRET,
    refreshToken: creds.refresh_token,
  });

  // Merge rotated tokens into the stored credentials, preserving profile
  // fields and the manual_token marker. TikTok rotates the refresh_token on
  // every call, so the new one MUST be persisted or the next audit can't refresh.
  const newCreds: TikTokCredentials = {
    ...creds,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at_iso: tokens.expires_at_iso,
    refresh_expires_at_iso: tokens.refresh_expires_at_iso,
    open_id: tokens.open_id,
    scope: tokens.scope,
  };
  db.prepare("UPDATE platform_accounts SET credentials = ? WHERE id = ?").run(
    JSON.stringify(newCreds),
    platformAccount.id,
  );
  console.log(
    `    refreshed — new access token expires ${toEtTimestamp(tokens.expires_at_iso)}`,
  );
  return tokens.access_token;
}
