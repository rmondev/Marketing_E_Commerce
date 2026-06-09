// TikTok onboarding — placeholder. Collects a handle/username and an
// access token by direct paste. The real OAuth/PKCE flow comes when the
// TikTok audit implementation lands; today this just persists whatever
// the operator provides so the platform_account row exists.

import { createInterface, type Interface } from "node:readline/promises";
import { z } from "zod";
import { askMasked } from "../../core/lib/prompt.js";
import type {
  PlatformOnboardingInput,
  PlatformOnboardingResult,
} from "../_registry.js";

const handleSchema = z
  .string()
  .trim()
  .min(1, "must be non-empty")
  .regex(/^@?[A-Za-z0-9_.]+$/, "must look like a TikTok handle, e.g. @rmondev");
const tokenSchema = z.string().trim().min(20, "looks too short");

const FLAG_HANDLE = "tiktokHandle";
const FLAG_TOKEN = "tiktokAccessToken";

export async function onboardTikTok(
  input: PlatformOnboardingInput,
): Promise<PlatformOnboardingResult> {
  const { flagValues, interactive } = input;
  let rl: Interface | undefined =
    interactive && flagValues[FLAG_HANDLE] === undefined
      ? createInterface({ input: process.stdin, output: process.stdout })
      : undefined;
  try {
    const handle = await resolveField(
      "tiktok-handle",
      flagValues[FLAG_HANDLE],
      "TikTok handle (e.g. @rmondev)",
      handleSchema,
      interactive,
      rl,
    );
    if (rl !== undefined) {
      rl.close();
      rl = undefined;
    }
    const accessToken = await resolveField(
      "tiktok-access-token",
      flagValues[FLAG_TOKEN],
      "Access Token (input hidden)",
      tokenSchema,
      interactive,
      undefined,
      { masked: true },
    );

    // Strip leading @ for the external_account_id; preserve it for display.
    const stripped = handle.startsWith("@") ? handle.slice(1) : handle;
    return {
      external_account_id: stripped,
      display_handle: handle.startsWith("@") ? handle : `@${stripped}`,
      credentials: JSON.stringify({
        access_token: accessToken,
        // refresh_token + expires_at slots reserved for the future
        // OAuth/PKCE flow.
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
