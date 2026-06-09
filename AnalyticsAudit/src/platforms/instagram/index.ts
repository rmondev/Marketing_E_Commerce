// Instagram registry entry. Bundles the IG-specific audit, report
// generators, onboarding, and token-refresh into a single PlatformHandle
// the registry hands back to the CLIs.

import type { PlatformHandle } from "../_registry.js";
import { notImplemented } from "../_registry.js";
import { runInstagramAudit } from "./audit.js";
import { generateReport } from "./markdown-report.js";
import { onboardInstagram } from "./onboarding.js";
import { generateTrendReport } from "./trend-report.js";

export const instagramPlatform: PlatformHandle = {
  name: "instagram",
  displayName: "Instagram",
  capabilities: {
    audit: true,
    reports: true,
    onboarding: true,
    // Token refresh still lives in cli/token-refresh.ts as a direct
    // IG-specific flow; wiring it through the registry is a future
    // cleanup.
    tokenRefresh: false,
  },
  audit: runInstagramAudit,
  generateMarkdownReport: generateReport,
  generateTrendReport,
  onboarding: onboardInstagram,
  tokenRefresh: () => notImplemented("Instagram", "tokenRefresh via registry (use cli/token-refresh.ts directly)"),
};
