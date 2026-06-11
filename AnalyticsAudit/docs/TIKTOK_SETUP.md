# TikTok Developer Setup

One-time setup of the TikTok Developer portal so the TikTok audit can authorize
the accounts you want to audit. Plan ~20 minutes the first time. The companion
of this doc is [APP_REVIEW.md](APP_REVIEW.md) for Meta — same purpose, different
platform.

## The one thing that matters most

TikTok app "platforms" force a trade-off, and getting this right is the whole
game:

- **Web** platform → authenticates with your **client secret**, no PKCE. ✅ This
  is what a server-side tool like AnalyticsAudit needs. **But the Web platform
  does not allow `localhost` redirect URIs** — you must register a public
  **https** page you control.
- **Desktop** platform → allows `localhost` redirects but **requires a PKCE
  flow** that does not work for this tool (the code exchange rejects otherwise
  valid requests). Do **not** use Desktop.

So: register the app's Login Kit under the **Web** platform with a **public
https redirect URI**. Because that page isn't on your machine, the OAuth `code`
lands in the page's address bar and you paste it back during onboarding — one
extra copy/paste, and everything works.

## TL;DR

Register a developer account → create one app in **sandbox** mode → add four
read-only scopes → set the platform to **Web** with an **https** redirect URI →
add the TikTok accounts you'll audit as **sandbox target users** → copy three
values into `.env.local` → run `npm run client:platform:add -- --platform
tiktok`. Sandbox is fine indefinitely if you only audit accounts you control or
have access to (up to 10 target users).

## Prerequisites

- A regular TikTok account (any) to be your **developer** identity.
- A **public https page you control** to use as the redirect URI. Any https URL
  works — it doesn't need to do anything (TikTok just appends `?code=...` to it
  and you read that from the address bar). A GitHub Pages page is perfect; we use
  `https://rmondev.github.io/analyticsaudit-policies/`.
- A business name + short description for the app's display fields.

## What you'll get at the end

| Value | Where it goes | Used for |
|---|---|---|
| `TIKTOK_CLIENT_KEY` | `.env.local` | App identifier — sandbox keys start with `sb...` |
| `TIKTOK_CLIENT_SECRET` | `.env.local` | Authenticates the token exchange (the Web flow) |
| `TIKTOK_REDIRECT_URI` | `.env.local` | Your public https redirect page (must match the portal exactly) |
| Sandbox target-user membership | TikTok portal (no local artifact) | Lets a TikTok account authorize the sandboxed app |

## Step 1 — Register at the TikTok Developer Portal

