// TikTok registry entry — scaffolding only. All functions throw
// `notImplemented` until the platform is built out. The CLI checks
// `isImplemented` before calling and prints a friendly skip message.
//
// Implementation plan (future session): TikTok uses a separate API
// (open.tiktokapis.com) and a separate OAuth flow (PKCE + refresh
// tokens). Expect a new api.ts, new types.ts (with TikTok-specific zod
// schemas), and a different token-refresh dance. Some helpers from
// src/core/reports/ may be reusable.

import type { PlatformHandle } from "../_registry.js";
import { notImplemented } from "../_registry.js";

export const tiktokPlatform: PlatformHandle = {
  name: "tiktok",
  displayName: "TikTok",
  isImplemented: false,
  audit: () => notImplemented("TikTok", "audit"),
  generateMarkdownReport: () => notImplemented("TikTok", "markdown report"),
  generateTrendReport: () => notImplemented("TikTok", "trend report"),
  tokenRefresh: () => notImplemented("TikTok", "token refresh"),
};
