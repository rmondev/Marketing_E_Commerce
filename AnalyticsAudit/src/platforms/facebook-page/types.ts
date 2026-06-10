// Facebook Pages API types + schemas.
//
// ─── Access status ──────────────────────────────────────────────────────────
// Until our Meta App passes App Review (see docs/APP_REVIEW.md), only a
// subset of these endpoints actually returns data:
//
//   ✓ /<page-id>?fields=id,name,followers_count,fan_count       (profile)
//   ✓ /<page-id>/posts?fields=id,message,created_time,...       (post listing)
//   ✓ /<post-id>?fields=id,message,created_time,permalink_url   (post metadata)
//   ✗ /<post-id>?fields=reactions.summary(...) or comments.summary(...) — code 10
//   ✗ /<page-id>/insights and /<post-id>/insights — silently return data: []
//
// The wrappers below are kept whole so that flipping App Review to "approved"
// requires no code changes — just enabling the calls in audit.ts. Functions
// marked APP-REVIEW-GATED are safe to call in dev mode (they degrade to null
// or empty) but won't return real values until review passes.

import { z } from "zod";

// Normalized post-type enum stored in post_metrics.media_type. Derived from
// Graph's `attachments.data[0].media_type` (the modern field) with fallback
// to `type`/`status_type` for older posts. Distinct from IG's MediaType.
const postTypeSchema = z.enum([
  "STATUS",
  "PHOTO",
  "VIDEO",
  "LINK",
  "ALBUM",
  "REEL",
  "EVENT",
  "OTHER",
]);
export type FacebookPostType = z.infer<typeof postTypeSchema>;

// ─── Page profile (dev-mode accessible) ─────────────────────────────────────

export const pageProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  followers_count: z.number().int().nonnegative().optional(),
  fan_count: z.number().int().nonnegative().optional(),
});
export type PageProfile = z.infer<typeof pageProfileSchema>;

// ─── Posts list (dev-mode accessible) ───────────────────────────────────────

const postAttachmentSchema = z.object({
  media_type: z.string().optional(),    // "photo" | "video" | "album" | "link" | "share" | etc.
  type: z.string().optional(),
  url: z.string().optional(),
  title: z.string().optional(),
});

export const postItemSchema = z.object({
  id: z.string(),
  created_time: z.string(),
  message: z.string().optional(),
  permalink_url: z.string().optional(),
  status_type: z.string().optional(),         // "mobile_status_update" | "added_photos" | "added_video" | "shared_story" | etc.
  attachments: z
    .object({
      data: z.array(postAttachmentSchema),
    })
    .optional(),
});
export type PostItem = z.infer<typeof postItemSchema>;

export const postsListResponseSchema = z.object({
  data: z.array(postItemSchema),
});

// Resolve a Graph post into one of our normalized post types. attachments is
// the modern field; status_type fills in for posts without an attachments
// payload (text-only updates, shared stories, etc.).
export function resolvePostType(item: PostItem): FacebookPostType {
  const attMedia = item.attachments?.data[0]?.media_type?.toLowerCase();
  if (attMedia === "video") return "VIDEO";
  if (attMedia === "photo") return "PHOTO";
  if (attMedia === "album") return "ALBUM";
  if (attMedia === "link") return "LINK";

  const att = item.attachments?.data[0]?.type?.toLowerCase();
  if (att?.includes("reel")) return "REEL";
  if (att === "video_inline" || att === "video_autoplay") return "VIDEO";
  if (att === "photo") return "PHOTO";
  if (att === "album") return "ALBUM";
  if (att === "share") return "LINK";
  if (att === "event") return "EVENT";

  const st = item.status_type;
  if (st === "added_video") return "VIDEO";
  if (st === "added_photos") return "PHOTO";
  if (st === "shared_story") return "LINK";
  if (st === "mobile_status_update") return "STATUS";

  return "OTHER";
}

// ─── Page-level insights (APP-REVIEW-GATED) ────────────────────────────────

// Each metric verified valid in Graph v25 via probe-metrics.ts on 2026-06-09.
// All return data: [] without App Review.
export const PAGE_SCALAR_METRICS = [
  "page_impressions_unique",          // reach (rolling window, unique)
  "page_impressions_paid_unique",     // of which: paid reach (splits paid vs organic)
  "page_views_total",                 // profile-view analogue
  "page_post_engagements",            // total per-post engagement actions
  "page_total_actions",               // CTA button clicks (Book Now, Call, Message)
  "page_follows",                     // new follow events in window
] as const;

export const PAGE_REACTIONS_METRIC = "page_actions_post_reactions_total" as const;

const reactionsBreakdownSchema = z.object({
  like: z.number().int().nonnegative().optional(),
  love: z.number().int().nonnegative().optional(),
  wow: z.number().int().nonnegative().optional(),
  haha: z.number().int().nonnegative().optional(),
  sorry: z.number().int().nonnegative().optional(),  // "sad"; Meta's API key
  anger: z.number().int().nonnegative().optional(),  // "angry"; Meta's API key
});
export type ReactionsBreakdown = z.infer<typeof reactionsBreakdownSchema>;

const pageInsightValueSchema = z.union([
  z.number(),
  reactionsBreakdownSchema,
]);

const pageInsightEntrySchema = z.object({
  name: z.string(),
  period: z.string(),
  values: z.array(
    z.object({ value: pageInsightValueSchema, end_time: z.string().optional() }),
  ),
});

export const pageInsightsResponseSchema = z.object({
  data: z.array(pageInsightEntrySchema),
});

// Max window size accepted by the page-insights endpoint. Going wider
// returns error_subcode 1504016. Backfills must chunk into ≤90-day passes.
export const PAGE_INSIGHTS_MAX_WINDOW_DAYS = 90;

// ─── Per-post insights (APP-REVIEW-GATED) ──────────────────────────────────

const postInsightValueSchema = z.union([
  z.number(),
  reactionsBreakdownSchema,
]);

const postInsightEntrySchema = z.object({
  name: z.string(),
  period: z.string(),
  values: z.array(z.object({ value: postInsightValueSchema })).min(1),
});

export const postInsightsResponseSchema = z.object({
  data: z.array(postInsightEntrySchema),
});

export const POST_SCALAR_METRICS = [
  "post_impressions_unique",          // per-post reach
  "post_clicks",                      // any click on the post (link, photo, etc.)
] as const;

export const POST_VIDEO_METRICS = [
  "post_video_views",                 // total video views (3s+)
  "post_video_views_unique",          // unique viewers
  "post_video_views_organic",         // of which: organic-only (not paid)
  "post_video_complete_views_30s",    // 30s+ completions
  "post_video_avg_time_watched",      // avg watch time (ms)
  "post_video_view_time",             // total watch time (ms)
  "post_video_view_time_organic",     // of which: organic-only watch time (ms)
] as const;

export const POST_REACTIONS_METRIC = "post_reactions_by_type_total" as const;

// ─── Error envelope (shared shape with IG) ─────────────────────────────────

export const apiErrorEnvelopeSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string().optional(),
    code: z.number().optional(),
    error_subcode: z.number().optional(),
    fbtrace_id: z.string().optional(),
  }),
});

// ─── Note on demographics ───────────────────────────────────────────────────
// Page-level demographic metrics (page_fans_gender_age, page_fans_country,
// page_fans_city, page_fans_locale) were DEPRECATED in Graph v22+. Verified
// removed from v25 via probe — they return code 100 "invalid insights
// metric" regardless of permissions. The data only exists in Meta Business
// Suite now; there is no API path to recover it. Even App Review can't
// unlock these. Demographics are deliberately omitted from the FB Page
// audit and from these types.
