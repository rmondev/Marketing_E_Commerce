# AnalyticsAudit

A local CLI for capturing weekly Instagram Business engagement snapshots and maintaining a rolling Markdown report per client.

The audit pipeline pulls profile, account-level, and per-post metrics from the Instagram Graph API, stores each snapshot in a local SQLite database, and regenerates a Markdown report containing the last 12 snapshots (newest first), with each section also showing the delta against the snapshot before it. Older snapshots fall through to a per-client archive file. Run it weekly to build a longitudinal engagement record that survives Instagram UI changes and becomes case-study material for client work.

v0 is a local single-user CLI. Supports multiple clients from day one. No web UI, no scheduling, no in-app OAuth.

## Prerequisites

- **Node 22 LTS or later**
- **An Instagram Business Account.** Note: insights only work for posts made *after* the personal → Business conversion. See [Insights gap](docs/OPERATIONS.md#insights-gap--pre-business-conversion-media) in the runbook.
- **A Meta Developer app** with these permissions ready for testing: `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement`, `pages_show_list`, `business_management`.
- **A Page Access Token** minted via the [Graph API Explorer](https://developers.facebook.com/tools/explorer/) for the Facebook Page connected to the Instagram account. Tokens expire ~60 days; see [Refreshing an expired Page Access Token](docs/OPERATIONS.md#refreshing-an-expired-page-access-token).

## Setup

```powershell
# Install dependencies
npm install

# Copy the env template, then edit .env.local with real values
cp .env.example .env.local
```

`.env.local` is gitignored. It holds:

| Variable | Source |
|---|---|
| `META_APP_ID`, `META_APP_SECRET` | Meta App Dashboard → App settings → Basic |
| `META_PAGE_ID` | The Facebook Page that owns the Instagram Business account |
| `META_INSTAGRAM_BUSINESS_ACCT_ID` | The IG Business account ID (distinct from the Page ID) |
| `META_PAGE_ACCESS_TOKEN` | Bootstrap token from Graph API Explorer — used only to seed the first client and run live API smoke tests. Per-client tokens then live in the `clients` table. |
| `META_CONFIG_ID` | Reference only, not read at runtime |

## Commands

### `npm run client:add`

Add a client. Prompts interactively for each field (token prompt hides keystrokes). Pass any value via CLI flag to skip its prompt:

```powershell
# Interactive
npm run client:add

# Fully scripted
npm run client:add -- --name "Riccardo Moncada (rmon.dev)" --short-name rmondev `
  --ig-account-id 17841... --page-id 1135... --page-token EAA...
```

`short-name` must be lowercase alphanumeric (`[a-z0-9_-]+`). It becomes the `--client` identifier on the `audit` command.

### `npm run client:list`

Tabular list of every configured client with the timestamp of its last snapshot.

### `npm run token:refresh`

Refresh an expired (or about-to-expire) Page Access Token. Exchanges a short-lived User Token from the Graph API Explorer for a long-lived Page Token and stores it on the client. Prompts for the client and the user token if not passed via flags. See [docs/OPERATIONS.md#refreshing-an-expired-page-access-token](docs/OPERATIONS.md#refreshing-an-expired-page-access-token).

### `npm run report:monthly -- --client <short-name>`

Renders an HTML monthly comparison report from the last 4 snapshots already stored in SQLite. Does not hit the API. Output is `reports/<short-name>_monthly.html` — open it in a browser. Charts are powered by Chart.js loaded from a CDN, so an internet connection is needed the first time you open the file.

```powershell
npm run report:monthly -- --client rmondev
```

This is the testing-phase windowing model (most recent 4 snapshots regardless of date). It will move to calendar-month + ISO-week selection later.

### `npm run audit -- --client <short-name>`

The primary command. Fetches live data, stores a snapshot in the database, generates a Markdown report.

```powershell
# Standard weekly audit
npm run audit -- --client rmondev

# Backfill: widen the media inclusion window (account insights stay 7-day fixed)
npm run audit -- --client rmondev --lookback-days 365
```

## Where things live

| Path | Purpose |
|---|---|
| `data/analytics.db` | SQLite database (gitignored). Auto-initialized on first run. |
| `reports/<short-name>.md` | Rolling report (gitignored). Regenerated from SQLite on every audit run. Contains the last 12 snapshots, newest first. |
| `reports/<short-name>_archive.md` | Snapshots older than the rolling window (gitignored). Created on the first run that produces a 13th snapshot. |
| `reports/<short-name>_monthly.html` | Monthly HTML comparison report (gitignored). Overwritten by each `report:monthly` run. |
| `src/db/schema.sql` | Schema applied idempotently on every DB connection. |
| `.env.local` | Credentials (gitignored). `.env.example` is the committed template. |
| `docs/OPERATIONS.md` | Operator runbook — weekly workflow, token refresh, onboarding, debugging. |
| `docs/NEW_CLIENT_ONBOARDING.md` | Step-by-step walkthrough for adding a new client (Graph Explorer UI flow). |
| `CONTEXT.md` | Purpose statement + non-goals. The *why* and the deliberate boundaries. |

## Common errors

### `Session has expired on ...` (code 190)

Your Page Access Token has aged out. Mint a fresh User Token in the Graph API Explorer and run `npm run token:refresh` — it does the short→long exchange and stores the new Page Token. Full procedure: [docs/OPERATIONS.md#refreshing-an-expired-page-access-token](docs/OPERATIONS.md#refreshing-an-expired-page-access-token).

### `(#100) Invalid parameter` on media insights, `error_subcode=2108006`

The media was posted before the Instagram account was converted from personal to Business. Instagram won't release insights for pre-conversion media. The audit handles this gracefully (logs, stores NULL insights, continues). Details: [docs/OPERATIONS.md#insights-gap--pre-business-conversion-media](docs/OPERATIONS.md#insights-gap--pre-business-conversion-media).

### `No client with short_name '...'`

Run `npm run client:list` to see what's configured. If the client isn't there, add it with `npm run client:add`.

### `NOT NULL constraint failed: ...`

The schema was changed without dropping the existing table. SQLite's `CREATE TABLE IF NOT EXISTS` doesn't migrate. Drop the affected table and re-run any command — `src/db/client.ts` will re-apply the schema with the new shape:

```powershell
npx tsx -e "import('./src/db/client.js').then(({ db }) => db.exec('DROP TABLE <table_name>'))"
```

## Project structure

```
AnalyticsAudit/
├── src/
│   ├── api/instagram.ts            # Graph API wrapper, retries, InstagramApiError
│   ├── api/instagram.live-test.ts  # Live smoke test against the bootstrap account
│   ├── cli/audit.ts                # Primary command — fetch, persist, report
│   ├── cli/client-add.ts           # Interactive client onboarding
│   ├── cli/client-list.ts          # Tabular list
│   ├── cli/report-monthly.ts       # Render monthly HTML report from existing snapshots
│   ├── db/client.ts                # better-sqlite3 connection + schema init
│   ├── db/schema.sql               # Applied idempotently per connection
│   ├── lib/env.ts                  # dotenv + zod env validation
│   ├── lib/time.ts                 # UTC → ET presentation helpers
│   ├── reports/generator.ts        # Markdown rolling-report builder
│   ├── reports/monthly-generator.ts # HTML monthly comparison builder (Chart.js)
│   └── types/instagram.ts          # zod response schemas + MediaType + METRICS_BY_TYPE
├── data/                           # SQLite (gitignored)
├── reports/                        # Generated Markdown (gitignored)
├── docs/OPERATIONS.md              # Operator runbook
├── docs/NEW_CLIENT_ONBOARDING.md   # Step-by-step new-client walkthrough
├── .env.example                    # Committed template
├── .env.local                      # Credentials (gitignored)
└── CONTEXT.md                      # Purpose & non-goals
```

## Stack

Node 22 LTS, TypeScript (strict, NodeNext ESM, `verbatimModuleSyntax`, no build step — runs via `tsx`), better-sqlite3, dotenv, commander, zod, date-fns. No HTTP library — uses native `fetch`.

## Useful scripts

| Script | Use |
|---|---|
| `npm run typecheck` | Run `tsc --noEmit` to verify types |
| `npm run test:instagram` | Hit all four Graph API wrapper functions against the bootstrap account in `.env.local`. Useful when Meta deprecates a metric and the wrapper starts failing. |
| `npm run dev` | `tsx watch` on `audit.ts` for rmondev — re-runs on save during development |
