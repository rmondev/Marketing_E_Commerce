// Live end-to-end smoke test for the Facebook Pages wrapper. Only calls
// the endpoints that work in dev mode — see docs/APP_REVIEW.md for what
// the App-Review-gated endpoints will do once approved.
//
// Run with:  npm run test:facebook-page -- --client <short-name>

import { Command } from "commander";
import { db } from "../../core/db/client.js";
import { getPageProfile, listRecentPosts } from "./api.js";
import { resolvePostType } from "./types.js";

const program = new Command();
program
  .name("test:facebook-page")
  .description("Live smoke test for the Facebook Pages wrapper (dev-mode endpoints).")
  .requiredOption(
    "--client <shortName>",
    "Client short_name with a configured facebook_page platform_account",
  );
program.parse();
const opts = program.opts() as { client: string };

type ClientRow = { id: number; short_name: string; display_name: string };
const client = db
  .prepare("SELECT id, short_name, display_name FROM clients WHERE short_name = ?")
  .get(opts.client) as ClientRow | undefined;
if (!client) {
  console.error(`No client with short_name '${opts.client}'.`);
  process.exit(1);
}

type PaRow = {
  external_account_id: string;
  credentials: string;
};
const pa = db
  .prepare(
    `SELECT external_account_id, credentials FROM platform_accounts
       WHERE client_id = ? AND platform = 'facebook_page'`,
  )
  .get(client.id) as PaRow | undefined;
if (!pa) {
  console.error(
    `Client '${client.short_name}' has no facebook_page platform_account.`,
  );
  process.exit(1);
}

const creds = JSON.parse(pa.credentials) as { page_access_token?: string };
const token = creds.page_access_token;
if (typeof token !== "string" || token.length < 20) {
  console.error("facebook_page credentials JSON is missing page_access_token.");
  process.exit(1);
}
const pageId = pa.external_account_id;

console.log(`Target FB Page: ${pageId} (client: ${client.short_name})\n`);

console.log("--- getPageProfile ---");
const profile = await getPageProfile(pageId, token);
console.log(profile);

console.log("\n--- listRecentPosts (limit 5) ---");
const posts = await listRecentPosts(pageId, token, 5);
console.log(`Got ${posts.length} post(s):`);
for (const p of posts) {
  const type = resolvePostType(p);
  const msg = p.message
    ? p.message.slice(0, 60).replace(/\s+/g, " ")
    : "(no message)";
  console.log(`  ${type.padEnd(7)} ${p.id}  ${p.created_time}  ${msg}`);
}

console.log("\nLive test complete.");
console.log("\nNote: insights / reactions / comments / shares endpoints require Meta App Review.");
console.log("See docs/APP_REVIEW.md for the unblock path.");
