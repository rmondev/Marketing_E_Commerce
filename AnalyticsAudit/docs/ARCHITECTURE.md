# AnalyticsAudit — Architecture

This doc describes the current shape of AnalyticsAudit: the mental model, the database schema, the directory layout, the platform registry, the reports tree, and a worked "how to add a new platform" walkthrough.

For setup and CLI usage see [README.md](../README.md). For the operator runbook see [OPERATIONS.md](OPERATIONS.md). For onboarding a new business end-to-end see [NEW_CLIENT_ONBOARDING.md](NEW_CLIENT_ONBOARDING.md). For why decisions were made the way they were see [CONTEXT.md](../CONTEXT.md).

---

## 1. Mental model

```
┌───────────────────────────────────────────────────────────────┐
│  client (business)                                            │
│  ───────────────────                                          │
│  rmondev, symmetry-esthetics                                  │
│                                                                │
│      owns one or more                                          │
│      ▼                                                         │
│  ┌─────────────────────────────────────────────────────┐      │
│  │ platform_account                                     │      │
│  │ ─────────────────                                    │      │
│  │ (instagram, facebook_page, tiktok, …)                │      │
│  │ external_account_id + credentials JSON               │      │
│  │                                                       │      │
│  │      every audit captures                             │      │
│  │      ▼                                                │      │
│  │  ┌─────────────────────────────────────────────┐    │      │
│  │  │ snapshot                                     │    │      │
│  │  │ ─────────                                    │    │      │
│  │  │ one row per (platform_account, captured_at)  │    │      │
│  │  │                                               │    │      │
│  │  │  has children:                                │    │      │
│  │  │   • 1 account_metrics row                     │    │      │
│  │  │   • N post_metrics rows                       │    │      │
│  │  │   • N demographic_breakdowns rows             │    │      │
│  │  └─────────────────────────────────────────────┘    │      │
│  └─────────────────────────────────────────────────────┘      │
└───────────────────────────────────────────────────────────────┘
```

The single most important shift to internalise: **a "client" is a business, not a single-platform account**. Symmetry Esthetics is one row in `clients`. Symmetry's Instagram presence is one row in `platform_accounts`. When (not if) Symmetry also runs a Facebook Page, that's a second row in `platform_accounts` for the same business — same `clients.id`, different `platform_accounts.id`.

Every audit captures one snapshot per platform_account. The audit CLI loops over all of a business's configured platform_accounts and dispatches each through the [platform registry](#4-the-platform-registry).

---

## 2. Database schema

Live schema: [src/core/db/schema.sql](../src/core/db/schema.sql). Migrations: [src/core/db/client.ts](../src/core/db/client.ts) (idempotent, runs on every connection).

### Top-level model

```
clients ─┐
         │
         │ (1 : N)
         ▼
   platform_accounts ─┐
                      │
                      │ (1 : N)
                      ▼
                 snapshots ─┬── (1 : 1) ──→ account_metrics
                            ├── (1 : N) ──→ post_metrics
                            └── (1 : N) ──→ demographic_breakdowns
```

### `clients` — business-level

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `short_name` | TEXT UNIQUE | The CLI identifier (e.g. `symmetry-esthetics`) |
| `display_name` | TEXT | "Symmetry Esthetics" |
| `created_at` | TEXT (ISO) | |
| `notes` | TEXT | Free-form |

No platform-specific fields here. They were dropped in Phase B.

### `platform_accounts` — per (business × platform)

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `client_id` | INTEGER FK → clients.id | |
| `platform` | TEXT | `'instagram'`, `'facebook_page'`, `'tiktok'`, … |
| `external_account_id` | TEXT | IG biz account ID, FB Page ID, TikTok user ID, etc. |
| `display_handle` | TEXT | Optional `@username` |
| `credentials` | TEXT (JSON) | Per-platform shape; see below |
| `added_at` | TEXT (ISO) | |
| `notes` | TEXT | |

UNIQUE constraint on `(client_id, platform, external_account_id)`.

**`credentials` JSON shape per platform** — defined by each platform's onboarding code:

```json
// Instagram
{ "page_access_token": "EAA...", "fb_page_id": "1135767..." }

// Facebook Page (future)
{ "page_access_token": "EAA...", "page_id": "1135767..." }

// TikTok (future)
{ "access_token": "...", "refresh_token": "...", "expires_at": "..." }
```

