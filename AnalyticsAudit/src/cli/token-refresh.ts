import { Command } from "commander";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import {
  debugToken,
  exchangeForLongLivedToken,
  getPageAccessToken,
} from "../platforms/instagram/api.js";
import { db } from "../core/db/client.js";
import { env } from "../core/lib/env.js";
import { askMasked, maskToken } from "../core/lib/prompt.js";
import { toEtTimestamp } from "../core/lib/time.js";

const ENV_FILE = ".env.local";

const program = new Command();
program
  .name("token:refresh")
  .description(
    "Exchange a short-lived User Token from the Graph API Explorer for a long-lived (~60 day) Page Access Token, store it on a client, and optionally update .env.local.",
  )
  .option("--client <shortName>", "Client short_name to update (prompts if omitted and >1 client exists)")
  .option(
    "--user-token <token>",
    "Short-lived User Token from Graph API Explorer (prompts hidden if omitted)",
  )
  .option(
    "--update-env",
    "Also update META_PAGE_ACCESS_TOKEN in .env.local without prompting",
  );

program.parse();

type RawOpts = {
  client?: string;
  userToken?: string;
  updateEnv?: boolean;
};
const rawOpts = program.opts() as RawOpts;

type ClientRow = {
  id: number;
  short_name: string;
  display_name: string;
  fb_page_id: string;
};

const clients = db
  .prepare(
    "SELECT id, short_name, display_name, fb_page_id FROM clients ORDER BY id",
  )
  .all() as ClientRow[];

if (clients.length === 0) {
  console.error("No clients in the database. Run 'npm run client:add' first.");
  process.exit(1);
}

// 1. Resolve target client
let targetShortName = rawOpts.client;
if (targetShortName === undefined) {
  if (clients.length === 1) {
    targetShortName = clients[0]!.short_name;
    console.log(`Refreshing token for sole client: ${targetShortName}`);
  } else {
    console.log("Configured clients:");
    for (const c of clients) {
      console.log(`  - ${c.short_name}  (${c.display_name})`);
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    targetShortName = (await rl.question("Which client short_name? ")).trim();
    rl.close();
  }
}

const client = clients.find((c) => c.short_name === targetShortName);
if (!client) {
  console.error(`No client with short_name '${targetShortName}'.`);
  process.exit(1);
}

// 2. Resolve short-lived user token
let userToken = rawOpts.userToken;
if (userToken === undefined) {
  console.log("\nIn the Graph API Explorer (https://developers.facebook.com/tools/explorer/):");
  console.log("  1. Select your Meta App");
  console.log("  2. Ensure 'User or Page' shows 'User Token' (don't switch to Page)");
  console.log("  3. Click 'Generate Access Token', then copy the token");
  console.log("");
  userToken = (await askMasked("Paste short-lived User Token (input hidden): ")).trim();
}
if (userToken === "") {
  console.error("Empty token. Aborting.");
  process.exit(1);
}

// 3. Exchange for long-lived USER token
console.log("\nExchanging for long-lived User Token...");
const exchange = await exchangeForLongLivedToken(
  env.META_APP_ID,
  env.META_APP_SECRET,
  userToken,
);
console.log(`  Long-lived user token: ${maskToken(exchange.access_token)}`);

// 4. Derive Page Access Token
console.log(`\nDeriving Page Access Token for page ${client.fb_page_id}...`);
const pageToken = await getPageAccessToken(client.fb_page_id, exchange.access_token);
console.log(`  Page token: ${maskToken(pageToken)}`);

// 5. Inspect expiry via /debug_token
console.log("\nInspecting token via /debug_token...");
const appAccessToken = `${env.META_APP_ID}|${env.META_APP_SECRET}`;
const debug = await debugToken(pageToken, appAccessToken);
const expiresAtStr =
  debug.expires_at === undefined || debug.expires_at === 0
    ? "never (derived from long-lived user token — valid as long as the user token is)"
    : toEtTimestamp(new Date(debug.expires_at * 1000).toISOString());
console.log(`  is_valid=${debug.is_valid}  type=${debug.type ?? "?"}`);
console.log(`  expires_at=${expiresAtStr}`);

if (!debug.is_valid) {
  console.error("\nNew token reports is_valid=false. Aborting without writing.");
  process.exit(1);
}

// 6. Update DB
db.prepare("UPDATE clients SET page_access_token = ? WHERE id = ?").run(
  pageToken,
  client.id,
);
console.log(
  `\nUpdated clients.page_access_token for '${client.short_name}' (id=${client.id}).`,
);

// 7. Optionally update .env.local
let updateEnv = rawOpts.updateEnv;
if (updateEnv === undefined) {
  const defaultYes = client.short_name === "rmondev";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ans = (
    await rl.question(
      `\nAlso update META_PAGE_ACCESS_TOKEN in ${ENV_FILE}? [${defaultYes ? "Y/n" : "y/N"}] `,
    )
  )
    .trim()
    .toLowerCase();
  rl.close();
  updateEnv = ans === "" ? defaultYes : ans === "y" || ans === "yes";
}

if (updateEnv) {
  const envContent = readFileSync(ENV_FILE, "utf-8");
  const updated = envContent.replace(
    /^META_PAGE_ACCESS_TOKEN=.*$/m,
    `META_PAGE_ACCESS_TOKEN=${pageToken}`,
  );
  if (updated === envContent) {
    console.error(
      `Could not find a META_PAGE_ACCESS_TOKEN= line in ${ENV_FILE}; not modified.`,
    );
    process.exit(1);
  }
  writeFileSync(ENV_FILE, updated, "utf-8");
  console.log(`Updated ${ENV_FILE}.`);
}

console.log(`\nDone. Next: npm run audit -- --client ${client.short_name}`);
