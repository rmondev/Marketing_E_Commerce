// Multi-platform business onboarding. Prompts for business-level fields
// (name, short_name, notes), then asks Y/N for each platform whose handle
// has capabilities.onboarding=true, dispatches that platform's onboarding
// function, and persists clients + N platform_accounts rows in one
// transaction.
//
// Platform-specific flags are namespaced (--instagram-account-id,
// --facebook-page-id, etc.) and parsed by each platform's onboarding
// function out of the shared flagValues record.

import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { z } from "zod";
import { db } from "../core/db/client.js";
import {
  PLATFORMS,
  type PlatformHandle,
  type PlatformOnboardingResult,
} from "../platforms/_registry.js";

const nameSchema = z.string().trim().min(1, "must be non-empty");
const shortNameSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z0-9][a-z0-9_-]*$/,
    "must be lowercase alphanumeric with optional _ or - (e.g. rmondev, symmetry-esthetics)",
  );

const program = new Command();
program
  .name("client:add")
  .description(
    "Onboard a new business and attach one or more platform_accounts. Interactive by default; pass flags to skip prompts.",
  )
  .option("--name <name>", "Human-readable display name")
  .option("--short-name <shortName>", "CLI identifier, e.g. symmetry-esthetics")
  .option("--notes <notes>", "Optional free-text notes")
  .option(
    "--platform <name...>",
    "Which platforms to onboard. Repeatable. If omitted, interactive Y/N prompt per registered platform.",
  )
  // Per-platform flags — declared upfront so commander accepts them
  // without complaining. Platforms parse their own out of flagValues.
  .option("--instagram-account-id <id>", "[Instagram] IG Business Account ID")
  .option("--instagram-page-id <id>", "[Instagram] Facebook Page ID")
  .option(
    "--instagram-page-token <token>",
    "[Instagram] Page Access Token (input hidden if prompted)",
  )
  .option("--facebook-page-id <id>", "[Facebook Page] Page ID")
  .option(
    "--facebook-page-token <token>",
    "[Facebook Page] Page Access Token (input hidden if prompted)",
  )
  .option("--tiktok-handle <handle>", "[TikTok] @username")
  .option(
    "--tiktok-access-token <token>",
    "[TikTok] Access Token (input hidden if prompted)",
  );

program.parse();

type RawOpts = {
  name?: string;
  shortName?: string;
  notes?: string;
  platform?: string[];
  instagramAccountId?: string;
  instagramPageId?: string;
  instagramPageToken?: string;
  facebookPageId?: string;
  facebookPageToken?: string;
  tiktokHandle?: string;
  tiktokAccessToken?: string;
};
const rawOpts = program.opts() as RawOpts;

const onboardablePlatforms = Object.values(PLATFORMS).filter(
  (h) => h.capabilities.onboarding,
);

// Validate --platform values against the registry early so a typo doesn't
// surface only after the user has typed half their business details.
if (rawOpts.platform !== undefined) {
  for (const name of rawOpts.platform) {
    if (!(name in PLATFORMS)) {
      console.error(
        `Unknown --platform '${name}'. Known: ${Object.keys(PLATFORMS).join(", ")}`,
      );
      process.exit(1);
    }
    if (!PLATFORMS[name]!.capabilities.onboarding) {
      console.error(
        `Platform '${name}' has no onboarding implementation yet.`,
      );
      process.exit(1);
    }
  }
}

// Whether ANY interactive prompts will be needed. If every required field
// for the chosen platforms is supplied via flags, we run fully scripted.
const interactive =
  rawOpts.name === undefined ||
  rawOpts.shortName === undefined ||
  rawOpts.platform === undefined;

const rl = createInterface({ input: process.stdin, output: process.stdout });

let businessName: string;
let shortName: string;
let notes: string | undefined;
let selectedPlatforms: PlatformHandle[];

