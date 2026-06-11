// TikTok onboarding. Two paths into a persisted platform_account:
//
//   1. OAuth (default): open the browser, authorize the TARGET account, and
//      exchange the code via the confidential web flow (client_secret, no
//      PKCE). The interactive flow lives in oauth-flow.ts.
//   2. Manual-token: --tiktok-access-token / --tiktok-refresh-token let an
//      operator paste a pair minted elsewhere (e.g. `npm run tiktok:mint`),
//      skipping the browser step.
//
// One-time setup (docs/TIKTOK_SETUP.md): register a Web platform with a public
// https redirect URI — TikTok's Web platform rejects localhost, so the redirect
// is a page you control and you paste the returned code from the address bar.

import { env } from "../../core/lib/env.js";
import type {
  PlatformOnboardingInput,
  PlatformOnboardingResult,
} from "../_registry.js";
import { getUserInfo } from "./api.js";
import { DEFAULT_REDIRECT_URI, type TikTokTokens } from "./oauth.js";
import { authorizeWeb } from "./oauth-flow.js";

export async function onboardTikTok(
  input: PlatformOnboardingInput,
): Promise<PlatformOnboardingResult> {
  // ─── Manual-token path ──────────────────────────────────────────────────
  const flagAccessToken = input.flagValues["tiktokAccessToken"];
  const flagRefreshToken = input.flagValues["tiktokRefreshToken"];
  if (flagAccessToken !== undefined && flagAccessToken !== "") {
    return runManualTokenWorkaround(flagAccessToken, flagRefreshToken);
  }

  // ─── OAuth web flow ─────────────────────────────────────────────────────
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
  const redirectUri = env.TIKTOK_REDIRECT_URI ?? DEFAULT_REDIRECT_URI;

  console.log("\n  Starting TikTok OAuth (confidential web flow)...");
  console.log(`  redirect URI: ${redirectUri}`);

  let tokens: TikTokTokens;
  try {
    tokens = await authorizeWeb({
      clientKey: env.TIKTOK_CLIENT_KEY,
      clientSecret: env.TIKTOK_CLIENT_SECRET,
      redirectUri,
      openBrowser: true,
      log: (line) => console.log(line),
    });
  } catch (err) {
    throw new Error(
      `TikTok onboarding failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  console.log("  Token exchange OK.");
  console.log(`    open_id:    ${tokens.open_id}`);
  console.log(`    scope:      ${tokens.scope}`);
  console.log(`    expires_at: ${tokens.expires_at_iso} (access ~24h)`);
  console.log(`    refresh_at: ${tokens.refresh_expires_at_iso} (refresh ~365d)`);

  console.log("\n  Fetching user info for display name...");
  const user = await getUserInfo(tokens.access_token);
  const displayName = user.display_name ?? user.username ?? tokens.open_id;
  const username = user.username ?? "";
  console.log(
    `    display_name=${displayName}${username !== "" ? `  @${username}` : ""}`,
  );

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
  console.log("\n  Manual token mode — skipping the browser OAuth step.");
  if (refreshToken === undefined || refreshToken === "") {
    console.log(
      "  ⚠ No --tiktok-refresh-token provided. The access token will expire in ~24h with no way to renew automatically.",
    );
  }

  // Validate the token and capture the canonical open_id + display name.
  console.log("\n  Validating token against /v2/user/info/...");
  const user = await getUserInfo(accessToken);
  const displayName = user.display_name ?? user.username ?? user.open_id;
  const username = user.username ?? "";
  console.log(
    `    open_id=${user.open_id}  display_name=${displayName}${
      username !== "" ? `  @${username}` : ""
    }`,
  );

  // Token lifetimes are best-effort assumptions when pasted manually (standard
  // TikTok access tokens last 24h, refresh tokens 365d). The audit's
  // ensure-fresh-token pass refreshes proactively as expiry approaches.
  const now = Date.now();
  const result: PlatformOnboardingResult = {
    external_account_id: user.open_id,
    credentials: JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken ?? "",
      expires_at_iso: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      refresh_expires_at_iso: new Date(
        now + 365 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      open_id: user.open_id,
      scope: "(manual)",
      display_name: displayName,
      username,
      manual_token: true,
    }),
  };
  if (username !== "") result.display_handle = `@${username}`;
  return result;
}
