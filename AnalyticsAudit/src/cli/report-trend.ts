import { Command } from "commander";
import { db } from "../core/db/client.js";
import { generateTrendReport } from "../platforms/instagram/trend-report.js";

const program = new Command();
program
  .name("report:trend")
  .description(
    "Render an HTML trend report (latest snapshot vs the one before, with 4-snapshot context) for one client.",
  )
  .requiredOption(
    "--client <shortName>",
    "Client short_name from the clients table",
  );
program.parse();

const { client: shortName } = program.opts() as { client: string };

// Joins clients to its Instagram platform_account. Currently the trend
// report is IG-only; Phase D's registry will dispatch per-platform.
type ClientRow = {
  client_id: number;
  short_name: string;
  display_name: string;
  platform_account_id: number;
};

const client = db
  .prepare(
    `SELECT c.id AS client_id, c.short_name, c.display_name,
            pa.id AS platform_account_id
       FROM clients c
       JOIN platform_accounts pa ON pa.client_id = c.id
       WHERE c.short_name = ? AND pa.platform = 'instagram'`,
  )
  .get(shortName) as ClientRow | undefined;

if (!client) {
  console.error(
    `No Instagram platform_account for client '${shortName}'.`,
  );
  console.error("  Use 'npm run client:list' to see configured clients.");
  process.exit(1);
}

const reportPath = generateTrendReport(client);
if (!reportPath) {
  console.error(
    `No snapshots for client '${shortName}'. Run 'npm run audit -- --client ${shortName}' first.`,
  );
  process.exit(1);
}
console.log(`Trend report: ${reportPath}`);
