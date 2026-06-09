// Instagram onboarding — collects the IG Business Account ID, the
// underlying Facebook Page ID, and the long-lived Page Access Token, then
// returns them packaged as a PlatformOnboardingResult ready to land in
// platform_accounts.
//
// Originally lived inside cli/client-add.ts; extracted here in Phase E so
// the orchestrator can dispatch per-platform.

import { createInterface, type Interface } from "node:readline/promises";
import { z } from "zod";
import { askMasked } from "../../core/lib/prompt.js";
import type {
  PlatformOnboardingInput,
  PlatformOnboardingResult,
} from "../_registry.js";

const idSchema = z.string().trim().regex(/^\d+$/, "must be all digits");
const tokenSchema = z
  .string()
  .trim()
  .min(20, "looks too short to be a real token");

// Flag names this platform reads out of the orchestrator's flagValues. The
// `--instagram-` prefix is the Phase E convention so every platform's flags
// are unambiguous: `--instagram-account-id` is clearly different from
// `--facebook-page-id` even though both happen to be numeric.
const FLAG_ACCOUNT_ID = "instagramAccountId";
const FLAG_PAGE_ID = "instagramPageId";
const FLAG_PAGE_TOKEN = "instagramPageToken";

export async function onboardInstagram(
  input: PlatformOnboardingInput,
): Promise<PlatformOnboardingResult> {
  const { flagValues, interactive } = input;
  // Allocate readline only if we'll actually use it. The token prompt is
  // always masked (uses raw mode) so the readline interface gets closed
  // before that step.
  let rl: Interface | undefined =
    interactive &&
    (flagValues[FLAG_ACCOUNT_ID] === undefined ||
      flagValues[FLAG_PAGE_ID] === undefined)
      ? createInterface({ input: process.stdin, output: process.stdout })
      : undefined;
  try {
    const igAccountId = await resolveField(
      "instagram-account-id",
      flagValues[FLAG_ACCOUNT_ID],
      "Instagram Business Account ID",
      idSchema,
      interactive,
      rl,
    );
    const pageId = await resolveField(
      "instagram-page-id",
      flagValues[FLAG_PAGE_ID],
      "Facebook Page ID (owns the IG account)",
      idSchema,
      interactive,
      rl,
    );
    // Close readline before the masked token prompt — askMasked grabs
    // stdin in raw mode and fights a live readline Interface.
    if (rl !== undefined) {
      rl.close();
      rl = undefined;
    }
    const pageToken = await resolveField(
      "instagram-page-token",
      flagValues[FLAG_PAGE_TOKEN],
      "Page Access Token (input hidden)",
      tokenSchema,
      interactive,
      undefined,
      { masked: true },
    );

    return {
      external_account_id: igAccountId,
      credentials: JSON.stringify({
        page_access_token: pageToken,
        fb_page_id: pageId,
      }),
    };
  } finally {
    if (rl !== undefined) rl.close();
  }
}

// Field-resolver pattern: pulls from a flag if provided, else prompts.
// Throws with a clear message in non-interactive mode if a required field
// is missing.
async function resolveField<T extends string>(
  flagName: string,
  flagValue: string | undefined,
  promptLabel: string,
  schema: z.ZodType<T>,
  interactive: boolean,
  rl: Interface | undefined,
  options: { masked?: boolean } = {},
): Promise<T> {
  if (flagValue !== undefined) {
    const parsed = schema.safeParse(flagValue);
    if (!parsed.success) {
      throw new Error(
        `Invalid --${flagName}: ${parsed.error.issues[0]?.message ?? "invalid"}`,
      );
    }
    return parsed.data;
  }
  if (!interactive) {
    throw new Error(
      `Missing required flag --${flagName} (non-interactive mode).`,
    );
  }
  if (!options.masked && rl === undefined) {
    throw new Error(
      `Internal: needed readline for --${flagName} prompt but none was provided.`,
    );
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const raw = options.masked
      ? await askMasked(`${promptLabel}: `)
      : await rl!.question(`${promptLabel}: `);
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    console.error(
      `  ${parsed.error.issues[0]?.message ?? "invalid"} (try again)`,
    );
  }
  throw new Error(`Too many invalid attempts for ${promptLabel}.`);
}
