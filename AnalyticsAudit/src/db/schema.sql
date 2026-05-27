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
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id    INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  captured_at  TEXT    NOT NULL,
  notes        TEXT
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
  video_views     INTEGER          -- nullable: VIDEO/REELS only
);
