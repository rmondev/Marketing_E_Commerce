import { z } from "zod";

// Our normalized dispatch key for media-insights metric selection AND for the
// `post_metrics.media_type` column. Distinct from Graph's raw `media_type`
// field (which only returns IMAGE/VIDEO/CAROUSEL_ALBUM — Reels come back as
// VIDEO with `media_product_type=REELS`). Always derive via resolveMediaType.
export const mediaTypeSchema = z.enum(["IMAGE", "VIDEO", "CAROUSEL_ALBUM", "REELS"]);
export type MediaType = z.infer<typeof mediaTypeSchema>;

const rawMediaTypeSchema = z.enum(["IMAGE", "VIDEO", "CAROUSEL_ALBUM"]);

export const accountProfileSchema = z.object({
  id: z.string(),
  followers_count: z.number().int().nonnegative(),
  follows_count: z.number().int().nonnegative(),
  media_count: z.number().int().nonnegative(),
});
export type AccountProfile = z.infer<typeof accountProfileSchema>;

const accountMetricEntrySchema = z.object({
  name: z.string(),
  period: z.string(),
  total_value: z.object({ value: z.number() }),
});
export const accountInsightsResponseSchema = z.object({
  data: z.array(accountMetricEntrySchema),
});
export type AccountInsightsResponse = z.infer<typeof accountInsightsResponseSchema>;

export const mediaItemSchema = z.object({
  id: z.string(),
  media_type: rawMediaTypeSchema,
  media_product_type: z.string().optional(),
  caption: z.string().optional(),
  permalink: z.string(),
  timestamp: z.string(),
  like_count: z.number().int().nonnegative(),
  comments_count: z.number().int().nonnegative(),
});
export type MediaItem = z.infer<typeof mediaItemSchema>;

export const mediaListResponseSchema = z.object({
  data: z.array(mediaItemSchema),
});

const mediaMetricEntrySchema = z.object({
  name: z.string(),
  period: z.string(),
  values: z.array(z.object({ value: z.number() })).min(1),
});
export const mediaInsightsResponseSchema = z.object({
  data: z.array(mediaMetricEntrySchema),
});
export type MediaInsightsResponse = z.infer<typeof mediaInsightsResponseSchema>;

// Single source of truth for the Reels-vs-Video distinction. Graph returns
// `media_type=VIDEO` for both feed videos and Reels; only `media_product_type`
// disambiguates. Use this everywhere we dispatch on type (metric selection,
// DB storage).
export function resolveMediaType(item: {
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_product_type?: string | undefined;
}): MediaType {
  if (item.media_product_type === "REELS") return "REELS";
  return item.media_type;
}

// Per-MediaType metric list for /insights. `views` is the Graph v25
// unified metric (replaces deprecated `impressions` for IMAGE/CAROUSEL_ALBUM
// and deprecated `video_views` for VIDEO/REELS). Supported across all four
// types as of Graph v22+. If a future API change rejects it for a specific
// type, the audit logs and stores null for that post — see getMediaInsights.
export const METRICS_BY_TYPE: Record<MediaType, readonly string[]> = {
  IMAGE: ["reach", "saved", "shares", "views"],
  VIDEO: ["reach", "saved", "shares", "views"],
  REELS: ["reach", "saved", "shares", "views"],
  CAROUSEL_ALBUM: ["reach", "saved", "shares", "views"],
};

export const apiErrorEnvelopeSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string().optional(),
    code: z.number().optional(),
    error_subcode: z.number().optional(),
    fbtrace_id: z.string().optional(),
  }),
});

// Audience demographics — Meta's `follower_demographics` and
// `engaged_audience_demographics` metrics on /<ig-user-id>/insights with
// period=lifetime, metric_type=total_value, breakdown=<dimension>.

export const AUDIENCE_TYPES = ["follower", "engaged"] as const;
export type AudienceType = (typeof AUDIENCE_TYPES)[number];

export const DEMOGRAPHIC_DIMENSIONS = [
  "age",
  "gender",
  "country",
  "city",
] as const;
export type DemographicDimension = (typeof DEMOGRAPHIC_DIMENSIONS)[number];

// Internal name → Meta request shape. The wrapper accepts our internal name
// and translates here; storage stays on the internal name for stable column
// values.
//
// follower_demographics is a lifetime snapshot — period=lifetime is sufficient.
// engaged_audience_demographics is inherently windowed ("people who engaged
// in the last N days") and Meta rejects the call without a timeframe. As of
// Graph v20+, the last_14_days / last_30_days / last_90_days timeframes are
// no longer accepted; only this_week and this_month remain. this_month is
// the wider of the two.
export const AUDIENCE_TYPE_CONFIG: Record<
  AudienceType,
  { metric: string; timeframe?: string }
> = {
  follower: { metric: "follower_demographics" },
  engaged: {
    metric: "engaged_audience_demographics",
    timeframe: "this_month",
  },
};

const demographicResultSchema = z.object({
  dimension_values: z.array(z.string()).min(1),
  value: z.number(),
});

const demographicBreakdownSchema = z.object({
  dimension_keys: z.array(z.string()),
  results: z.array(demographicResultSchema),
});

const demographicEntrySchema = z.object({
  name: z.string(),
  period: z.string(),
  total_value: z.object({
    breakdowns: z.array(demographicBreakdownSchema).min(1),
  }),
});

export const demographicInsightsResponseSchema = z.object({
  data: z.array(demographicEntrySchema),
});
export type DemographicInsightsResponse = z.infer<
  typeof demographicInsightsResponseSchema
>;

// Response shapes for token-management endpoints.
export const tokenExchangeResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
});

export const pageAccessTokenResponseSchema = z.object({
  id: z.string(),
  access_token: z.string(),
});

export const debugTokenResponseSchema = z.object({
  data: z.object({
    is_valid: z.boolean(),
    type: z.string().optional(),
    app_id: z.string().optional(),
    user_id: z.string().optional(),
    expires_at: z.number().optional(),
    data_access_expires_at: z.number().optional(),
  }),
});
