// TikTok token-minting helper (workaround for the sandbox OAuth code-exchange
// bug — see docs/TIKTOK_SETUP.md). It drives the normal authorization flow to
// get a single-use `code`, then attempts the code→token exchange across
// several request-shape variants and prints whichever pair succeeds, ready to
// paste into `client:platform:add`.
//
// Why this exists: our standard onboarding exchange hits TikTok's sandbox
// validator with `invalid_request: Code verifier or code challenge is
// invalid`. This helper isolates the variables — PKCE method (default `plain`,
// validated by string equality rather than the possibly-broken S256 hash
// compare) and the exact body/Content-Type encoding — so a working
// combination can be found without guessing blind.
//
// Run:
//   npm run tiktok:mint                 # PKCE plain (try this first)
//   npm run tiktok:mint -- --method s256
//
// On success it prints the access_token + refresh_token and the exact
// client:platform:add command to persist them.

import { Command } from "commander";
import { exec } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { env } from "../../core/lib/env.js";
import { getUserInfo, TikTokApiError } from "./api.js";
import {
  DEFAULT_REDIRECT_URI,
  deriveCodeChallenge,
  generateCodeVerifier,
  generateState,
  TIKTOK_SCOPES,
} from "./oauth.js";

const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const CALLBACK_PATH = "/oauth/tiktok/callback";
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

const program = new Command();
program
  .name("tiktok:mint")
  .description(
    "Mint a TikTok access/refresh token pair via the browser (OAuth code → token exchange).",
  )
  .option(
    "--no-pkce",
    "Disable PKCE (confidential web flow). NOTE: TikTok's authorize endpoint for THIS app requires code_challenge, so --no-pkce fails at authorize with a 'code_challenge' error. Kept only for experimentation; PKCE (S256) is the default and is required here.",
  )
  .option("--debug", "Print the exact request body (secret redacted) and the full raw response.")
  .option(
    "--no-exchange",
    "Stop after capturing the code: print the code (+ code_verifier when --pkce) and the exact token request so you can exchange it elsewhere (Thunder Client, Postman, curl).",
  )
  .option("--no-browser", "Don't auto-open the browser; just print the URL.");
program.parse();

const opts = program.opts() as {
  pkce?: boolean;
  debug: boolean;
  exchange: boolean;
  browser: boolean;
};
// PKCE (S256) is the default: TikTok's authorize endpoint requires
// code_challenge for this app. --no-pkce sets opts.pkce=false (web flow,
// disproven — authorize rejects it).
const usePkce = opts.pkce !== false;

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
const clientKey = env.TIKTOK_CLIENT_KEY;
const clientSecret = env.TIKTOK_CLIENT_SECRET;
const redirectUri = env.TIKTOK_REDIRECT_URI ?? DEFAULT_REDIRECT_URI;

// Confidential web flow (default): authenticate with client_secret, no PKCE.
// --pkce switches to the S256 code_verifier/challenge flow (mobile/desktop).
const codeVerifier = usePkce ? generateCodeVerifier() : "";
const codeChallenge = usePkce ? deriveCodeChallenge(codeVerifier) : "";
const state = generateState();

const authUrlObj = new URL(AUTH_URL);
authUrlObj.searchParams.set("client_key", clientKey);
authUrlObj.searchParams.set("response_type", "code");
authUrlObj.searchParams.set("scope", TIKTOK_SCOPES.join(","));
authUrlObj.searchParams.set("redirect_uri", redirectUri);
authUrlObj.searchParams.set("state", state);
if (usePkce) {
  authUrlObj.searchParams.set("code_challenge", codeChallenge);
  authUrlObj.searchParams.set("code_challenge_method", "S256");
}
const authUrl = authUrlObj.toString();

