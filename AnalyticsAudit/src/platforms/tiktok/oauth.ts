// TikTok OAuth 2.0 token helpers (protocol layer — URL building, code/refresh
// exchange, expiry check). The interactive browser flow lives in oauth-flow.ts.
//
// Flow type: CONFIDENTIAL WEB. TikTok Login Kit *web* apps authenticate with
// client_key + client_secret and DO NOT use PKCE — per TikTok's token docs,
// code_verifier is "Required for mobile and desktop app only". The web flow:
//   1. Direct the user to TikTok's auth URL (no code_challenge).
//   2. User authorizes; TikTok redirects to the registered redirect URI w/ a code.
//   3. Exchange the code + client_secret for access_token + refresh_token.
//   4. Refresh on the access_token's 24h expiry using the 365d refresh_token
//      (which itself rotates on every refresh).
//
// PKCE remains supported by buildAuthorizationUrl/exchangeCodeForTokens (pass a
// codeChallenge / codeVerifier) for desktop/mobile app types, but the web app
// type this project uses doesn't need it. Endpoints target the v2 OAuth surface.

import { randomBytes } from "node:crypto";
import { z } from "zod";

const AUTH_HOST = "https://www.tiktok.com";
const API_HOST = "https://open.tiktokapis.com";

// Default redirect for the confidential web flow — a public https page the
// operator controls (TikTok's Web platform rejects localhost). Override with
// TIKTOK_REDIRECT_URI in .env.local.
export const DEFAULT_REDIRECT_URI =
  "https://rmondev.github.io/analyticsaudit-policies/";

// Scopes the audit needs. user.info.basic is implicit when Login Kit is
// configured; listing it explicitly anyway is harmless and makes the
// intent visible at the call site.
export const TIKTOK_SCOPES = [
  "user.info.basic",
  "user.info.profile",
  "user.info.stats",
  "video.list",
] as const;

// ─── State / encoding helpers ───────────────────────────────────────────────

// CSRF guard — round-trips through the auth URL's `state` param. 32 bytes
// of entropy is plenty.
export function generateState(): string {
  return base64UrlEncode(randomBytes(32));
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ─── Authorization URL ─────────────────────────────────────────────────────

export function buildAuthorizationUrl(input: {
  clientKey: string;
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
  // PKCE S256 challenge. OMIT for the confidential web flow (the default);
  // include only for a desktop/mobile (public-client) app type.
  codeChallenge?: string;
}): string {
  const url = new URL(`${AUTH_HOST}/v2/auth/authorize/`);
  url.searchParams.set("client_key", input.clientKey);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", (input.scopes ?? TIKTOK_SCOPES).join(","));
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  if (input.codeChallenge !== undefined) {
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

// ─── Token exchange + refresh ──────────────────────────────────────────────

// TikTok's token endpoint returns this shape on success. expires_in and
// refresh_expires_in are seconds-from-now.
const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number().int().positive(),
  refresh_expires_in: z.number().int().positive(),
  open_id: z.string(),
  scope: z.string(),
  token_type: z.string().optional(),
});

const errorResponseSchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
  log_id: z.string().optional(),
});

export type TikTokTokens = {
  access_token: string;
  refresh_token: string;
  expires_at_iso: string;          // when access_token expires
  refresh_expires_at_iso: string;  // when refresh_token expires
  open_id: string;
  scope: string;                   // comma-separated granted scopes
};

export class TikTokAuthError extends Error {
  readonly tikTokError: string;
  readonly description: string | undefined;
  readonly logId: string | undefined;

  constructor(error: string, description?: string, logId?: string) {
    super(
      description !== undefined ? `${error}: ${description}` : error,
    );
    this.name = "TikTokAuthError";
    this.tikTokError = error;
    this.description = description;
    this.logId = logId;
  }
}

