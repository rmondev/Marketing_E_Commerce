import { Command } from "commander";
import { db } from "../db/client.js";
import { generateMonthlyReport } from "../reports/monthly-generator.js";

const program = new Command();
program
  .name("report:monthly")
  .description(
    "Render an HTML monthly comparison report (last 4 snapshots) for one client.",
  )
  .requiredOption(
    "--client <shortName>",
    "Client short_name from the clients table",
  );
program.parse();

const { client: shortName } = program.opts() as { client: string };

type ClientRow = {
  id: number;
  short_name: string;
  display_name: string;
};

const client = db
  .prepare(
    "SELECT id, short_name, display_name FROM clients WHERE short_name = ?",
  )
  .get(shortName) as ClientRow | undefined;

if (!client) {
  console.error(`No client with short_name '${shortName}'.`);
  console.error("  Use 'npm run client:list' to see configured clients.");
  process.exit(1);
}

const reportPath = generateMonthlyReport(client);
if (!reportPath) {
  console.error(
    `No snapshots for client '${shortName}'. Run 'npm run audit -- --client ${shortName}' first.`,
  );
  process.exit(1);
}
console.log(`Monthly report: ${reportPath}`);
