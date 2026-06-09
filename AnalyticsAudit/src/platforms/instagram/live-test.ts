// Live end-to-end smoke test for the Instagram Graph API wrapper.
// Hits the real API using the bootstrap token from .env.local and the
// rmondev IG Business account ID. Run with:  npm run test:instagram
//
// This is NOT a unit test — it makes real network calls. Use sparingly to
// verify the wrapper works against live data before wiring it into commands.

import { env } from "../../core/lib/env.js";
import { resolveMediaType } from "./types.js";
import {
  getAccountInsights,
  getAccountProfile,
  getMediaInsights,
  listRecentMedia,
} from "./api.js";

const igId = env.META_INSTAGRAM_BUSINESS_ACCT_ID;
const token = env.META_PAGE_ACCESS_TOKEN;

console.log(`Target IG Business Account: ${igId}\n`);

console.log("--- getAccountProfile ---");
const profile = await getAccountProfile(igId, token);
console.log(profile);

console.log("\n--- getAccountInsights (last 7d, reach + profile_views) ---");
const now = Math.floor(Date.now() / 1000);
const weekAgo = now - 7 * 24 * 60 * 60;
const insights = await getAccountInsights(igId, token, weekAgo, now, [
  "reach",
  "profile_views",
]);
console.log(insights);

console.log("\n--- listRecentMedia (limit 5) ---");
const media = await listRecentMedia(igId, token, 5);
console.log(`Got ${media.length} item(s):`);
for (const m of media) {
  const caption = m.caption ? m.caption.slice(0, 60).replace(/\s+/g, " ") : "(no caption)";
  console.log(`  ${m.media_type.padEnd(15)} ${m.id}  ${m.timestamp}  ${caption}`);
}

console.log("\n--- getMediaInsights for first 3 ---");
for (const m of media.slice(0, 3)) {
  const kind = resolveMediaType(m);
  const ins = await getMediaInsights(m.id, kind, token);
  console.log(`  ${m.id} (${kind}): ${ins ? JSON.stringify(ins) : "null"}`);
}

console.log("\nLive test complete.");
