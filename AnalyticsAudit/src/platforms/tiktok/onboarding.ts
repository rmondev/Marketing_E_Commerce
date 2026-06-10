// TikTok onboarding via OAuth 2.0 + PKCE.
//
// Flow:
//   1. Verify TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET are in .env.local.
//   2. Generate PKCE code_verifier + code_challenge and a CSRF state token.
//   3. Spin up a one-shot HTTP server on the redirect-URI port (default :3001).
//   4. Open the operator's default browser to TikTok's authorize URL.
//   5. User (or operator-as-user) logs in and approves.
//   6. TikTok redirects to our localhost callback with `code` + `state`.
//   7. Validate state matches (CSRF guard).
//   8. Exchange code + code_verifier for access_token + refresh_token.
//   9. Fetch user info with the fresh access_token for display_name/username.
//  10. Persist tokens + open_id (as external_account_id) + display_handle.
//
// Times out after 5 minutes if no callback arrives — the operator can retry.

import { exec } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { z } from "zod";
import { env } from "../../core/lib/env.js";
import type {
  PlatformOnboardingInput,
  PlatformOnboardingResult,
} from "../_registry.js";
import {
  buildAuthorizationUrl,
  DEFAULT_REDIRECT_URI,
  deriveCodeChallenge,
  exchangeCodeForTokens,
  generateCodeVerifier,
  generateState,
  TikTokAuthError,
  type PkceMethod,
  type TikTokTokens,
} from "./oauth.js";

// Toggle for diagnosing TikTok sandbox PKCE issues. "plain" sends the
// verifier as the challenge (no SHA-256), which TikTok validates by
// equality. Less secure than S256 but only meaningful for an MITM on
// the redirect URI — since our redirect is localhost only, that's the
// operator's own machine. Safe to use during debugging or as a permanent
// fallback if TikTok's sandbox S256 validation stays broken.
const PKCE_METHOD: PkceMethod =
  process.env["TIKTOK_PKCE_METHOD"] === "plain" ? "plain" : "S256";
const DEBUG = process.env["TIKTOK_DEBUG"] === "1";

const CALLBACK_PATH = "/oauth/tiktok/callback";
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

const userInfoSchema = z.object({
  data: z.object({
    user: z.object({
      open_id: z.string(),
      display_name: z.string().optional(),
      username: z.string().optional(),
    }),
  }),
});

