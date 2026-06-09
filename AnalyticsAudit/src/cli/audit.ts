// Multi-platform audit dispatcher. Loads the business by short_name, walks
// its configured platform_accounts, and dispatches each through the
// registry. Unimplemented platforms print a friendly skip message and the
// loop continues — one bad platform doesn't break the others.
//
// The IG-specific audit logic moved to src/platforms/instagram/audit.ts
// in Phase D; this file only orchestrates.

import { Command } from "commander";
import { db } from "../core/db/client.js";
import { PLATFORMS, type PlatformAccount } from "../platforms/_registry.js";

const DEFAULT_LOOKBACK_DAYS = 7;

const program = new Command();
program
  .name("audit")
  .description(
    "Capture a snapshot for one business across all configured platforms (or one platform if --platform is set).",
  )
  .requiredOption(
    "--client <shortName>",
    "Client short_name from the clients table",
  )
  .option(
    "--lookback-days <days>",
    `Days to look back for media inclusion in post_metrics (default: ${DEFAULT_LOOKBACK_DAYS}). Account insights always use a fixed 7-day window.`,
  )
  .option(
    "--platform <name>",
    "Restrict the audit to a single platform (e.g. instagram, facebook_page, tiktok). Default: all configured platforms for the business.",
  );
program.parse();

const rawOpts = program.opts() as {
  client: string;
  lookbackDays?: string;
  platform?: string;
};

let lookbackDays = DEFAULT_LOOKBACK_DAYS;
if (rawOpts.lookbackDays !== undefined) {
  const parsed = Number(rawOpts.lookbackDays);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) {
    console.error(
      `Invalid --lookback-days '${rawOpts.lookbackDays}': must be a positive integer (1-3650).`,
    );
    process.exit(1);
  }
  lookbackDays = parsed;
}

type ClientRow = { id: number; short_name: string; display_name: string };
const client = db
  .prepare(
    "SELECT id, short_name, display_name FROM clients WHERE short_name = ?",
  )
  .get(rawOpts.client) as ClientRow | undefined;

if (!client) {
  console.error(`No client with short_name '${rawOpts.client}'.`);
  console.error("  Use 'npm run client:list' to see configured clients.");
  process.exit(1);
}

let platformAccounts = db
  .prepare(
    `SELECT id, client_id, platform, external_account_id, display_handle, credentials
       FROM platform_accounts
       WHERE client_id = ?
       ORDER BY id`,
  )
  .all(client.id) as PlatformAccount[];

if (rawOpts.platform !== undefined) {
  const before = platformAccounts.length;
  platformAccounts = platformAccounts.filter(
    (pa) => pa.platform === rawOpts.platform,
  );
  if (platformAccounts.length === 0) {
    console.error(
      `Client '${client.short_name}' has no platform_account with platform='${rawOpts.platform}'. ` +
        `Configured platforms: ${before === 0 ? "(none)" : "<see client:list>"}`,
    );
    process.exit(1);
  }
}

if (platformAccounts.length === 0) {
  console.error(
    `Client '${client.short_name}' has no configured platforms. ` +
      `Run 'npm run client:add' or attach a platform manually.`,
  );
  process.exit(1);
}

console.log(`Auditing ${client.display_name} (${client.short_name})`);
console.log(
  `  platforms: ${platformAccounts.map((pa) => pa.platform).join(", ")}`,
);
console.log(`  lookback:  ${lookbackDays} day(s)\n`);

type RunResult = {
  platform: string;
  status: "captured" | "skipped" | "error";
  detail: string;
};
const results: RunResult[] = [];

for (const pa of platformAccounts) {
  const handle = PLATFORMS[pa.platform];
  const displayName = handle?.displayName ?? pa.platform;

  console.log(`═══ ${displayName} ═══`);
  if (!handle) {
    console.log(
      `Unknown platform '${pa.platform}' — no handler registered. Skipping.\n`,
    );
    results.push({
      platform: pa.platform,
      status: "skipped",
      detail: "unknown platform",
    });
    continue;
  }
  if (!handle.isImplemented) {
    console.log(
      `${displayName} audit is registered but not yet implemented. Skipping.\n`,
    );
    results.push({
      platform: pa.platform,
      status: "skipped",
      detail: "not yet implemented",
    });
    continue;
  }
  try {
    const result = await handle.audit({
      platformAccount: pa,
      client: {
        id: client.id,
        short_name: client.short_name,
        display_name: client.display_name,
      },
      lookbackDays,
    });
    results.push({
      platform: pa.platform,
      status: "captured",
      detail: `snapshot #${result.snapshotId}`,
    });
    console.log("");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`${displayName} audit failed: ${msg}\n`);
    results.push({
      platform: pa.platform,
      status: "error",
      detail: msg,
    });
  }
}

console.log("═══ Summary ═══");
for (const r of results) {
  const statusGlyph =
    r.status === "captured" ? "✓" : r.status === "skipped" ? "·" : "✗";
  console.log(
    `  ${statusGlyph} ${r.platform.padEnd(15)} ${r.status.padEnd(10)} ${r.detail}`,
  );
}

const errorCount = results.filter((r) => r.status === "error").length;
if (errorCount > 0) process.exit(1);
