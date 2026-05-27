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

export const db = conn;