Each platform's audit code knows how to parse its own shape. Cross-platform code never has to know.

### `snapshots` — one per audit run

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `platform_account_id` | INTEGER FK → platform_accounts.id | NOT a direct FK to clients |
| `captured_at` | TEXT (ISO UTC) | |
| `lookback_days` | INTEGER | Media inclusion window for this audit |
| `demographics_attempted` | INTEGER (0/1) | Whether the audit tried to fetch demographics |
| `notes` | TEXT | |

### `account_metrics` — shared columns + platform extras

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `snapshot_id` | INTEGER FK → snapshots.id, UNIQUE | |
| `followers_count` | INTEGER NOT NULL | |
| `follows_count` | INTEGER NOT NULL | |
| `posts_count` | INTEGER NOT NULL | Generalises the old IG-specific `media_count` |
| `platform_extras` | TEXT (JSON) | Platform-specific; nullable for fresh DBs |

`platform_extras` JSON shapes:
- **Instagram**: `{"reach": N, "profile_views": N, "website_clicks": N|null}`
- **Future TikTok**: `{"total_video_views": N, "average_watch_time_seconds": N, ...}`

### `post_metrics` — shared columns + platform extras

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `snapshot_id` | INTEGER FK → snapshots.id | |
| `external_post_id` | TEXT NOT NULL | The platform's native ID (was `ig_media_id`) |
| `media_type` | TEXT NOT NULL | `IMAGE`, `VIDEO`, `REELS`, `CAROUSEL_ALBUM` for IG |
| `caption` | TEXT | Full caption; reports extract hashtags from it |
| `permalink` | TEXT NOT NULL | |
| `published_at` | TEXT NOT NULL | |
| `like_count` | INTEGER NOT NULL | |
| `comments_count` | INTEGER NOT NULL | |
| `shares` | INTEGER | Nullable: not all post types return shares |
| `views` | INTEGER | Nullable: pre-business-conversion media (was `video_views`) |
| `is_supplemental` | INTEGER NOT NULL DEFAULT 0 | 1 = older post pulled in to fill the report |
| `platform_extras` | TEXT (JSON) | |

`platform_extras` JSON shapes:
- **Instagram**: `{"reach": N|null, "saved": N|null}`
- **Future TikTok**: `{"completion_rate": N, "average_watch_time_seconds": N, ...}`

### `demographic_breakdowns`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `snapshot_id` | INTEGER FK → snapshots.id | |
| `audience_type` | TEXT NOT NULL | `'follower'`, `'engaged'` for IG; relaxed CHECK so other platforms can register their own |
| `dimension` | TEXT NOT NULL | `'age'`, `'gender'`, `'country'`, `'city'` for IG; relaxed CHECK |
| `bucket` | TEXT NOT NULL | Raw value returned by the platform (e.g. `'25-34'`, `'F'`, `'US'`) |
| `value` | INTEGER NOT NULL | Count Meta returned for that bucket |

Stored unfiltered. Top-N + "Other" rollup is a presentation concern in the report generator.

---

## 3. Directory layout

