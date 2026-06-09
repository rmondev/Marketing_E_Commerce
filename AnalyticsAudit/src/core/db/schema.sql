-- AnalyticsAudit SQLite schema (multi-platform)
-- Applied idempotently on every db connection open via src/core/db/client.ts.
-- Timestamps are stored as ISO 8601 strings, written by app code.
--
-- Model: a 'client' is a BUSINESS (Symmetry Esthetics is one row). Each
-- business owns one or more platform_accounts (Symmetry on Instagram,
-- Symmetry on a Facebook Page, etc.). Snapshots, account_metrics,
-- post_metrics, and demographic_breakdowns all belong to a
-- platform_account, not directly to a client.

CREATE TABLE IF NOT EXISTS clients (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  short_name   TEXT    NOT NULL UNIQUE,
  display_name TEXT    NOT NULL,
  created_at   TEXT    NOT NULL,
  notes        TEXT
);

-- One row per (business x platform). The credentials field is a JSON blob
-- whose shape is defined by each platform's onboarding code; this keeps
-- the schema platform-agnostic while letting each platform store whatever
-- access tokens / IDs / refresh tokens it needs.
-- Example (instagram): {"page_access_token": "EAA...", "fb_page_id": "1135..."}
CREATE TABLE IF NOT EXISTS platform_accounts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id           INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  platform            TEXT    NOT NULL,
  external_account_id TEXT    NOT NULL,           -- IG business account ID, FB Page ID, TikTok user ID, etc.
  display_handle      TEXT,                       -- "@symmetry_esthetics" — optional, for operator confirmation
  credentials         TEXT    NOT NULL,           -- JSON, per-platform shape
  added_at            TEXT    NOT NULL,
  notes               TEXT,
  UNIQUE(client_id, platform, external_account_id)
);
CREATE INDEX IF NOT EXISTS idx_platform_accounts_client   ON platform_accounts(client_id);
CREATE INDEX IF NOT EXISTS idx_platform_accounts_platform ON platform_accounts(platform);

CREATE TABLE IF NOT EXISTS snapshots (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  platform_account_id    INTEGER NOT NULL REFERENCES platform_accounts(id) ON DELETE RESTRICT,
  captured_at            TEXT    NOT NULL,
  lookback_days          INTEGER NOT NULL,
  demographics_attempted INTEGER NOT NULL DEFAULT 0,
  notes                  TEXT
);
-- The idx_snapshots_platform_account index is created in src/core/db/client.ts
-- AFTER the multi-platform migration has had a chance to add the column.
-- An old-shape snapshots table (with client_id but no platform_account_id)
-- would make this index statement fail if it lived here.

-- Shared columns that every platform exposes in some form. Platform-specific
-- metrics (Instagram's reach, profile_views, website_clicks; TikTok's
-- avg_watch_time, completion_rate; etc.) live in the platform_extras JSON.
CREATE TABLE IF NOT EXISTS account_metrics (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id     INTEGER NOT NULL UNIQUE REFERENCES snapshots(id) ON DELETE RESTRICT,
  followers_count INTEGER NOT NULL,
  follows_count   INTEGER NOT NULL,
  posts_count     INTEGER NOT NULL,  -- generalizes the old IG-specific 'media_count'
  platform_extras TEXT               -- JSON blob, shape defined by each platform
);

-- Same model: shared engagement columns + platform_extras JSON for the rest.
-- external_post_id is the platform's native post identifier (was 'ig_media_id').
CREATE TABLE IF NOT EXISTS post_metrics (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id      INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE RESTRICT,
  external_post_id TEXT    NOT NULL,
  media_type       TEXT    NOT NULL,
  caption          TEXT,
  permalink        TEXT    NOT NULL,
  published_at     TEXT    NOT NULL,
  like_count       INTEGER NOT NULL,
  comments_count   INTEGER NOT NULL,
  shares           INTEGER,                          -- nullable: not all post types return shares
  views            INTEGER,                          -- nullable: missing on pre-business-conversion media; was 'video_views'
  is_supplemental  INTEGER NOT NULL DEFAULT 0,
  platform_extras  TEXT                              -- JSON: e.g. {"reach": N, "saved": N} for Instagram
);

-- Audience breakdowns per snapshot. CHECK constraints from the IG-only
-- schema are removed so other platforms can register their own audience
-- types and dimensions (e.g. TikTok's 'video_view' audience).
CREATE TABLE IF NOT EXISTS demographic_breakdowns (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id   INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE RESTRICT,
  audience_type TEXT    NOT NULL,
  dimension     TEXT    NOT NULL,
  bucket        TEXT    NOT NULL,
  value         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_demo_snapshot ON demographic_breakdowns(snapshot_id);