export async function onboardTikTok(
  input: PlatformOnboardingInput,
): Promise<PlatformOnboardingResult> {
  // ─── Workaround path: pre-existing tokens supplied via flags ─────────────
  // The OAuth + PKCE flow is hitting a sandbox-side validator bug — we send a
  // mathematically-correct PKCE pair (RFC 7636 verified) but TikTok rejects
  // it as "invalid". Until the bug is fixed or our support ticket is
  // answered, operators can paste tokens minted elsewhere (TikTok's
  // developer portal "Try API" tool, Postman, etc.) and skip OAuth.
  const flagAccessToken = input.flagValues["tiktokAccessToken"];
  const flagRefreshToken = input.flagValues["tiktokRefreshToken"];
  if (flagAccessToken !== undefined && flagAccessToken !== "") {
    return runManualTokenWorkaround(flagAccessToken, flagRefreshToken);
  }

  if (
    env.TIKTOK_CLIENT_KEY === undefined ||
    env.TIKTOK_CLIENT_KEY === "" ||
    env.TIKTOK_CLIENT_SECRET === undefined ||
    env.TIKTOK_CLIENT_SECRET === ""
  ) {
    throw new Error(
      "TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET must be set in .env.local before onboarding a TikTok account. See docs/TIKTOK_SETUP.md.",
    );
  }
  const clientKey = env.TIKTOK_CLIENT_KEY;
  const clientSecret = env.TIKTOK_CLIENT_SECRET;
  const redirectUri = env.TIKTOK_REDIRECT_URI ?? DEFAULT_REDIRECT_URI;

  const codeVerifier = generateCodeVerifier();
  const codeChallenge =
    PKCE_METHOD === "plain" ? codeVerifier : deriveCodeChallenge(codeVerifier);
  const state = generateState();
  const authUrl = buildAuthorizationUrl({
    clientKey,
    redirectUri,
    codeChallenge,
    state,
    method: PKCE_METHOD,
  });

  if (DEBUG) {
    console.log("\n  [DEBUG] PKCE method:    ", PKCE_METHOD);
    console.log("  [DEBUG] code_verifier:  ", codeVerifier);
    console.log("  [DEBUG] code_challenge: ", codeChallenge);
    console.log("  [DEBUG] verifier length:", codeVerifier.length);
    console.log("  [DEBUG] challenge length:", codeChallenge.length);
  }

  const parsedRedirect = new URL(redirectUri);
  const port = Number(parsedRedirect.port || "80");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port in TIKTOK_REDIRECT_URI: ${redirectUri}`);
  }

  console.log("\n  Starting TikTok OAuth flow...");
  console.log(`  Local callback server: ${redirectUri}`);
  console.log("");
  console.log(
    "  Opening your browser to the TikTok authorization page. If the browser",
  );
  console.log("  doesn't open automatically, copy this URL into one manually:");
  console.log(`\n  ${authUrl}\n`);

  const callback = await runCallbackServer(port, state, authUrl);
  const { code } = callback;

  console.log("\n  Exchanging code for tokens...");
  if (DEBUG) {
    console.log("  [DEBUG] sending code_verifier:", codeVerifier);
    console.log("  [DEBUG] received code:        ", code);
  }
  let tokens: TikTokTokens;
  try {
    tokens = await exchangeCodeForTokens({
      clientKey,
      clientSecret,
      code,
      codeVerifier,
      redirectUri,
    });
  } catch (err) {
    if (err instanceof TikTokAuthError) {
      throw new Error(
        `TikTok token exchange failed: ${err.message}` +
          (err.logId !== undefined ? ` (log_id=${err.logId})` : ""),
      );
    }
    throw err;
  }

  console.log("  Token exchange OK.");
  console.log(`    open_id:    ${tokens.open_id}`);
  console.log(`    scope:      ${tokens.scope}`);
  console.log(`    expires_at: ${tokens.expires_at_iso} (access ~24h)`);
  console.log(`    refresh_at: ${tokens.refresh_expires_at_iso} (refresh ~365d)`);

  console.log("\n  Fetching user info for display name...");
  const userInfo = await fetchUserInfo(tokens.access_token);
  const displayName = userInfo.display_name ?? userInfo.username ?? tokens.open_id;
  const username = userInfo.username ?? "";
  console.log(
    `    display_name=${displayName}${username !== "" ? `  @${username}` : ""}`,
  );

  // external_account_id is the stable, opaque TikTok ID — open_id is the
  // right anchor since usernames can change but open_id is permanent for
  // an (app, user) pair.
  const result: PlatformOnboardingResult = {
    external_account_id: tokens.open_id,
    credentials: JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at_iso: tokens.expires_at_iso,
      refresh_expires_at_iso: tokens.refresh_expires_at_iso,
      open_id: tokens.open_id,
      scope: tokens.scope,
      display_name: displayName,
      username,
    }),
  };
  if (username !== "") result.display_handle = `@${username}`;
  return result;
}

// ─── Manual-token workaround ──────────────────────────────────────────────

async function runManualTokenWorkaround(
  accessToken: string,
  refreshToken: string | undefined,
): Promise<PlatformOnboardingResult> {
  console.log("\n  Manual token mode — skipping OAuth (workaround for sandbox PKCE bug).");
  if (refreshToken === undefined || refreshToken === "") {
    console.log(
      "  ⚠ No --tiktok-refresh-token provided. The access token will expire in ~24h with no way to renew automatically.",
    );
  }

  // Verify the token works and capture the canonical open_id + display name.
  console.log("\n  Fetching user info to validate token...");
  const userInfo = await fetchUserInfo(accessToken);
  const displayName = userInfo.display_name ?? userInfo.username ?? userInfo.open_id;
  const username = userInfo.username ?? "";
  console.log(
    `    open_id=${userInfo.open_id}  display_name=${displayName}${
      username !== "" ? `  @${username}` : ""
    }`,
  );

  // Token lifetimes are best-effort assumptions when pasted manually —
  // standard TikTok access tokens last 24h, refresh tokens 365d, with the
  // exact issuance time unknown. Use safe estimates; the audit's
  // ensure-fresh-token pass will refresh proactively as expiry approaches.
  const now = Date.now();
  const tokens: TikTokTokens = {
    access_token: accessToken,
    refresh_token: refreshToken ?? "",
    expires_at_iso: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
    refresh_expires_at_iso: new Date(
      now + 365 * 24 * 60 * 60 * 1000,
    ).toISOString(),
    open_id: userInfo.open_id,
    scope: "(manual)",
  };

  console.log("\n  Manual token persisted.");
  console.log(`    open_id:    ${tokens.open_id}`);
  console.log(`    expires_at: ${tokens.expires_at_iso} (assumed; may be sooner)`);

  const result: PlatformOnboardingResult = {
    external_account_id: tokens.open_id,
    credentials: JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at_iso: tokens.expires_at_iso,
      refresh_expires_at_iso: tokens.refresh_expires_at_iso,
      open_id: tokens.open_id,
      scope: tokens.scope,
      display_name: displayName,
      username,
      manual_token: true,
    }),
  };
  if (username !== "") result.display_handle = `@${username}`;
  return result;
}

// ─── Local callback server ────────────────────────────────────────────────

type CallbackResult = { code: string };

function runCallbackServer(
  port: number,
  expectedState: string,
  authUrl: string,
): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const reqUrl = new URL(req.url ?? "", `http://localhost:${port}`);
      if (reqUrl.pathname !== CALLBACK_PATH) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      const code = reqUrl.searchParams.get("code");
      const state = reqUrl.searchParams.get("state");
      const error = reqUrl.searchParams.get("error");
      const errorDescription = reqUrl.searchParams.get("error_description");

      if (error !== null) {
        respondHtml(
          res,
          400,
          `<h1>TikTok authorization failed</h1><p>${escapeHtml(error)}${
            errorDescription !== null
              ? `: ${escapeHtml(errorDescription)}`
              : ""
          }</p><p>You can close this tab.</p>`,
        );
        server.close();
        reject(
          new Error(
            `TikTok authorization denied: ${error}${
              errorDescription !== null ? ` — ${errorDescription}` : ""
            }`,
          ),
        );
        return;
      }
      if (code === null || state === null) {
        respondHtml(
          res,
          400,
          "<h1>Missing parameters</h1><p>TikTok did not return a code. Please retry the onboarding command.</p>",
        );
        server.close();
        reject(new Error("Callback missing required code or state parameter"));
        return;
      }
      if (state !== expectedState) {
        respondHtml(
          res,
          400,
          "<h1>State mismatch</h1><p>This may indicate a CSRF attempt. Please retry the onboarding command.</p>",
        );
        server.close();
        reject(
          new Error(
            "CSRF state mismatch: returned state does not match the one issued. Aborting.",
          ),
        );
        return;
      }
      respondHtml(
        res,
        200,
        "<h1>Authorization complete</h1><p>You can close this tab and return to the terminal.</p>",
      );
      server.close();
      resolve({ code });
    });

    server.on("error", (err) => {
      reject(
        new Error(
          `Failed to start local callback server on port ${port}: ${err.message}`,
        ),
      );
    });

    const timeoutHandle = setTimeout(() => {
      server.close();
      reject(
        new Error(
          `TikTok OAuth timed out after ${Math.floor(AUTH_TIMEOUT_MS / 1000)}s — no callback received.`,
        ),
      );
    }, AUTH_TIMEOUT_MS);
    // Don't keep the process alive solely on the timeout — once the server
    // closes the timeout is cleared via the resolve/reject path.
    server.on("close", () => clearTimeout(timeoutHandle));

    server.listen(port, "127.0.0.1", () => {
      // Server is ready; open the browser. Failures here are non-fatal —
      // the URL is also printed to stdout so the operator can paste it
      // manually if their browser is misconfigured.
      openBrowser(authUrl).catch((err) => {
        console.warn(`  (browser open failed: ${err.message})`);
      });
    });
  });
}