```
src/
├── cli/                                      Entry points for `npm run <command>` — platform-agnostic orchestrators
│   ├── audit.ts                              Iterates over a client's platforms, dispatches each via the registry
│   ├── client-add.ts                         Interactive business + IG platform_account onboarding
│   ├── client-list.ts                        Tabular list of businesses with last_snapshot
│   ├── db-clear.ts                           Wipe DB (dry-run by default, gated prompts for destructive ops)
│   ├── report-trend.ts                       Iterates platforms, dispatches each generateTrendReport
│   └── token-refresh.ts                      IG-specific token refresh (currently not dispatched via registry — future cleanup)
├── core/                                     Platform-agnostic guts shared by every platform
│   ├── db/
│   │   ├── client.ts                         better-sqlite3 connection, schema apply, idempotent migrations
│   │   └── schema.sql                        Source of truth for the data model
│   ├── lib/
│   │   ├── env.ts                            dotenv + zod env validation
│   │   ├── prompt.ts                         Hidden-input prompt for tokens (askMasked)
│   │   └── time.ts                           ET formatting helpers (compact, readable, filename-safe, long)
│   └── reports/
│       ├── _shared.ts                        Hashtag extraction, country/gender expansion, ER calc, top-N rollup
│       └── catalog.ts                        Archive catalog (index.html), manifest, orphan migration
└── platforms/                                One subdirectory per supported platform
    ├── _registry.ts                          PLATFORMS map + PlatformHandle interface — central dispatch
    ├── instagram/                            Fully implemented
    │   ├── api.ts                            Graph API wrapper, retries, InstagramApiError
    │   ├── audit.ts                          runInstagramAudit — captures snapshot + regenerates markdown
    │   ├── index.ts                          PlatformHandle export bundling all of the above
    │   ├── live-test.ts                      Live smoke test against the bootstrap account
    │   ├── markdown-report.ts                Rolling Markdown report generator
    │   ├── trend-report.ts                   HTML trend report generator
    │   └── types.ts                          zod response schemas + MediaType + METRICS_BY_TYPE + AUDIENCE_TYPE_CONFIG
    ├── facebook-page/                        Scaffolded; isImplemented=false
    │   └── index.ts                          Stub PlatformHandle (all functions throw notImplemented)
    └── tiktok/                               Scaffolded; isImplemented=false
        └── index.ts                          Stub PlatformHandle (all functions throw notImplemented)
```

The split is deliberate:
- **`cli/`** knows what npm scripts exist and how to parse arguments. It doesn't know what Instagram is.
- **`core/`** knows about the database, time formatting, hashtag regex, and the report catalog. It doesn't know about specific platforms.
- **`platforms/<name>/`** knows about one platform's API, types, and metric vocabulary. It doesn't know about other platforms.

---

## 4. The platform registry

[src/platforms/_registry.ts](../src/platforms/_registry.ts) is the central dispatch table:

```ts
export const PLATFORMS: Record<string, PlatformHandle> = {
  instagram: instagramPlatform,           // isImplemented: true
  facebook_page: facebookPagePlatform,    // isImplemented: false
  tiktok: tiktokPlatform,                 // isImplemented: false
};
```

Every CLI that talks to a platform looks it up here:

```ts
const handle = PLATFORMS[pa.platform];
if (!handle) {
  console.log(`Unknown platform '${pa.platform}' — skipping.`);
} else if (!handle.isImplemented) {
  console.log(`${handle.displayName} not yet implemented — skipping.`);
} else {
  const result = await handle.audit({ platformAccount: pa, client, lookbackDays });
}
```

### The `PlatformHandle` interface

```ts
export type PlatformHandle = {
  name: string;                       // Matches platform_accounts.platform (snake_case)
  displayName: string;                // Human-readable: "Instagram", "Facebook Page"
  isImplemented: boolean;             // CLI checks this before calling the function fields
  audit: (input: PlatformAuditInput) => Promise<PlatformAuditResult>;
  generateMarkdownReport: (client: ClientRef) => GenerateReportResult;
  generateTrendReport: (client: ClientRef) => GenerateTrendResult | null;
  tokenRefresh: (input: PlatformTokenRefreshInput) => Promise<PlatformTokenRefreshResult>;
};
```

For unimplemented platforms, the function fields throw `notImplemented(platform, what)` immediately if called — but the CLI's `isImplemented` gate means they normally never get invoked. The throw is just a defensive guard for direct programmatic use.

---

## 5. Reports layout

Live tree (after one audit on each of two clients):

```
reports/
├── _legacy/                               One-time migration target for pre-Phase-C orphan files
│   ├── rmondev.md
│   └── …
├── rmondev/
│   └── instagram/
│       ├── rolling.md                     Latest 12 snapshots, regenerated each audit
│       ├── archive.md                     Older snapshots beyond the rolling window
│       └── trend/
│           ├── 2026-06-09_133415-EDT.html First trend run for this platform_account
│           ├── 2026-06-09_172216-EDT.html Each subsequent run = a new timestamped file
│           ├── index.html                 Auto-regenerated catalog
│           └── manifest.json              Catalog's data source
└── symmetry-esthetics/
    └── instagram/
        └── …                              Same shape
```

### Markdown reports

- `rolling.md` — last 12 snapshots, newest first. Regenerated each audit.
- `archive.md` — everything older than the rolling window. Created on the first audit that produces a 13th snapshot.
- Both written by [src/platforms/instagram/markdown-report.ts](../src/platforms/instagram/markdown-report.ts).

