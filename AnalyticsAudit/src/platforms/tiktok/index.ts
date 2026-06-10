// TikTok registry entry.
//
// Phase status:
//   G1 — OAuth onboarding (+ manual-token workaround). Done.
//   G2 — Display API wrapper (api.ts / types.ts). Done.
//   G3 — audit + Markdown report + HTML trend report (this file wires them). Done.
//
// TikTok uses a separate API (open.tiktokapis.com) and OAuth flow (PKCE +
// rotating refresh tokens). The audit auto-refreshes the access token inline
// (see audit.ts → ensureFreshToken), so there's no manual token-refresh step
// during normal use; the registry's tokenRefresh hook stays a stub until the
// token:refresh CLI becomes registry-aware.

import type { PlatformHandle } from "../_registry.js";
import { notImplemented } from "../_registry.js";
import { runTikTokAudit } from "./audit.js";
import { generateTikTokReport } from "./markdown-report.js";
import { onboardTikTok } from "./onboarding.js";
import { generateTikTokTrendReport } from "./trend-report.js";

export const tiktokPlatform: PlatformHandle = {
  name: "tiktok",
  displayName: "TikTok",
  capabilities: {
    audit: true,
    reports: true,
    onboarding: true,
    tokenRefresh: false,
  },
  audit: runTikTokAudit,
  generateMarkdownReport: generateTikTokReport,
  generateTrendReport: generateTikTokTrendReport,
  onboarding: onboardTikTok,
  tokenRefresh: () => notImplemented("TikTok", "token refresh"),
};
