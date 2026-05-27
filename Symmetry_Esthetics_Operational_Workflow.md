# Symmetry Esthetics — Operational Workflow
## Digital Marketing PoC · Phase-by-Phase Playbook

**Document Type:** Operational Workflow / Process Reference  
**Status:** Active — Proof of Concept Phase  
**Version:** 1.3 — May 2026  
**Prepared By:** Project Lead

---

## Overview

This document defines the end-to-end operational workflow for the Symmetry Esthetics Digital Marketing PoC. It is structured as a sequential five-phase engagement model, beginning with pre-launch analytics capture and progressing through content operations, influencer partnerships, analytics validation, and e-commerce enablement.

Each phase has defined objectives, tasks, tools, and success criteria. This document is intended to be repeatable across future clients with vertical-specific adjustments.

---

## Phase 1 — Analytics Baseline Capture

**Objective:** Record the client's social media performance metrics *before* any work begins. This data becomes the comparison baseline used to demonstrate the impact of all future efforts.

**Timing:** Week 1, prior to any content or posting activity.

### 1.1 Platforms to Audit

Capture data from whichever of the following the client currently uses:

- Instagram (primary)
- TikTok
- YouTube Shorts
- Facebook (secondary, if active)
- Google Business Profile (if active)
- Website via Google Analytics or Google Search Console (if access is available)

### 1.2 Metrics to Record

**Social Media Platforms**

For each active platform, capture and document the following:

| Metric | Description |
|---|---|
| Follower count | Total at time of audit |
| Average reach per post | Impressions / accounts reached |
| Average engagement rate | (Likes + Comments + Shares) / Followers × 100 |
| Average views per video | For Reels, TikToks, Shorts |
| Post frequency | Posts per week over the past 30 days |
| Profile visits | Monthly profile visits (if available) |
| Website link clicks | From bio link (if available) |
| Top-performing content type | Video / photo / carousel / graphic |

**Google Business Profile** (if active)

| Metric | Description |
|---|---|
| Total reviews | Count and average star rating |
| Search impressions | How often the listing appeared in local search |
| Direction requests | How many users requested directions |
| Phone call clicks | Calls initiated from the listing |
| Website clicks | Clicks through to the client's website from GBP |

GBP data is supplementary — the primary goal of this engagement is social media growth and eventual e-commerce. However, GBP metrics are strong evidence of increased local interest and bookings, and are worth capturing as supporting proof points for the case study.

**Website Traffic** (if Google Analytics / Search Console access is granted)

| Metric | Description |
|---|---|
| Monthly sessions | Total site visits |
| Top traffic sources | Organic, social, direct, referral |
| Bounce rate | Percentage of single-page visits |
| Most visited pages | Services, contact, home |

### 1.3 How to Capture

- Access the client's native platform analytics (Instagram Insights, TikTok Analytics, YouTube Studio).
- Access Google Business Profile dashboard for GBP metrics (client must grant access or share screenshots).
- Access Google Analytics or Search Console if the client is willing to share — flag this as optional but beneficial.
- Screenshot and record all key metrics.
- Store in: `/Reporting/Baseline/[Platform]_Baseline_[Date].png` and a summary row in the Analytics Tracker spreadsheet.

### 1.4 Output

- Completed baseline analytics snapshot for each active platform.
- Summary document: `Analytics_Baseline_[ClientName]_[Month_Year].md`

---

## Phase 2 — Content Creation & Pipeline Setup

**Objective:** Establish the full content system — from understanding what the client is comfortable producing, to building the folders, communication channels, and automation that make consistent posting sustainable.

**Timing:** Weeks 1–4 (setup); ongoing from Week 2 forward.

---

### 2.1 Content Discovery — Client Comfort Assessment

Before creating anything, understand what the client is willing to participate in. This determines the entire content strategy.

**Questions to answer in discovery:**