### HTML trend reports

- `trend/<timestamp>.html` — one file per `report:trend` run. Never overwritten. Filenames are `YYYY-MM-DD_HHMMSS-EDT.html` (sortable, filesystem-safe, timezone-explicit; produced by `toFilenameSafeTimestampEt`).
- `trend/manifest.json` — internal record of every report's `snapshot_id`, `captured_at`, `generated_at`, and `lookback_days`. The catalog reads from this.
- `trend/index.html` — the archive catalog. Regenerated alongside every trend report. Navigation: Quick Access cards (Latest top 3, Last Week, Last Month, Last Quarter, Last Year) + Browse By Date (year → month → report) accordions. Native `<details>`/`<summary>`; no JS.

Catalog logic lives in [src/core/reports/catalog.ts](../src/core/reports/catalog.ts).

### Orphan migration to `_legacy/`

Before Phase C, reports were written to the top of `reports/` (e.g. `reports/symmetry-esthetics.md`). On the first audit after Phase C, those files get swept into `reports/_legacy/` by `migrateLegacyOrphans()` (idempotent — no-op once clean).

---

## 6. The CLI surface

| Command | Purpose |
|---|---|
| `npm run audit -- --client <short>` | Capture a snapshot for every configured platform on this business. `--platform <name>` narrows. `--lookback-days <n>` widens media inclusion. |
| `npm run report:trend -- --client <short>` | Generate the HTML trend report + regenerate the catalog for every platform. `--platform <name>` narrows. |
| `npm run client:add` | Onboard a new business + its IG platform_account. (Phase E will make this multi-platform.) |
| `npm run client:list` | Tabular list of businesses with their last_snapshot (across all platforms). |
| `npm run token:refresh` | Mint a fresh Page Access Token for an IG platform_account, update the credentials JSON, optionally rewrite `.env.local`. Currently IG-only. |
| `npm run db:clear` | Wipe the DB. Dry-run by default; gated prompts for destructive variants. |
| `npm run test:instagram` | Live API smoke test against the bootstrap account in `.env.local`. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run dev` | `tsx watch` on audit for rapid iteration. |

Per-platform CLI behaviour:
- Unknown platform → error with `client:list` hint.
- Known but `isImplemented=false` → friendly skip message; the loop continues.
- Implementation error → caught, shown in the final Summary table; the loop continues; non-zero exit code.

---

## 7. Cookbook — how to add a new platform

This is what Phase D was designed for. Adding a new platform is purely additive. Worked example: adding LinkedIn.

### Step 1 — Create the directory

```
src/platforms/linkedin/
├── api.ts          ← LinkedIn Marketing API wrapper
├── audit.ts        ← runLinkedInAudit(input: PlatformAuditInput): Promise<PlatformAuditResult>
├── index.ts        ← the PlatformHandle export
├── markdown-report.ts
├── trend-report.ts
└── types.ts        ← zod schemas for LinkedIn responses
```

Use [src/platforms/instagram/](../src/platforms/instagram/) as the template. The two reports can copy generously from IG since their visual language is shared.

### Step 2 — Author the audit function

```ts
// src/platforms/linkedin/audit.ts
import type { PlatformAuditInput, PlatformAuditResult } from "../_registry.js";
import { generateReport } from "./markdown-report.js";

export async function runLinkedInAudit(
  input: PlatformAuditInput,
): Promise<PlatformAuditResult> {
  const { platformAccount, client, lookbackDays } = input;

  // 1. Parse platform-specific credentials
  const creds = JSON.parse(platformAccount.credentials) as { access_token: string };

  // 2. Hit the LinkedIn API for profile, insights, posts, demographics
  //    (mirrors what runInstagramAudit does for Instagram)

  // 3. Persist a snapshot + child rows
  //    Use the SAME tables — just put LinkedIn-specific fields in platform_extras JSON

  // 4. Regenerate the platform's markdown report
  const { rollingPath, archivePath } = generateReport({
    client_id: client.id,
    platform_account_id: platformAccount.id,
    platform: platformAccount.platform,
    short_name: client.short_name,
    display_name: client.display_name,
  });

  return { snapshotId, rollingPath, archivePath };
}
```

### Step 3 — Wire up the registry entry

```ts
// src/platforms/linkedin/index.ts
import type { PlatformHandle } from "../_registry.js";
import { runLinkedInAudit } from "./audit.js";
import { generateReport } from "./markdown-report.js";
import { generateTrendReport } from "./trend-report.js";

