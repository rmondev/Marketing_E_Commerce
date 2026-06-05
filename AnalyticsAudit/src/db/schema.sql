-- AnalyticsAudit SQLite schema
-- Applied idempotently on every db connection open via src/db/client.ts.
-- Timestamps are stored as ISO 8601 strings, written by app code.

CREATE TABLE IF NOT EXISTS clients (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  short_name               TEXT    NOT NULL UNIQUE,
  display_name             TEXT    NOT NULL,
  ig_business_account_id   TEXT    NOT NULL,
  fb_page_id               TEXT    NOT NULL,
  page_access_token        TEXT    NOT NULL,
  created_at               TEXT    NOT NULL,
  notes                    TEXT
);

CREATE TABLE IF NOT EXISTS snapshots (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id              INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  captured_at            TEXT    NOT NULL,
  lookback_days          INTEGER NOT NULL,
  demographics_attempted INTEGER NOT NULL DEFAULT 0,   -- 1 = audit tried to fetch audience demographics; 0 = pre-feature snapshot. Lets the report distinguish "Meta withheld" from "audit didn't ask".
  notes                  TEXT
);

CREATE TABLE IF NOT EXISTS account_metrics (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id     INTEGER NOT NULL UNIQUE REFERENCES snapshots(id) ON DELETE RESTRICT,
  followers_count INTEGER NOT NULL,
  follows_count   INTEGER NOT NULL,
  media_count     INTEGER NOT NULL,
  reach           INTEGER NOT NULL,
  profile_views   INTEGER NOT NULL,
  website_clicks  INTEGER          -- nullable: not available on all accounts
);

CREATE TABLE IF NOT EXISTS post_metrics (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id     INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE RESTRICT,
  ig_media_id     TEXT    NOT NULL,
  media_type      TEXT    NOT NULL,
  caption         TEXT,            -- nullable: posts can have no caption
  permalink       TEXT    NOT NULL,
  published_at    TEXT    NOT NULL,
  like_count      INTEGER NOT NULL,
  comments_count  INTEGER NOT NULL,
  reach           INTEGER,         -- nullable: missing when /insights rejects the query (e.g. pre-business-conversion media)
  saved           INTEGER,         -- nullable: same reason as reach
  shares          INTEGER,         -- nullable: not available on all media types
  video_views     INTEGER,         -- nullable: VIDEO/REELS only
  is_supplemental INTEGER NOT NULL DEFAULT 0   -- 1 = captured to fill the Posts table beyond the lookback window
);

-- Lifetime audience breakdowns per snapshot, one row per (audience_type, dimension, bucket).
-- audience_type:  'follower' (everyone following) | 'engaged' (engaged-audience-weighted)
-- dimension:      'age' | 'gender' | 'country' | 'city'
-- bucket:         e.g. '25-34', 'F', 'US', 'New York, NY'  (raw value returned by Meta)
-- value:          count returned by Meta for that bucket
-- Stored unfiltered — Top-N + Other rollup is a presentation concern in the report generator.
CREATE TABLE IF NOT EXISTS demographic_breakdowns (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id   INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE RESTRICT,
  audience_type TEXT    NOT NULL CHECK (audience_type IN ('follower', 'engaged')),
  dimension     TEXT    NOT NULL CHECK (dimension IN ('age', 'gender', 'country', 'city')),
  bucket        TEXT    NOT NULL,
  value         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_demo_snapshot
  ON demographic_breakdowns(snapshot_id);
