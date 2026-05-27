# Analytics Audit System — Setup Guide
## Part 1: Meta Developer Account & Instagram Graph API Access

**Document Type:** Setup / Onboarding Guide  
**Status:** Active — PoC Build Phase  
**Version:** 1.0 — May 2026  
**Prepared By:** Project Lead

---

## Purpose

This guide walks through every step required to gain programmatic access to Instagram analytics data for the Analytics Audit system. It assumes zero prior setup with Meta's developer platform.

The end state of this guide: a working Meta app in Development Mode, with `rmon.dev` (your personal business account) authenticated as the developer/tester, capable of returning live insights data via the Instagram Graph API.

**Scope of Part 1:** Account setup, app creation, permissions, and first successful API call.  
**Out of scope (for later parts):** Code scaffold, data model, storage, scheduled pulls, App Review for client onboarding.

---

## Context

A few things to know before starting, so the steps below make sense in the larger picture.

### Why Instagram Graph API (not Basic Display)
Instagram's Basic Display API was officially shut down on December 4, 2024. The Graph API is now the only supported path for any Instagram data access. It requires a Business or Creator account linked to a Facebook Page.

### Why Facebook Login for Business (not Instagram Login)
There are two auth flows available. **Instagram Login** is the newer flow using `graph.instagram.com`. **Facebook Login for Business** is the older, more mature flow using `graph.facebook.com` and requires the IG account to be linked to a Facebook Page. For insights data on Business/Creator accounts, Facebook Login for Business is the better-documented and more reliable path. That's what this guide uses.

### Development Mode vs App Review
A Meta app starts in **Development Mode**. In this mode, the app can call any Graph API endpoint with full permissions, but only for accounts that have a role on the app (admins, developers, testers). No app review is required. This is everything we need to build and test the PoC.

**App Review** becomes necessary later, when we want the app to authenticate accounts that aren't roled on it — i.e., when we onboard Symmetry Esthetics. Plan for 3–7 business days for review when that time comes. We do not need to think about App Review during the PoC build.

### Rate Limits
The Instagram Graph API allows 200 calls per hour per app. This is more than sufficient for the Analytics Audit system, which will pull a daily snapshot per client. No special rate limit handling needed at PoC stage.

### Access Token Lifecycle
- Short-lived tokens last 1 hour
- Long-lived tokens last 60 days and can be refreshed
- For the Analytics Audit system, we'll exchange short-lived for long-lived tokens and store them; the refresh strategy is a Part 2 concern

---

## Prerequisites

Before starting, confirm the following:

- [ ] You have a Facebook account in good standing (personal account)
- [ ] You have access to the Instagram account `@rmon.dev`
- [ ] The `@rmon.dev` Instagram account is set as **Business** or **Creator** type
- [ ] You have admin access to (or can create) a Facebook Page that will be linked to `@rmon.dev`

---

## Step 1: Verify Instagram Account Setup

Before touching the developer dashboard, confirm the Instagram side is correctly configured.

### 1.1 Confirm Business/Creator Account Type
1. Open the Instagram app
2. Go to **Profile → Settings and privacy → Account type and tools**
3. Confirm the account is set to **Business** or **Creator**
4. If still on Personal, switch now

### 1.2 Link the Instagram Account to a Facebook Page
This is the step most likely to cause issues later if skipped. The Graph API will return cryptic permission errors that look like auth problems but are actually structural.

