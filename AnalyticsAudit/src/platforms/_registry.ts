// Central registry of supported platforms. Each platform exports a
// PlatformHandle bundling its audit, report, and (in Phase E) onboarding +
// token-refresh functions. CLIs (audit, report:trend, token:refresh) look
// up a platform by name and dispatch through the handle — they never
// import a platform's internals directly.
//
// To add a new platform:
//   1. Create src/platforms/<name>/index.ts exporting a PlatformHandle
//   2. Register it in PLATFORMS below
//   3. Done. CLIs pick it up automatically.

import type { ClientRef, GenerateReportResult } from "./instagram/markdown-report.js";
import type { GenerateTrendResult } from "./instagram/trend-report.js";

import { instagramPlatform } from "./instagram/index.js";
import { facebookPagePlatform } from "./facebook-page/index.js";
import { tiktokPlatform } from "./tiktok/index.js";

// Re-export ClientRef so callers don't have to know which platform's file
// originally declared the type (it's the same shape across all platforms).
export type { ClientRef } from "./instagram/markdown-report.js";

// Row shape returned from `SELECT * FROM platform_accounts`. Kept here
// because every platform handle takes one of these as audit input.
export type PlatformAccount = {
  id: number;
  client_id: number;
  platform: string;
  external_account_id: string;
  display_handle: string | null;
  credentials: string; // JSON; shape defined per-platform
};

// Identifies the business this audit is running for. Subset of the clients
// row that every platform's audit needs (regardless of which platform).
export type AuditClient = {
  id: number;
  short_name: string;
  display_name: string;
};

export type PlatformAuditInput = {
  platformAccount: PlatformAccount;
  client: AuditClient;
  lookbackDays: number;
};

export type PlatformAuditResult = {
  snapshotId: number;
  rollingPath: string;
  archivePath: string | null;
};

// Token refresh input/output. For platforms whose tokens don't expire on
// a regular cadence (or where refresh is a no-op), the implementation can
// return success without doing work.
export type PlatformTokenRefreshInput = {
  platformAccount: PlatformAccount;
  // Free-form: each platform's refresh might prompt for or accept different
  // inputs. The CLI passes raw flag values through.
  flagValues: Record<string, string | boolean | undefined>;
};

export type PlatformTokenRefreshResult = {
  newCredentials: string; // updated JSON to write into platform_accounts.credentials
  expiresAtIso?: string;  // optional; for display only
};

export type PlatformHandle = {
  // Identifier used as the value of platform_accounts.platform (lowercase
  // snake_case for portability across SQL contexts).
  name: string;
  // Human-readable name shown in CLI output ("Instagram", "Facebook Page").
  displayName: string;
  // Set false for scaffolded-but-unbuilt platforms. CLI uses this to print
  // a friendly skip message instead of attempting the call.
  isImplemented: boolean;

  audit: (input: PlatformAuditInput) => Promise<PlatformAuditResult>;
  generateMarkdownReport: (client: ClientRef) => GenerateReportResult;
  generateTrendReport: (client: ClientRef) => GenerateTrendResult | null;
  tokenRefresh: (input: PlatformTokenRefreshInput) => Promise<PlatformTokenRefreshResult>;
};

export const PLATFORMS: Record<string, PlatformHandle> = {
  [instagramPlatform.name]: instagramPlatform,
  [facebookPagePlatform.name]: facebookPagePlatform,
  [tiktokPlatform.name]: tiktokPlatform,
};

// Helper used by stub platforms — throws a clear error if a not-implemented
// function gets accidentally called. Stubs short-circuit via isImplemented
// in the CLIs, but this guards against direct programmatic use.
export function notImplemented(platform: string, what: string): never {
  throw new Error(
    `${platform} ${what} not yet implemented — register the platform's index.ts with isImplemented=true and provide a real function before calling.`,
  );
}
