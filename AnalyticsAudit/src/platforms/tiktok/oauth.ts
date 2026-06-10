// TikTok OAuth 2.0 + PKCE helpers.
//
// TikTok's Login Kit uses Authorization Code + PKCE (RFC 7636). The flow:
//   1. Generate a random code_verifier and its SHA-256 code_challenge.
//   2. Direct the user to TikTok's auth URL with the code_challenge.
//   3. User authorizes; TikTok redirects to our localhost callback with a code.
//   4. Exchange the code + code_verifier for access_token + refresh_token.
//   5. Store tokens; refresh on the access_token's 24-hour expiry using the
//      365-day refresh_token (which itself rotates on every refresh).
//
// All endpoints target the v2 OAuth surface (open.tiktokapis.com), distinct
// from the v1 endpoints that were deprecated in 2024.

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

const AUTH_HOST = "https://www.tiktok.com";
const API_HOST = "https://open.tiktokapis.com";

export const DEFAULT_REDIRECT_URI = "http://localhost:3001/oauth/tiktok/callback";

// Scopes the audit needs. user.info.basic is implicit when Login Kit is
// configured; listing it explicitly anyway is harmless and makes the
// intent visible at the call site.
export const TIKTOK_SCOPES = [
  "user.info.basic",
  "user.info.profile",
  "user.info.stats",
  "video.list",
] as const;

// ─── PKCE helpers ──────────────────────────────────────────────────────────

// 96 bytes → 128-char base64url string (within RFC 7636's 43-128 range).
export function generateCodeVerifier(): string {
  return base64UrlEncode(randomBytes(96));
}

export function deriveCodeChallenge(verifier: string): string {
  return base64UrlEncode(createHash("sha256").update(verifier).digest());
}

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
  codeChallenge: string;
  state: string;
  scopes?: readonly string[];
}): string {
  const url = new URL(`${AUTH_HOST}/v2/auth/authorize/`);
  url.searchParams.set("client_key", input.clientKey);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", (input.scopes ?? TIKTOK_SCOPES).join(","));
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
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
  codeVerifier: string;
  redirectUri: string;
}): Promise<TikTokTokens> {
  const body = new URLSearchParams({
    client_key: input.clientKey,
    client_secret: input.clientSecret,
    code: input.code,
    grant_type: "authorization_code",
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });
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
  const res = await fetch(`${API_HOST}/v2/oauth/token/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body: body.toString(),
  });
  const raw = (await res.json().catch(() => null)) as unknown;
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
