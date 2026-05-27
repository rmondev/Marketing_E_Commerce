import { db } from "../db/client.js";

interface Row {
  id: number;
  short_name: string;
  display_name: string;
  last_snapshot: string | null;
}

const rows = db
  .prepare(
    `SELECT
       c.id,
       c.short_name,
       c.display_name,
       MAX(s.captured_at) AS last_snapshot
     FROM clients c
     LEFT JOIN snapshots s ON s.client_id = c.id
     GROUP BY c.id
     ORDER BY c.id`,
  )
  .all() as Row[];

if (rows.length === 0) {
  console.log("No clients configured.");
  console.log(
    "  Add one with: npm run client:add -- --name \"...\" --short-name ... --ig-account-id ... --page-id ... --page-token ...",
  );
  process.exit(0);
}

const idW = Math.max(2, ...rows.map((r) => String(r.id).length));
const shortW = Math.max(10, ...rows.map((r) => r.short_name.length));
const nameW = Math.max(12, ...rows.map((r) => r.display_name.length));

const header = `${"ID".padEnd(idW)}  ${"SHORT_NAME".padEnd(shortW)}  ${"DISPLAY_NAME".padEnd(nameW)}  LAST_SNAPSHOT`;
console.log(header);
console.log("-".repeat(header.length));
for (const r of rows) {
  const last = r.last_snapshot ?? "(never)";
  console.log(
    `${String(r.id).padEnd(idW)}  ${r.short_name.padEnd(shortW)}  ${r.display_name.padEnd(nameW)}  ${last}`,
  );
}
console.log(`\n${rows.length} client(s).`);