- How much time can the client (or their team) dedicate to content per week?
- Are they comfortable appearing on camera? (Face, hands, or neither?)
- Do they have a videography partner available? (Justin in this PoC)
- What do they think represents their business best?
- Are there any content types they are uncomfortable with or want to avoid?

**Outcome:** Categorize the client into one of three content involvement tiers:

| Tier | Client Involvement | Primary Content Type |
|---|---|---|
| High | On camera, active participant | Video-led (Reels, TikToks) |
| Medium | Behind-the-scenes, hands-only | Mixed: service shots + graphics |
| Low | Minimal direct involvement | Infographic-led + testimonials |

---

### 2.2 Content Formats by Type

Based on the client's comfort level, select from the following format library:

**Video-Based Content**
- Day-in-the-life of the business
- Services being performed (with client permission and consent from their clients)
- Product demonstrations and tutorials
- Before & after showcases
- "Tips & Tricks" from the esthetician (position as an expert)
- Staff introductions and team culture

**Infographic & Brand-Awareness Content**
- Wellness education (skincare routines, ingredient spotlights, seasonal tips)
- Local area connection (Ajax / Durham Region community content)
- Industry statistics and surprising facts
- "Did you know?" series
- Testimonial graphics and review highlights

**Synonymization Content** (build identity around a broader lifestyle)
- Align the brand with wellness, self-care, and professional beauty
- For spa: associate with calm aesthetics, natural ingredients, luxury self-care
- For future tattoo/barber clients: associate with artistry, culture, craftsmanship
- Examples: art, mood boards, curated lifestyle images that match the brand's energy

---

### 2.3 Content Posting Schedule

- Build a shared content calendar before the first post goes live.
- Recommended initial cadence: **3–4 posts per week** (adjust based on content availability).
- Platform-specific considerations:
  - Instagram: 3–4 Reels + 1–2 static posts per week
  - TikTok: 3–5 short videos per week
  - YouTube Shorts: 1–2 per week (repurposed from IG/TikTok)

**Tools:**
- Shared Google Calendar for scheduling visibility
- Content pipeline folders (see 2.4) for production status
- WhatsApp or Discord group as the client-to-team communication channel

---

### 2.4 Cloud Storage Pipeline (Google Drive)

Set up a dedicated Google Drive folder structure for the client. Both the client and the project team must have access.

```
/[ClientName]_Content_Pipeline/
    /01_Ideas_Intake/         ← Client drops raw ideas, voice notes, photos here
    /02_Drafting/             ← Captions, concepts, scripts in progress
    /03_Production/           ← Raw video/photo from Justin or client
    /04_Review/               ← Internal team review before scheduling
    /05_Scheduled/            ← Approved and ready to post (auto-post reads from here)
    /06_Posted_Archive/       ← All published content with post date + performance log
    /07_Evergreen_Bank/       ← Pre-built stock of evergreen posts ready to fill schedule gaps
```

**Workflow rules:**
- Nothing moves to `/Scheduled` without passing through `/Review` first.
- The `/Review` folder is primarily an **internal team review stage** — the project lead and any collaborators check for quality, branding consistency, and caption accuracy before scheduling. Client involvement at this stage is optional and should not be a hard gate on the posting schedule.
- Raw content (from Justin or client) lands in `/Production`, never directly in `/Scheduled`.
- Every posted piece is archived with its publish date, platform, and initial performance stats.

**Client review policy:**

The client has a **48-hour window to flag any post before it goes live.** If no response is received within that window, the post is considered approved and publishes automatically. This policy must be agreed in writing during onboarding — a WhatsApp or email confirmation from the client is sufficient at the PoC stage.

This approach is intentional:
- The client stays informed and retains veto rights on anything they're uncomfortable with.
- The posting schedule is never blocked by a non-response.
- Liability is shared — the client has been notified and had opportunity to intervene.

