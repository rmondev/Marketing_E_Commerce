# Master Project Document
## Digital Marketing PoC — Systems-Oriented Agency Build

**Document Type:** Master Reference / Project Bible  
**Status:** Active — Proof of Concept Phase  
**Last Updated:** May 2026  
**Version:** 1.3  
**Prepared By:** Project Lead

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Project Mindset & Philosophy](#2-project-mindset--philosophy)
3. [Core Objectives](#3-core-objectives)
4. [Business Model Vision](#4-business-model-vision)
5. [Operational Pillars](#5-operational-pillars)
6. [Partner Ecosystem](#6-partner-ecosystem)
7. [Areas of Work](#7-areas-of-work)
8. [Workflow & Operations](#8-workflow--operations)
9. [AI Integration Strategy](#9-ai-integration-strategy)
10. [Project Management Approach](#10-project-management-approach)
11. [Success Metrics](#11-success-metrics)
12. [Current Status & Phase Plan](#12-current-status--phase-plan)
13. [Design Principles](#13-design-principles)
14. [Long-Term Scalability Vision](#14-long-term-scalability-vision)

---

## 1. Project Overview

This project is a **Proof of Concept (PoC)** for a systems-oriented digital marketing and content operations business. Rather than launching as a traditional marketing agency, the approach is to first validate repeatable workflows, branding systems, and content pipelines using a real local business as the inaugural PoC client.

The PoC client is a local esthetics and spa business in Ajax, Ontario. This client serves as the live proving ground for all workflows, content systems, and operational processes being developed. Nothing about the business model is assumed to be finalized — everything is being tested, iterated, and documented as the project evolves.

The project simultaneously serves several purposes:

- Helping a real local business improve its digital presence and online visibility
- Building and validating repeatable content and marketing workflows
- Learning digital marketing operations through hands-on execution
- Creating portfolio and case study material
- Laying the groundwork for a scalable service model targeting other local service businesses

---

## 2. Project Mindset & Philosophy

### Core Approach

This project is run with **software-development thinking applied to marketing operations.** The mental model is closer to a startup engineering team than a traditional marketing agency.

Key principles:

- **Systems over tasks.** Every piece of work should produce a reusable process, not just a one-off output.
- **Documentation is execution.** If a workflow isn't written down, it doesn't exist. Documentation is treated as a first-class deliverable.
- **Iteration over perfection.** Speed of learning matters more than polish at this stage. Ship, observe, refine.
- **Modularity.** Every system built should be adaptable to different clients, industries, and vibes without being rebuilt from scratch.
- **Lean execution.** No over-engineering. No enterprise-scale tooling before it's needed. Manual workflows are acceptable while systems are being validated.

### What This Project Is NOT

- Not a traditional marketing agency taking on multiple clients immediately
- Not trying to build a perfect enterprise stack before proving anything
- Not aiming for fully automated infrastructure at this stage
- Not treating any current workflow as permanent

### What This Project IS

- An operational PoC designed to generate evidence that the model works
- A learning environment where mistakes are cheap and speed is rewarded
- A documentation engine building the future playbook
- A case study in progress

---

## 3. Core Objectives

### Immediate Objectives
1. Improve the PoC client's online presence and brand consistency
2. Build a cohesive visual and content identity for the PoC client
3. Establish consistent, repeatable social media posting workflows
4. Organize raw content intake from the videography partner into a reliable pipeline

### Short-Term Objectives
5. Demonstrate measurable engagement growth through the PoC
6. Develop and document a Content Relay System (capture → storage → publish)
7. Explore online store and e-commerce integration opportunities
8. Build out organized project management infrastructure (Jira/Confluence style)

### Long-Term Objectives
9. Package all developed systems into a "Turnkey Digital Marketing Solution" for service-based businesses
10. Expand the model to additional local service business verticals (barbershops, tattoo studios, etc.)
11. Transition from "doing the work" to "delivering the system" for clients
12. Build a portfolio-worthy, documented case study from the PoC engagement

---

## 4. Business Model Vision

### Current State
Operating as a solo strategist and logistics lead, directly executing digital marketing and content operations for the PoC client. Revenue model, pricing, and formal client agreements are not yet the focus.

### Target State
A lean digital marketing and operations agency offering a **turnkey content and e-commerce solution** for local service-based businesses, with the following components:

**Content Operations Service**
- Content capture coordination (working with videography/photo partners)
- Content organization, editing pipeline, and scheduling
- Social media management and consistency
- Brand identity maintenance

**E-Commerce Enablement**
- Online store setup and product integration (Shopify)
- Logistics and fulfillment coordination (last-mile management)
- Product photography coordination
- Returns and customer service management
- Allowing service providers to monetize products without managing operations themselves

**Agency Enablement Model (Future)**
- Packaging the above systems into a repeatable solution
- Serving multiple verticals: spas, barbershops, tattoo studios, fitness, and others
- Transitioning to a provider of systems, not just services

### Target Client Profile
Local service-based businesses that:
- Have strong craft/skill but limited digital marketing bandwidth
- Are underrepresented online relative to their actual quality
- Would benefit from consistent social presence and e-commerce capability
- Cannot afford or don't need a large traditional agency

---

## 5. Operational Pillars

### Pillar 1 — Content Relay System
Automate and standardize the flow from raw content capture to organized storage to published output.

**Stages:**
1. Raw capture by videography/photography partner (Justin)
2. Intake into organized raw content inbox/folder
3. Internal team review (quality, branding, caption accuracy)
4. Client 48-hour review window via WhatsApp — auto-approved on silence
5. Scheduling and publishing
6. Performance tracking and archiving

**Goal:** Eliminate chaos in the content pipeline. Make content delivery predictable and consistent regardless of who is executing it.

**Future State:** Automate client review notifications via Twilio SMS API with inbound webhook listener for HOLD replies.

### Pillar 2 — Logistics-First E-Commerce
Manage the physical and operational "last mile" of product sales on behalf of the PoC client, freeing the business owner to focus on delivering services.

**Components:**
- Product sourcing and research (current stock + industry conventions)
- Online store setup (Shopify)
- Product photography (coordinated with Justin)
- Order management and fulfillment coordination
- Returns and refund policy management
- Shipping coordination

**Goal:** Create a revenue stream for the client without adding operational burden to their business.

### Pillar 3 — Agency Enablement
Document and package all systems so they can be deployed for future clients without rebuilding from scratch.

**Deliverables:**
- Repeatable workflow templates
- Onboarding documentation
- Client intake systems
- Content and branding playbooks by vertical
- Creator partnership agreement templates
- Consent and media release templates

**Goal:** Transform PoC learnings into a productized offering.

### Pillar 4 — AI Integration
Use AI tools as backend agents to accelerate content operations, documentation, and workflow management.

**Current AI Stack:**
- Claude — strategic planning, documentation, structured systems thinking
- ChatGPT — content drafting, ideation, creative copy
- Gemini — research, cross-referencing, supplemental reasoning

**Future Integration:**
- Twilio API — automated client approval notifications and inbound reply handling
- Scheduling APIs — Instagram Graph API, TikTok API for auto-publishing from Scheduled folder

**Goal:** Build AI-assisted workflows that are reproducible and don't rely on specific prompt memory. Document prompt patterns and AI roles for each workflow stage.

---

## 6. Partner Ecosystem

| Role | Description |
|---|---|
| **Project Lead** | Strategist, systems architect, logistics coordinator, and marketing operations lead |
| **PoC Client** | Local esthetics/spa business in Ajax, Ontario — the live proving ground for all systems |
| **Content Partner** | Videographer (Justin) responsible for on-site content capture and product photography |

### Partner Coordination Notes
- Content partner (Justin) delivers raw footage/photos and handles product photography; project lead manages the intake and relay pipeline
- PoC client communication is managed through WhatsApp as the primary channel; Google Drive shared folder for content collaboration
- Client discovery and feedback processes are being built to reduce ambiguity and gather actionable information
- Local content creators (micro-influencers) are engaged on a per-partnership basis under a documented deliverables agreement

---

## 7. Areas of Work

### Branding
- Visual identity development (color palettes, typography, tone)
- Branding consistency across all content and platforms
- Aesthetic direction tailored to the PoC client's market positioning
- Reference asset library (colors, fonts, visual guidelines)

### Social Media Strategy
- Analytics baseline capture across all active platforms before work begins
- Content planning and editorial calendars
- Posting consistency and scheduling (target 3–4 posts per week)
- Audience engagement and growth strategy
- Testimonial and social proof integration
- Video content pipeline
- Reusable content formats and templates
- Synonymization content — associating the brand with broader wellness and lifestyle identity
- Evergreen content bank maintained as a scheduling buffer
- Milestone analytics check-ins at Week 6, Month 2, and Month 3

### Local Creator Partnerships
- Research and outreach to Durham Region micro-influencers (1,000–50,000 followers)
- Trade/comp partnership model during PoC phase
- Documented deliverables agreement per partnership (platform, format, deadline, tagging)
- Per-creator impact tracking (follows, profile visits, bookings attributed)
- Profile readiness gate — outreach begins only after 2–3 weeks of consistent posting

### Organic Engagement Strategy
- Daily engagement routine targeting 10–15 meaningful interactions per day
- Follow and engage with aligned account categories: local wellness businesses, complementary beauty services, skincare educators, product brands stocked by the client, local business collectives, and local lifestyle/community pages
- Genuine, specific comments on relevant posts — no spam or generic responses
- Engage with local hashtags: `#AjaxOntario`, `#DurhamRegionWellness`, `#ShopLocalDurham`
- Optional engagement log to track which account categories drive follow-backs and profile visits
- Long-game relationship building with recurring local accounts to develop organic cross-promotion without formal agreements

### Online Store / E-Commerce
- Shopify as the confirmed platform
- Revenue model and profit split agreed before build begins
- Product research: current stock, supplier relationships, industry conventions
- Original product photography (clean neutral background, multiple angles)
- Pricing strategy with margin analysis
- Returns and refund policy (documented and client-approved before launch)
- Fulfillment and logistics management by project lead

### Client Discovery & Intake
- Intake questionnaires designed to surface real business needs
- Content comfort assessment (on-camera tier: high / medium / low)
- Content consent and media release process for customer footage
- WhatsApp as primary client communication channel
- 48-hour post approval window with auto-approve on silence

### Presentation & Pitch Materials
- Business growth presentation concepts
- Digital transformation explainer materials
- Testimonial and video embedding in slides
- Visual storytelling for client-facing materials

---

## 8. Workflow & Operations

### Information Architecture
All project information flows through a centralized structure:

```
Raw Inputs (Intake)
    └── Internal Review (Quality, Branding, Caption)
        └── Client Review Window (48 hrs via WhatsApp)
            └── Scheduled (Auto-post reads from here)
                └── Posted Archive + Performance Log
                    └── Documentation & Templates
```

### Content Pipeline Folder Structure (Google Drive)

```
/[ClientName]_Content_Pipeline/
    /01_Ideas_Intake/         ← Client drops raw ideas, voice notes, photos here
    /02_Drafting/             ← Captions, concepts, scripts in progress
    /03_Production/           ← Raw video/photo from Justin or client
    /04_Review/               ← Internal team review; holds returned here
    /05_Scheduled/            ← Approved and ready to post
    /06_Posted_Archive/       ← Published content with date + performance log
    /07_Evergreen_Bank/       ← Pre-built stock posts ready to fill schedule gaps
```

### Project Folder Structure

```
/Project Root
    /Brand Assets
        /Logos
        /Colors & Typography
        /Templates
    /Content Pipeline          ← Per client (see above)
    /Campaigns
    /Client Discovery
        /Consent_Forms
    /Documentation
        /Workflows
        /Playbooks
        /Meeting Notes
    /Reporting
        /Baseline
        /Checkpoints
        /Creator_Tracking
```

### Daily Workflow Cadence (Target)
- **Raw inbox review** — assess new content, messages, inputs
- **Processing queue** — move raw items into active work
- **Scheduling check** — confirm upcoming posts and deadlines
- **Documentation update** — capture what was done and what changed

### Key Workflow Principles
- Raw content never lives in the same place as processed content
- Every content piece moves through defined stages before publishing
- Client has a 48-hour window to flag posts via WhatsApp; silence = approved
- Holds pause posts — they are never deleted, always documented
- All workflows are documented as they're developed, not after
- Templates are created the second something is done more than once
- Evergreen bank replenished whenever it drops below 5 pieces

### Client Approval Policy
The client is notified of upcoming posts and has 48 hours to reply "HOLD" via WhatsApp before a post publishes automatically. This policy is agreed in writing during onboarding. It protects the client's right to flag content while ensuring the posting schedule is never blocked by a non-response. Liability is shared — the client has been notified and had the opportunity to intervene.

**Future State — Twilio Automation (Post-PoC):**
Replace manual WhatsApp notifications with automated SMS via Twilio API. A backend service with a webhook listener handles inbound HOLD replies, updates post status, and notifies the project lead. Only the registered client phone number can trigger a hold.

---

## 9. AI Integration Strategy

### Philosophy
AI tools are treated as **specialized team members**, not magic solutions. Each tool has a defined role. Prompts and workflows are designed to be reproducible — not dependent on chat memory or session continuity.

### Tool Roles

| Tool | Primary Role |
|---|---|
| **Claude** | Strategic planning, systems design, documentation, structured workflows |
| **ChatGPT** | Content drafting, creative copy, social media captions, ideation |
| **Gemini** | Research, cross-referencing, supplemental analysis |
| **Twilio** (planned) | Automated client SMS notifications and inbound reply handling |

### Cross-Platform Continuity
Since AI tools don't share memory across sessions or platforms, continuity is maintained through:
- This master document (and derivative documents) being re-imported into sessions as context
- Standardized prompt templates for recurring tasks
- Documented outputs stored in the project folder, not in chat history

### AI Workflow Integration Points
- Content caption drafting
- Hashtag and keyword research
- Client questionnaire design
- Documentation generation
- Campaign planning and brainstorming
- Workflow design and process engineering
- Reporting summaries
- Auto-posting trigger and scheduling (future state)

---

## 10. Project Management Approach

### Philosophy
Project management is modeled on software development practices — specifically Jira/Confluence-style workflows applied to marketing operations.

### Tooling (Current / Planned)
- **Jira** — task tracking, campaign management, sprint-style work organization
- **Confluence** — documentation, playbooks, SOPs, meeting notes
- **Google Drive** — client content pipeline and shared collaboration
- **WhatsApp** — primary client communication and post approval channel
- **Manual workflows** — acceptable during PoC phase while processes are validated

### Documentation Standards
- All workflows documented in Confluence-style pages
- Campaign work tracked as Jira issues/epics
- Meeting notes captured with action items
- Every process documented before it scales

### Work Organization Model
- Campaigns treated as Epics
- Individual tasks within campaigns as Issues/Stories
- Recurring workflows as Templates or Automation Rules (future state)
- Regular review cycles to update documentation

---

## 11. Success Metrics

### PoC Success Indicators
The PoC is considered successful when the following are demonstrably true:

**Content & Social**
- Consistent posting cadence established and maintained
- Measurable improvement in social media engagement vs. baseline
- Brand identity visibly more cohesive across all platforms
- Evergreen content bank operational and maintained

**Analytics**
- Baseline captured across all active platforms before work begins
- Week 6 and Month 2 internal check-ins completed and documented
- Full 3-month comparison report produced with before/after data
- Google Business Profile metrics showing increased local interest (supplementary)

**Operations**
- Repeatable content pipeline documented and functional
- Intake-to-publish workflow operating with minimal chaos
- Client approval process agreed and operating (48-hour WhatsApp window)
- Content consent and release process in place before any customer footage is posted
- Creator partnerships tracked with per-partnership impact logs
- All processes documented, not just practiced

**Business Impact**
- Increase in client inquiries or bookings attributable to digital presence improvements
- Client reports improved professionalism and online visibility
- Portfolio-worthy case study material generated

**E-Commerce**
- Revenue model agreed before storefront build begins
- Shopify store live with original product photography and published returns policy
- First product sale completed

**System Validation**
- At least one complete workflow documented end-to-end
- AI-assisted processes producing consistent, usable outputs
- Project management structure operational (Jira/Confluence or equivalent)
- Twilio approval automation scoped and ready for post-PoC build

---

## 12. Current Status & Phase Plan

### Phase 1 — Foundation (Current)
- [ ] Master document created (this document)
- [ ] Branding reference assets organized
- [ ] Content pipeline folder structure established (Google Drive)
- [ ] Client discovery document / intake questionnaire finalized
- [ ] Content comfort tier assessed (high / medium / low)
- [ ] Client approval policy agreed in writing (48-hour WhatsApp window)
- [ ] Content consent and media release template prepared
- [ ] Analytics baseline captured (social platforms + GBP + website if available)
- [ ] Content partner (Justin) workflow coordinated
- [ ] Evergreen content bank seeded (target: 10–15 pieces before first post)
- [ ] First content batch processed through pipeline

### Phase 2 — Execution & Iteration
- [ ] Consistent posting cadence achieved (3–4 posts/week)
- [ ] First content calendar built and executed
- [ ] Daily organic engagement routine established (10–15 interactions/day)
- [ ] Target account categories identified and initial follow/engage list built
- [ ] Creator outreach begins (Week 3+ after profile is credible)
- [ ] Deliverables agreements in place for each creator partnership
- [ ] Creator impact tracking log active
- [ ] Week 6 analytics check-in completed and documented
- [ ] Month 2 analytics check-in completed and documented
- [ ] E-commerce platform research completed (Shopify confirmed)
- [ ] Jira/Confluence project structure set up
- [ ] AI prompt templates documented for recurring tasks

### Phase 3 — Validation & Packaging
- [ ] Month 3 full analytics review completed vs. baseline
- [ ] Creator partnership results reviewed — identify which to continue
- [ ] Revenue model and profit split agreed with client
- [ ] Product list and pricing finalized
- [ ] Product photography session completed with Justin
- [ ] Returns and refund policy written and client-approved
- [ ] Shopify store built and tested
- [ ] All core workflows documented as repeatable playbooks
- [ ] Case study materials drafted
- [ ] Twilio approval automation scoped for next phase build
- [ ] Business model refined based on PoC learnings
- [ ] Expansion plan drafted for next client vertical

---

## 13. Design Principles

These principles apply to all work produced in this project — content, systems, and documentation.

1. **Modular** — Everything should be adaptable to a new client without rebuilding from scratch.
2. **Documented** — If it isn't written down, it doesn't exist.
3. **Lean** — Use the simplest tool that does the job. Add complexity only when necessary.
4. **Vibe-Aware** — Content and brand identity must be tuned to the specific subculture and aesthetic of each client. Cookie-cutter content is failure.
5. **Iterative** — Nothing is final. Everything improves over time with evidence.
6. **Transparent** — Progress, problems, and learnings are documented openly. No hiding behind busywork.

---

## 14. Long-Term Scalability Vision

### The End Goal
Package everything developed in this PoC into a **Turnkey Digital Marketing and E-Commerce Solution** for local service-based businesses — particularly those in creative or personal service industries.

### Target Verticals (Priority Order)
1. Esthetics / Spa / Beauty
2. Barbershops
3. Tattoo Studios
4. Fitness / Personal Training
5. Other local creative service businesses

### Scalability Model
- Each new client vertical gets a tailored "vibe playbook" but runs on the same underlying operational system
- Pricing and service tiers to be developed based on PoC learnings
- AI integration deepens over time as prompt libraries and workflow templates are validated
- Twilio-based client approval system becomes a standard component of the onboarding stack
- Potential to build a small team or contractor network to scale execution

### The Flywheel
```
PoC Client Success
    → Documented Systems
        → Repeatable Workflows
            → Next Client Onboarded Faster
                → Better Case Study
                    → Easier to Sell Next Client
```

The goal is to make each client engagement faster, cheaper to execute, and more impactful than the last — until the model is packageable as a product, not just a service.

---

*This document is a living reference. It should be updated as the project evolves, decisions are made, and new information surfaces. It is the single source of truth for the project's vision, structure, and operational approach.*

*v1.3 — May 2026: Added Organic Engagement Strategy to Areas of Work and Phase 2 checklist — covering daily engagement routine, aligned account categories, local hashtag targeting, engagement log, and long-game relationship building.*

*v1.2 — May 2026: Updated to reflect operational workflow decisions including 5-phase engagement model, GBP and website analytics baseline, Google Drive pipeline folder structure, 48-hour client approval policy via WhatsApp, Twilio automation as planned future state, content consent and release process, evergreen content bank, creator partnership deliverables and impact tracking, Phase 3 profile readiness gate, milestone check-ins at Week 6 and Month 2, Shopify as confirmed e-commerce platform, product photography standards, and returns/refund policy requirement.*
