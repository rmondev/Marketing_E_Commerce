# AnalyticsAudit — Purpose & Non-Goals

For setup, commands, and file layout see [README.md](README.md). For the operator runbook see [docs/OPERATIONS.md](docs/OPERATIONS.md). This doc captures the *why* and the deliberate boundaries — things that aren't obvious from reading the code.

## Why this exists

Instagram's native insights UI is read-only, fades old data, and gives no longitudinal record. AnalyticsAudit takes weekly snapshots of an Instagram Business account's engagement metrics, stores them in a local SQLite database, and generates comparison reports. Over months this builds the evidence base that proves content strategies are working for clients — case study material for pitches, and a record that survives Instagram UI changes.

## Who it's for

A solo digital marketing operator running it locally for their own client roster. Multi-client from day one (rmon.dev is client 0; Symmetry Esthetics is client 1), but single-user, single-machine.

## Non-goals (deliberate)

These are choices, not omissions — bringing any of them in changes what AnalyticsAudit is.

- **No web UI.** CLI only. Reports are static files (Markdown for the rolling report, HTML for the trend report).
- **No multi-user / no auth layer.** The DB is local; per-platform credentials (Page Access Tokens, etc.) are stored plaintext in `platform_accounts.credentials` JSON. Acceptable for a local single-operator tool; would have to change for any hosted/shared model.
- **No in-app OAuth.** Page Access Tokens are minted manually via the Graph API Explorer and refreshed via `npm run token:refresh`. Adding an OAuth flow adds a server, a redirect URI, and Meta app review — all out of scope.
- **No scheduling.** The operator runs the audit when they run it. No cron, no background worker.
- **No VM / hosted deployment.** Pure local Node CLI. (Per project memory: strip any VM-migration language that creeps in.)
- **No general schema migration system in v0.** `src/core/db/client.ts` runs an idempotent migration block on every connection. Today it covers small column additions (lookback_days, is_supplemental, demographics_attempted) plus the Phase B multi-platform reshape (clients → business + platform_accounts, IG-specific columns moved into platform_extras JSON). It uses `ALTER TABLE ADD/DROP/RENAME COLUMN` (SQLite 3.35+) and one 12-step table rebuild for the demographic_breakdowns CHECK relaxation. Anything beyond what's already covered still needs a manual `DROP TABLE` per the runbook. A full migration framework (numbered files, versioned state, down-migrations) is deferred until schema actually starts churning faster than we can hand-write each step.

## When to revisit this doc

When any of the non-goals stop being true (e.g., adding a second operator, hosting it remotely, switching off SQLite), update this doc *before* the code so the next reader understands the new boundary.
