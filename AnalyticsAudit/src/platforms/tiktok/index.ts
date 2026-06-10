// TikTok registry entry.
//
// Phase status:
//   G1 — OAuth onboarding (+ manual-token workaround). Done.
//   G2 — Display API wrapper (api.ts / types.ts). Done.
//   G3 — audit + Markdown report (this file wires them). Done.
//   Next — HTML trend report (generateTrendReport) flips `reports` to true.
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

export const tiktokPlatform: PlatformHandle = {
  name: "tiktok",
  displayName: "TikTok",
  capabilities: {
    audit: true,
    // HTML trend report not built yet — report:trend skips TikTok until this
    // flips. The Markdown rolling report IS generated (inside the audit).
    reports: false,
    onboarding: true,
    tokenRefresh: false,
  },
  audit: runTikTokAudit,
  generateMarkdownReport: generateTikTokReport,
  generateTrendReport: () => notImplemented("TikTok", "trend report"),
  onboarding: onboardTikTok,
  tokenRefresh: () => notImplemented("TikTok", "token refresh"),
};
