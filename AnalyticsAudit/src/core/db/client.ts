import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DATA_DIR = resolve("data");
const DB_PATH = resolve(DATA_DIR, "analytics.db");
const SCHEMA_PATH = resolve(import.meta.dirname, "schema.sql");

mkdirSync(DATA_DIR, { recursive: true });

const conn = new Database(DB_PATH);

// Foreign keys must be enabled per-connection in SQLite — defaults to off.
conn.pragma("foreign_keys = ON");

conn.exec(readFileSync(SCHEMA_PATH, "utf-8"));

// Idempotent migrations for pre-existing analytics.db files. The CREATE TABLE
// statements above use IF NOT EXISTS, which silently skips altering tables
// that already exist with an older shape. SQLite has no ADD COLUMN IF NOT
// EXISTS, so we PRAGMA-check first. Defaults are required because the schema
// declares these NOT NULL — fresh DBs still get the no-default declaration
// (so new INSERTs must supply the value explicitly); the defaults only fill
// rows that pre-date the column.
type ColumnInfo = { name: string };
function hasColumn(table: string, column: string): boolean {
  const rows = conn.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
  return rows.some((r) => r.name === column);
}
if (!hasColumn("snapshots", "lookback_days")) {
  conn.exec(
    "ALTER TABLE snapshots ADD COLUMN lookback_days INTEGER NOT NULL DEFAULT 7",
  );
}
if (!hasColumn("post_metrics", "is_supplemental")) {
  conn.exec(
    "ALTER TABLE post_metrics ADD COLUMN is_supplemental INTEGER NOT NULL DEFAULT 0",
  );
}
if (!hasColumn("snapshots", "demographics_attempted")) {
  conn.exec(
    "ALTER TABLE snapshots ADD COLUMN demographics_attempted INTEGER NOT NULL DEFAULT 0",
  );
  // One-time backfill: any pre-existing snapshot that already has demographic
  // rows clearly came from a build that attempted the fetch. Without this,
  // the report would mislabel them as "pre-feature snapshot (audit didn't
  // ask)". Idempotent — safe to re-run, only takes effect on the migration
  // step above which itself is one-shot.
  conn.exec(
    `UPDATE snapshots SET demographics_attempted = 1
       WHERE id IN (SELECT DISTINCT snapshot_id FROM demographic_breakdowns)`,
  );
}

export const db = conn;