try {
  // Business-level prompts (or read straight from flags).
  businessName = await resolveBusinessField(
    "name",
    rawOpts.name,
    "Display name",
    nameSchema,
  );
  shortName = await resolveBusinessField(
    "short-name",
    rawOpts.shortName,
    "Short name (lowercase alphanumeric)",
    shortNameSchema,
  );
  notes = rawOpts.notes;
  if (notes === undefined && interactive) {
    const raw = (await rl.question("Notes (optional, Enter to skip): ")).trim();
    notes = raw === "" ? undefined : raw;
  }

  // Which platforms to onboard? Either --platform list or Y/N per registered platform.
  if (rawOpts.platform !== undefined) {
    selectedPlatforms = rawOpts.platform.map((n) => PLATFORMS[n]!);
  } else {
    console.log("\nWhich platforms does this business have?");
    selectedPlatforms = [];
    for (const handle of onboardablePlatforms) {
      const defaultYes = handle.name === "instagram";
      const ans = (
        await rl.question(
          `  ${handle.displayName}? [${defaultYes ? "Y/n" : "y/N"}] `,
        )
      )
        .trim()
        .toLowerCase();
      const chosen =
        ans === ""
          ? defaultYes
          : ans === "y" || ans === "yes";
      if (chosen) selectedPlatforms.push(handle);
    }
    if (selectedPlatforms.length === 0) {
      console.error(
        "\nNo platforms selected. A business needs at least one. Aborting.",
      );
      process.exit(1);
    }
  }

  // Close readline before any platform calls askMasked — they fight over stdin
  // in raw mode.
  rl.close();

  // Each platform's onboarding gathers its own fields. Returns the
  // (external_account_id, credentials, display_handle?) tuple we'll
  // INSERT into platform_accounts.
  const onboardResults: { handle: PlatformHandle; result: PlatformOnboardingResult }[] = [];
  for (const handle of selectedPlatforms) {
    console.log(`\n── ${handle.displayName} ──`);
    const result = await handle.onboarding({
      flagValues: rawOpts as unknown as Record<string, string | undefined>,
      interactive,
    });
    onboardResults.push({ handle, result });
  }

  // Single transaction: clients row + N platform_accounts rows.
  const insertClient = db.prepare(`
    INSERT INTO clients (short_name, display_name, created_at, notes)
    VALUES (?, ?, ?, ?)
  `);
  const insertPlatformAccount = db.prepare(`
    INSERT INTO platform_accounts (
      client_id, platform, external_account_id, display_handle,
      credentials, added_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const persist = db.transaction(() => {
    const nowIso = new Date().toISOString();
    const clientRes = insertClient.run(
      shortName,
      businessName,
      nowIso,
      notes ?? null,
    );
    const clientId = Number(clientRes.lastInsertRowid);
    const paIds: Array<{ handle: PlatformHandle; paId: number }> = [];
    for (const { handle, result } of onboardResults) {
      const paRes = insertPlatformAccount.run(
        clientId,
        handle.name,
        result.external_account_id,
        result.display_handle ?? null,
        result.credentials,
        nowIso,
      );
      paIds.push({ handle, paId: Number(paRes.lastInsertRowid) });
    }
    return { clientId, paIds };
  });
  let onboarded: ReturnType<typeof persist>;
  try {
    onboarded = persist();
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("UNIQUE constraint failed: clients.short_name")
    ) {
      console.error(
        `\nClient with short_name '${shortName}' already exists. ` +
          "To attach a new platform to it, run: " +
          `npm run client:platform:add -- --client ${shortName}`,
      );
      process.exit(1);
    }
    throw err;
  }

  console.log(`\n✓ Added client '${shortName}' (id=${onboarded.clientId}).`);
  console.log(`  display_name: ${businessName}`);
  if (notes) console.log(`  notes:        ${notes}`);
  for (const { handle, paId } of onboarded.paIds) {
    const heads_up = !handle.capabilities.audit
      ? " (⚠ audit support not yet implemented; npm run audit will skip this platform)"
      : "";
    console.log(`  ${handle.displayName.padEnd(15)} platform_account_id=${paId}${heads_up}`);
  }
} catch (err) {
  console.error(
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
} finally {
  try {
    rl.close();
  } catch {
    // already closed
  }
}

// Helper: prompt OR pull from a flag for the business-level fields.
async function resolveBusinessField<T extends string>(
  flagName: string,
  flagValue: string | undefined,
  promptLabel: string,
  schema: z.ZodType<T>,
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
  for (let attempt = 1; attempt <= 3; attempt++) {
    const raw = await rl.question(`${promptLabel}: `);
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    console.error(
      `  ${parsed.error.issues[0]?.message ?? "invalid"} (try again)`,
    );
  }
  throw new Error(`Too many invalid attempts for ${promptLabel}.`);
}
