// Multi-platform trend report dispatcher. Loads the business by
// short_name, walks its configured platform_accounts, and dispatches each
// through the registry. Each platform writes to its own directory
// (reports/<client>/<platform>/trend/) so platforms never collide.

import { Command } from "commander";
import { db } from "../core/db/client.js";
import { PLATFORMS } from "../platforms/_registry.js";

const program = new Command();
program
  .name("report:trend")
  .description(
    "Render the HTML trend report for one client. By default runs for every configured platform; use --platform to narrow.",
  )
  .requiredOption(
    "--client <shortName>",
    "Client short_name from the clients table",
  )
  .option(
    "--platform <name>",
    "Restrict to a single platform (instagram | facebook_page | tiktok). Default: all.",
  );
program.parse();

const rawOpts = program.opts() as { client: string; platform?: string };

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

type PaRow = { id: number; platform: string };
let platformAccounts = db
  .prepare(
    "SELECT id, platform FROM platform_accounts WHERE client_id = ? ORDER BY id",
  )
  .all(client.id) as PaRow[];

if (rawOpts.platform !== undefined) {
  platformAccounts = platformAccounts.filter(
    (pa) => pa.platform === rawOpts.platform,
  );
  if (platformAccounts.length === 0) {
    console.error(
      `Client '${client.short_name}' has no platform_account with platform='${rawOpts.platform}'.`,
    );
    process.exit(1);
  }
}

if (platformAccounts.length === 0) {
  console.error(
    `Client '${client.short_name}' has no configured platforms.`,
  );
  process.exit(1);
}

let anyGenerated = false;
for (const pa of platformAccounts) {
  const handle = PLATFORMS[pa.platform];
  const displayName = handle?.displayName ?? pa.platform;

  if (!handle) {
    console.log(`[${pa.platform}] no handler registered — skipping.`);
    continue;
  }
  if (!handle.capabilities.reports) {
    console.log(`[${displayName}] reports not yet implemented — skipping.`);
    continue;
  }

  const result = handle.generateTrendReport({
    client_id: client.id,
    platform_account_id: pa.id,
    platform: pa.platform,
    short_name: client.short_name,
    display_name: client.display_name,
  });
  if (!result) {
    console.log(
      `[${displayName}] no snapshots yet for this platform_account — skipping.`,
    );
    continue;
  }
  console.log(`[${displayName}]`);
  console.log(`  Trend report: ${result.trendPath}`);
  console.log(`  Catalog:      ${result.catalogPath}`);
  anyGenerated = true;
}

if (!anyGenerated) {
  console.error("\nNo reports were generated.");
  process.exit(1);
}
