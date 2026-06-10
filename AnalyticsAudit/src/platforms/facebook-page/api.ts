// Facebook Pages Graph API wrapper. Mirrors the shape of
// src/platforms/instagram/api.ts. See docs/APP_REVIEW.md for what's
// accessible in dev mode vs gated behind App Review.

import {
  apiErrorEnvelopeSchema,
  FB_FOLLOWER_DEMOGRAPHIC_METRICS,
  PAGE_REACTIONS_METRIC,
  PAGE_SCALAR_METRICS,
  POST_REACTIONS_METRIC,
  POST_SCALAR_METRICS,
  POST_VIDEO_METRICS,
  followsInsightsResponseSchema,
  pageInsightsResponseSchema,
  pageProfileSchema,
  postInsightsResponseSchema,
  postsListResponseSchema,
  type FacebookDemographicDimension,
  type PageProfile,
  type PostItem,
  type ReactionsBreakdown,
} from "./types.js";

const BASE_URL = "https://graph.facebook.com/v25.0";

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [500, 1000] as const;

export class FacebookApiError extends Error {
  readonly httpStatus: number;
  readonly apiCode: number | undefined;
  readonly fbtraceId: string | undefined;

  constructor(
    message: string,
    httpStatus: number,
    apiCode?: number,
    fbtraceId?: string,
  ) {
    super(message);
    this.name = "FacebookApiError";
    this.httpStatus = httpStatus;
    this.apiCode = apiCode;
    this.fbtraceId = fbtraceId;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(path: string, params: Record<string, string>): string {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

async function requestJson(url: string): Promise<unknown> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();

      const body = (await res.json().catch(() => null)) as unknown;
      const parsed = apiErrorEnvelopeSchema.safeParse(body);
      const apiErr = parsed.success
        ? new FacebookApiError(
            parsed.data.error.message,
            res.status,
            parsed.data.error.code,
            parsed.data.error.fbtrace_id,
          )
        : new FacebookApiError(`HTTP ${res.status} ${res.statusText}`, res.status);

      if (res.status < 500 || attempt === MAX_ATTEMPTS) throw apiErr;
      await sleep(BACKOFF_MS[attempt - 1]!);
    } catch (err) {
      if (err instanceof FacebookApiError) throw err;
      if (attempt === MAX_ATTEMPTS) throw err;
      await sleep(BACKOFF_MS[attempt - 1]!);
    }
  }
  throw new Error("unreachable");
}

// ─── Page profile (dev-mode accessible) ─────────────────────────────────────

export async function getPageProfile(
  pageId: string,
  token: string,
): Promise<PageProfile> {
  const url = buildUrl(`/${pageId}`, {
    fields: "id,name,followers_count,fan_count",
    access_token: token,
  });
  const raw = await requestJson(url);
  return pageProfileSchema.parse(raw);
}

// ─── Posts list (dev-mode accessible) ───────────────────────────────────────

export async function listRecentPosts(
  pageId: string,
  token: string,
  limit = 50,
): Promise<PostItem[]> {
  const url = buildUrl(`/${pageId}/posts`, {
    fields:
      "id,created_time,message,permalink_url,status_type,attachments{media_type,type,url,title}",
    limit: String(limit),
    access_token: token,
  });
  const raw = await requestJson(url);
  return postsListResponseSchema.parse(raw).data;
}

// ─── Page-level insights — APP-REVIEW-GATED ────────────────────────────────
// Returns {} in dev mode (Meta silently returns data: []). Real values
// arrive once the app passes review for pages_read_engagement.

export async function getPageScalarInsights(
  pageId: string,
  token: string,
  sinceUnix: number,
  untilUnix: number,
): Promise<Record<string, number>> {
  const url = buildUrl(`/${pageId}/insights`, {
    metric: PAGE_SCALAR_METRICS.join(","),
    period: "day",
    since: String(sinceUnix),
    until: String(untilUnix),
    access_token: token,
  });
  const raw = await requestJson(url);
  const parsed = pageInsightsResponseSchema.parse(raw);
  const out: Record<string, number> = {};
  for (const entry of parsed.data) {
    let sum = 0;
    for (const v of entry.values) {
      if (typeof v.value === "number") sum += v.value;
    }
    out[entry.name] = sum;
  }
  return out;
}

// APP-REVIEW-GATED. Returns null when Meta doesn't release the data (in
// dev mode that's always; post-review it's only when the window has zero
// reactions).
export async function getPageReactionsBreakdown(
  pageId: string,
  token: string,
  sinceUnix: number,
  untilUnix: number,
): Promise<ReactionsBreakdown | null> {
  const url = buildUrl(`/${pageId}/insights`, {
    metric: PAGE_REACTIONS_METRIC,
    period: "day",
    since: String(sinceUnix),
    until: String(untilUnix),
    access_token: token,
  });
  try {
    const raw = await requestJson(url);
    const parsed = pageInsightsResponseSchema.parse(raw);
    const entry = parsed.data[0];
    if (!entry) return null;
    const accum: Record<string, number> = {};
    for (const v of entry.values) {
      if (typeof v.value === "object" && v.value !== null) {
        for (const [k, n] of Object.entries(v.value)) {
          if (typeof n === "number") accum[k] = (accum[k] ?? 0) + n;
        }
      }
    }
    return accum;
  } catch (err) {
    if (err instanceof FacebookApiError) {
      console.warn(
        `  [page reactions breakdown] skipped: ${err.message}` +
          (err.apiCode !== undefined ? ` (code ${err.apiCode})` : ""),
      );
      return null;
    }
    throw err;
  }
}

