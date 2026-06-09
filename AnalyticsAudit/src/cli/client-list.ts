import { db } from "../core/db/client.js";

interface Row {
  id: number;
  short_name: string;
  display_name: string;
  platforms: string | null;
  last_snapshot: string | null;
}

// Per-business summary with:
//   - a comma-list of attached platforms (GROUP_CONCAT over platform_accounts)
//   - the last_snapshot timestamp across all of those platforms
//     (MAX(captured_at) signals "when did we last audit ANY channel")
const rows = db
  .prepare(
    `SELECT
       c.id,
       c.short_name,
       c.display_name,
       GROUP_CONCAT(DISTINCT pa.platform) AS platforms,
       MAX(s.captured_at) AS last_snapshot
     FROM clients c
     LEFT JOIN platform_accounts pa ON pa.client_id = c.id
     LEFT JOIN snapshots s ON s.platform_account_id = pa.id
     GROUP BY c.id
     ORDER BY c.id`,
  )
  .all() as Row[];

if (rows.length === 0) {
  console.log("No clients configured.");
  console.log("  Add one with: npm run client:add");
  process.exit(0);
}

const idW = Math.max(2, ...rows.map((r) => String(r.id).length));
const shortW = Math.max(10, ...rows.map((r) => r.short_name.length));
const nameW = Math.max(12, ...rows.map((r) => r.display_name.length));
const platW = Math.max(
  9,
  ...rows.map((r) => (r.platforms ?? "(none)").length),
);

const header =
  `${"ID".padEnd(idW)}  ${"SHORT_NAME".padEnd(shortW)}  ` +
  `${"DISPLAY_NAME".padEnd(nameW)}  ${"PLATFORMS".padEnd(platW)}  ` +
  "LAST_SNAPSHOT";
console.log(header);
console.log("-".repeat(header.length));
for (const r of rows) {
  const last = r.last_snapshot ?? "(never)";
  const platforms = r.platforms ?? "(none)";
  console.log(
    `${String(r.id).padEnd(idW)}  ${r.short_name.padEnd(shortW)}  ` +
      `${r.display_name.padEnd(nameW)}  ${platforms.padEnd(platW)}  ${last}`,
  );
}
console.log(`\n${rows.length} client(s).`);
