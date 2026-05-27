import {
  accountInsightsResponseSchema,
  accountProfileSchema,
  apiErrorEnvelopeSchema,
  debugTokenResponseSchema,
  mediaInsightsResponseSchema,
  mediaListResponseSchema,
  METRICS_BY_TYPE,
  pageAccessTokenResponseSchema,
  tokenExchangeResponseSchema,
  type MediaItem,
  type MediaType,
} from "../types/instagram.js";

const BASE_URL = "https://graph.facebook.com/v25.0";

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [500, 1000] as const;

export class InstagramApiError extends Error {
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
    this.name = "InstagramApiError";
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

// Retries on network errors and 5xx only. 4xx fails immediately — those are
// caller errors (bad token, bad metric, etc.) and retrying won't help.
async function requestJson(url: string): Promise<unknown> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();

      const body = (await res.json().catch(() => null)) as unknown;
      const parsed = apiErrorEnvelopeSchema.safeParse(body);
      const apiErr = parsed.success
        ? new InstagramApiError(
            parsed.data.error.message,
            res.status,
            parsed.data.error.code,
            parsed.data.error.fbtrace_id,
          )
        : new InstagramApiError(`HTTP ${res.status} ${res.statusText}`, res.status);

      if (res.status < 500 || attempt === MAX_ATTEMPTS) throw apiErr;
      await sleep(BACKOFF_MS[attempt - 1]!);
    } catch (err) {
      if (err instanceof InstagramApiError) throw err;
      if (attempt === MAX_ATTEMPTS) throw err;
      await sleep(BACKOFF_MS[attempt - 1]!);
    }
  }
  throw new Error("unreachable");
}

export async function getAccountProfile(
  igAccountId: string,
  token: string,
): Promise<{ followers_count: number; follows_count: number; media_count: number }> {
  const url = buildUrl(`/${igAccountId}`, {
    fields: "followers_count,follows_count,media_count",
    access_token: token,
  });
  const raw = await requestJson(url);
  const parsed = accountProfileSchema.parse(raw);
  return {
    followers_count: parsed.followers_count,
    follows_count: parsed.follows_count,
    media_count: parsed.media_count,
  };
}

// Returns a metric-name → value map. Caller decides which metrics to request.
// All requests standardize on metric_type=total_value (required by Graph v25
// for profile_views and most newer account metrics).
export async function getAccountInsights(
  igAccountId: string,
  token: string,
  sinceUnix: number,
  untilUnix: number,
  metrics: readonly string[],
): Promise<Record<string, number>> {
  const url = buildUrl(`/${igAccountId}/insights`, {
    metric: metrics.join(","),
    period: "day",
    metric_type: "total_value",
    since: String(sinceUnix),
    until: String(untilUnix),
    access_token: token,
  });
  const raw = await requestJson(url);
  const parsed = accountInsightsResponseSchema.parse(raw);
  const out: Record<string, number> = {};
  for (const entry of parsed.data) out[entry.name] = entry.total_value.value;
  return out;
}

export async function listRecentMedia(
  igAccountId: string,
  token: string,
  limit = 50,
): Promise<MediaItem[]> {
  const url = buildUrl(`/${igAccountId}/media`, {
    fields:
      "id,media_type,media_product_type,caption,permalink,timestamp,like_count,comments_count",
    limit: String(limit),
    access_token: token,
  });
  const raw = await requestJson(url);
  return mediaListResponseSchema.parse(raw).data;
}

// Exchange a short-lived User Token (typical 1-2 hr expiry from Graph API
// Explorer) for a long-lived User Token (~60 days). Required to derive
// long-lived Page Access Tokens — the Explorer's "User or Page" → Page
// shortcut yields whatever longevity the underlying user token has.
export async function exchangeForLongLivedToken(
  appId: string,
  appSecret: string,
  shortLivedUserToken: string,
): Promise<{ access_token: string; expires_in: number | undefined }> {
  const url = buildUrl("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLivedUserToken,
  });
  const raw = await requestJson(url);
  const parsed = tokenExchangeResponseSchema.parse(raw);
  return { access_token: parsed.access_token, expires_in: parsed.expires_in };
}

// Derive a Page Access Token from a (long-lived) User Token. The Page Token
// inherits longevity from the User Token; when the user token is long-lived,
// the resulting page token effectively never expires (expires_at=0).
export async function getPageAccessToken(
  pageId: string,
  userAccessToken: string,
): Promise<string> {
  const url = buildUrl(`/${pageId}`, {
    fields: "access_token",
    access_token: userAccessToken,
  });
  const raw = await requestJson(url);
  return pageAccessTokenResponseSchema.parse(raw).access_token;
}

// Inspect a token via /debug_token. Uses an app access token (`{app_id}|
// {app_secret}` format) as the caller credential.
export async function debugToken(
  tokenToInspect: string,
  appAccessToken: string,
): Promise<{
  is_valid: boolean;
  type: string | undefined;
  expires_at: number | undefined;
}> {
  const url = buildUrl("/debug_token", {
    input_token: tokenToInspect,
    access_token: appAccessToken,
  });
  const raw = await requestJson(url);
  const parsed = debugTokenResponseSchema.parse(raw);
  return {
    is_valid: parsed.data.is_valid,
    type: parsed.data.type,
    expires_at: parsed.data.expires_at,
  };
}

// Returns a metric-name → value map for a single media item. Callers must
// pass the resolved MediaType (use resolveMediaType from ../types/instagram.js)
// so REELS get the right metric set, not the VIDEO set. If the Graph API
// rejects the metric set (e.g. media predates personal→business conversion,
// or unsupported metric for this media), returns null and logs — the audit
// records the media row without post-level insights rather than failing the
// whole snapshot.
export async function getMediaInsights(
  mediaId: string,
  mediaType: MediaType,
  token: string,
): Promise<Record<string, number> | null> {
  const metrics = METRICS_BY_TYPE[mediaType];
  const url = buildUrl(`/${mediaId}/insights`, {
    metric: metrics.join(","),
    access_token: token,
  });
  try {
    const raw = await requestJson(url);
    const parsed = mediaInsightsResponseSchema.parse(raw);
    const out: Record<string, number> = {};
    for (const entry of parsed.data) out[entry.name] = entry.values[0]!.value;
    return out;
  } catch (err) {
    if (err instanceof InstagramApiError) {
      console.warn(
        `  [media ${mediaId} (${mediaType})] insights skipped: ${err.message}` +
          (err.apiCode !== undefined ? ` (code ${err.apiCode})` : ""),
      );
      return null;
    }
    throw err;
  }
}
