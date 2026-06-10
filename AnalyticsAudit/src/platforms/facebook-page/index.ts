// Facebook Pages registry entry. Ships a "thin v1" audit + reports that
// capture what Meta exposes in dev mode (Page profile + post inventory).
// Engagement metrics, page insights, and demographics require Meta App
// Review — see docs/APP_REVIEW.md for the unblock path.

import type { PlatformHandle } from "../_registry.js";
import { notImplemented } from "../_registry.js";
import { runFacebookPageAudit } from "./audit.js";
import { generateFacebookPageReport } from "./markdown-report.js";
import { onboardFacebookPage } from "./onboarding.js";
import { generateFacebookPageTrendReport } from "./trend-report.js";

export const facebookPagePlatform: PlatformHandle = {
  name: "facebook_page",
  displayName: "Facebook Page",
  capabilities: {
    // Thin v1: audit runs and captures a useful snapshot (followers + fans +
    // post inventory) even without App Review. Once review approves the
    // pages_read_engagement scope, audit.ts and the report renderers gain
    // engagement data with no schema changes.
    audit: true,
    reports: true,
    onboarding: true,
    tokenRefresh: false,
  },
  audit: runFacebookPageAudit,
  generateMarkdownReport: generateFacebookPageReport,
  generateTrendReport: generateFacebookPageTrendReport,
  onboarding: onboardFacebookPage,
  tokenRefresh: () => notImplemented("Facebook Page", "token refresh"),
};