function openBrowser(url: string): Promise<void> {
  // Best-effort. Failures are non-fatal — the URL is also printed to stdout
  // so the operator can paste it manually.
  const platform = process.platform;
  let cmd: string;
  if (platform === "win32") {
    // Windows `start` needs an empty title arg because the first quoted
    // string is interpreted as the window title.
    cmd = `start "" "${url}"`;
  } else if (platform === "darwin") {
    cmd = `open "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }
  return new Promise((resolve, reject) => {
    exec(cmd, (err) => (err ? reject(err) : resolve()));
  });
}

function respondHtml(
  res: ServerResponse,
  status: number,
  body: string,
): void {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>AnalyticsAudit OAuth</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:4rem auto;padding:0 1.5rem;color:#111;line-height:1.5}h1{font-size:1.4rem}</style>
</head><body>${body}</body></html>`;
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── User info fetch ──────────────────────────────────────────────────────

// Pre-G2 minimal inline call — once api.ts exists, swap to the wrapper.
async function fetchUserInfo(
  accessToken: string,
): Promise<{ open_id: string; display_name?: string; username?: string }> {
  const url = new URL("https://open.tiktokapis.com/v2/user/info/");
  url.searchParams.set("fields", "open_id,display_name,username");
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Cache-Control": "no-cache",
    },
  });
  const raw = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    throw new Error(
      `TikTok user info call failed: HTTP ${res.status} ${JSON.stringify(raw).slice(0, 200)}`,
    );
  }
  const parsed = userInfoSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `TikTok user info response shape unexpected: ${parsed.error.message}`,
    );
  }
  const out: { open_id: string; display_name?: string; username?: string } = {
    open_id: parsed.data.data.user.open_id,
  };
  if (parsed.data.data.user.display_name !== undefined) {
    out.display_name = parsed.data.data.user.display_name;
  }
  if (parsed.data.data.user.username !== undefined) {
    out.username = parsed.data.data.user.username;
  }
  return out;
}
