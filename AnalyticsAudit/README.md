# AnalyticsAudit

A local CLI for capturing weekly Instagram Business engagement snapshots and maintaining a rolling Markdown report plus an HTML trend report per client.

The audit pipeline pulls profile, account-level, per-post, and audience-demographic metrics from the Instagram Graph API, stores each snapshot in a local SQLite database, and regenerates a Markdown rolling report containing the last 12 snapshots (newest first), with each section showing the delta against the snapshot before it. Older snapshots fall through to a per-client archive file. A separate `report:trend` command renders an HTML view with KPI cards, audience donut charts, a sortable posts table, and a likes-per-post-across-window line chart. Run the audit weekly to build a longitudinal engagement record that survives Instagram UI changes and becomes case-study material for client work.

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

Onboard a new business and attach one or more platform_accounts. Interactive by default: prompts for business fields, then Y/N per registered platform with onboarding implemented, then per-platform credential prompts (token prompts hide keystrokes). Any field can be passed as a flag to skip its prompt.

```powershell
# Fully interactive — walks through everything
npm run client:add

# Fully scripted — Instagram + Facebook Page in one go
npm run client:add -- --name "Riccardo Moncada (rmon.dev)" --short-name rmondev `
  --platform instagram --instagram-account-id 17841... --instagram-page-id 1135... --instagram-page-token EAA... `
  --platform facebook_page --facebook-page-id 1135... --facebook-page-token EAA...
```

Per-platform flags are namespaced (`--instagram-account-id`, `--facebook-page-id`, `--tiktok-handle`, etc.) so they're unambiguous when onboarding multiple platforms in the same command. `--platform <name>` is repeatable.

`short-name` must be lowercase alphanumeric (`[a-z0-9_-]+`). It becomes the `--client` identifier on the `audit` command.

### `npm run client:platform:add -- --client <short-name>`

Attach a new platform_account to an *existing* business. Symmetric with `client:add` but scoped to one platform.

```powershell
# Add TikTok to symmetry-esthetics interactively
npm run client:platform:add -- --client symmetry-esthetics

# Add Facebook Page scripted
npm run client:platform:add -- --client symmetry-esthetics --platform facebook_page `
  --facebook-page-id 1135... --facebook-page-token EAA...
```

If the platform's audit isn't implemented yet, the platform_account row is created with a heads-up that `npm run audit` will skip it until the audit lands.

### `npm run client:list`

Tabular list of every configured business with the comma-separated list of its attached platforms and the timestamp of its last snapshot across any platform.

### `npm run token:refresh`

Refresh an expired (or about-to-expire) Page Access Token. Exchanges a short-lived User Token from the Graph API Explorer for a long-lived Page Token and stores it on the client. Prompts for the client and the user token if not passed via flags. See [docs/OPERATIONS.md#refreshing-an-expired-page-access-token](docs/OPERATIONS.md#refreshing-an-expired-page-access-token).

### `npm run report:trend -- --client <short-name>`

Renders an HTML trend report from snapshots already stored in SQLite. Does not hit the API. Runs once per configured platform on the business (use `--platform <name>` to narrow). Each invocation writes a new timestamped HTML in `reports/<client>/<platform>/trend/` and regenerates an `index.html` catalog in the same directory — the catalog is your navigation entry point. Charts are powered by Chart.js loaded from a CDN, so an internet connection is needed the first time you open the file.

```powershell
# Every configured platform
npm run report:trend -- --client rmondev

# Just one platform
npm run report:trend -- --client rmondev --platform instagram
```

### `npm run audit -- --client <short-name>`

The primary command. Iterates over every configured platform on the business and dispatches each through the platform registry. Platforms whose audit isn't implemented yet are gracefully skipped. Stores a snapshot per successful platform and regenerates that platform's Markdown report.

```powershell
# Standard weekly audit across all configured platforms
npm run audit -- --client rmondev

# One platform only
npm run audit -- --client rmondev --platform instagram

# Backfill: widen the media inclusion window (account insights stay 7-day fixed)
npm run audit -- --client rmondev --lookback-days 365
```

### `npm run db:clear`

Wipe the local analytics database. **Dry-run by default** — printing what would be deleted and exiting. Three opt-in modes, in increasing order of damage:

```powershell
# Preview only — no changes
npm run db:clear

# Wipe snapshot history (snapshots / account_metrics / post_metrics / demographic_breakdowns). Clients and tokens preserved.
npm run db:clear -- --confirm

# Wipe everything including clients. Prompts you to type 'DELETE' (uppercase) before proceeding.
npm run db:clear -- --confirm --include-clients

