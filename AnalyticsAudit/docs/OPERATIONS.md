# AnalyticsAudit — Operations Runbook

Operator runbook for running weekly audits, onboarding new clients, refreshing tokens, and debugging. For setup and command reference, see [README.md](../README.md).

## Weekly audit workflow

Once a week, for each configured client:

```powershell
npm run audit -- --client <short-name>
```

What happens:

1. Loads the client's row from the `clients` table by short_name (errors loudly if not found).
2. Calls the Instagram Graph API for:
   - Profile (followers / follows / media count)
   - Account insights for the last 7 days (reach, profile views) — window is **fixed at 7 days** and not affected by `--lookback-days`.
   - Most recent ~50 media items
   - Per-post insights for media within the lookback window (default 7 days)
3. Persists in a single DB transaction: one row to `snapshots`, one to `account_metrics`, N rows to `post_metrics`.
4. Regenerates the rolling Markdown report at `reports/<short-name>.md` (the last 12 snapshots, newest first) and — if there are now more than 12 — the archive at `reports/<short-name>_archive.md` (everything older).

Both report files are rebuilt from SQLite on every audit run. Re-running the same day inserts a new snapshot row and re-renders the reports; older same-day runs become their own sections rather than being overwritten.

## How to read a report

### File layout

- `reports/<short-name>.md` — rolling report, last 12 snapshots, newest first.
- `reports/<short-name>_archive.md` — everything older than the rolling window. Created on the first audit that produces a 13th snapshot.
- `reports/<short-name>_trend.html` — HTML trend report with Chart.js visualisations (KPI sparklines, audience donuts, post evolution). Built by `npm run report:trend`, not by the audit.

### Section header (per snapshot)

```markdown
## 2026-05-26 — snapshot #5

- **Captured:** 2026-05-26 17:54:39 EDT
- **Prior:** #4 captured 2026-05-26 17:49:32 EDT (5 min earlier)
```

Each H2 is one snapshot. The "Prior" line identifies the snapshot it's compared against (the next-older one in the rolling window, or — for the oldest entry — the most recent archived snapshot, so deltas stay meaningful at the window boundary). Timestamps are Eastern Time.

For a client's very first snapshot, "Prior" reads `(none — first snapshot for this client)` and the Change column is `—` throughout.

### Account subsection

Five rows: followers, following, total media (cumulative count from Instagram), reach (rolling 7-day total), profile views (rolling 7-day total).

Change column conventions:

| Display | Meaning |
|---|---|
| `0 (—)` | Unchanged from prior snapshot |
| `+5 (+9.8%)` | Positive change with percent |
| `-3 (-5.9%)` | Negative change with percent |
| `+12 (—)` | Change exists but prior was 0 (percent is undefined) |
| `—` | No prior snapshot |

### Posts subsection