// ─── Per-post insights — APP-REVIEW-GATED ──────────────────────────────────

export async function getPostScalarInsights(
  postId: string,
  token: string,
): Promise<{
  scalars: Record<string, number>;
  reactions: ReactionsBreakdown;
} | null> {
  const metricList = [POST_REACTIONS_METRIC, ...POST_SCALAR_METRICS].join(",");
  const url = buildUrl(`/${postId}/insights`, {
    metric: metricList,
    access_token: token,
  });
  try {
    const raw = await requestJson(url);
    const parsed = postInsightsResponseSchema.parse(raw);
    const scalars: Record<string, number> = {};
    let reactions: ReactionsBreakdown = {};
    for (const entry of parsed.data) {
      const v = entry.values[0]!.value;
      if (entry.name === POST_REACTIONS_METRIC) {
        if (typeof v === "object" && v !== null) reactions = v;
      } else if (typeof v === "number") {
        scalars[entry.name] = v;
      }
    }
    return { scalars, reactions };
  } catch (err) {
    if (err instanceof FacebookApiError) {
      console.warn(
        `  [post ${postId} scalar insights] skipped: ${err.message}` +
          (err.apiCode !== undefined ? ` (code ${err.apiCode})` : ""),
      );
      return null;
    }
    throw err;
  }
}

export async function getPostVideoMetrics(
  postId: string,
  token: string,
): Promise<Record<string, number> | null> {
  const url = buildUrl(`/${postId}/insights`, {
    metric: POST_VIDEO_METRICS.join(","),
    access_token: token,
  });
  try {
    const raw = await requestJson(url);
    const parsed = postInsightsResponseSchema.parse(raw);
    const out: Record<string, number> = {};
    for (const entry of parsed.data) {
      const v = entry.values[0]!.value;
      if (typeof v === "number") out[entry.name] = v;
    }
    return out;
  } catch (err) {
    if (err instanceof FacebookApiError) {
      console.warn(
        `  [post ${postId} video metrics] skipped: ${err.message}` +
          (err.apiCode !== undefined ? ` (code ${err.apiCode})` : ""),
      );
      return null;
    }
    throw err;
  }
}

// ─── Follower demographics (country / city) ────────────────────────────────
// Works in dev mode — Meta returns real lifetime aggregate data even
// without App Review. The response has one values[] entry per day in the
// requested window, each carrying the same {bucket: count} dict (lifetime
// cumulative state, not daily delta). We use the most recent end_time.
//
// Returns null on Graph API errors AND on the empty-bucket case (a Page
// below Meta's ~100-person-per-bucket privacy threshold for a given
// dimension just gets an empty response).
export async function getPageFollowsDemographics(
  pageId: string,
  dimension: FacebookDemographicDimension,
  token: string,
  sinceUnix: number,
  untilUnix: number,
): Promise<Record<string, number> | null> {
  const metric = FB_FOLLOWER_DEMOGRAPHIC_METRICS[dimension];
  const url = buildUrl(`/${pageId}/insights`, {
    metric,
    period: "day",
    since: String(sinceUnix),
    until: String(untilUnix),
    access_token: token,
  });
  try {
    const raw = await requestJson(url);
    const parsed = followsInsightsResponseSchema.parse(raw);
    const entry = parsed.data[0];
    if (!entry || entry.values.length === 0) return null;
    // Pick the most recent end_time (last entry). Meta's API returns days
    // in chronological order; values without end_time still get treated as
    // "latest in array" by virtue of being last.
    const latest = entry.values[entry.values.length - 1]!;
    if (Object.keys(latest.value).length === 0) return null;
    return { ...latest.value };
  } catch (err) {
    if (err instanceof FacebookApiError) {
      console.warn(
        `  [follower_demographics × ${dimension}] skipped: ${err.message}` +
          (err.apiCode !== undefined ? ` (code ${err.apiCode})` : ""),
      );
      return null;
    }
    throw err;
  }
}

// APP-REVIEW-GATED. In dev mode FB returns 200 with shares omitted
// (silent suppression) and reactions/comments summaries fail with code 10.
export async function getPostObjectCounts(
  postId: string,
  token: string,
): Promise<{
  shares_count: number;
  reactions_total: number;
  comments_count: number;
} | null> {
  const url = buildUrl(`/${postId}`, {
    fields: "shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)",
    access_token: token,
  });
  try {
    const raw = (await requestJson(url)) as {
      shares?: { count?: number };
      reactions?: { summary?: { total_count?: number } };
      comments?: { summary?: { total_count?: number } };
    };
    return {
      shares_count: raw.shares?.count ?? 0,
      reactions_total: raw.reactions?.summary?.total_count ?? 0,
      comments_count: raw.comments?.summary?.total_count ?? 0,
    };
  } catch (err) {
    if (err instanceof FacebookApiError) {
      console.warn(
        `  [post ${postId} object counts] skipped: ${err.message}` +
          (err.apiCode !== undefined ? ` (code ${err.apiCode})` : ""),
      );
      return null;
    }
    throw err;
  }
}