const parsedRedirect = new URL(redirectUri);
const port = Number(parsedRedirect.port || "80");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid port in redirect URI: ${redirectUri}`);
  process.exit(1);
}

console.log("\n  TikTok token mint");
console.log(
  `  flow:          ${usePkce ? "PKCE S256 (mobile/desktop-style)" : "confidential web — client_secret, no PKCE"}`,
);
console.log(`  redirect URI:  ${redirectUri}`);
if (usePkce) {
  console.log(`  code_verifier: ${codeVerifier}`);
  console.log(`  code_challenge: ${codeChallenge}`);
}
console.log("");
console.log("  Log in as the TARGET account (the one you want to audit) and");
console.log("  click Authorize. If the browser doesn't open, paste this URL:");
console.log(`\n  ${authUrl}\n`);

const code = await runCallbackServer(port, state, opts.browser ? authUrl : null);
console.log(`\n  Got authorization code (len=${code.length}).`);

// --no-exchange: hand off to an external client (Thunder Client / Postman /
// curl) for the token exchange. Codes are single-use and expire within
// minutes, so run the exchange immediately. POST these as a bare
// application/x-www-form-urlencoded body to the token URL below.
if (!opts.exchange) {
  console.log("\n  ── Exchange these elsewhere (code expires in minutes — go now) ──");
  console.log(`  POST ${TOKEN_URL}`);
  console.log(`  Header  Content-Type: application/x-www-form-urlencoded`);
  console.log("  Body (x-www-form-urlencoded):");
  console.log(`    client_key=${clientKey}`);
  console.log(`    client_secret=${clientSecret}`);
  console.log(`    code=${code}`);
  console.log(`    grant_type=authorization_code`);
  console.log(`    redirect_uri=${redirectUri}`);
  if (usePkce) console.log(`    code_verifier=${codeVerifier}`);
  console.log(
    "\n  In Thunder Client: Method POST, the URL above, Headers tab → add the\n" +
      "  Content-Type, Body tab → 'Form-encode' (x-www-form-urlencoded) → add each\n" +
      "  key=value pair above. Send. On success copy access_token + refresh_token into:\n" +
      "    npm run client:platform:add -- --client <client> --platform tiktok \\\n" +
      "      --tiktok-access-token \"act.xxx\" --tiktok-refresh-token \"rft.xxx\"",
  );
  process.exit(0);
}

console.log("  Exchanging...\n");

// ─── Token exchange ─────────────────────────────────────────────────────────
// Request shape (probed 2026-06-11): client_secret MUST be in a bare
// "application/x-www-form-urlencoded" body (no charset suffix; not JSON; not an
// HTTP Basic header — all of those return "request parameters are malformed").
//
// PKCE: per TikTok's token-management docs, code_verifier is "Required for
// mobile and desktop app only". This is a confidential WEB client, so the
// default flow omits PKCE entirely (no code_challenge at authorize, no
// code_verifier here) and authenticates with client_secret. Sending a
// code_verifier on the web flow is what produced "Code verifier or code
// challenge is invalid". --pkce re-adds it for desktop/mobile-style testing.
type TokenSuccess = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
  open_id: string;
  scope: string;
};

const exchangeParams: Record<string, string> = {
  client_key: clientKey,
  client_secret: clientSecret,
  code,
  grant_type: "authorization_code",
  redirect_uri: redirectUri,
};
if (usePkce) exchangeParams["code_verifier"] = codeVerifier;
const body = new URLSearchParams(exchangeParams).toString();

if (opts.debug) {
  console.log(`  [debug] POST ${TOKEN_URL}`);
  console.log(`  [debug] body:    ${body.replace(/client_secret=[^&]+/, "client_secret=***")}\n`);
}

const res = await fetch(TOKEN_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "Cache-Control": "no-cache",
  },
  body,
});
const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
if (opts.debug) {
  console.log(`  [debug] HTTP ${res.status}`);
  console.log(`  [debug] raw response: ${JSON.stringify(raw)}\n`);
}

const minted = readTokenSuccess(raw);
if (!minted) {
  const errCode =
    raw && typeof raw["error"] === "string" ? (raw["error"] as string) : `HTTP ${res.status}`;
  const errDesc =
    raw && typeof raw["error_description"] === "string" ? (raw["error_description"] as string) : "";
  const logId = raw && typeof raw["log_id"] === "string" ? (raw["log_id"] as string) : "";
  console.error(
    `  FAIL [${errCode}]${errDesc ? ` ${errDesc}` : ""}${logId ? ` (log_id=${logId})` : ""}`,
  );
  console.error("\n  Exchange failed. Likely causes:");
  console.error("    • Expired/invalid code → re-run and click Authorize promptly (codes last minutes).");
  if (usePkce) {
    console.error(
      "    • You ran with --pkce. This is a confidential WEB app — drop --pkce so it\n" +
        "      authenticates with client_secret and no code_verifier (TikTok's docs: code_verifier\n" +
        "      is 'Required for mobile and desktop app only').",
    );
  } else {
    console.error(
      "    • 'Code verifier or code challenge is invalid' on the web flow is unexpected —\n" +
        "      confirm the app is registered as a Web app and this redirect URI is registered.",
    );
  }
  process.exit(1);
}

const now = Date.now();
const expiresAtIso = new Date(now + minted.expires_in * 1000).toISOString();
const refreshExpiresAtIso = new Date(now + minted.refresh_expires_in * 1000).toISOString();

console.log("\n  ✓ Minted token pair:");
console.log(`    open_id:     ${minted.open_id}`);
console.log(`    scope:       ${minted.scope}`);
console.log(`    expires_at:  ${expiresAtIso} (access ~${Math.round(minted.expires_in / 3600)}h)`);
console.log(
  `    refresh_at:  ${refreshExpiresAtIso} (refresh ~${Math.round(minted.refresh_expires_in / 86400)}d)`,
);

// Validate the token actually works against the Display API.
console.log("\n  Validating against /v2/user/info/ ...");
try {
  const user = await getUserInfo(minted.access_token);
  console.log(
    `    OK — open_id=${user.open_id}  @${user.username ?? "?"}  followers=${user.follower_count ?? "(withheld)"}  videos=${user.video_count ?? "(withheld)"}`,
  );
} catch (err) {
  const msg = err instanceof TikTokApiError ? err.message : String(err);
  console.log(`    (validation call failed: ${msg}) — the token may still be usable; continuing.`);
}

console.log("\n  ── Tokens (copy these) ──");
console.log(`  access_token:  ${minted.access_token}`);
console.log(`  refresh_token: ${minted.refresh_token}`);
console.log("\n  Persist them on a client (replace <client> with the short_name):\n");
console.log(
  `  npm run client:platform:add -- --client <client> --platform tiktok \``,
);
console.log(`    --tiktok-access-token "${minted.access_token}" \``);
console.log(`    --tiktok-refresh-token "${minted.refresh_token}"`);
console.log("");

