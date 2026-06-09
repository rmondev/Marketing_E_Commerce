import { Command } from "commander";
import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { db } from "../core/db/client.js";

// Dry-run by default. Two opt-in destructive modes:
//   --confirm                       → wipe snapshot history, preserve clients
//   --confirm --include-clients     → wipe everything; the clients branch
//                                     additionally prompts the operator to
//                                     type 'DELETE' unless --force is passed
// A timestamped backup of analytics.db is written before any deletion
// (suppress with --no-backup).

const program = new Command();
program
  .name("db:clear")
  .description(
    "Wipe the local analytics database. Dry-run by default; use --confirm to actually delete. Always preserves clients unless --include-clients is also passed.",
  )
  .option(
    "--confirm",
    "Actually delete. Without this flag, prints a preview and exits.",
  )
  .option(
    "--include-clients",
    "Also delete the clients table (tokens, configurations). Requires --confirm. Re-onboarding will need fresh page access tokens.",
  )
  .option(
    "--force",
    "Skip the interactive 'type DELETE to confirm' prompt that gates --include-clients. Only intended for scripts.",
  )
  .option("--no-backup", "Skip the pre-wipe backup copy.");
program.parse();

const opts = program.opts() as {
  confirm?: boolean;
  includeClients?: boolean;
  force?: boolean;
  backup: boolean; // commander inverts --no-backup
};

const HISTORY_TABLES = [
  "demographic_breakdowns",
  "post_metrics",
  "account_metrics",
  "snapshots",
] as const;
const ALL_TABLES = [...HISTORY_TABLES, "clients"] as const;

type CountRow = { c: number };
const counts: Record<string, number> = {};
for (const t of ALL_TABLES) {
  counts[t] = (
    db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as CountRow
  ).c;
}

const wipingClients = opts.includeClients === true;

console.log("Current row counts:");
for (const t of ALL_TABLES) {
  const willClear = wipingClients || (HISTORY_TABLES as readonly string[]).includes(t);
  const marker = willClear ? "→ will clear" : "→ preserved";
  console.log(`  ${t.padEnd(25)} ${String(counts[t]).padStart(6)}  ${marker}`);
}

if (!opts.confirm) {
  console.log("\nDry-run only. No changes made.");
  console.log("");
  console.log("To wipe snapshot history (preserve clients):");
  console.log("  npm run db:clear -- --confirm");
  console.log("");
  console.log("To wipe everything including clients (typing 'DELETE' required):");
  console.log("  npm run db:clear -- --confirm --include-clients");
  console.log("");
  console.log(
    "A backup of data/analytics.db is written before any deletion (use --no-backup to skip).",
  );
  process.exit(0);
}

if (wipingClients && !opts.force) {
  console.log(
    "\nWARNING: --include-clients will delete the clients table (page access tokens and",
  );
  console.log(
    "configurations). This is irreversible without a backup; re-onboarding each client",
  );
  console.log("requires minting fresh tokens via the Graph API Explorer.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    "Type 'DELETE' (uppercase) to proceed, anything else to abort: ",
  );
  rl.close();
  if (answer.trim() !== "DELETE") {
    console.log("Aborted. No changes made.");
    process.exit(1);
  }
}

if (opts.backup !== false) {
  const dbPath = resolve("data", "analytics.db");
  if (existsSync(dbPath)) {
    const ts = new Date()
      .toISOString()
      .replace(/[:.]/g, "")
      .replace("T", "-")
      .slice(0, 15);
    const backupPath = resolve("data", `analytics.backup.${ts}.db`);
    copyFileSync(dbPath, backupPath);
    console.log(`Backup written to ${backupPath}`);
  }
}

// Delete in FK-respecting order: children before parents (ON DELETE RESTRICT).
const wipe = db.transaction(() => {
  for (const t of HISTORY_TABLES) {
    db.exec(`DELETE FROM ${t}`);
  }
  db.exec(
    `DELETE FROM sqlite_sequence WHERE name IN ('snapshots','account_metrics','post_metrics','demographic_breakdowns')`,
  );
  if (wipingClients) {
    db.exec("DELETE FROM clients");
    db.exec("DELETE FROM sqlite_sequence WHERE name = 'clients'");
  }
});
wipe();

console.log("\nDone. Verifying:");
for (const t of ALL_TABLES) {
  const c = (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as CountRow).c;
  console.log(`  ${t.padEnd(25)} ${String(c).padStart(6)}`);
}
