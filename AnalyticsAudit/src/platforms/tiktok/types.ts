// TikTok Display API (open.tiktokapis.com/v2) types + schemas.
//
// Two endpoints power the audit:
//
//   ✓ GET  /v2/user/info/   — account-level stats (followers, following,
//                             total likes, video count) + profile fields.
//                             Needs scopes user.info.basic / .profile / .stats.
//   ✓ POST /v2/video/list/  — the user's own videos with per-video
//                             view/like/comment/share counts. Needs scope
//                             video.list. Paginated via cursor + has_more.
//
// Unlike Meta's Graph API, TikTok wraps EVERY response (success and failure)
// in an `error` envelope. A successful call carries `error.code === "ok"`;
// anything else is a real error even when the HTTP status is 200. The api.ts
// wrapper keys off that, so the schemas below always include `error`.
//
// Audience demographics (age/gender/geo) are intentionally absent: TikTok
// exposes those only through the separately-gated Research API, not the
// Display API our Login Kit app uses. Reports surface that as an empty-state
// explanation rather than blank values.

import { z } from "zod";

// ─── Response envelope ──────────────────────────────────────────────────────

// Present on every v2 response. `code` is "ok" on success; on failure it's a
// string like "access_token_invalid", "scope_not_authorized", or
// "rate_limit_exceeded". log_id is TikTok's support-ticket correlation id.
export const tiktokErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  log_id: z.string().optional(),
});
export type TikTokErrorEnvelope = z.infer<typeof tiktokErrorSchema>;

// ─── User info ──────────────────────────────────────────────────────────────

// Fields requested from /v2/user/info/. The stats fields (follower_count …
// video_count) require user.info.stats; the rest require user.info.basic /
// .profile. TikTok omits any field whose scope wasn't granted, so every
// metric is modelled as optional and the audit treats a missing stat as
// "withheld" rather than zero.
export const USER_INFO_FIELDS = [
  "open_id",
  "union_id",
  "avatar_url",
  "display_name",
  "bio_description",
  "profile_deep_link",
  "is_verified",
  "username",
  "follower_count",
  "following_count",
  "likes_count",
  "video_count",
] as const;

export const userInfoSchema = z.object({
  open_id: z.string(),
  union_id: z.string().optional(),
  avatar_url: z.string().optional(),
  display_name: z.string().optional(),
  bio_description: z.string().optional(),
  profile_deep_link: z.string().optional(),
  is_verified: z.boolean().optional(),
  username: z.string().optional(),
  follower_count: z.number().int().nonnegative().optional(),
  following_count: z.number().int().nonnegative().optional(),
  likes_count: z.number().int().nonnegative().optional(),
  video_count: z.number().int().nonnegative().optional(),
});
export type TikTokUserInfo = z.infer<typeof userInfoSchema>;

export const userInfoResponseSchema = z.object({
  data: z.object({ user: userInfoSchema }),
  error: tiktokErrorSchema,
});

// ─── Video list ─────────────────────────────────────────────────────────────

// Fields requested from /v2/video/list/. The four *_count fields are the
// per-post engagement metrics the audit stores in post_metrics. create_time
// is a Unix epoch in SECONDS (not ms). duration is seconds.
export const VIDEO_LIST_FIELDS = [
  "id",
  "create_time",
  "cover_image_url",
  "share_url",
  "video_description",
  "duration",
  "title",
  "like_count",
  "comment_count",
  "share_count",
  "view_count",
] as const;

export const videoSchema = z.object({
  id: z.string(),
  create_time: z.number().int().nonnegative(), // unix epoch SECONDS
  cover_image_url: z.string().optional(),
  share_url: z.string().optional(),
  video_description: z.string().optional(),
  duration: z.number().nonnegative().optional(), // seconds
  title: z.string().optional(),
  like_count: z.number().int().nonnegative().optional(),
  comment_count: z.number().int().nonnegative().optional(),
  share_count: z.number().int().nonnegative().optional(),
  view_count: z.number().int().nonnegative().optional(),
});
export type TikTokVideo = z.infer<typeof videoSchema>;

export const videoListResponseSchema = z.object({
  data: z.object({
    videos: z.array(videoSchema).optional(), // omitted entirely when the user has no videos
    cursor: z.number().optional(),
    has_more: z.boolean().optional(),
  }),
  error: tiktokErrorSchema,
});

// Max videos per page accepted by /v2/video/list/ (TikTok rejects > 20).
export const VIDEO_LIST_MAX_PAGE = 20;

// ─── Credentials shape ──────────────────────────────────────────────────────

// JSON shape persisted into platform_accounts.credentials by onboarding.ts.
// Mirrored here so the audit (G3) and any token-refresh code parse a typed
// blob instead of a bag of `unknown`. `manual_token` marks accounts
// bootstrapped via the OAuth-bug workaround (see docs/TIKTOK_SETUP.md).
export type TikTokCredentials = {
  access_token: string;
  refresh_token: string;
  expires_at_iso: string;
  refresh_expires_at_iso: string;
  open_id: string;
  scope: string;
  display_name?: string;
  username?: string;
  manual_token?: boolean;
};

// TikTok content is always video, so post_metrics.media_type is constant.
// Kept as a named export so the audit and reports don't hardcode the string.
export const TIKTOK_MEDIA_TYPE = "VIDEO" as const;
