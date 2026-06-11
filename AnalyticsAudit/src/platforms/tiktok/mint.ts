// tiktok:mint — token-only utility. Runs the browser OAuth (confidential web
// flow) and PRINTS an access/refresh pair plus the client:platform:add command
// to persist it. Handy for testing, or for minting a pair to paste elsewhere.
//
// The normal onboarding path is `npm run client:platform:add -- --platform
// tiktok`, which runs the same flow and persists in one step. This utility
// exists for when you want the raw tokens without (yet) attaching them to a
// client. See docs/TIKTOK_SETUP.md for the one-time portal setup.

import { Command } from "commander";
import { env } from "../../core/lib/env.js";
import { getUserInfo, TikTokApiError } from "./api.js";
import { DEFAULT_REDIRECT_URI } from "./oauth.js";
import { authorizeWeb } from "./oauth-flow.js";

const program = new Command();
program
  .name("tiktok:mint")
  .description(
    "Mint a TikTok access/refresh token pair via the browser (confidential web flow) and print it.",
  )
  .option(
    "--redirect <uri>",
    "Override the redirect URI (default: TIKTOK_REDIRECT_URI from .env.local). Must be registered under the app's Web platform.",
  )
  .option("--debug", "Print the token request/response (client_secret redacted).")
  .option("--no-browser", "Don't auto-open the browser; just print the auth URL.");
program.parse();

const opts = program.opts() as {
  redirect?: string;
  debug?: boolean;
  browser: boolean;
};
if (opts.debug) process.env["TIKTOK_DEBUG"] = "1";

if (
  env.TIKTOK_CLIENT_KEY === undefined ||
  env.TIKTOK_CLIENT_KEY === "" ||
  env.TIKTOK_CLIENT_SECRET === undefined ||
  env.TIKTOK_CLIENT_SECRET === ""
) {
  console.error(
    "TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET must be set in .env.local. See docs/TIKTOK_SETUP.md.",
  );
  process.exit(1);
}
const redirectUri = opts.redirect ?? env.TIKTOK_REDIRECT_URI ?? DEFAULT_REDIRECT_URI;

console.log("\n  TikTok token mint (confidential web flow)");
console.log(`  redirect URI: ${redirectUri}`);

let tokens;
try {
  tokens = await authorizeWeb({
    clientKey: env.TIKTOK_CLIENT_KEY,
    clientSecret: env.TIKTOK_CLIENT_SECRET,
    redirectUri,
    openBrowser: opts.browser,
    log: (line) => console.log(line),
  });
} catch (err) {
  console.error(`\n  Mint failed: ${err instanceof Error ? err.message : String(err)}`);
  console.error("    • Expired/invalid code → re-run and Authorize promptly (codes last minutes).");
  console.error(
    "    • Confirm the app has a Web platform with this exact redirect URI registered (docs/TIKTOK_SETUP.md).",
  );
  process.exit(1);
}

console.log("\n  ✓ Minted token pair:");
console.log(`    open_id:    ${tokens.open_id}`);
console.log(`    scope:      ${tokens.scope}`);
console.log(`    expires_at: ${tokens.expires_at_iso} (access ~24h)`);
console.log(`    refresh_at: ${tokens.refresh_expires_at_iso} (refresh ~365d)`);

console.log("\n  Validating against /v2/user/info/ ...");
try {
  const user = await getUserInfo(tokens.access_token);
  console.log(
    `    OK — @${user.username ?? "?"}  followers=${user.follower_count ?? "(withheld)"}  videos=${user.video_count ?? "(withheld)"}`,
  );
} catch (err) {
  const msg = err instanceof TikTokApiError ? err.message : String(err);
  console.log(`    (validation call failed: ${msg}) — the token may still be usable.`);
}

console.log("\n  ── Tokens (copy these) ──");
console.log(`  access_token:  ${tokens.access_token}`);
console.log(`  refresh_token: ${tokens.refresh_token}`);
console.log("\n  Persist them on a client (replace <client> with the short_name):\n");
console.log(`  npm run client:platform:add -- --client <client> --platform tiktok \``);
console.log(`    --tiktok-access-token "${tokens.access_token}" \``);
console.log(`    --tiktok-refresh-token "${tokens.refresh_token}"`);
console.log("");
