// Facebook Page onboarding — collects the Page ID and Page Access Token,
// stores them in credentials JSON. The actual audit/report logic isn't
// built yet; this lets you attach a FB Page platform_account today so it
// starts working as soon as the audit is implemented.

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

const FLAG_PAGE_ID = "facebookPageId";
const FLAG_PAGE_TOKEN = "facebookPageToken";

export async function onboardFacebookPage(
  input: PlatformOnboardingInput,
): Promise<PlatformOnboardingResult> {
  const { flagValues, interactive } = input;
  let rl: Interface | undefined =
    interactive && flagValues[FLAG_PAGE_ID] === undefined
      ? createInterface({ input: process.stdin, output: process.stdout })
      : undefined;
  try {
    const pageId = await resolveField(
      "facebook-page-id",
      flagValues[FLAG_PAGE_ID],
      "Facebook Page ID",
      idSchema,
      interactive,
      rl,
    );
    if (rl !== undefined) {
      rl.close();
      rl = undefined;
    }
    const pageToken = await resolveField(
      "facebook-page-token",
      flagValues[FLAG_PAGE_TOKEN],
      "Page Access Token (input hidden)",
      tokenSchema,
      interactive,
      undefined,
      { masked: true },
    );

    return {
      external_account_id: pageId,
      credentials: JSON.stringify({
        page_access_token: pageToken,
      }),
    };
  } finally {
    if (rl !== undefined) rl.close();
  }
}

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
