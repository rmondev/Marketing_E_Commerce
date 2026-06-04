# New Client Onboarding — Detailed Walkthrough

Step-by-step procedure for adding a brand new client to AnalyticsAudit. Companion to the terser [New client onboarding (end-to-end)](OPERATIONS.md#new-client-onboarding-end-to-end) section in `OPERATIONS.md`.

Use this doc the first few times. Once the flow is muscle memory, the OPERATIONS.md section is enough.

## Prerequisites

Before you start:

- **You have an Admin or Editor role on the client's Facebook Page.** Without a Page role, the Page won't appear in `GET /me/accounts` no matter what permissions are on your token. Ask the client to add you via the Page's *Settings → Page Roles*.
- **The client's Instagram Business account is connected to the Facebook Page.** Verify in the Facebook Page's *Settings → Linked Accounts → Instagram*. If it's not connected, no IG metrics are reachable.
- **The Meta app referenced in `.env.local` is the one you'll select in Graph Explorer.** `META_APP_ID` + `META_APP_SECRET` from `.env.local` are used later by `token:refresh` to exchange tokens — they must match the app you mint the User Token from.
- **Decide a `short_name`** (lowercase, `[a-z0-9][a-z0-9_-]*`). This becomes the `--client` identifier on every audit. Pick something memorable: `rmondev`, `symmetry-esthetics`, etc.

## What you'll collect

By the end of step 3 below you'll have:

| Value | Source |
|---|---|
| Facebook Page ID | `GET /me/accounts` → `data[*].id` |
| Page Access Token (short-lived) | `GET /me/accounts` → `data[*].access_token` |
| IG Business Account ID | `GET /<page-id>?fields=instagram_business_account` → `instagram_business_account.id` |
| Display name | Free choice (e.g. "Symmetry Esthetics") |
| Conversion date (Personal → Business) | Ask the client. Affects which historical posts will return insights. See [Insights gap](OPERATIONS.md#insights-gap--pre-business-conversion-media). |

## Procedure

### Step 1 — Mint a User Token with Page access

1. Open the [Graph API Explorer](https://developers.facebook.com/tools/explorer/).
2. **Top-right "Meta App" dropdown** → select your AnalyticsAudit app (same one in `.env.local`).
3. **"User or Page" dropdown** → leave on **User Token**. Do *not* switch to Page yet — `token:refresh` needs a User Token to do the short→long exchange.
4. **Permissions** — click "Add a Permission" and ensure all five are attached:
   - `instagram_basic`
   - `instagram_manage_insights`
   - `pages_read_engagement`
   - `pages_show_list`
   - `business_management`
5. Click **Generate Access Token**.
6. Facebook pops a dialog asking which Pages this token can act on. **Make sure the client's Page is selected** alongside any others. If the client's Page is not in this dialog at all, you don't have a Page role yet — back to Prerequisites.

You now have a short-lived User Token in the input field (typically 1–2 hours of life). Keep this tab open — you'll use it for steps 2, 3, and 5.

### Step 2 — Get the Facebook Page ID

In the Graph Explorer with the User Token still in the field, set the request to:

```
GET  /me/accounts
```

Click **Submit**. The response is:

```jsonc
{
  "data": [
    {
      "access_token": "EAA...",          // short-lived Page Token — save for step 4
      "category": "Beauty, Cosmetic & Personal Care",
      "name": "Symmetry Esthetics",
      "id": "1234567890123456",          // the Facebook Page ID — save for step 4
      "tasks": ["ADVERTISE", "ANALYZE", "CREATE_CONTENT", ...]
    },
    {
      "name": "Some Other Page",
      "id": "9876543210987654",
      ...
    }
  ],
  ...
}
```

Identify the right `data[*]` entry by `name`. From it, copy:

- `id` — this is the **Facebook Page ID**.
- `access_token` — this is the **short-lived Page Access Token**. It's good for the same window as your User Token; we'll upgrade it to long-lived in step 5.

> **If the client's Page is not in `data` at all:** the token wasn't granted access to it in step 1's Page-selection dialog. Re-mint the User Token and make sure the right Page is checked.

### Step 3 — Get the Instagram Business Account ID

Set the request to:

```
GET  /<page-id>?fields=instagram_business_account
```

Replace `<page-id>` with the Page ID from step 2. Click **Submit**. Response:

```jsonc
{
  "instagram_business_account": {
    "id": "17841400000000000"
  },
  "id": "1234567890123456"
}
```

Copy `instagram_business_account.id` — this is the **Instagram Business Account ID**. It's a different number from the Page ID and goes in a different DB column.

> **If `instagram_business_account` is missing from the response:** the IG account isn't linked to this Page. Fix in the Facebook Page's *Settings → Linked Accounts → Instagram* and retry.

### Step 4 — Add the client

You now have all four values:

| Value | Where it goes |
|---|---|
| Display name | `--name` |
| `short_name` | `--short-name` |
| IG Business Account ID (step 3) | `--ig-account-id` |
| Facebook Page ID (step 2) | `--page-id` |
| Short-lived Page Token (step 2's `access_token`) | `--page-token` (or paste when prompted) |

Run interactively:

```powershell
npm run client:add
```

The token prompt hides keystrokes — paste once, hit Enter. After you submit, the script prints the inserted row (with a masked token).

Or fully scripted:

```powershell
npm run client:add -- --name "Symmetry Esthetics" --short-name symmetry-esthetics `
  --ig-account-id 17841... --page-id 1234... --page-token EAA...
```

> The stored token is short-lived right now (matches your User Token's life). **Do not stop here.** Continue to step 5 *while your User Token is still valid* — `token:refresh` needs that same User Token to derive a long-lived Page Token.

### Step 5 — Upgrade the token to long-lived

Still with the User Token from step 1 in hand:

```powershell
npm run token:refresh
```

The script:

1. Asks which client to refresh (if more than one exists). Pick the new one.
2. Prompts for the User Token — paste the same one from step 1 (input hidden).
3. Exchanges it for a long-lived User Token via `/oauth/access_token`.
4. Derives a long-lived Page Token from that user token via `GET /<page-id>?fields=access_token`.
5. Calls `/debug_token` to confirm validity. Expected output:
   ```
     is_valid=true  type=PAGE
     expires_at=never (derived from long-lived user token — valid as long as the user token is)
   ```
6. Writes the new Page Token to `clients.page_access_token`.
7. Asks whether to also update `META_PAGE_ACCESS_TOKEN` in `.env.local` — default is `N` for non-rmondev clients (the env var is only the bootstrap token for `npm run test:instagram`). Answer `N` for a typical new client.

> If `expires_at` reports a near-future timestamp instead of `never`, the token you pasted was already a Page Token or some other short-lived artifact rather than a fresh User Token. Re-mint per step 1 and re-run.

### Step 6 — Run the first audit

```powershell
npm run audit -- --client <short-name>
```

What you should see:

- A profile fetch, account-insights fetch, media fetch (up to 50 most recent), and per-post insights for media within the 7-day lookback.
- One snapshot row inserted into `snapshots`, one into `account_metrics`, N into `post_metrics`.
- `reports/<short-name>.md` written (or rebuilt — but for a new client it's a first write).

The first snapshot's "Change" column will be `—` throughout (no prior snapshot to compare against). That's correct. Real deltas start with the second weekly audit.

If the client has a lot of historical content you want represented in the first snapshot's Posts section, widen the media window for this run only:

```powershell
npm run audit -- --client <short-name> --lookback-days 365
```

Account insights stay fixed at 7 days regardless of `--lookback-days`.

### Step 7 — Verify

Open `reports/<short-name>.md` and check:

- **Snapshot header** has today's date and a sensible "Captured" timestamp in ET.
- **Account section** has non-zero followers / following / media count, and probably zero or near-zero reach / profile views (rolling 7d — depends on the account's last-week activity).
- **Posts section** matches what you expect:
  - If the account was created as Business, all posts in the lookback window should have populated insights columns.
  - If there was a Personal → Business conversion, posts before that date will appear with `—` in reach/saved/shares/views columns and the report will show *"N post(s) in this snapshot returned no insights (likely pre-business-conversion media)"*. See [Insights gap](OPERATIONS.md#insights-gap--pre-business-conversion-media).

If anything looks off, [Where to look when things fail](OPERATIONS.md#where-to-look-when-things-fail) in OPERATIONS.md is the entry point.

## Troubleshooting (onboarding-specific)

| Symptom | Cause + fix |
|---|---|
| Page not in `/me/accounts` `data` | You don't have a Page role on the client's Facebook Page. Ask the client to add you (*FB Page → Settings → Page Roles*). Re-mint the User Token after. |
| `/me/accounts` returns empty `data` | User Token is missing `pages_show_list` permission, or no Pages were checked in the token-generation dialog. Re-mint with the right permissions and Page selection. |
| `instagram_business_account` field missing from page response | IG account isn't linked to the Facebook Page. Fix on *FB Page → Settings → Linked Accounts → Instagram*. |
| `(#10) Insufficient permissions to access this data` on audit | Token is missing `instagram_manage_insights` or `pages_read_engagement`. Re-mint the User Token with all five permissions attached (Step 1.4), then re-run `token:refresh`. |
| `Session has expired` (code 190) immediately after onboarding | User Token expired between step 1 and step 5, so `token:refresh` derived an already-dead Page Token. Re-mint the User Token and re-run `token:refresh` for the same client. |
| `UNIQUE constraint failed: clients.short_name` on `client:add` | A client with that `short_name` already exists. `npm run client:list` to see; pick a different name or delete the existing row first. |
| Audit succeeds but Posts section is empty / "returned no insights" | Either no posts in the 7-day window (use `--lookback-days 365` to backfill), or pre-conversion media. Confirm the conversion date with the client. |

## Glossary

- **User Token** — minted in Graph Explorer when "User or Page" is set to "User Token". Carries your FB user's permissions across all Pages you have a role on. Short-lived by default; can be exchanged for long-lived (~60 day) via `/oauth/access_token`.
- **Page Access Token** — a token scoped to a single FB Page. Derived from a User Token by hitting `/<page-id>?fields=access_token`. Inherits the longevity of the User Token it was derived from (long-lived User → Page Token with `expires_at=0` / "never").
- **IG Business Account ID** — Instagram's internal ID for the IG account linked to the Page. *Distinct* from the Page ID. Goes in the `ig_business_account_id` column.
- **Facebook Page ID** — the numeric ID of the FB Page itself. Goes in the `fb_page_id` column. Used by `token:refresh` to derive the Page Token.