**How a hold works:**
- Client replies "HOLD" via WhatsApp within the 48-hour window.
- The post is moved back to `/04_Review/` and a conversation is opened to understand the concern.
- The post is not deleted — it is paused and documented.
- All flagged posts and the reason for the hold are logged for future content calibration.

**Official hold channel:** WhatsApp only. Flags raised via other channels (DM, email, in person) do not count as an official hold — direct the client to WhatsApp to keep the process clean and auditable.

---

### 2.4.1 Future State — Automated Approval via Twilio (Post-PoC)

> **Status:** Planned — not built during PoC phase. Document for future implementation.

The manual WhatsApp review process above will be replaced with an automated SMS notification and response system built on the **Twilio API**.

**Intended flow:**

1. A post is moved into `/05_Scheduled/` and the scheduler prepares it for publishing.
2. An automated SMS is sent to the client's phone via Twilio containing a brief description of the post and its scheduled publish time.
3. The message instructs the client: *"Reply HOLD to pause this post, otherwise it goes live in 48 hours."*
4. A backend service listens for inbound replies via a **Twilio webhook** (POST request to a defined endpoint).
5. If the client replies HOLD before the deadline, the service updates the post status to "Held" and notifies the project lead.
6. If no reply is received, the scheduler proceeds and the post publishes automatically.

**Technical requirements for build:**

- Twilio account with a dedicated phone number (consistent number so the client recognizes it)
- Backend service deployed on a persistent host (e.g. Railway, Render, or similar) to receive webhook callbacks
- Inbound message validation — only the registered client phone number can trigger a hold on their posts
- Post status tracking in a lightweight data store (Google Sheet, Airtable, or simple database) so post state is visible without relying on chat history
- Webhook endpoint must be publicly accessible and always available — a service that goes down means holds get missed

**Key design rule:** The client's number is the only number that can hold their posts. Basic input validation on inbound webhooks is non-negotiable before this goes live.

---

### 2.5 Content Consent & Release

**This step is non-negotiable before any content featuring the client's customers is posted.**

If Justin or any team member captures footage or photos of customers receiving services, a signed consent and media release is required from each individual before that content can be used on any platform.

**Minimum consent form contents:**
- Name of the person consenting
- Description of content being captured (e.g. "footage of facial treatment")
- Platforms the content may be published on (Instagram, TikTok, YouTube Shorts)
- Right to use the content for marketing purposes
- Signature and date

**Process:**
- Consent forms are collected at the time of filming — not after.
- Signed forms are stored in `/Client Discovery/Consent_Forms/`.
- No footage of identifiable individuals is posted without a corresponding signed form on file.
- A simple one-page template should be prepared before Justin's first filming session.

---

### 2.6 Evergreen Content Bank

To prevent the posting schedule from stalling when original content is slow, a bank of evergreen posts should be built during the setup phase and maintained as part of ongoing client upkeep.

**Target:** 10–15 evergreen pieces ready before the first week of posting begins.

**Evergreen content types (never expire or go stale):**
- Skincare tips and seasonal routines
- Ingredient spotlights ("Why we love hyaluronic acid")
- Wellness lifestyle quotes paired with branded visuals
- FAQ-style posts ("What should I expect from my first facial?")
- "Did you know?" industry facts
- Testimonial graphics from existing client reviews
- Mood board / synonymization posts (wellness lifestyle imagery)

**Maintenance:** Replenish the evergreen bank whenever it drops below 5 pieces. This is a recurring task on the monthly content review checklist.

---

### 2.7 AI-Assisted Auto-Posting

**Goal:** Automate routine posting from the `/Scheduled` folder to reduce manual work and ensure consistency.

**Current approach (PoC phase — lean):**
- Use scheduling tools (e.g. Later, Buffer, or Meta Business Suite) to pre-schedule posts from the Scheduled folder.
- AI (ChatGPT / Claude) drafts captions and hashtag sets based on content type.
- Project lead reviews and queues posts.