1. In Instagram, go to **Settings and privacy → Accounts Centre**
2. Tap **Accounts** to see connected accounts
3. If no Facebook Page is connected:
   - Create a basic Facebook Page first at [facebook.com/pages/create](https://facebook.com/pages/create)
   - The Page can be minimal — name, category, and a profile photo are enough
   - Page name suggestion: `rmon.dev` or whatever matches the IG brand
4. Return to Accounts Centre and link the Facebook Page to the `@rmon.dev` Instagram account

**Important:** Insights data via the API only includes data from after the account became Business/Creator. Historical insights from before the conversion date are not retrievable.

---

## Step 2: Create the Meta Developer Account

1. Go to [developers.facebook.com](https://developers.facebook.com)
2. Click **Get Started** in the top right
3. Sign in with your Facebook account
4. Accept the Meta Platform Terms and Developer Policies
5. Verify your account — Meta will require:
   - Phone number verification (SMS code)
   - Selection of a primary occupation (choose **Developer**)
6. Once verified, you'll land on the **App Dashboard**

The developer account is free and does not require Business Verification at this stage. Business Verification is only required when submitting for App Review with Advanced Access permissions.

---

## Step 3: Create the App

### 3.1 Create a New App
1. From the App Dashboard, click **Create App** in the top right
2. **Use case selection:** Choose **Other** when prompted *(this gives you the widest set of product options)*
3. **App type:** Select **Business**
4. **App details:**
   - **App name:** `Analytics Audit PoC` (this is internal — can be changed later)
   - **App contact email:** Use your primary email
   - **Business portfolio:** Leave as "I don't want to connect a business portfolio yet" for now — not required during Development Mode
5. Click **Create App**
6. Complete any CAPTCHA or password prompt that appears

You'll be taken to the new app's dashboard. Note the **App ID** displayed at the top — you'll need it shortly.

### 3.2 Save the App Credentials
1. In the left sidebar, navigate to **App settings → Basic**
2. Note the following values (these will go into your `.env` file when we start writing code):
   - **App ID** (visible at the top)
   - **App Secret** — click **Show**, complete the password prompt, then copy
3. Store these somewhere safe. Do not commit them to version control. Do not share them.

---

## Step 4: Add the Instagram Product

1. From the app dashboard, in the left sidebar, find **Add Product**
2. Locate **Instagram** in the product list and click **Set up**
3. You'll see two integration options:
   - **Instagram API with Facebook Login** ← choose this one
   - Instagram API with Instagram Login
4. Click **Set up** under **Instagram API with Facebook Login**

This adds the Instagram Graph API endpoints to your app.

---

## Step 5: Add Facebook Login for Business

Graph API authentication routes through Facebook Login, so this product must also be added.

1. From **Add Product**, locate **Facebook Login for Business** and click **Set up**
2. In the left sidebar, under **Facebook Login for Business**, click **Settings**
3. Configure the following:
   - **Valid OAuth Redirect URIs:** For local development, add `https://localhost:3000/auth/callback` (the port can change to match whatever your Node app uses)
   - **Client OAuth Login:** Enabled
   - **Web OAuth Login:** Enabled
4. Click **Save Changes**

**Note on HTTPS:** Meta requires OAuth redirect URIs to use HTTPS, even for localhost. When we get to the code, we'll either use a self-signed cert for local dev or tunnel through a service like ngrok. Flag this for the build phase.

---

## Step 6: Add Your Instagram Account as a Tester

This is the step that gives `@rmon.dev` access to the app while it's in Development Mode.

1. In the left sidebar, navigate to **App roles → Roles**
2. Under **Instagram Testers**, click **Add Instagram Testers**
3. Enter the Instagram username: `rmon.dev`
4. Click **Submit**
5. Open Instagram on your phone or browser, log into `@rmon.dev`
6. Go to **Settings and privacy → Apps and websites → Tester Invitations**
7. Accept the invitation from the `Analytics Audit PoC` app

The account is now authorized to be authenticated by the app in Development Mode.

---

## Step 7: Configure Permissions

The permissions (now called "use cases" in Meta's newer UI) determine what your app can access.

1. In the left sidebar, navigate to **Use cases**
2. Find the Instagram-related use case (typically **Access and manage Instagram messaging and content** or similar — Meta's naming varies)
3. Click **Customize** to view available permissions
4. Confirm the following permissions are added:
   - `instagram_basic` — read profile info and media
   - `instagram_manage_insights` — read insights data (the critical one for analytics)
   - `pages_show_list` — read the list of Pages linked to the user
   - `pages_read_engagement` — read engagement data on linked Pages
   - `business_management` (optional — needed for some Business account features)

All of these are available in Development Mode without App Review when targeting accounts roled on the app.

---

## Step 8: Get an Access Token (Manual Test)

Before writing any code, confirm the entire setup works by manually getting an access token via the Graph API Explorer.

1. Go to [developers.facebook.com/tools/explorer](https://developers.facebook.com/tools/explorer)
2. In the top right, set the **Meta App** dropdown to `Analytics Audit PoC`
3. Click **Generate Access Token**
4. A Facebook Login popup appears — log in with your Facebook account (the one that owns the app)
5. Grant the requested permissions
6. The token now appears in the **Access Token** field

### 8.1 Verify the Token
With the token populated, run the following test queries directly in the Explorer:

**Query 1: Confirm Page access**
```
GET /me/accounts
```
You should see a JSON response listing the Facebook Page(s) you linked in Step 1.2. Note the `id` value of the relevant Page.

**Query 2: Confirm Instagram Business Account access**
```
GET /{page-id}?fields=instagram_business_account
```
Replace `{page-id}` with the ID from Query 1. The response should include an `instagram_business_account` object with an `id` — this is your Instagram Business Account ID. Save it; we'll use it constantly.

**Query 3: Confirm insights access**
```
GET /{ig-business-account-id}/insights?metric=reach,profile_views&period=day
```
Replace `{ig-business-account-id}` with the ID from Query 2. If you see a JSON response with metric values, **everything is wired correctly.**

If you get an error here, the most likely cause is the missing Facebook Page link (Step 1.2). Second most likely is the IG account not being Business/Creator type.

### 8.2 Save the Token for Now
Copy the access token from the Explorer. This is a **short-lived token** (~1 hour). In Part 2, we'll write code to:
- Exchange this for a long-lived token (60 days)
- Store it securely
- Refresh it on a schedule

For now, this short-lived token is enough to start prototyping.

---

## Step 9: Document Your IDs and Tokens

Create a local file (not committed to git) with the values you'll need:

```
META_APP_ID=             # From Step 3.2
META_APP_SECRET=         # From Step 3.2
FACEBOOK_PAGE_ID=        # From Step 8.1, Query 1
IG_BUSINESS_ACCOUNT_ID=  # From Step 8.1, Query 2
SHORT_LIVED_TOKEN=       # From Step 8.2 (will be replaced with long-lived later)
```

This will become the basis of your `.env` file when the Node project is scaffolded in Part 2.

---

## Verification Checklist

Before moving on to building the Node app, confirm all of the following:

- [ ] Meta Developer account created and verified
- [ ] App created with Business type
- [ ] App ID and App Secret saved securely
- [ ] Instagram product added to the app
- [ ] Facebook Login for Business product added with OAuth redirect URI configured
- [ ] `@rmon.dev` accepted as an Instagram Tester
- [ ] All required permissions added to the use case configuration
- [ ] Test access token generated via Graph API Explorer
- [ ] `GET /me/accounts` returns the linked Facebook Page
- [ ] `GET /{page-id}?fields=instagram_business_account` returns an IG account ID
- [ ] `GET /{ig-business-account-id}/insights?metric=reach,profile_views&period=day` returns insight data

If all twelve boxes are checked, the Meta side is ready. Part 2 will scaffold the Node/TypeScript project.

---

## What Comes Next (Part 2 Preview)

Part 2 of the setup will cover:

1. Node/TypeScript project scaffold (package.json, tsconfig, folder structure)
2. Environment variable management and secrets handling
3. Long-lived token exchange and storage
4. Wrapping the Graph API in a thin typed client
5. Defining the data model for insights snapshots
6. Storage layer (SQLite for PoC)
7. The first `audit` command — pull all baseline metrics from one IG account and save to local DB

Once Part 1 is complete and verified, we'll write Part 2 with the same step-by-step structure.

---

## Troubleshooting

**Error: "Insufficient permissions to access this endpoint"**  
Most common cause: the Instagram account is not linked to a Facebook Page. Return to Step 1.2.

**Error: "Unsupported get request" on insights endpoint**  
Most common cause: the account is still set to Personal, not Business/Creator. Or the IG Business Account ID is being used as a Page ID by mistake. They are different IDs.

**Tester invitation not appearing in Instagram**  
Sometimes takes a few minutes to propagate. If it doesn't appear after 10 minutes, remove and re-add the tester in the app dashboard.

**Access token expires immediately**  
The token from the Explorer is short-lived (~1 hour). This is expected. Long-lived token exchange is handled in Part 2.

**Error: "App not active"**  
Confirm the app is in Development Mode (not switched to Live). For our purposes, Development Mode is correct.

---

*This document is the foundation for the Analytics Audit system build. Treat it as a one-time setup reference — once Meta access is established, you should not need to return to it except to add new clients (which will happen post-App-Review).*