// Exchange the OAuth code (from the redirect callback) for an initial
// access_token + refresh_token pair.
export async function exchangeCodeForTokens(input: {
  clientKey: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  // Only for PKCE (desktop/mobile) app types. Omit for the confidential web flow.
  codeVerifier?: string;
}): Promise<TikTokTokens> {
  const body = new URLSearchParams({
    client_key: input.clientKey,
    client_secret: input.clientSecret,
    code: input.code,
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri,
  });
  if (input.codeVerifier !== undefined && input.codeVerifier !== "") {
    body.set("code_verifier", input.codeVerifier);
  }
  return postToTokenEndpoint(body);
}

// Trade the refresh_token for a fresh access_token + (rotated) refresh_token.
// TikTok rotates the refresh_token on every call; the old one becomes
// invalid immediately. Persist the new one or lose the connection.
export async function refreshTokens(input: {
  clientKey: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<TikTokTokens> {
  const body = new URLSearchParams({
    client_key: input.clientKey,
    client_secret: input.clientSecret,
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
  });
  return postToTokenEndpoint(body);
}

async function postToTokenEndpoint(
  body: URLSearchParams,
): Promise<TikTokTokens> {
  const bodyString = body.toString();
  if (process.env["TIKTOK_DEBUG"] === "1") {
    const redacted = bodyString.replace(
      /client_secret=[^&]+/,
      "client_secret=***",
    );
    console.log(`  [DEBUG] POST ${API_HOST}/v2/oauth/token/`);
    console.log(`  [DEBUG] body:`, redacted);
  }
  // String body with bare Content-Type. TikTok's sandbox rejected
  // `application/x-www-form-urlencoded;charset=UTF-8` as malformed, and
  // also rejected URLSearchParams-direct (which fetch wraps with the same
  // charset suffix). Bare type was the only variant that parsed cleanly
  // — though it still hit the PKCE validator error downstream.
  const res = await fetch(`${API_HOST}/v2/oauth/token/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body: bodyString,
  });
  const raw = (await res.json().catch(() => null)) as unknown;
  if (process.env["TIKTOK_DEBUG"] === "1") {
    console.log(`  [DEBUG] HTTP ${res.status}`);
    console.log(`  [DEBUG] response:`, JSON.stringify(raw).slice(0, 400));
  }
  if (!res.ok) {
    const parsedErr = errorResponseSchema.safeParse(raw);
    if (parsedErr.success) {
      throw new TikTokAuthError(
        parsedErr.data.error,
        parsedErr.data.error_description,
        parsedErr.data.log_id,
      );
    }
    throw new TikTokAuthError(
      `HTTP ${res.status}`,
      JSON.stringify(raw).slice(0, 240),
    );
  }
  const parsed = tokenResponseSchema.safeParse(raw);
  if (!parsed.success) {
    // The error shape is sometimes returned with HTTP 200, especially when
    // the request was syntactically valid but rejected for business reasons.
    const errAttempt = errorResponseSchema.safeParse(raw);
    if (errAttempt.success) {
      throw new TikTokAuthError(
        errAttempt.data.error,
        errAttempt.data.error_description,
        errAttempt.data.log_id,
      );
    }
    throw new TikTokAuthError(
      "parse_error",
      `unexpected token response shape: ${parsed.error.message}`,
    );
  }
  const now = Date.now();
  return {
    access_token: parsed.data.access_token,
    refresh_token: parsed.data.refresh_token,
    expires_at_iso: new Date(now + parsed.data.expires_in * 1000).toISOString(),
    refresh_expires_at_iso: new Date(
      now + parsed.data.refresh_expires_in * 1000,
    ).toISOString(),
    open_id: parsed.data.open_id,
    scope: parsed.data.scope,
  };
}

// Returns true if the access_token will expire within `bufferSeconds` (or
// has already expired). Callers refresh before any API call when this returns
// true to avoid mid-flight expiry.
export function tokensNeedRefresh(
  tokens: { expires_at_iso: string },
  bufferSeconds = 300,
): boolean {
  const expiresAt = new Date(tokens.expires_at_iso).getTime();
  return Date.now() + bufferSeconds * 1000 >= expiresAt;
}
