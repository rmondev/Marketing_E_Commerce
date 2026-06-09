// Instagram registry entry. Bundles the IG-specific audit, report
// generators, and token-refresh into a single PlatformHandle the registry
// hands back to the CLIs.

import type { PlatformHandle } from "../_registry.js";
import { notImplemented } from "../_registry.js";
import { runInstagramAudit } from "./audit.js";
import { generateReport } from "./markdown-report.js";
import { generateTrendReport } from "./trend-report.js";

export const instagramPlatform: PlatformHandle = {
  name: "instagram",
  displayName: "Instagram",
  isImplemented: true,
  audit: runInstagramAudit,
  generateMarkdownReport: generateReport,
  generateTrendReport,
  // Token refresh still lives in cli/token-refresh.ts as a direct
  // IG-specific flow because the prompts + .env.local rewriting are
  // tightly coupled to the Meta Graph token model. Wiring it through the
  // registry is a future cleanup.
  tokenRefresh: () => notImplemented("Instagram", "tokenRefresh via registry (use cli/token-refresh.ts directly)"),
};