export const linkedInPlatform: PlatformHandle = {
  name: "linkedin",
  displayName: "LinkedIn",
  isImplemented: true,
  audit: runLinkedInAudit,
  generateMarkdownReport: generateReport,
  generateTrendReport,
  tokenRefresh: /* … */,
};
```

### Step 4 — Register it

```ts
// src/platforms/_registry.ts
import { linkedInPlatform } from "./linkedin/index.js";

export const PLATFORMS: Record<string, PlatformHandle> = {
  [instagramPlatform.name]: instagramPlatform,
  [facebookPagePlatform.name]: facebookPagePlatform,
  [tiktokPlatform.name]: tiktokPlatform,
  [linkedInPlatform.name]: linkedInPlatform,  // ← new line
};
```

### Step 5 — Onboard a client with it

After Phase E lands, `npm run client:add` will offer LinkedIn as a checkbox in the multi-select. Until then, attach manually:

```sql
INSERT INTO platform_accounts (client_id, platform, external_account_id, credentials, added_at)
VALUES (?, 'linkedin', '<linkedin-org-id>', '{"access_token": "..."}', datetime('now'));
```

### Step 6 — Audit

```powershell
npm run audit -- --client <short> --platform linkedin
```

The CLI loop picks up the new platform_account, looks it up in PLATFORMS, finds `isImplemented=true`, calls `runLinkedInAudit`, and you have your first snapshot.

### What you *don't* need to change

- The `clients`, `platform_accounts`, `snapshots`, `account_metrics`, `post_metrics`, `demographic_breakdowns` table shapes. New platform extras go in `platform_extras` JSON.
- The CLI dispatchers ([cli/audit.ts](../src/cli/audit.ts), [cli/report-trend.ts](../src/cli/report-trend.ts)). They iterate the registry generically.
- The reports/ directory tree. `reports/<client>/linkedin/...` slots in alongside `reports/<client>/instagram/...`.
- The catalog. It reads `manifest.json` and renders identically regardless of platform.

---

## 8. Quick reference — where things live

| If you're looking for… | Look in… |
|---|---|
| The schema | [src/core/db/schema.sql](../src/core/db/schema.sql) |
| Migration logic | [src/core/db/client.ts](../src/core/db/client.ts) (after `conn.exec(schema)`) |
| Platform dispatch | [src/platforms/_registry.ts](../src/platforms/_registry.ts) |
| Instagram audit logic | [src/platforms/instagram/audit.ts](../src/platforms/instagram/audit.ts) |
| Instagram API wrapper | [src/platforms/instagram/api.ts](../src/platforms/instagram/api.ts) |
| The HTML trend report | [src/platforms/instagram/trend-report.ts](../src/platforms/instagram/trend-report.ts) |
| The catalog (`index.html`) | [src/core/reports/catalog.ts](../src/core/reports/catalog.ts) |
| Hashtag extraction, ER calc, country expansion | [src/core/reports/_shared.ts](../src/core/reports/_shared.ts) |
| Date/time formatting | [src/core/lib/time.ts](../src/core/lib/time.ts) |
| Hidden-input prompts | [src/core/lib/prompt.ts](../src/core/lib/prompt.ts) |
| env validation | [src/core/lib/env.ts](../src/core/lib/env.ts) |
| CLI commands | [package.json](../package.json) `"scripts"` |

---

## 9. What's deliberately not here

Things this doc doesn't talk about — by design — and where they live instead:

| Topic | Where |
|---|---|
| How to install + run for the first time | [README.md](../README.md) |
| Weekly operator workflow + troubleshooting | [OPERATIONS.md](OPERATIONS.md) |
| Step-by-step new-client Graph Explorer walk | [NEW_CLIENT_ONBOARDING.md](NEW_CLIENT_ONBOARDING.md) |
| Why each non-goal is a non-goal | [CONTEXT.md](../CONTEXT.md) |
| Historical "how did we get here" | Git commit log |
