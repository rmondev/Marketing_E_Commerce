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

// === Multi-platform migration (Phase B) ===
// Brings pre-multi-platform DBs (with IG-specific columns on clients,
// snapshots.client_id, IG-only account/post metric columns) up to the
// platform-agnostic schema. Detection key: presence of
// ig_business_account_id on clients = old shape.
//
// SQLite 3.35+ (better-sqlite3 12.x) supports native ALTER TABLE DROP
// COLUMN and RENAME COLUMN, so we don't need 12-step table rebuilds for
// the column-level changes. The only rebuild is the demographic_breakdowns
// CHECK relaxation at the bottom (SQLite cannot drop CHECK constraints
// without recreating the table).
type ClientRow = {
  id: number;
  ig_business_account_id: string;
  fb_page_id: string;
  page_access_token: string;
  created_at: string;
};
if (hasColumn("clients", "ig_business_account_id")) {
  const migrate = conn.transaction(() => {
    // Backfill platform_accounts from existing clients. Each existing
    // client becomes one platform_account with platform='instagram',
    // carrying its page token and FB Page ID in the credentials JSON.
    const oldClients = conn
      .prepare(
        `SELECT id, ig_business_account_id, fb_page_id, page_access_token, created_at
           FROM clients`,
      )
      .all() as ClientRow[];

    const insertPa = conn.prepare(
      `INSERT INTO platform_accounts (
         client_id, platform, external_account_id, credentials, added_at
       ) VALUES (?, 'instagram', ?, ?, ?)`,
    );
    for (const c of oldClients) {
      insertPa.run(
        c.id,
        c.ig_business_account_id,
        JSON.stringify({
          page_access_token: c.page_access_token,
          fb_page_id: c.fb_page_id,
        }),
        c.created_at,
      );
    }

    // Drop IG-specific columns from clients
    conn.exec("ALTER TABLE clients DROP COLUMN ig_business_account_id");
    conn.exec("ALTER TABLE clients DROP COLUMN fb_page_id");
    conn.exec("ALTER TABLE clients DROP COLUMN page_access_token");

    // snapshots: add platform_account_id, backfill from client_id, drop
    // client_id. Cannot ALTER ADD a NOT NULL column without default, so
    // the column lands nullable here; every existing row gets filled by
    // the UPDATE before client_id is removed. Going forward new INSERTs
    // always supply platform_account_id explicitly (audit.ts enforces).
    if (
      hasColumn("snapshots", "client_id") &&
      !hasColumn("snapshots", "platform_account_id")
    ) {
      conn.exec(
        "ALTER TABLE snapshots ADD COLUMN platform_account_id INTEGER REFERENCES platform_accounts(id)",
      );
      conn.exec(
        `UPDATE snapshots
           SET platform_account_id = (
             SELECT id FROM platform_accounts
             WHERE platform_accounts.client_id = snapshots.client_id
               AND platform = 'instagram'
             LIMIT 1
           )`,
      );
      conn.exec("ALTER TABLE snapshots DROP COLUMN client_id");
    }

    // account_metrics: media_count → posts_count, move IG-specifics into
    // platform_extras JSON. json_object SQLite function ships in better-sqlite3.
    if (hasColumn("account_metrics", "media_count")) {
      conn.exec(
        "ALTER TABLE account_metrics RENAME COLUMN media_count TO posts_count",
      );
    }
    if (!hasColumn("account_metrics", "platform_extras")) {
      conn.exec("ALTER TABLE account_metrics ADD COLUMN platform_extras TEXT");
      conn.exec(
        `UPDATE account_metrics
           SET platform_extras = json_object(
             'reach', reach,
             'profile_views', profile_views,
             'website_clicks', website_clicks
           )`,
      );
      conn.exec("ALTER TABLE account_metrics DROP COLUMN reach");
      conn.exec("ALTER TABLE account_metrics DROP COLUMN profile_views");
      conn.exec("ALTER TABLE account_metrics DROP COLUMN website_clicks");
    }

    // post_metrics: ig_media_id → external_post_id, video_views → views,
    // move reach + saved into platform_extras.
    if (hasColumn("post_metrics", "ig_media_id")) {
      conn.exec(
        "ALTER TABLE post_metrics RENAME COLUMN ig_media_id TO external_post_id",
      );
    }
    if (hasColumn("post_metrics", "video_views")) {
      conn.exec(
        "ALTER TABLE post_metrics RENAME COLUMN video_views TO views",
      );
    }
    if (!hasColumn("post_metrics", "platform_extras")) {
      conn.exec("ALTER TABLE post_metrics ADD COLUMN platform_extras TEXT");
      conn.exec(
        `UPDATE post_metrics
           SET platform_extras = json_object('reach', reach, 'saved', saved)`,
      );
      conn.exec("ALTER TABLE post_metrics DROP COLUMN reach");
      conn.exec("ALTER TABLE post_metrics DROP COLUMN saved");
    }
  });
  migrate();
}

// demographic_breakdowns CHECK relaxation. The pre-multi-platform schema
// restricted audience_type to IG values; multi-platform needs to allow
// each platform's own values. SQLite cannot drop a CHECK constraint
// without rebuilding the table, so do that here. Detection: look at the
// recorded CREATE statement in sqlite_master.
const demoSchemaSql =
  (
    conn
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='demographic_breakdowns'",
      )
      .get() as { sql: string } | undefined
  )?.sql ?? "";
if (demoSchemaSql.includes("CHECK")) {
  // PRAGMA foreign_keys must be OUTSIDE the transaction — SQLite ignores
  // the pragma if there's a pending transaction. Disable, rebuild, re-enable.
  conn.pragma("foreign_keys = OFF");
  const relax = conn.transaction(() => {
    conn.exec(`
      CREATE TABLE demographic_breakdowns_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id   INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE RESTRICT,
        audience_type TEXT    NOT NULL,
        dimension     TEXT    NOT NULL,
        bucket        TEXT    NOT NULL,
        value         INTEGER NOT NULL
      )
    `);
    conn.exec(
      "INSERT INTO demographic_breakdowns_new SELECT * FROM demographic_breakdowns",
    );
    conn.exec("DROP TABLE demographic_breakdowns");
    conn.exec(
      "ALTER TABLE demographic_breakdowns_new RENAME TO demographic_breakdowns",
    );
    conn.exec(
      "CREATE INDEX IF NOT EXISTS idx_demo_snapshot ON demographic_breakdowns(snapshot_id)",
    );
  });
  relax();
  conn.pragma("foreign_keys = ON");
}

// Indexes whose target columns may not exist until the migration above has
// run (e.g. snapshots.platform_account_id is added by the Phase B migration).
// Putting them here instead of in schema.sql keeps schema-apply idempotent
// on old-shape DBs.
conn.exec(
  `CREATE INDEX IF NOT EXISTS idx_snapshots_platform_account
     ON snapshots(platform_account_id)`,
);

export const db = conn;