**Future state (automated):**
- Cron job or Zapier automation monitors the `/Scheduled` folder.
- On detection of a new file, triggers AI caption generation + platform upload.
- Platform APIs (Instagram Graph API, TikTok API) handle publishing.
- Publish confirmation + performance tracking logged automatically.

**AI Prompt Template (caption generation):**
```
You are a social media copywriter for [Client Name], a local [business type] in [Location].
Tone: [warm / professional / fun / educational].
Content piece: [describe the video or graphic].
Write 3 caption options. Include 15–20 relevant hashtags per option.
Format: Caption + line break + hashtags.
```

---

## Phase 3 — Drive Engagement via Local Content Creators

**Objective:** Amplify reach by partnering with local content creators (micro-influencers) who already have established local audiences and can authentically promote the client's services.

**Timing:** Begin no earlier than Week 3, after at least 2–3 weeks of consistent posting is live. The client's profile must look credible before any creator is approached — a sparse or inconsistent profile will kill the pitch. Run concurrently with Phase 2 from Week 3 through Month 3.

### 3.1 Creator Research Criteria

Search for local creators who meet the following profile:

- Based in Ajax, Whitby, Oshawa, Pickering, or broader Durham Region
- Follower count: 1,000 – 50,000 (micro-influencer range — higher engagement, lower cost)
- Content niche aligned with the client's vertical:
  - Spa / Esthetics: wellness, beauty, self-care, lifestyle, fitness
  - Future clients: art & culture (tattoo), men's grooming (barber)
- Authentic engagement — check that comments are real (not generic bot comments)
- Professional tone or aspirational lifestyle content

**Search methods:**
- Instagram hashtag search: `#AjaxOntario`, `#DurhamRegionBeauty`, `#WellnessDurham`, etc.
- TikTok location tags
- Local Facebook groups and community pages
- Google: "[niche] content creator [city]"

### 3.2 Partnership Model Options

| Type | Description | Cost |
|---|---|---|
| Trade / Comp | Creator visits in exchange for free service | Low cost — ideal for PoC |
| Gifted collab | Send products for review (once e-commerce is live) | Product cost only |
| Paid post | Negotiate a flat fee for one post/Reel/TikTok | Budget required |
| Brand ambassador | Ongoing relationship, multiple posts per month | Higher investment |

**PoC recommendation:** Start with trade / comp arrangements. Offer a free facial, treatment, or product in exchange for an Instagram Reel and/or TikTok. Require tagging and location mention.

### 3.3 Creator Deliverables Agreement

Before any creator visit is booked, agree on and document the deliverables in writing. A verbal agreement is not sufficient.

**Deliverables to specify:**

| Item | Example |
|---|---|
| Platform(s) | Instagram Reel + TikTok |
| Content format | Short-form video (30–60 sec) |
| Posting deadline | Within 7 days of the visit |
| Tagging requirements | Must tag @symmetryesthetics + location |
| Minimum requirements | No minimum views — authenticity over metrics |
| Usage rights | Creator grants permission to reshare content on client's channels |

**Agreement format:** A simple written confirmation via DM or email is sufficient for trade/comp arrangements at the PoC stage. For paid arrangements, a one-page contract is required.

---

### 3.4 Outreach Template

```
Hey [Creator Name],

I'm [Name], working with Symmetry Esthetics in Ajax — a local spa known for [brief description].

We'd love to have you in for a complimentary [service] and share your experience with your audience. 
In exchange, we'd ask for one Instagram Reel or TikTok tagging our account with your honest experience,
posted within a week of your visit.

No scripts — just real content. Let me know if this sounds like something you'd enjoy!

[Signature]
```

### 3.5 What to Ask Creators to Cover

- First impressions of the space and team
- The service itself (with consent protocols in place)
- Product recommendations from the spa's retail selection
- Honest review / recommendation to their audience

---