function readTokenSuccess(raw: Record<string, unknown> | null): TokenSuccess | null {
  if (raw === null) return null;
  if (
    typeof raw["access_token"] === "string" &&
    typeof raw["refresh_token"] === "string" &&
    typeof raw["expires_in"] === "number" &&
    typeof raw["refresh_expires_in"] === "number" &&
    typeof raw["open_id"] === "string" &&
    typeof raw["scope"] === "string"
  ) {
    return {
      access_token: raw["access_token"],
      refresh_token: raw["refresh_token"],
      expires_in: raw["expires_in"],
      refresh_expires_in: raw["refresh_expires_in"],
      open_id: raw["open_id"],
      scope: raw["scope"],
    };
  }
  return null;
}

// ─── Local callback server ──────────────────────────────────────────────────
// Resolves with the `code` once TikTok redirects back. Mirrors the server in
// onboarding.ts but returns just the code (this helper does its own exchange).
function runCallbackServer(
  serverPort: number,
  expectedState: string,
  urlToOpen: string | null,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const reqUrl = new URL(req.url ?? "", `http://localhost:${serverPort}`);
      if (reqUrl.pathname !== CALLBACK_PATH) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }
      const cbCode = reqUrl.searchParams.get("code");
      const cbState = reqUrl.searchParams.get("state");
      const error = reqUrl.searchParams.get("error");
      const errorDescription = reqUrl.searchParams.get("error_description");

      const done = (status: number, body: string): void => {
        res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;max-width:36rem;margin:4rem auto"><h1>AnalyticsAudit — TikTok mint</h1>${body}</body>`,
        );
      };

      if (error !== null) {
        done(400, `<p>Authorization failed: ${error}${errorDescription ? ` — ${errorDescription}` : ""}</p>`);
        server.close();
        reject(new Error(`Authorization denied: ${error}${errorDescription ? ` — ${errorDescription}` : ""}`));
        return;
      }
      if (cbCode === null || cbState === null) {
        done(400, "<p>Missing code/state. Retry the command.</p>");
        server.close();
        reject(new Error("Callback missing code or state"));
        return;
      }
      if (cbState !== expectedState) {
        done(400, "<p>State mismatch (possible CSRF). Retry the command.</p>");
        server.close();
        reject(new Error("CSRF state mismatch"));
        return;
      }
      done(200, "<p>Authorized. Return to the terminal — it's exchanging the code now.</p>");
      server.close();
      resolve(cbCode);
    });

    server.on("error", (err) => {
      reject(new Error(`Failed to start callback server on port ${serverPort}: ${err.message}`));
    });

    const timeout = setTimeout(() => {
      server.close();
      reject(new Error(`Timed out after ${Math.floor(AUTH_TIMEOUT_MS / 1000)}s — no callback.`));
    }, AUTH_TIMEOUT_MS);
    server.on("close", () => clearTimeout(timeout));

    server.listen(serverPort, "127.0.0.1", () => {
      if (urlToOpen !== null) {
        openBrowser(urlToOpen).catch((err) =>
          console.warn(`  (browser open failed: ${err.message})`),
        );
      }
    });
  });
}

function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  const cmd =
    platform === "win32"
      ? `start "" "${url}"`
      : platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  return new Promise((resolve, reject) => {
    exec(cmd, (err) => (err ? reject(err) : resolve()));
  });
}