- "This snapshot: N post(s)" — posts that fell into the lookback window.
- "Prior snapshot (#K): M post(s)" — count from the prior snapshot for context.
- "N post(s) returned no insights" — Graph API rejected post insights for N media. Usually the [insights gap](#insights-gap--pre-business-conversion-media) below.
- Table: one row per post in the current snapshot. Dashes (`—`) in metric columns mean Instagram didn't return data for that metric.

If the lookback window contains no posts, the table is omitted entirely (just the count summary appears).

## HTML trend report

```powershell
npm run report:trend -- --client <short-name>
```

Renders `reports/<short-name>_trend.html` from snapshots already stored in SQLite. Does not hit the Graph API. Open the file in a browser; charts are rendered by Chart.js loaded from a CDN, so an internet connection is needed the first time.

Headline comparison is the **latest snapshot vs the one before it**. The last 4 snapshots provide trend context.

What's in the HTML:
- **Account KPI cards** — followers, following, total media, reach (7d), profile views (7d). Each card shows: current value, delta + %change vs prior snapshot, and a sparkline across the 4-snapshot window.
- **Audience donuts** — pie/donut charts for follower demographics (age, gender, top countries, top cities) and engaged-audience demographics. Country and city use a top-5 + "Other" rollup because Meta returns ~45 buckets each. Engaged demographics often show an empty-state message — Meta only releases breakdowns when there are ≥~100 unique engagers in the timeframe.
- **Posts table** — the latest snapshot's posts, with `†` markers for supplemental posts (pulled in from before the lookback window so the table is never empty) and a "no insights" note for media that pre-dates the Business conversion.
- **Likes per post chart** — line chart, each unique post seen across the window is a series, showing how its like count evolved snapshot-by-snapshot. Omitted if the window has fewer than 2 snapshots or no posts were tracked.

Window-selection rule: `LIMIT 4 ORDER BY id DESC` — the most recent 4 snapshots regardless of when they were captured. With fewer than 2, comparisons and trends gracefully degrade ("trend needs ≥2 snapshots", "no prior snapshot yet — comparisons unavailable").

## Refreshing an expired Page Access Token

The audit fails with:

```
InstagramApiError: Session has expired on Tuesday, 26-May-26 13:00:00 PDT
  httpStatus: 400, apiCode: 190
```

### Important: short-lived vs long-lived tokens

The Graph API Explorer's "User or Page" → Page shortcut yields a Page Token whose longevity is inherited from the underlying User Token. The default User Token in the Explorer is **short-lived** (1-2 hours typical, sometimes less). To get a true ~60-day Page Token you must exchange the short-lived User Token for a long-lived User Token first, then derive the Page Token from that.

`npm run token:refresh` does the full exchange in one command.

### Procedure

1. Open the [Graph API Explorer](https://developers.facebook.com/tools/explorer/).
2. Select your Meta App from the dropdown (top-right).
3. Ensure "User or Page" shows **User Token** (do NOT switch to Page — the script handles that).
4. Click **Generate Access Token**. Copy the token.
5. In the project:

```powershell
npm run token:refresh
```

You'll be asked:
- Which client to refresh (auto-selected if only one exists)
- Paste the User Token (hidden input)
- Whether to also update `META_PAGE_ACCESS_TOKEN` in `.env.local` (default Y for rmondev, N for others — only matters for the bootstrap client used by `npm run test:instagram`)

The script does the short→long User Token exchange, derives the Page Token, inspects it via `/debug_token` (printing `is_valid`, `type`, and `expires_at` in ET), updates `clients.page_access_token`, and optionally rewrites `.env.local`.

For fully scripted use, pass `--client`, `--user-token`, and `--update-env`:

```powershell
npm run token:refresh -- --client rmondev --user-token "EAASYx..." --update-env
```

6. Re-run `npm run audit -- --client <short-name>` to confirm.

### Token expiry details

Page Tokens derived from long-lived User Tokens have no explicit expiration (`expires_at=0` in `/debug_token`). They remain valid as long as the underlying long-lived User Token does (~60 days, renewable by repeating the exchange flow). If `token:refresh` prints `expires_at=<a soon timestamp>` instead of "never", the input you pasted was already a Page Token or some other short-lived artifact rather than a fresh User Token — re-mint per step 3 above.

## New client onboarding (end-to-end)

> For a step-by-step Graph Explorer walkthrough (with screenshots-equivalent UI guidance and response shapes), see [NEW_CLIENT_ONBOARDING.md](NEW_CLIENT_ONBOARDING.md). The section below is the condensed reference once the flow is familiar.

### Gather

- Facebook Page ID (numeric)
- Instagram Business Account ID (numeric, distinct from the Page ID)
- A Page Access Token minted from their Page (Graph API Explorer, your app)
- **Critical:** the date the Instagram account was converted from Personal to Business. Anything posted before that date is insights-blind forever — see the [insights gap](#insights-gap--pre-business-conversion-media) below.

### Find the IDs via Graph API Explorer

With a User Token that has access to the client's Page:

```
GET /me/accounts                              → lists Pages; copy the `id` of the right one
GET /<page-id>?fields=instagram_business_account  → returns the IG Business account ID under `instagram_business_account.id`
```

### Add the client

```powershell
npm run client:add
```

Prompts interactively. The token prompt hides keystrokes — paste once, hit Enter. The `short-name` must be lowercase alphanumeric (`[a-z0-9_-]+`); it becomes the `--client` identifier on the audit command. Pick something memorable.

### Run the first audit

```powershell
npm run audit -- --client <short-name>
```

If you want to backfill historical posts in the first audit (within Instagram's ~2-year insights retention and only for posts made post-Business-conversion):

```powershell
npm run audit -- --client <short-name> --lookback-days 365
```

Account insights stay on a fixed 7-day window regardless of `--lookback-days`.

## Insights gap — pre-business-conversion media

Instagram only returns insights for posts made **after** the most recent personal → Business conversion of an account. Posts made before that date always return:

```
HTTP 400, code 100, error_subcode 2108006
error_user_msg: "The media was posted before the most recent time that the user's account was converted to a business account from a personal account."
```

### Effect on the data

The audit handles this gracefully:

- A `post_metrics` row is inserted for each pre-conversion post.
- `like_count` and `comments_count` come from the `/media` endpoint (these still work) and are populated.
- `reach`, `saved`, `shares`, `video_views` are all set to `NULL`.
- The report Posts section calls this out: *"N post(s) in this snapshot returned no insights (likely pre-business-conversion media)"*.

### Workaround

None. The only fix is for the account to post new content while it's a Business account — those posts will return insights normally.

When onboarding, always ask when the account was converted to Business. If a meaningful chunk of their content predates the conversion, set expectations: those posts will never have insights, only future content will.

## Where to look when things fail

| Symptom | Cause + fix |
|---|---|
| `Session has expired` (code 190) | Token expired. See [Refreshing an expired Page Access Token](#refreshing-an-expired-page-access-token). |
| `Invalid parameter (code 100)`, `error_subcode 2108006` on media insights | Pre-conversion media. See [Insights gap](#insights-gap--pre-business-conversion-media). |
| `(#10) Insufficient permissions to access this data` | Token doesn't have `instagram_manage_insights` or `pages_read_engagement`. Re-mint in Explorer ensuring the right scopes are attached to the configuration. |
| `(#100) since param is not valid. Metrics data is available for the last 2 years` | Account insights window exceeded Graph's 2-year cap. Account insights are fixed at 7d so you shouldn't see this in normal operation — if you do, check for accidental edits to `ACCOUNT_INSIGHTS_WINDOW_DAYS` in `src/cli/audit.ts`. |
| `No client with short_name '...'` | Run `npm run client:list`. If the client isn't there, add it with `npm run client:add`. |
| Audit hangs on a prompt | `client:add` was run with missing required flags. Provide all five (`--name`, `--short-name`, `--ig-account-id`, `--page-id`, `--page-token`) for fully scripted use. |
| `NOT NULL constraint failed: ...` after a schema change | SQLite's `CREATE TABLE IF NOT EXISTS` doesn't migrate. Drop the affected table and re-run; `src/db/client.ts` will recreate it with the new shape: `npx tsx -e "import('./src/db/client.js').then(({db}) => db.exec('DROP TABLE <table>'))"`. **Verify the table is empty or backed up first** — DROP is destructive. |
| `TypeError` / unexpected null from wrapper | Meta may have changed a response shape. Run `npm run test:instagram` to probe the wrapper end-to-end against the bootstrap account. The output should match the four-section successful run in [src/api/instagram.live-test.ts](../src/api/instagram.live-test.ts). |
| Hard-to-diagnose Graph error | The wrapper's `InstagramApiError` carries `httpStatus`, `apiCode`, and `fbtraceId`. Quote the `fbtraceId` to Meta support if needed — it's their request ID for that call. |

## Database

- **Location:** `data/analytics.db` (single file, gitignored)
- **Schema:** `src/db/schema.sql`, applied idempotently on every connection
- **Foreign keys:** enabled per-connection (SQLite's default is off — see `src/db/client.ts`)
- **Migrations:** none. Schema changes in v0 require manual `DROP TABLE` for the affected table.

### Inspecting the DB

```powershell
# All snapshots
npx tsx -e "import('./src/db/client.js').then(({ db }) => console.table(db.prepare('SELECT id, client_id, captured_at FROM snapshots ORDER BY id').all()))"

# Latest account metrics per snapshot, joined with client name
npx tsx -e "import('./src/db/client.js').then(({ db }) => console.table(db.prepare('SELECT c.short_name, s.id AS snap_id, s.captured_at, a.followers_count, a.follows_count, a.media_count, a.reach, a.profile_views FROM account_metrics a JOIN snapshots s ON s.id = a.snapshot_id JOIN clients c ON c.id = s.client_id ORDER BY s.id DESC LIMIT 20').all()))"

# Post metrics counts per snapshot
npx tsx -e "import('./src/db/client.js').then(({ db }) => console.table(db.prepare('SELECT snapshot_id, COUNT(*) AS posts, SUM(CASE WHEN reach IS NULL THEN 1 ELSE 0 END) AS no_insights FROM post_metrics GROUP BY snapshot_id ORDER BY snapshot_id').all()))"
```

When passing SQL through `tsx -e` from PowerShell, keep all JS strings single-quoted to avoid PowerShell expanding `*` in `COUNT(*)`.

### Backups

The DB is a single file. Take a backup before any schema change or destructive operation:

```powershell
Copy-Item data\analytics.db "data\analytics.backup.$(Get-Date -Format yyyyMMdd-HHmm).db"
```

A weekly backup before the Sunday audit run is reasonable insurance. To restore: stop any process touching the DB and copy the backup back to `data/analytics.db`.

## Token storage

Per-client Page Access Tokens live in `clients.page_access_token` as plain text. The database is local; this is acceptable for v0 single-user CLI use. The DB file is in `.gitignore` and must not be committed.

## Diagnostics

`npm run test:instagram` runs `src/api/instagram.live-test.ts`, which hits all four wrapper functions against the bootstrap account in `.env.local`. Use it when:

- A wrapper function suddenly starts failing and you suspect Meta changed a response shape
- Verifying a freshly minted bootstrap token works
- Sanity-checking the wrapper after dependency upgrades

Expected output: profile counts, account insights (likely 0/0 for low-activity accounts), 5 most recent media with id/type/timestamp/caption, per-media insights for the first 3 (returns `null` for pre-conversion media).