### 3.6 Creator Impact Tracking

Not all creator partnerships will deliver meaningful results. Track each collaboration individually to identify which partnerships are worth repeating or deepening.

**Per-creator tracking log (store in `/Reporting/Creator_Tracking/`):**

| Field | Notes |
|---|---|
| Creator name + handle | |
| Platform(s) posted on | |
| Post date | |
| Views / reach on their post | |
| Follows gained on client account (day of + 48hr after) | |
| Profile visits spike | Check Instagram Insights the day of posting |
| DMs or inquiries received | Client to report any direct messages referencing the creator |
| New bookings attributed | Best effort — ask new bookings how they heard about the spa |
| Worth repeating? | Yes / No / Maybe |

**Signal over vanity:** A creator with 5,000 followers who drives 3 bookings is more valuable than a creator with 50,000 followers who drives none. Track outcomes, not just reach.

---

### 3.7 Organic Engagement Strategy — Following Like-Minded Accounts

Beyond creator partnerships, a consistent organic engagement routine is one of the lowest-effort, highest-leverage growth tactics available. By actively following and engaging with aligned accounts, the client's profile becomes visible to audiences that are already interested in the same content — without spending anything.

**The core mechanic:** When the client's account comments meaningfully on a post from a relevant account, that comment is visible to everyone who views that post. If the comment adds value, those viewers click the profile. If the profile looks good (which Phase 2 ensures it does), they follow.

**Account categories to follow and engage with:**

| Category | Examples | Why |
|---|---|---|
| Local wellness businesses | Yoga studios, fitness coaches, naturopaths, massage therapists in Durham Region | Shared audience — their followers are wellness-minded locals |
| Local lifestyle accounts | Ajax / Oshawa / Whitby food, lifestyle, and community pages | Geographic audience overlap |
| Complementary beauty businesses | Nail studios, hair salons, brow bars (non-competing services) | Referral-adjacent — clients who visit one visit others |
| Skincare and beauty educators | Dermatologists, estheticians, skincare influencers with educational content | Content alignment — their audience already values skincare expertise |
| Product brands stocked by the client | Any brands whose products are sold or used in the spa | Brand communities are warm audiences; the brand may also reshare |
| Local business collectives | Durham Region business groups, BIAs, "shop local" accounts | Community credibility and local visibility |

**Engagement rules — quality over quantity:**

- Leave genuine, specific comments — not emoji-only or generic ("great post!") responses. Those read as spam and damage credibility.
- Comments should add something: a question, a relevant insight, a shared experience, or a compliment that references the actual content.
- Aim for 10–15 meaningful interactions per day across platforms during the active growth phase.
- Follow accounts before engaging — a follow with no interaction history looks like a bot. Engage first, follow second, or both simultaneously.
- Never mass-follow and unfollow (follow-for-follow tactics). It damages account trust signals on Instagram and TikTok's algorithms.

**Content to interact with:**

- Posts using local hashtags (`#AjaxOntario`, `#DurhamRegionWellness`, `#ShopLocalDurham`)
- Posts from the account categories above
- Posts about self-care, skincare routines, wellness, and beauty that are trending or high-engagement

**Engagement log (optional but useful during PoC):**

Track which account categories are generating profile visit spikes or follows back. If engagement with a specific niche consistently drives traffic, double down on that category and deprioritize ones that don't convert.

Store in: `/Reporting/Engagement_Log/[Month]_Organic_Engagement.md`

| Date | Account engaged | Category | Action (comment / follow / like) | Result (follow-back / profile visit spike) |
|---|---|---|---|---|

**Relationship building — think long game:**

Regular engagement with the same local accounts over weeks builds recognition. A yoga studio that sees consistent thoughtful comments from the spa's account will eventually follow back, reshare content, or suggest a collaboration. This is how organic cross-promotion develops without a formal agreement — and it costs nothing but 15 minutes a day.

---

