# Meta App Review — Required for Full Facebook Page Audit

This document captures **why** the Facebook Page audit currently ships in "thin v1" mode, **what's blocked**, and the step-by-step path to unblock it via Meta's App Review process.

## TL;DR

- The Instagram audit works fine in development mode because Meta has been lenient about `instagram_manage_insights` for owned accounts.
- The Facebook Page audit cannot fetch reactions, comments, shares, page insights, or demographics in development mode — even though the operator has admin rights on the Page and the token carries `pages_read_engagement`.
- These endpoints are gated behind **Meta App Review** for the app (`rmondev-analytics-tester` / `META_APP_ID=1293883799586007`).
- Until the app passes review, FB Page audits capture only: Page Name, Followers, Fans, and post metadata (id / type / message / timestamp / permalink). No engagement metrics.
- Submitting for review is a 2-4 week process. Steps are in [Submission process](#submission-process) below.

## What we verified (2026-06-09 diagnostic session)

We probed the live API with a fully-scoped Page Access Token (`debug_token` confirmed all 5 scopes including `pages_read_engagement`) and learned:

### Works in development mode

- `GET /<page-id>?fields=id,name,followers_count,fan_count` — Page profile ✓
- `GET /<page-id>/posts?fields=id,message,created_time,permalink_url,status_type,attachments{...}` — post listing ✓
- `GET /<post-id>?fields=id,message,created_time,permalink_url` — post metadata ✓

### Blocked by App Review (returns code 10: "requires pages_read_engagement OR Page Public Content Access")

- `GET /<post-id>?fields=reactions.summary(total_count)` — per-post reaction counts
- `GET /<post-id>?fields=comments.summary(total_count)` — per-post comment counts
- `GET /<post-id>?fields=reactions{type}` — per-post reaction breakdown by type

### Silently empty without App Review (returns 200 with empty data)

- `GET /<post-id>?fields=shares` — silently returns no `shares` object
- `GET /<page-id>/insights?metric=...` — all page-level insights metrics return `{data: []}` regardless of activity, time window, or `metric_type` parameter
- `GET /<post-id>/insights?metric=...` — all per-post insights metrics return `{data: []}`

### Deprecated by Meta in Graph v22+ (returns code 100: "value must be a valid insights metric")

Page-level demographic metrics — all gone:

- `page_fans_gender_age`, `page_fans_country`, `page_fans_city`, `page_fans_locale`
- `page_fans_by_country`, `page_fans_by_gender`, `page_fans` (lifetime fan count)
- `page_engaged_users`, `page_consumptions`, `page_negative_feedback`

These will **not** come back after App Review. The data is only viewable in Meta Business Suite UI now. There's no v25 API path for FB Page demographics.

#### View-based replacements — also dead (exhaustive probe 2026-06-09)

Some recent documentation cites view-based demographic metrics as the v22+ replacement path for the deprecated `page_fans_*` series:

- `page_views_by_age_gender_unique`
- `page_views_by_country_unique`
- `page_views_by_city_unique`
- `page_views_by_referers_unique`
- `page_impressions_by_age_gender_unique` / `_country_unique` / `_city_unique`

This is **wrong as of Graph v25**. We ran an exhaustive 37-call probe (see [debug-raw.ts](../src/platforms/facebook-page/debug-raw.ts)) covering:

- All 7 names from the cited source, plus 19 plausible spelling variants (singular "view", without "by", `_age_gender_unique` vs `_age_gender`, `audience_`, `demographics_`, `reach_by_`, IG-style `audience_demographics_`, etc.) — **26 variants total, all return code 100 "invalid insights metric"**.
- 7 parameter combinations on the canonical name (`period=days_28`, `period=week`, `period=lifetime`, `metric_type=total_value`, `metric_type=time_series`, with/without `since`/`until`) — **all return code 100**.
- The source's exact batched URL pattern (3 metrics in one call, `period=day`, 7-day window) on **both `v22.0` AND `v25.0` paths** — **both return code 100**.
- Sanity calls (`page_impressions_unique` on v22.0 and v25.0) — both return HTTP 200 with `data: []`, confirming the endpoint and token are working correctly. The endpoint isn't the problem; the metric names are.

35 out of 37 tests returned code 100 (the only 2 successes were the sanity checks). This is the unambiguous Meta error for "this metric name does not exist in our registry" — distinct from code 10 (permission denied) and from HTTP 200 with empty data (silent suppression for unscoped access).

Conclusion: **FB Page demographics are unrecoverable from the Graph API.** Downgrading the API version, switching parameter combinations, or trying alternate spellings will not help — Meta uses unversioned, global deprecation. Sources claiming otherwise are either stale (the metric names were valid at some point in 2024-2025 and got removed silently) or AI-generated guesses from outdated training data. Do not chase demographic metric replacements. The data is only viewable in Meta Business Suite UI; App Review will not unlock it either.

### Bonus rules discovered

- FB Page insights cap the `since`/`until` window at **93 days** (error_subcode 1504016 if exceeded). Our 7-day audit windows are fine; widening backfills must chunk into ≤93-day passes.

## Scopes our app needs reviewed

Submit these for **Advanced Access**:

| Scope | Used for | Critical? |
|---|---|---|
| `pages_read_engagement` | Reaction/comment/share counts on owned posts; page insights endpoints | **Yes** — without it the audit has no engagement data |
| `pages_show_list` | Listing the operator's Pages during onboarding | Already granted in dev mode for own pages; review formalizes it |
| `instagram_basic` + `instagram_manage_insights` | Already powers the IG audit | **Yes** — under "Advanced Access" status long-term these may also need review even though they work in dev today |
| `business_management` | Reading the business hierarchy (if expanded later) | Defer until needed |

## Submission process

These are the steps you'll work through. Allow 2–4 weeks elapsed time (most of it waiting on Meta).

### 0. Business Verification — prerequisite for App Review

Meta won't review an app for Pages scopes until the connected Business Manager is verified.

1. Open **business.facebook.com → Business Settings → Security Center**.
2. Start **Business Verification**. You'll need:
   - Government-issued business documents (incorporation certificate, business license, or tax document with the legal business name + address).
   - A verifiable business phone number, email, or website.
3. Meta cross-checks documents against public records. Most small businesses verify within 2-5 business days.
4. If you operate as a sole proprietor (`Riccardo Moncada` / `rmon.dev`), use whatever legal business registration document you have. If you don't have one yet, you'll need to register a business name first — this becomes part of operating commercially anyway, so it's worth doing.

### 1. App Settings — get the app submission-ready

1. **App Mode**: still in `Development` while you prep. Don't switch to Live yet.
2. **App Details → Display Name**: change to a customer-facing name (currently `rmondev-analytics-tester`; pick something like `AnalyticsAudit by rmon.dev` or your business name).
3. **App Details → App Icon**: 1024×1024 PNG. Keep it simple.
4. **App Details → Privacy Policy URL**: required. A one-page hosted document explaining what data you collect (Page metadata, engagement counts), how you use it (generate local reports for the Page admin), how long you store it (in a local SQLite database on the operator's machine), and how to delete it (delete `data/analytics.db`). Can be a GitHub Pages or Notion page.
5. **App Details → Terms of Service URL**: required. Plain-text terms covering acceptable use. Boilerplate is fine.
6. **App Details → User Data Deletion**: a contact URL/email where users can request data deletion. For a local CLI tool, document that data deletion is performed by the operator (you) deleting the local DB.
7. **App Details → Business Use Case**: select the most relevant ("Marketing API" or "Pages API for owned business assets").
8. **Connect a Business**: link the app to your verified Business Manager (from step 0).

### 2. Permissions and Features → request each scope individually

For each scope you submit, Meta asks for:

- **How you use it** — 2-3 paragraph description.
- **Step-by-step instructions** — exactly how a reviewer can reproduce your use.
- **Screencast** — a video (max ~3 min) showing the integration in action.

#### Submission package for `pages_read_engagement`

**How you use it (suggested text):**

> AnalyticsAudit is a CLI tool used by the Page admin to generate weekly engagement reports for their own owned Pages. The tool reads reaction counts, comment counts, share counts, and insights metrics (impressions, page views, post engagements) from the operator's owned Page(s) via `/<page-id>/insights` and `/<post-id>?fields=reactions.summary(total_count),comments.summary(total_count),shares`. The output is a local Markdown report and an HTML dashboard with KPI cards, sparklines, and a post-by-post engagement table. No data is shared with third parties; the database is a single SQLite file on the operator's machine.

**Step-by-step for reviewer:**

> 1. Log in to the Test User account provided in the test users section (must have Admin role on a test FB Page).
> 2. Open Meta Business Suite to confirm the Page has at least 2 posts with reactions/comments visible.
> 3. In the AnalyticsAudit CLI (instructions in the demo video), run `npm run client:add` to onboard the test Page. Paste the Page Token from Graph Explorer.
> 4. Run `npm run audit -- --client <short-name>`. Observe that the tool fetches reactions/comments/shares/insights for the test posts.
> 5. Open `reports/<short-name>/facebook_page/rolling.md` and `reports/<short-name>/facebook_page/trend/index.html`. Both will show engagement metrics that match what's visible in Business Suite.

**Screencast outline (3 minutes):**

- 0:00–0:30 — Open the CLI, show the project structure, explain it's a local analytics tool for the Page admin's own Pages.
- 0:30–1:30 — Run `npm run client:add` then `npm run audit -- --client <test>`. Show the wrapper hitting Graph API for reactions/comments/insights and persisting to SQLite.
- 1:30–2:30 — Open the generated Markdown and HTML reports. Side-by-side with Business Suite, point out that the engagement counts match.
- 2:30–3:00 — Show that the database is local-only (`data/analytics.db`), no data leaves the machine.

Record at 1080p with screen + voice. Upload as MP4 directly in the App Review submission.

### 3. Submit and wait

- Click **Submit for Review** on each permission.
- Meta initial response: typically 5–10 business days.
- They almost always come back with one round of revisions ("clarify X", "show Y in the demo"). Reply within a week to avoid auto-rejection.
- Second pass: usually 3–7 business days.

### 4. Post-approval — switch to Advanced Access

Once approved, the scopes move from "Standard Access" (dev-mode-only) to "Advanced Access" (production-ready). At that point:

1. In the project, the FB Page wrapper code paths that were stubbed out (insights, reaction summaries, comment summaries, share counts) become callable.
2. Re-enable them in `src/platforms/facebook-page/audit.ts` (look for `// App Review required` markers).
3. Update `capabilities.reports` to keep showing engagement sections in the Markdown + HTML reports.
4. Run `npm run audit -- --client <short>` again — this time the data populates.

We will track this re-enablement work as a future phase (F2-approved). Until then, [the thin v1 audit](OPERATIONS.md#facebook-page-thin-v1-development-mode-only) ships what's accessible.

## What the thin v1 captures today

See [OPERATIONS.md → Facebook Page (thin v1)](OPERATIONS.md#facebook-page-thin-v1-development-mode-only) for the operational details. In short:

- **Account**: Page Name, Followers count, Fans count (legacy "Page Likes" number), Post count (posts seen in this snapshot).
- **Posts**: a content inventory — id, type (PHOTO / VIDEO / LINK / etc.), posted timestamp, message preview, permalink. **No** like/reaction/comment/share counts. **No** per-post reach.
- **Audience**: nothing. Demographics are gone from Graph v25 entirely; even App Review can't recover them.

The snapshot still has value as a content + follower-growth tracker. Once App Review unlocks engagement, the same snapshots become much richer without any schema changes.
