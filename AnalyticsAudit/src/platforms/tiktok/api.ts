// TikTok Display API wrapper (open.tiktokapis.com/v2). Mirrors the shape of
// src/platforms/facebook-page/api.ts and instagram/api.ts: a small set of
// typed, schema-validated calls plus one shared fetch helper with retry.
//
// Auth: every call takes a bearer access_token (the 24h token minted during
// onboarding / refreshed by the audit). This module does NOT refresh tokens
// — that's the caller's job (oauth.ts has refreshTokens / tokensNeedRefresh).
//
// Error handling: TikTok returns an `error` envelope on EVERY response, often
// with HTTP 200 even on failure. tiktokApiFetch treats `error.code !== "ok"`
// as the authoritative failure signal regardless of HTTP status.

import {
  USER_INFO_FIELDS,
  VIDEO_LIST_FIELDS,
  VIDEO_LIST_MAX_PAGE,
  userInfoResponseSchema,
  videoListResponseSchema,
  type TikTokUserInfo,
  type TikTokVideo,
} from "./types.js";

const API_HOST = "https://open.tiktokapis.com";

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [500, 1000] as const;

// Hard ceiling on pagination passes so a misbehaving has_more can't spin
// forever. 20 pages × 20 videos = 400 videos, far beyond any audit window.
const MAX_PAGES = 20;

export class TikTokApiError extends Error {
  readonly apiCode: string;
  readonly httpStatus: number;
  readonly logId: string | undefined;

  constructor(
    apiCode: string,
    message: string,
    httpStatus: number,
    logId?: string,
  ) {
    super(message === "" ? apiCode : `${apiCode}: ${message}`);
    this.name = "TikTokApiError";
    this.apiCode = apiCode;
    this.httpStatus = httpStatus;
    this.logId = logId;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Pull a real error out of the envelope. Returns null when the response is a
// success (`error.code === "ok"` or no error object at all).
function envelopeError(
  raw: unknown,
): { code: string; message: string; logId: string | undefined } | null {
  if (raw === null || typeof raw !== "object" || !("error" in raw)) return null;
  const err = (raw as { error: unknown }).error;
  if (err === null || typeof err !== "object" || !("code" in err)) return null;
  const code = (err as { code: unknown }).code;
  if (typeof code !== "string" || code === "ok") return null;
  const rawMessage = (err as { message?: unknown }).message;
  const rawLogId = (err as { log_id?: unknown }).log_id;
  return {
    code,
    message: typeof rawMessage === "string" ? rawMessage : "",
    logId: typeof rawLogId === "string" ? rawLogId : undefined,
  };
}

// Shared request path: fetch, parse JSON, surface envelope/HTTP errors, retry
// on transient failures (5xx or rate-limit). Returns the raw parsed JSON for
// the caller to validate against an endpoint-specific schema.
async function tiktokApiFetch(
  url: string,
  init: RequestInit,
): Promise<unknown> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      // Network-level failure (DNS, socket). Retry, then give up.
      if (attempt === MAX_ATTEMPTS) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new TikTokApiError("network_error", msg, 0);
      }
      await sleep(BACKOFF_MS[attempt - 1]!);
      continue;
    }

    const raw = (await res.json().catch(() => null)) as unknown;
    const envErr = envelopeError(raw);

    if (res.ok && envErr === null) return raw;

    const apiErr = new TikTokApiError(
      envErr?.code ?? `HTTP ${res.status}`,
      envErr?.message ?? res.statusText,
      res.status,
      envErr?.logId,
    );

    const retryable =
      res.status >= 500 || apiErr.apiCode === "rate_limit_exceeded";
    if (!retryable || attempt === MAX_ATTEMPTS) throw apiErr;
    await sleep(BACKOFF_MS[attempt - 1]!);
  }
  // Unreachable: the loop either returns or throws on the final attempt.
  throw new TikTokApiError("unreachable", "retry loop exited", 0);
}

// ─── User info ──────────────────────────────────────────────────────────────

// Account-level stats + profile. `fields` is a query param (comma-joined);
// the access_token rides in the Authorization header.
export async function getUserInfo(
  accessToken: string,
): Promise<TikTokUserInfo> {
  const url = new URL(`${API_HOST}/v2/user/info/`);
  url.searchParams.set("fields", USER_INFO_FIELDS.join(","));
  const raw = await tiktokApiFetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Cache-Control": "no-cache",
    },
  });
  const parsed = userInfoResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new TikTokApiError(
      "parse_error",
      `unexpected user info response shape: ${parsed.error.message}`,
      200,
    );
  }
  return parsed.data.data.user;
}

// ─── Video list ─────────────────────────────────────────────────────────────

// List the user's own videos, newest first, with per-video engagement counts.
// Walks the cursor until `has_more` is false or `maxVideos` is reached.
//
// TikTok's /v2/video/list/ takes `fields` as a query param but `max_count`
// and `cursor` in a JSON body. max_count caps at 20 per page (VIDEO_LIST_MAX_PAGE).
export async function listVideos(
  accessToken: string,
  opts?: { maxVideos?: number },
): Promise<TikTokVideo[]> {
  const maxVideos = opts?.maxVideos ?? 50;
  const out: TikTokVideo[] = [];
  let cursor: number | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const remaining = maxVideos - out.length;
    if (remaining <= 0) break;

    const url = new URL(`${API_HOST}/v2/video/list/`);
    url.searchParams.set("fields", VIDEO_LIST_FIELDS.join(","));

    const body: Record<string, number> = {
      max_count: Math.min(VIDEO_LIST_MAX_PAGE, remaining),
    };
    if (cursor !== undefined) body["cursor"] = cursor;

    const raw = await tiktokApiFetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify(body),
    });

    const parsed = videoListResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new TikTokApiError(
        "parse_error",
        `unexpected video list response shape: ${parsed.error.message}`,
        200,
      );
    }

    const videos = parsed.data.data.videos ?? [];
    out.push(...videos);

    const hasMore = parsed.data.data.has_more === true;
    const nextCursor = parsed.data.data.cursor;
    if (!hasMore || nextCursor === undefined || videos.length === 0) break;
    cursor = nextCursor;
  }

  return out.slice(0, maxVideos);
}