## Phase 4 — Analytics Review & Comparison

**Objective:** Measure and document the impact of all Phase 2 and 3 activity against the Phase 1 baseline. Use this data to validate the PoC and build case study material.

**Timing:** Formal review at ~Month 3. Milestone check-ins at Week 6 and Month 2 to catch issues early.

---

### 4.0 Milestone Check-Ins

Do not wait until the 3-month mark to assess progress. Two internal check-ins are scheduled within the window:

**Week 6 Check-In (internal only)**
- Pull a quick snapshot of all tracked metrics.
- Is follower growth trending upward?
- Are any content types clearly outperforming others?
- Is the posting cadence being maintained?
- Flag any concerns to adjust strategy early — not at the end.
- Document findings in: `/Reporting/Checkpoints/Week6_Snapshot.md`

**Month 2 Check-In (internal only)**
- Repeat the same snapshot.
- Assess creator collaboration results so far — any clearly working partnerships?
- Confirm the evergreen content bank is stocked.
- Identify whether Phase 5 (storefront) setup should begin to be planned.
- Document findings in: `/Reporting/Checkpoints/Month2_Snapshot.md`

---

### 4.1 Metrics to Re-Capture

Pull the same metrics recorded in Phase 1 from each platform:

**Social Media**

| Metric | Baseline | Wk 6 | Mo 2 | Mo 3 | Change |
|---|---|---|---|---|---|
| Follower count | | | | | |
| Avg. reach per post | | | | | |
| Avg. engagement rate | | | | | |
| Avg. video views | | | | | |
| Post frequency | | | | | |
| Profile visits | | | | | |
| Website link clicks | | | | | |

**Google Business Profile** (if captured at baseline)

| Metric | Baseline | 3-Month | Change |
|---|---|---|---|
| Total reviews | | | |
| Search impressions | | | |
| Direction requests | | | |
| Website clicks from GBP | | | |

### 4.2 Qualitative Assessment

In addition to numbers, document:

- Has the client received more direct inquiries or bookings since posting began?
- Has the visual quality and consistency of the profile improved?
- Has the client reported feeling more confident in their online presence?
- What content types performed best? Why?

### 4.3 Case Study Evidence

Package the comparison data into a shareable case study format:

- Before / after follower and engagement stats
- Screenshots of top-performing posts
- Creator collaboration results (reach, saves, follows generated)
- Client testimonial (quote from the business owner)

**Output document:** `Symmetry_Esthetics_PoC_Case_Study_Draft.md`

---

## Phase 5 — Online Storefront Setup (Shopify)

**Objective:** Once the social presence is established and engagement is demonstrably growing, layer in an e-commerce revenue stream for the client.

**Prerequisite:** Phase 4 review shows positive engagement trajectory.

**Timing:** Month 4+ (after analytics validation).

---

### 5.1 Revenue Model Discussion (First)

Before building anything, agree on the business arrangement with the client.

**Topics to cover:**

- What percentage of product sale revenue goes to the client vs. the project?
- Who manages fulfillment? (Project lead handles logistics — this is the Pillar 2 value proposition)
- Who handles customer service for online orders?
- Are there any products the client does NOT want sold online?
- How will pricing be set? (Same as in-store, or different?)

**Document the agreement before any store setup begins.**

---

### 5.2 Product Research

Identify what the client can sell online.

**Sources to evaluate:**

- Products currently stocked and sold in-store
- Supplier relationships the client already has
- Industry trade shows and esthetics conventions (for new product discovery)
- Competitor online store audits (what are other local spas selling?)

**Product categories for a spa client:**
- Skincare (cleansers, serums, moisturizers)
- Treatment add-ons (masks, exfoliants)
- Branded merchandise (if applicable)
- Gift cards and experience packages

### 5.3 Pricing Strategy

For each product, document:
- Cost to source
- Target retail price
- Margin after platform fees and shipping
- Whether the price matches or differs from in-store pricing

