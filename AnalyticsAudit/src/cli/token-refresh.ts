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

// Token refresh today supports any platform that uses the FB Graph
// User-Token → Page-Token derivation flow: Instagram (Page Token derived
// for the linked Facebook Page) and Facebook Page (Page Token derived for
// the Page itself). TikTok and future OAuth platforms will register their
// own refresh logic when the registry becomes refresh-aware.
const SUPPORTED_PLATFORMS = ["instagram", "facebook_page"] as const;
type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];
const DEFAULT_PLATFORM: SupportedPlatform = "instagram";

const program = new Command();
program
  .name("token:refresh")
  .description(
    "Exchange a short-lived User Token from the Graph API Explorer for a long-lived (~60 day) Page Access Token, store it on a client's platform_account, and optionally update .env.local.",
  )
  .option("--client <shortName>", "Client short_name to update (prompts if omitted and >1 client matches)")
  .option(
    "--platform <name>",
    `Which platform's token to refresh: ${SUPPORTED_PLATFORMS.join(" | ")}. Default: ${DEFAULT_PLATFORM}.`,
  )
  .option(
    "--user-token <token>",
    "Short-lived User Token from Graph API Explorer (prompts hidden if omitted)",
  )
  .option(
    "--update-env",
    "Also update META_PAGE_ACCESS_TOKEN in .env.local without prompting (only applies to instagram)",
  );

program.parse();

type RawOpts = {
  client?: string;
  platform?: string;
  userToken?: string;
  updateEnv?: boolean;
};
const rawOpts = program.opts() as RawOpts;

// Resolve target platform up front. Default to instagram to preserve the
// previous single-platform call signature.
const targetPlatform: SupportedPlatform = (() => {
  const p = rawOpts.platform ?? DEFAULT_PLATFORM;
  if (!SUPPORTED_PLATFORMS.includes(p as SupportedPlatform)) {
    console.error(
      `Unsupported --platform '${p}'. Supported: ${SUPPORTED_PLATFORMS.join(", ")}.`,
    );
    process.exit(1);
  }
  return p as SupportedPlatform;
})();

type Row = {
  client_id: number;
  short_name: string;
  display_name: string;
  platform_account_id: number;
  external_account_id: string;
  credentials: string;
};
const rows = db
  .prepare(
    `SELECT c.id AS client_id, c.short_name, c.display_name,
            pa.id AS platform_account_id, pa.external_account_id, pa.credentials
       FROM clients c
       JOIN platform_accounts pa ON pa.client_id = c.id
       WHERE pa.platform = ?
       ORDER BY c.id`,
  )
  .all(targetPlatform) as Row[];

if (rows.length === 0) {
  console.error(
    `No '${targetPlatform}' platform_accounts in the database.` +
      (targetPlatform === "instagram"
        ? " Run 'npm run client:add' first."
        : ` Attach one with: npm run client:platform:add -- --platform ${targetPlatform}`),
  );
  process.exit(1);
}

// Each row exposes a `page_id_for_derive` — the FB Page numeric ID we'll
// pass to /<page-id>?fields=access_token. For IG, that ID lives inside the
// credentials JSON (fb_page_id). For FB Page, it IS the external_account_id.
type Candidate = Row & { page_id_for_derive: string; parsed_credentials: Record<string, unknown> };
const candidates: Candidate[] = rows.map((r) => {
  const creds = JSON.parse(r.credentials) as Record<string, unknown>;
  let pageId: string;
  if (targetPlatform === "instagram") {
    const fb = creds["fb_page_id"];
    if (typeof fb !== "string") {
      throw new Error(
        `Instagram platform_account for '${r.short_name}' is missing fb_page_id in credentials JSON. Re-onboard.`,
      );
    }
    pageId = fb;
  } else {
    pageId = r.external_account_id;
  }
  return { ...r, page_id_for_derive: pageId, parsed_credentials: creds };
});

// 1. Resolve target client
let targetShortName = rawOpts.client;
if (targetShortName === undefined) {
  if (candidates.length === 1) {
    targetShortName = candidates[0]!.short_name;
    console.log(
      `Refreshing ${targetPlatform} token for sole client: ${targetShortName}`,
    );
  } else {
    console.log(`Configured clients with a ${targetPlatform} platform_account:`);
    for (const c of candidates) {
      console.log(`  - ${c.short_name}  (${c.display_name})`);
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    targetShortName = (await rl.question("Which client short_name? ")).trim();
    rl.close();
  }
}

const target = candidates.find((c) => c.short_name === targetShortName);
if (!target) {
  console.error(
    `No '${targetPlatform}' platform_account for client '${targetShortName}'.`,
  );
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
console.log(
  `\nDeriving Page Access Token for page ${target.page_id_for_derive}...`,
);
const pageToken = await getPageAccessToken(
  target.page_id_for_derive,
  exchange.access_token,
);
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

// 6. Update DB. Preserve every existing credentials field (fb_page_id for
// IG, future fields for other platforms) — only the page_access_token is
// being rotated.
const newCreds = {
  ...target.parsed_credentials,
  page_access_token: pageToken,
};
db.prepare(
  "UPDATE platform_accounts SET credentials = ? WHERE id = ?",
).run(JSON.stringify(newCreds), target.platform_account_id);
console.log(
  `\nUpdated platform_accounts.credentials for '${target.short_name}' / ${targetPlatform} (platform_account_id=${target.platform_account_id}).`,
);

// 7. Optionally update .env.local. Only meaningful for instagram (the env
// var is the bootstrap token used by `npm run test:instagram`). Skip the
// prompt entirely for other platforms.
if (targetPlatform === "instagram") {
  let updateEnv = rawOpts.updateEnv;
  if (updateEnv === undefined) {
    const defaultYes = target.short_name === "rmondev";
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
} else if (rawOpts.updateEnv === true) {
  console.log(
    `\nNote: --update-env is a no-op for ${targetPlatform} (META_PAGE_ACCESS_TOKEN is the IG bootstrap only).`,
  );
}

const nextCmd =
  targetPlatform === "facebook_page"
    ? `npm run test:facebook-page -- --client ${target.short_name}`
    : `npm run audit -- --client ${target.short_name}`;
console.log(`\nDone. Next: ${nextCmd}`);
