// Facebook Pages registry entry — scaffolding only. All functions throw
// `notImplemented` until the platform is built out. The CLI checks
// `isImplemented` before calling and prints a friendly skip message.
//
// Implementation plan (future session): Facebook Pages uses the same Meta
// Graph API as Instagram (largely the same endpoints, just `/{page_id}`
// instead of `/{ig_business_account_id}`). Expect substantial code reuse
// from src/platforms/instagram/.

import type { PlatformHandle } from "../_registry.js";
import { notImplemented } from "../_registry.js";

export const facebookPagePlatform: PlatformHandle = {
  name: "facebook_page",
  displayName: "Facebook Page",
  isImplemented: false,
  audit: () => notImplemented("Facebook Page", "audit"),
  generateMarkdownReport: () =>
    notImplemented("Facebook Page", "markdown report"),
  generateTrendReport: () => notImplemented("Facebook Page", "trend report"),
  tokenRefresh: () => notImplemented("Facebook Page", "token refresh"),
};