---

### 5.4 Product Photography

Product pages on Shopify are only as credible as their photography. Supplier stock images are an acceptable starting point, but original photography is required for any product being positioned as a signature or branded offering.

**Standards:**
- Clean neutral background (white or light gray) — consistent across all product shots
- Multiple angles per product (front, back, label detail)
- Lifestyle shots where applicable (product in use, on a vanity, in context)
- Consistent lighting — all photos shot in the same session for visual coherence

**Who shoots it:** Justin handles product photography as part of the content partnership. Schedule a dedicated product shoot session before the store goes live.

**File specs for Shopify:** Minimum 2048 × 2048px, square crop preferred, JPG or PNG.

---

### 5.5 Returns & Refund Policy

A basic policy must be written and published on the Shopify store before launch. This protects both the client and the project from ambiguous customer situations.

**Recommended baseline policy for a spa/skincare store:**

- Opened skincare products: no returns for health and hygiene reasons
- Unopened products: exchange or store credit within 14 days of delivery, with proof of purchase
- Damaged or incorrect items: full replacement or refund, no return required
- Gift cards: non-refundable
- Digital products (if any): no refunds

**Process:** Customer contacts the store via email (set up a dedicated orders@ or hello@ address). Project lead handles the first response and coordinates with the client if the situation requires a judgment call.

**Document the agreed policy** and get the client's sign-off before it goes live on the store.

---

### 5.6 Shopify Setup Checklist

- [ ] Revenue model and profit split agreed and documented (see 5.1)
- [ ] Returns and refund policy written and client-approved (see 5.5)
- [ ] Product list finalized with pricing confirmed
- [ ] Product photography completed by Justin — all images at spec (min 2048×2048px, square, neutral bg)
- [ ] Shopify store created and domain configured
- [ ] Brand colors, fonts, and logo applied to storefront theme
- [ ] Products listed with original photography and descriptions
- [ ] Shipping rates and fulfillment methods configured
- [ ] Payment processing enabled (Shopify Payments or Stripe)
- [ ] Tax settings configured for Ontario / Canada
- [ ] Returns policy published on store
- [ ] Customer service email address configured (orders@ or hello@)
- [ ] Link from Instagram and TikTok bio to store
- [ ] "Shop" tab enabled on Instagram profile (if eligible)
- [ ] Test order completed successfully
- [ ] Order notification system set up for project lead (fulfillment trigger)

---

## Workflow Summary — Phase Timeline

| Phase | Activity | Timing |
|---|---|---|
| 1 | Analytics baseline capture | Week 1 |
| 2 | Content discovery, pipeline setup, auto-posting | Weeks 1–4 setup; ongoing |
| 3 | Local creator outreach and partnerships | Week 3+ (after profile is credible); through Month 3 |
| 4 | Milestone check-in #1 | Week 6 |
| 4 | Milestone check-in #2 | Month 2 |
| 4 | Full analytics review and comparison | Month 3 |
| 5 | Storefront setup (Shopify) | Month 4+ (after analytics validation) |

---

## Repeatable Use — Future Clients

This workflow is designed to be adapted, not rebuilt, for each new client. When onboarding a future client:

1. Swap the platform audit platforms if different (e.g. Pinterest for a design-adjacent client)
2. Adjust content format library to match the vertical's aesthetic and subculture
3. Update creator research niche keywords
4. Adjust product category list for 5.2
5. Use same folder structure, same calendar system, same pipeline stages

Vertical-specific "vibe playbooks" will be built on top of this base workflow as future clients are onboarded.

---

*This document is a living reference. Update as workflows are tested, refined, or replaced with better approaches. All changes should be versioned and dated.*

*v1.3 — May 2026: Added section 3.7 — Organic Engagement Strategy covering like-minded account following, engagement rules, account categories, engagement log template, and long-game relationship building approach.*