1. Open [developers.tiktok.com](https://developers.tiktok.com/).
2. **Login** (top-right) with the TikTok account you want as your developer
   identity. Accept the developer Terms of Service.
3. You land on the dashboard with no apps yet.

> TikTok sometimes requires phone/email verification here — complete it if asked.

## Step 2 — Create the app (sandbox mode)

1. **Manage apps → Connect an app** (button label varies; both lead to the same
   form).
2. Fill in: **App name** (e.g. `AnalyticsAudit by rmon.dev`), an **icon**
   (256×256 PNG), a **category** (Business Tools / Analytics), a **description**,
   and **Terms of Service** + **Privacy Policy** URLs (a one-page hosted doc is
   enough; the form rejects empty values).
3. Submit. The app lands with status **Sandbox** — correct.

You'll create a sandbox under this app in the next steps. Sandbox keys are
distinct from the production app's — always copy the **sandbox's** key and
secret.

## Step 3 — Add the scopes (Login Kit)

In the app/sandbox detail page, add the **Login Kit** product and enable exactly
these four scopes:

- `user.info.basic` — `open_id`, `display_name`, `avatar_url` (required for any Login Kit app).
- `user.info.profile` — `username`, `is_verified`, `profile_deep_link` (richer report headers).
- `user.info.stats` — `follower_count`, `following_count`, `likes_count`, `video_count`. **The audit needs this.**
- `video.list` — per-video `view_count` / `like_count` / `comment_count` / `share_count`. **The audit needs this.**

Do **not** add `video.publish` / `video.upload` (posting permissions — not needed
and add consent-screen friction). Leave any `research.*` scopes unchecked.

## Step 4 — Set the platform to Web + an https redirect URI

This is the critical step (see "The one thing that matters most" above).

1. In the app/sandbox config, find **Platforms** and check **Web**. (Leave
   Desktop unchecked — its flow doesn't work here.)
2. Under **Login Kit → Redirect URI**, select the **Web** tab and add your public
   https page, e.g.:
   `https://rmondev.github.io/analyticsaudit-policies/`
3. **Apply changes** and give it ~30 seconds to propagate.

> If you try to register `http://localhost:...` under Web, TikTok rejects it with
> "localhost is not supported" — that's expected. Use your https page instead.

## Step 5 — Add sandbox target users

Until the app passes **Audit** (Step 9), only accounts you explicitly add can
authorize it. In **Sandbox settings → Target users** (or **Add account**), add
each TikTok account you want to audit (up to 10):

1. Click **Add account**.
2. Log into that TikTok account when prompted and accept the terms.
3. It now shows as an active target user.

For us that's Symmetry's TikTok (`@symmetryajax`). Every other account hits an
"app not approved" error on the consent screen.

## Step 6 — Save credentials to `.env.local`

From the **sandbox's** credentials panel, copy the **Client Key** and **Client
Secret**. In your project root, edit `.env.local` (create from `.env.example` if
needed) and set:

```ini
TIKTOK_CLIENT_KEY=sb...
TIKTOK_CLIENT_SECRET=<the long opaque string>
TIKTOK_REDIRECT_URI=https://rmondev.github.io/analyticsaudit-policies/
```

`TIKTOK_REDIRECT_URI` must match the portal value **exactly** (including the
trailing slash). `.env.local` is gitignored — never commit these.

## Step 7 — Onboard the account (the main command)

```powershell
npm run client:platform:add -- --client symmetry-esthetics --platform tiktok
```

What happens:

1. The CLI opens your browser to TikTok's authorize page.
2. Log in as the **target** account and click **Authorize** (do it promptly —
   the returned code expires within minutes).
3. TikTok redirects to your https page; the address bar now reads
   `https://.../?code=XXXX&state=YYYY`.
4. **Copy that whole URL** and paste it at the terminal's `Paste redirected URL
   or code:` prompt.
5. The CLI exchanges the code (Web flow — client secret, no PKCE), validates the
   token, and persists the `tiktok` platform_account.

Then run the audit and reports:

```powershell
npm run audit -- --client symmetry-esthetics --platform tiktok
npm run report:trend -- --client symmetry-esthetics --platform tiktok
```

## Token lifetimes — what to expect

- **Access token: ~24 hours.** Bearer on every API call.
- **Refresh token: ~365 days,** rotating on each use (the window slides forward
  each refresh, so auditing at least once a year keeps it alive indefinitely).
- **The audit auto-refreshes.** Each `npm run audit` checks expiry first and
  refreshes inline if needed, persisting the rotated pair. The refresh call uses
  the client secret (no PKCE) and just works — no manual step during normal use.

## Optional — mint a token without onboarding

`npm run tiktok:mint` runs the same browser flow but only **prints** an
access/refresh pair (plus the `client:platform:add` command to persist it).
Useful for testing, or to mint a pair and attach it later:

```powershell
npm run tiktok:mint                # uses TIKTOK_REDIRECT_URI from .env.local
npm run tiktok:mint -- --debug     # also prints the redacted request/response
```

## Optional — paste a pre-minted token

If you already have a pair (from `tiktok:mint`, Postman, etc.), skip the browser
entirely:

```powershell
npm run client:platform:add -- --client symmetry-esthetics --platform tiktok `
  --tiktok-access-token "act.<...>" --tiktok-refresh-token "rft.<...>"
```

The onboarding code validates the token live, marks `manual_token=true` in the
credentials blob, and persists. Auto-refresh then takes over normally.

## Common gotchas

| Symptom | Cause + fix |
|---|---|
| Authorize page: "correct the following: `code_challenge`" | The app is on the **Desktop** platform (PKCE required). Switch to **Web** (Step 4). |
| Portal: "localhost is not supported" when saving the redirect | Web doesn't allow localhost. Use your public **https** page. |
| Consent screen: "app not approved" / "audit pending" | The TikTok account isn't a sandbox target user. Add it (Step 5). |
| `Code verifier or code challenge is invalid` at exchange | You're using a PKCE/desktop flow. This tool uses the **Web** confidential flow — confirm the app platform is Web and `TIKTOK_REDIRECT_URI` is your https page. |
| `invalid_client` at exchange | Wrong/stale `TIKTOK_CLIENT_SECRET`, or key/secret are from different apps/sandboxes. Re-copy both from the **sandbox** credentials panel. |
| `redirect_uri` error | The redirect in `.env.local` doesn't byte-match the portal value (watch the trailing slash). |
| Token expired a year later | The refresh token lapsed (1-year). Re-run `client:platform:add` to mint a fresh pair. |

## Step 9 — Leaving sandbox (submitting for Audit)

Sandbox caps you at the accounts you add as target users. To audit a TikTok you
can't add as a target user, submit the app for **Audit**:

1. App detail page → **Submit for Audit**.
2. Provide a 3–5 min **screencast** of the OAuth flow + what data you collect/how
   to delete it (showing the local SQLite file + `db:clear --confirm
   --include-clients` is the deletion demo), plus a short **scope justification**
   per scope.
3. TikTok responds in ~5–10 business days, usually with one revision round.

For now we stay in sandbox — Symmetry's TikTok is the only account audited via
this tool. Submit for Audit later, only when the client count justifies it.

## Reference URLs

- [Manage apps dashboard](https://developers.tiktok.com/apps)
- [Login Kit for Web](https://developers.tiktok.com/doc/login-kit-web/)
- [Manage user access tokens (token exchange spec)](https://developers.tiktok.com/doc/oauth-user-access-token-management)
- [Display API — user info](https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info/)
- [Display API — video list](https://developers.tiktok.com/doc/tiktok-api-v2-video-list/)
