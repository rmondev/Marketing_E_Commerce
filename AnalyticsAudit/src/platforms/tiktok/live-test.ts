// Live smoke test for the TikTok Display API wrapper (Phase G2).
//
// Two ways to supply a token:
//
//   1. Directly — works BEFORE any TikTok account is onboarded, which is the
//      common case while the OAuth sandbox PKCE bug is open and tokens are
//      minted via Postman / the portal "Try API" tool (see docs/TIKTOK_SETUP.md):
//        npm run test:tiktok -- --access-token "act.xxxxx"
//
//   2. From an onboarded client's stored credentials:
//        npm run test:tiktok -- --client symmetry-esthetics
//
// Optional: --max-videos <n> (default 10) caps how many videos to pull.

import { Command } from "commander";
import { db } from "../../core/db/client.js";
import { toEtTimestamp } from "../../core/lib/time.js";
import { getUserInfo, listVideos, TikTokApiError } from "./api.js";
import type { TikTokCredentials } from "./types.js";

const program = new Command();
program
  .name("test:tiktok")
  .description("Live smoke test for the TikTok Display API wrapper.")
  .option(
    "--access-token <token>",
    "Bearer access token to test with directly (skips the DB lookup)",
  )
  .option(
    "--client <shortName>",
    "Client short_name with a configured tiktok platform_account (reads its stored access token)",
  )
  .option("--max-videos <n>", "Max videos to pull (default 10)");
program.parse();

const opts = program.opts() as {
  accessToken?: string;
  client?: string;
  maxVideos?: string;
};

const maxVideos = (() => {
  if (opts.maxVideos === undefined) return 10;
  const n = Number(opts.maxVideos);
  if (!Number.isInteger(n) || n < 1 || n > 400) {
    console.error(`Invalid --max-videos '${opts.maxVideos}': must be 1-400.`);
    process.exit(1);
  }
  return n;
})();

// ─── Resolve the access token ───────────────────────────────────────────────

let accessToken: string;
let sourceLabel: string;

if (opts.accessToken !== undefined && opts.accessToken !== "") {
  accessToken = opts.accessToken;
  sourceLabel = "--access-token flag";
} else if (opts.client !== undefined) {
  type ClientRow = { id: number; short_name: string };
  const client = db
    .prepare("SELECT id, short_name FROM clients WHERE short_name = ?")
    .get(opts.client) as ClientRow | undefined;
  if (!client) {
    console.error(`No client with short_name '${opts.client}'.`);
    process.exit(1);
  }
  type PaRow = { credentials: string };
  const pa = db
    .prepare(
      `SELECT credentials FROM platform_accounts
         WHERE client_id = ? AND platform = 'tiktok'`,
    )
    .get(client.id) as PaRow | undefined;
  if (!pa) {
    console.error(
      `Client '${client.short_name}' has no tiktok platform_account. ` +
        `Onboard one with: npm run client:platform:add -- --client ${client.short_name} --platform tiktok`,
    );
    process.exit(1);
  }
  const creds = JSON.parse(pa.credentials) as TikTokCredentials;
  if (typeof creds.access_token !== "string" || creds.access_token.length < 10) {
    console.error("tiktok credentials JSON is missing a usable access_token.");
    process.exit(1);
  }
  accessToken = creds.access_token;
  sourceLabel = `client '${client.short_name}' stored credentials`;
} else {
  console.error(
    "Supply a token: either --access-token <token> or --client <shortName>.",
  );
  process.exit(1);
}

console.log(`TikTok wrapper smoke test (token from ${sourceLabel})\n`);

try {
  console.log("--- getUserInfo ---");
  const user = await getUserInfo(accessToken);
  console.log({
    open_id: user.open_id,
    username: user.username ?? "(withheld)",
    display_name: user.display_name ?? "(withheld)",
    is_verified: user.is_verified ?? "(withheld)",
    follower_count: user.follower_count ?? "(withheld)",
    following_count: user.following_count ?? "(withheld)",
    likes_count: user.likes_count ?? "(withheld)",
    video_count: user.video_count ?? "(withheld)",
  });

  console.log(`\n--- listVideos (max ${maxVideos}) ---`);
  const videos = await listVideos(accessToken, { maxVideos });
  console.log(`Got ${videos.length} video(s):`);
  for (const v of videos) {
    const posted = toEtTimestamp(new Date(v.create_time * 1000).toISOString());
    const desc = (v.title ?? v.video_description ?? "(no caption)")
      .slice(0, 50)
      .replace(/\s+/g, " ");
    console.log(
      `  ${posted}  views=${v.view_count ?? "?"} likes=${v.like_count ?? "?"} ` +
        `comments=${v.comment_count ?? "?"} shares=${v.share_count ?? "?"}  ${desc}`,
    );
  }

  console.log("\nLive test complete.");
  console.log(
    "\nNote: TikTok's Display API exposes no audience demographics (age/gender/geo) —",
  );
  console.log(
    "those require the separately-gated Research API. Reports surface that as an empty state.",
  );
} catch (err) {
  if (err instanceof TikTokApiError) {
    console.error(
      `\nTikTok API error [${err.apiCode}] (HTTP ${err.httpStatus}): ${err.message}` +
        (err.logId !== undefined ? `\n  log_id=${err.logId}` : ""),
    );
    if (err.apiCode === "access_token_invalid") {
      console.error(
        "  → The access token is expired or invalid. TikTok access tokens last ~24h.",
      );
    }
    process.exit(1);
  }
  throw err;
}
