# TikTok Developer Setup — Prerequisites for Phase G

Step-by-step setup of the TikTok Developer portal so the TikTok audit (Phase G) has the credentials and OAuth configuration it needs. Do these steps *before* running `npm run client:platform:add -- --platform tiktok` for the first time. The whole process takes 15-30 minutes once.

The companion of this doc is [APP_REVIEW.md](APP_REVIEW.md) for Meta — same purpose, different platform.

## TL;DR

You'll register a developer account, create one app in **sandbox mode**, attach four read-only scopes, set a localhost OAuth redirect URI, add yourself + each client whose TikTok you want to audit as **Sandbox Users**, and copy two credentials into `.env.local`. That's it. The app stays in sandbox indefinitely if you only want to audit accounts you control or have explicit access to (up to 5 sandbox users).

## Prerequisites

- A regular TikTok account (any, doesn't have to be a business one). This becomes your "developer" identity.
- A business name + a brief description of the audit tool — you'll paste these into the app's display fields. For us: app name "AnalyticsAudit by rmon.dev" (or your variant); description "Local CLI tool that captures weekly engagement snapshots of TikTok accounts the operator administers, generating Markdown and HTML reports stored in a single local SQLite file."
- Time: ~20 minutes for steps 1-6 below. Plus optionally 1-3 weeks of waiting if you ever submit for **Audit** (steps 8+, which lets non-sandbox-users authorize the app).

## What you'll get at the end

| Value | Where it goes | Used for |
|---|---|---|
| `TIKTOK_CLIENT_KEY` | `.env.local` | App identifier — sent on every API call |
| `TIKTOK_CLIENT_SECRET` | `.env.local` | Authenticates token exchange |
| `TIKTOK_REDIRECT_URI` | `.env.local` (optional override; defaults to `http://localhost:3001/oauth/tiktok/callback`) | Where TikTok sends the OAuth code |
| Sandbox User membership | TikTok portal (no local artifact) | Lets the test TikTok account complete OAuth against your sandboxed app |

## Step 1 — Register at the TikTok Developer Portal

1. Open [developers.tiktok.com](https://developers.tiktok.com/).
2. Click **Login** in the top-right corner. Sign in with the TikTok account you want to use as your developer identity. (You can change this later; treat it like a long-lived account.)
3. Accept the developer Terms of Service when prompted.
4. You land on the developer dashboard. There are no apps yet.

> **Note:** TikTok occasionally requires phone-number or email verification at this stage. If you hit that, complete it before continuing.

## Step 2 — Create the app (sandbox mode)

1. Click **Manage apps → Connect an app** (the button label has been "Create app" or "Connect an app" in different recent revisions of the UI — both go to the same form).
2. Fill in the form:
   - **App name**: `AnalyticsAudit by rmon.dev` (or your preferred customer-facing name)
   - **App icon**: 256×256 PNG. Plain background is fine.
   - **Category**: pick *Business Tools* or *Analytics* — whichever the dropdown surfaces today.
   - **Description**: "Local CLI tool that captures weekly engagement snapshots of TikTok accounts the operator administers (followers, video views, likes, comments, shares). Generates Markdown rolling reports and HTML trend dashboards stored in a single local SQLite file on the operator's machine. No data is shared with third parties."
   - **Terms of Service URL** + **Privacy Policy URL**: required. If you don't have these hosted yet, a one-page Notion or GitHub Pages doc with "what data we collect, how we use it, how to delete it" is enough. For sandbox-mode apps TikTok doesn't actively review these, but the form rejects empty values.
   - **Website URL**: any URL you control (your portfolio, GitHub, etc.)
3. Submit the form. The app lands in your dashboard with status **Sandbox** — that's the right state.

You should now see your new app on the **Manage apps** page with `client_key` displayed somewhere on the app's detail page.

## Step 3 — Add the required scopes (Login Kit + User Info + Video List)

1. In the app's detail page, find the **Add products** or **Products** section.
2. Add **Login Kit** (sometimes shown as "TikTok Login Kit" or "Login for Business" depending on the UI revision). This is the OAuth surface.
3. Inside Login Kit, configure scopes — check the boxes for exactly these four:
   - `user.info.basic` — `open_id`, `union_id`, `display_name`, `avatar_url`. Required; every Login Kit app needs this.
   - `user.info.profile` — `bio_description`, `profile_deep_link`, `is_verified`. Used for richer report headers.
   - `user.info.stats` — `follower_count`, `following_count`, `likes_count`, `video_count`. **The audit needs this** for account-level metrics.
   - `video.list` — list and query the user's own videos with per-video stats (`view_count`, `like_count`, `comment_count`, `share_count`). **The audit needs this** for post-level metrics.
4. Do **not** add `video.publish` or `video.upload` — those request posting permission and aren't needed for an audit tool. Asking for them adds friction in the OAuth consent screen.

> **Note:** If the scopes list shows extra items like `research.adlib.basic` or `research.data.basic`, those belong to the Research API (a separately-gated program). Leave them unchecked — they trigger an institutional review process that takes weeks.

## Step 4 — Set the OAuth redirect URI

Still on the app detail page:

1. Find **Login Kit → Redirect URI** (sometimes labeled "Callback URL").
2. Add: `http://localhost:3001/oauth/tiktok/callback`
3. Save.

That URL is what the AnalyticsAudit onboarding command will listen on with a one-shot local HTTP server during OAuth. TikTok requires the redirect URI on the request to exactly match one of the URIs registered here — including the path, port, and trailing-slash handling.

> **Note:** Use `http://localhost:...` (not `127.0.0.1`). TikTok historically accepted both; recently they've been stricter about literal `localhost` for sandbox-mode apps.

## Step 5 — Add Sandbox Users

This is the gate that keeps non-sandbox accounts from being able to authorize your app. Until your app passes **Audit** (Step 8+), only:

- Your developer TikTok account itself
- Up to **5 explicitly-added Sandbox Users**

can complete OAuth against your app. Every other TikTok account hits a "this app hasn't been approved yet" error during the consent screen.

To add a Sandbox User:

1. App detail page → **Sandbox Users** section.
2. Click **Add user**.
3. Enter the TikTok **handle** (`@symmetry_esthetics_tiktok_handle` — *not* a display name, not an email — the exact `@`-handle).
4. TikTok sends an in-app notification to that user requesting acceptance. They open TikTok → notifications → accept.
5. Once accepted, the user shows as **Active** in your Sandbox Users list.

You'll need to do this once for each client whose TikTok you want to audit. For Phase G, that means Symmetry's TikTok handle. Tell Symmetry to expect the notification and accept it from her TikTok app.

> **Note:** Sandbox User invitations expire after ~7 days if not accepted. If you wait too long you'll have to re-invite.

## Step 6 — Save credentials to `.env.local`

Back on the app's detail page, find:

- **Client Key** (sometimes labeled "App ID"). Looks like `awxxxxxxxxxxxxxx` — a short string starting with `aw`.
- **Client Secret** (sometimes labeled "App Secret"). Long opaque string. Treat like a password.

In your project root, edit `.env.local` (create from `.env.example` if it doesn't exist yet) and add:

```ini
TIKTOK_CLIENT_KEY=awxxxxxxxxxxxxxx
TIKTOK_CLIENT_SECRET=<the long opaque string>
```

Optionally, if you ever change the redirect URI, override the default:

```ini
TIKTOK_REDIRECT_URI=http://localhost:3001/oauth/tiktok/callback
```

`.env.local` is gitignored. Never commit either credential.

## Step 7 — Verify (after G1 code lands)

When G1 ships, you'll run:

```powershell
npm run client:platform:add -- --client symmetry-esthetics --platform tiktok
```

Expected flow:

1. CLI prints a TikTok auth URL and opens your default browser to it.
2. Local HTTP server starts on `:3001`.
3. In the browser, you log in to Symmetry's TikTok and click **Authorize**.
4. TikTok redirects to `localhost:3001/oauth/tiktok/callback?code=...`.
5. The local server exchanges the code for tokens, prints a success message, and shuts down.
6. The new `tiktok` platform_account row is persisted; `npm run client:list` shows `instagram,facebook_page,tiktok` for Symmetry.

If any step fails before G1 lands, you'll see something other than what's above — that's expected, code isn't there yet.

## Workaround: manual token paste (current default)

The full OAuth + PKCE onboarding flow shipped in G1 is hitting a sandbox-side validator bug as of 2026-06-10. Our PKCE pair is mathematically correct (verified against RFC 7636's published test vector), but TikTok's `/v2/oauth/token/` endpoint rejects the exchange with `invalid_request: Code verifier or code challenge is invalid` regardless of verifier length (43/64/128), character set (base64url vs alphanumeric), or Content-Type variant. A support ticket is open with the `log_id` values; until that's resolved, onboarding accepts pre-minted tokens via flags:

```powershell
npm run client:platform:add -- --client symmetry-esthetics --platform tiktok `
  --tiktok-access-token "act.<long...>" `
  --tiktok-refresh-token "rft.<long...>"
```

### How to obtain the tokens

You need an access_token + refresh_token pair for the target TikTok account (Symmetry in our case). Options:

1. **TikTok's developer-portal "Try API" tool** — some app detail pages have a section that completes OAuth + token exchange on TikTok's own infrastructure (bypassing whatever's broken about cross-origin/PKCE exchange to our app). Look for a "Test API" / "Sandbox Test" / "OAuth Playground" button.
2. **Postman + TikTok's published collection** — TikTok publishes a Postman collection for Login Kit. Import it, configure your `CLIENT_KEY` / `CLIENT_SECRET` / `REDIRECT_URI`, run the OAuth flow inside Postman. Postman handles PKCE itself and seems immune to the bug. You'll have `access_token` and `refresh_token` in the response.
3. **A different OAuth client library** (e.g. simple-oauth2, node-tiktok-api-v2 if it exists) that has its own PKCE implementation. If theirs works where ours doesn't, the bug is specific to a request-shape detail we're missing.

Whichever path you use, **the target account (Symmetry) must complete the consent screen** during OAuth, and the resulting tokens carry her authorization — they're not a developer-side artifact.

### After the workaround

When tokens are pasted via flags:
- The audit assumes 24h access-token lifetime and 365d refresh-token lifetime. Both are reset by `token:refresh` if you re-mint.
- `credentials.manual_token=true` is set in the JSON blob so the audit can warn the operator that this account was bootstrapped via the workaround.
- The audit's auto-refresh path (G3) will use the `refresh_token` normally — TikTok's `/v2/oauth/token/?grant_type=refresh_token` endpoint doesn't use PKCE and works correctly in our testing.

The workaround is invisible to G2-G6 — the audit reads the same credentials shape regardless of whether tokens came from OAuth or manual paste.

## Verify the API wrapper (Phase G2)

Once you have an access token — whether minted via OAuth, the manual workaround, or pasted straight from Postman/the portal "Try API" tool — you can smoke-test the Display API wrapper before the full audit (Phase G3) exists:

```powershell
# Test a raw token directly (works before any account is onboarded):
npm run test:tiktok -- --access-token "act.<long...>"

# Or test an already-onboarded client's stored token:
npm run test:tiktok -- --client symmetry-esthetics
```

It calls `/v2/user/info/` (follower/following/likes/video counts) and `/v2/video/list/` (recent videos with per-video view/like/comment/share counts) and prints what came back. Any scope-withheld stat shows as `(withheld)` rather than `0`. Add `--max-videos <n>` to cap how many videos it pulls (default 10). An expired token surfaces a clean `access_token_invalid` error — re-mint and retry.

## Common gotchas

| Symptom | Cause + fix |
|---|---|
| `invalid_client` during token exchange | `TIKTOK_CLIENT_KEY` or `TIKTOK_CLIENT_SECRET` is wrong, or the secret was rotated and `.env.local` still has the old value. Re-copy both from the portal. |
| `redirect_uri_mismatch` | The exact URI in your request doesn't match what's registered. Watch for trailing slashes and `http://localhost` vs `http://127.0.0.1`. |
| OAuth consent shows "app not approved" / "audit pending" | The TikTok user trying to authorize isn't a Sandbox User. Add them in Step 5 and have them accept the in-app invitation. |
| `access_denied` on first run a year later | The refresh_token expired (1-year lifetime). Re-run `client:platform:add` to mint a fresh pair. |
| Scopes silently dropped on first OAuth | TikTok ignores scopes that aren't enabled on the app side. Check Step 3 — the four scopes must be enabled in the Login Kit product config. |
| `client_key not_found` | You're using the dev portal's **App ID** when TikTok wants the **Client Key**. They're different strings on the same app detail page; Client Key is the one starting with `aw`. |

## Token lifetimes — what to expect operationally

TikTok's auth model is different from Meta's. Worth internalizing once:

- **Access token: 24 hours.** Used as `Authorization: Bearer <token>` on every API call. Expires every day.
- **Refresh token: 365 days.** Used once per access-token expiry to mint a new access token (plus a new refresh token, refresh-token-rotation is on). The refresh window slides forward each time it's used — as long as you audit at least once a year, the refresh token stays alive indefinitely.
- **The audit auto-refreshes.** When G3 lands, every `npm run audit` for a TikTok platform_account checks `expires_at` first, refreshes inline if needed, persists the new tokens, then makes the data fetches. No manual `token:refresh` action needed during normal weekly use.
- **Manual `token:refresh` for TikTok** still exists as an escape hatch for "something broke, mint a fresh pair" scenarios, but should rarely be needed.

Compare with Meta: Page Access Tokens last ~60 days, derived from a User Token that itself rotates through a manual Graph Explorer flow. Much more operator overhead, but no daily expiry.

## When you're ready to leave sandbox: submitting for Audit

Until the app passes **Audit**, only your developer account + up to 5 Sandbox Users can authorize. If you ever want to onboard a client whose TikTok handle you can't add as a Sandbox User (e.g. you're an agency with >5 client TikToks, or a client refuses the Sandbox User invitation), you submit the app for Audit.

The Audit process (similar to Meta App Review):

1. App detail page → **Submit for Audit** button.
2. Provide a **screencast** (3-5 min) demonstrating how a user goes through OAuth in your app, what data you collect, how you store it, and how to delete it. Showing the local SQLite file + `db:clear --confirm --include-clients` is the deletion demo.
3. Provide written **scope justifications** — one short paragraph per scope explaining why your app needs `user.info.stats` etc.
4. Submit. TikTok responds in 5-10 business days, usually with one round of revisions ("clarify X", "show Y"). Reply within a week.
5. Second pass: 3-7 business days. Once approved, sandbox restrictions lift — any TikTok user can authorize.

For Phase G we stay in sandbox indefinitely. Symmetry's TikTok is the only one being audited via this tool right now. We submit for Audit later only when the client count justifies it.

## Reference URLs

- [Manage apps dashboard](https://developers.tiktok.com/apps)
- [TikTok for Developers docs root](https://developers.tiktok.com/doc/)
- [Login Kit OAuth reference](https://developers.tiktok.com/doc/login-kit-web/)
- [Display API user info endpoint](https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info/)
- [Display API video list endpoint](https://developers.tiktok.com/doc/tiktok-api-v2-video-list/)