# Same as above but skips the prompt — for scripts only.
npm run db:clear -- --confirm --include-clients --force
```

A timestamped backup of `data/analytics.db` is written before any deletion (`data/analytics.backup.YYYYMMDD-HHMMSS.db`). Pass `--no-backup` to skip if you've already taken one.

## Where things live

| Path | Purpose |
|---|---|
| `data/analytics.db` | SQLite database (gitignored). Auto-initialized on first run. |
| `reports/<short-name>.md` | Rolling report (gitignored). Regenerated from SQLite on every audit run. Contains the last 12 snapshots, newest first. |
| `reports/<short-name>_archive.md` | Snapshots older than the rolling window (gitignored). Created on the first run that produces a 13th snapshot. |
| `reports/<short-name>_trend.html` | HTML trend report (gitignored). Overwritten by each `report:trend` run. |
| `src/core/db/schema.sql` | Schema applied idempotently on every DB connection. |
| `.env.local` | Credentials (gitignored). `.env.example` is the committed template. |
| `docs/ARCHITECTURE.md` | Current shape of the system — mental model, schema, directory layout, platform registry, and "how to add a new platform" cookbook. |
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

The schema was changed in a way the idempotent migrations in `src/core/db/client.ts` don't cover. Drop the affected table and re-run any command — the schema and migration block will recreate it with the new shape:

```powershell
npx tsx -e "import('./src/core/db/client.js').then(({ db }) => db.exec('DROP TABLE <table_name>'))"
```

## Project structure

```
AnalyticsAudit/
├── src/
│   ├── cli/                              # Entry points for `npm run <command>` — platform-agnostic orchestrators
│   │   ├── audit.ts                      # Iterate platforms, dispatch each via registry, capture snapshots
│   │   ├── client-add.ts                 # Onboard a business + N platform_accounts (interactive or scripted)
│   │   ├── client-list.ts                # Tabular list of businesses with PLATFORMS column + last_snapshot
│   │   ├── client-platform-add.ts        # Attach a new platform to an existing business
│   │   ├── db-clear.ts                   # Wipe DB (dry-run by default, gated prompts for destructive ops)
│   │   ├── report-trend.ts               # Iterate platforms, regenerate timestamped HTML + catalog per platform
│   │   └── token-refresh.ts              # Mint a fresh Page Access Token, update platform_accounts.credentials (IG-only for now)
│   ├── core/                             # Platform-agnostic guts shared by every platform
│   │   ├── db/client.ts                  # better-sqlite3 connection + schema init + idempotent migrations
│   │   ├── db/schema.sql                 # Applied idempotently per connection
│   │   ├── lib/env.ts                    # dotenv + zod env validation
│   │   ├── lib/prompt.ts                 # Hidden-input prompt for tokens
│   │   ├── lib/time.ts                   # UTC → ET presentation helpers (multiple readable formats)
│   │   └── reports/
│   │       ├── _shared.ts                # Cross-platform report helpers (hashtag extraction, country/gender expansion, ER, top-N rollup)
│   │       └── catalog.ts                # Trend report archive catalog (index.html, manifest, orphan migration)
│   └── platforms/                        # One subdirectory per supported platform
│       ├── _registry.ts                  # Central PLATFORMS map + PlatformHandle interface — CLIs dispatch here
│       ├── instagram/                    # Fully implemented (audit + reports + onboarding)
│       │   ├── api.ts                    # Graph API wrapper, retries, InstagramApiError
│       │   ├── audit.ts                  # runInstagramAudit — captures snapshot + regenerates markdown
│       │   ├── index.ts                  # PlatformHandle export bundling all of the above
│       │   ├── live-test.ts              # Live smoke test against the bootstrap account
│       │   ├── markdown-report.ts        # Markdown rolling-report builder
│       │   ├── onboarding.ts             # IG-specific onboarding prompts (registry-bound)
│       │   ├── trend-report.ts           # HTML trend report builder (Chart.js, donuts, sparklines)
│       │   └── types.ts                  # zod response schemas + MediaType + METRICS_BY_TYPE + AUDIENCE_TYPE_CONFIG
│       ├── facebook-page/                # Thin v1: profile + post inventory (engagement gated by Meta App Review)
│       │   ├── api.ts                    # Graph API wrapper, FacebookApiError
│       │   ├── audit.ts                  # runFacebookPageAudit — captures profile + posts metadata
│       │   ├── index.ts                  # PlatformHandle with capabilities.audit/reports/onboarding=true
│       │   ├── live-test.ts              # Live smoke test (dev-mode endpoints only)
│       │   ├── markdown-report.ts        # Markdown rolling report with App Review banner
│       │   ├── onboarding.ts             # Page ID + Page Token prompts
│       │   ├── probe-metrics.ts          # Diagnostic — probes which metric names survive in current Graph version
│       │   ├── trend-report.ts           # HTML trend report (3 KPI cards + sparklines + posts table)
│       │   └── types.ts                  # zod response schemas + post type resolver
│       └── tiktok/                       # Onboarding placeholder; audit + reports + OAuth pending
│           ├── index.ts                  # PlatformHandle with capabilities.onboarding=true
│           └── onboarding.ts             # Handle + paste-token prompts (OAuth flow comes with audit)
├── data/                                 # SQLite (gitignored); pre-multi-platform backup also lives here
├── reports/                              # Generated Markdown + HTML (gitignored)
├── docs/ARCHITECTURE.md                  # System architecture — mental model + schema + registry + cookbook
├── docs/OPERATIONS.md                    # Operator runbook
├── docs/NEW_CLIENT_ONBOARDING.md         # Step-by-step new-client walkthrough
├── docs/APP_REVIEW.md                    # Meta App Review process (unblocks the FB Page engagement audit)
├── .env.example                          # Committed template
├── .env.local                            # Credentials (gitignored)
└── CONTEXT.md                            # Purpose & non-goals
```

## Stack

Node 22 LTS, TypeScript (strict, NodeNext ESM, `verbatimModuleSyntax`, no build step — runs via `tsx`), better-sqlite3, dotenv, commander, zod, date-fns. No HTTP library — uses native `fetch`.

## Useful scripts

| Script | Use |
|---|---|
| `npm run typecheck` | Run `tsc --noEmit` to verify types |
| `npm run test:instagram` | Hit all four Graph API wrapper functions against the bootstrap account in `.env.local`. Useful when Meta deprecates a metric and the wrapper starts failing. |
| `npm run dev` | `tsx watch` on `audit.ts` for rmondev — re-runs on save during development |
