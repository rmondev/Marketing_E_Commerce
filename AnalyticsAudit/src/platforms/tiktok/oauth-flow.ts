// Interactive browser OAuth flow for TikTok's Login Kit, shared by onboarding
// (client:platform:add) and the tiktok:mint utility.
//
// Flow type: CONFIDENTIAL WEB (client_secret, no PKCE). TikTok's app platforms
// force a trade-off — Desktop allows localhost redirects but requires PKCE
// (whose sandbox exchange rejects valid pairs), while Web is the plain
// client_secret flow but does NOT allow localhost. We use Web with a public
// https redirect; see docs/TIKTOK_SETUP.md.
//
// Code capture adapts to the redirect URI:
//   • loopback (http://localhost / 127.0.0.1) → a one-shot local HTTP server
//     catches the redirect automatically.
//   • anything else (the https Web redirect) → we can't run a server there, so
//     the operator pastes the redirected URL from the browser's address bar.

import { exec } from "node:child_process";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createInterface } from "node:readline/promises";
import { URL } from "node:url";
import {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  generateState,
  type TikTokTokens,
} from "./oauth.js";

const CALLBACK_PATH = "/oauth/tiktok/callback";
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

export type FlowLogger = (line: string) => void;
const noopLog: FlowLogger = () => {};

// Authorize in the browser and exchange the resulting code for tokens using
// the confidential web flow. Returns the minted TikTokTokens; the caller does
// whatever it wants with them (persist, print, …).
export async function authorizeWeb(opts: {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: readonly string[];
  openBrowser?: boolean;
  log?: FlowLogger;
}): Promise<TikTokTokens> {
  const log = opts.log ?? noopLog;
  const openInBrowser = opts.openBrowser ?? true;
  const state = generateState();
  const authUrl = buildAuthorizationUrl({
    clientKey: opts.clientKey,
    redirectUri: opts.redirectUri,
    state,
    ...(opts.scopes !== undefined ? { scopes: opts.scopes } : {}),
  });

  const host = new URL(opts.redirectUri).hostname;
  const isLoopback = host === "localhost" || host === "127.0.0.1";

  log("");
  log("  Log in as the TARGET account (the one you want to audit) and click Authorize.");
  log("  If the browser doesn't open, paste this URL into one manually:");
  log(`\n  ${authUrl}\n`);

  const code = isLoopback
    ? await captureViaServer(opts.redirectUri, state, authUrl, openInBrowser, log)
    : await captureViaPaste(authUrl, state, openInBrowser, log);

  log("  Authorized — exchanging the code for tokens...");
  return exchangeCodeForTokens({
    clientKey: opts.clientKey,
    clientSecret: opts.clientSecret,
    code,
    redirectUri: opts.redirectUri,
  });
}

// ─── Loopback capture (localhost redirect) ──────────────────────────────────

function captureViaServer(
  redirectUri: string,
  expectedState: string,
  authUrl: string,
  openInBrowser: boolean,
  log: FlowLogger,
): Promise<string> {
  const port = Number(new URL(redirectUri).port || "80");
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

      const done = (status: number, body: string): void => {
        res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
        res.end(htmlPage(body));
      };

      if (error !== null) {
        done(400, `<p>Authorization failed: ${escapeHtml(error)}${errorDescription !== null ? ` — ${escapeHtml(errorDescription)}` : ""}</p><p>You can close this tab.</p>`);
        server.close();
        reject(new Error(`Authorization denied: ${error}${errorDescription !== null ? ` — ${errorDescription}` : ""}`));
        return;
      }
      if (code === null || state === null) {
        done(400, "<p>Missing code/state. Please retry the command.</p>");
        server.close();
        reject(new Error("Callback missing required code or state parameter"));
        return;
      }
      if (state !== expectedState) {
        done(400, "<p>State mismatch (possible CSRF). Please retry the command.</p>");
        server.close();
        reject(new Error("CSRF state mismatch — returned state does not match the one issued"));
        return;
      }
      done(200, "<p>Authorized. Return to the terminal — it's exchanging the code now.</p>");
      server.close();
      resolve(code);
    });

    server.on("error", (err) => {
      reject(new Error(`Failed to start callback server on port ${port}: ${err.message}`));
    });

    const timeout = setTimeout(() => {
      server.close();
      reject(new Error(`TikTok OAuth timed out after ${Math.floor(AUTH_TIMEOUT_MS / 1000)}s — no callback received.`));
    }, AUTH_TIMEOUT_MS);
    server.on("close", () => clearTimeout(timeout));

    server.listen(port, "127.0.0.1", () => {
      if (openInBrowser) {
        openBrowser(authUrl).catch((err) => log(`  (browser open failed: ${err.message})`));
      }
    });
  });
}

// ─── Paste capture (non-loopback https redirect) ────────────────────────────

async function captureViaPaste(
  authUrl: string,
  expectedState: string,
  openInBrowser: boolean,
  log: FlowLogger,
): Promise<string> {
  if (openInBrowser) {
    openBrowser(authUrl).catch((err) => log(`  (browser open failed: ${err.message})`));
  }
  log("  After you Authorize, the browser lands on your redirect page with");
  log("  ?code=...&state=... in the address bar. Copy that whole URL (or just the");
  log("  code value) and paste it below.\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const answer = (await rl.question("  Paste redirected URL or code: ")).trim();
      if (answer === "") continue;

      let code = answer;
      if (answer.includes("code=") || answer.startsWith("http")) {
        try {
          const u = new URL(answer);
          const err = u.searchParams.get("error");
          if (err !== null) {
            log(`  Authorization error in URL: ${err}`);
            continue;
          }
          const c = u.searchParams.get("code");
          const s = u.searchParams.get("state");
          if (c === null) {
            log("  No 'code' found in that URL — try again.");
            continue;
          }
          if (s !== null && s !== expectedState) {
            throw new Error("CSRF state mismatch (stale or wrong redirected URL). Re-run and retry.");
          }
          code = c;
        } catch (e) {
          if (e instanceof Error && e.message.startsWith("CSRF")) throw e;
          code = answer; // not a parseable URL — treat as a raw code
        }
      }
      // The address-bar code is URL-encoded (e.g. %2A, %21); decode it so the
      // exchange sends the raw value TikTok issued.
      try {
        code = decodeURIComponent(code);
      } catch {
        /* leave as-is if it wasn't encoded */
      }
      return code;
    }
    throw new Error("No code provided after 3 attempts.");
  } finally {
    rl.close();
  }
}

// ─── Browser + HTML helpers ─────────────────────────────────────────────────

export function openBrowser(url: string): Promise<void> {
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

function htmlPage(body: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>AnalyticsAudit OAuth</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:4rem auto;padding:0 1.5rem;color:#111;line-height:1.5}h1{font-size:1.4rem}</style>
</head><body><h1>AnalyticsAudit — TikTok</h1>${body}</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
