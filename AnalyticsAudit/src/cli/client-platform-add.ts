// Attach a new platform_account to an existing business. Symmetric with
// client:add but for the "this business just signed up for TikTok"
// scenario — picks a single platform and dispatches its onboarding.

import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { db } from "../core/db/client.js";
import { PLATFORMS } from "../platforms/_registry.js";

const program = new Command();
program
  .name("client:platform:add")
  .description(
    "Attach a new platform_account to an existing business. The platform_account row sits ready for future audits; if the platform's audit isn't implemented yet, npm run audit will skip it until then.",
  )
  .requiredOption(
    "--client <shortName>",
    "short_name of the business to attach to",
  )
  .option(
    "--platform <name>",
    "Which platform to add (instagram | facebook_page | tiktok). If omitted, you'll be prompted.",
  )
  // Pass-through flags for each platform's onboarding.
  .option("--instagram-account-id <id>", "[Instagram] IG Business Account ID")
  .option("--instagram-page-id <id>", "[Instagram] Facebook Page ID")
  .option("--instagram-page-token <token>", "[Instagram] Page Access Token")
  .option("--facebook-page-id <id>", "[Facebook Page] Page ID")
  .option("--facebook-page-token <token>", "[Facebook Page] Page Access Token")
  .option("--tiktok-handle <handle>", "[TikTok] @username (unused; reserved for legacy flag compatibility)")
  .option("--tiktok-access-token <token>", "[TikTok] Paste a pre-minted access token instead of running the browser OAuth flow")
  .option("--tiktok-refresh-token <token>", "[TikTok] Refresh Token (recommended alongside --tiktok-access-token)");

program.parse();

type RawOpts = {
  client: string;
  platform?: string;
  [k: string]: string | undefined;
};
const rawOpts = program.opts() as RawOpts;

type ClientRow = { id: number; short_name: string; display_name: string };
const client = db
  .prepare(
    "SELECT id, short_name, display_name FROM clients WHERE short_name = ?",
  )
  .get(rawOpts.client) as ClientRow | undefined;

if (!client) {
  console.error(`No client with short_name '${rawOpts.client}'.`);
  console.error("  Use 'npm run client:list' to see configured clients.");
  process.exit(1);
}

const onboardablePlatforms = Object.values(PLATFORMS).filter(
  (h) => h.capabilities.onboarding,
);
const interactive = rawOpts.platform === undefined;
const rl = createInterface({ input: process.stdin, output: process.stdout });

try {
  let chosen: string;
  if (rawOpts.platform !== undefined) {
    if (!(rawOpts.platform in PLATFORMS)) {
      throw new Error(
        `Unknown --platform '${rawOpts.platform}'. Known: ${Object.keys(PLATFORMS).join(", ")}`,
      );
    }
    if (!PLATFORMS[rawOpts.platform]!.capabilities.onboarding) {
      throw new Error(
        `Platform '${rawOpts.platform}' has no onboarding implementation yet.`,
      );
    }
    chosen = rawOpts.platform;
  } else {
    console.log(
      `\nAttaching a platform to ${client.display_name} (${client.short_name}).`,
    );
    console.log("\nAvailable platforms (those with onboarding implemented):");
    onboardablePlatforms.forEach((h, i) => {
      console.log(`  ${i + 1}) ${h.displayName.padEnd(15)} (${h.name})`);
    });
    const ans = (await rl.question("\nChoose by number or name: ")).trim();
    const asNum = Number(ans);
    if (Number.isInteger(asNum) && asNum >= 1 && asNum <= onboardablePlatforms.length) {
      chosen = onboardablePlatforms[asNum - 1]!.name;
    } else if (ans in PLATFORMS && PLATFORMS[ans]!.capabilities.onboarding) {
      chosen = ans;
    } else {
      throw new Error(`Invalid choice '${ans}'.`);
    }
  }

  // Pre-check: this business may already have this platform attached.
  const existing = db
    .prepare(
      "SELECT id FROM platform_accounts WHERE client_id = ? AND platform = ?",
    )
    .get(client.id, chosen) as { id: number } | undefined;
  if (existing) {
    console.log(
      `\nNote: ${client.display_name} already has a ${chosen} platform_account (id=${existing.id}).`,
    );
    console.log(
      "If you proceed, a second one will be added (the UNIQUE constraint requires a different external_account_id).",
    );
    if (interactive) {
      const ans = (await rl.question("Continue? [y/N] ")).trim().toLowerCase();
      if (!(ans === "y" || ans === "yes")) {
        console.log("Aborted.");
        process.exit(0);
      }
    }
  }

  // readline is closed before any askMasked prompts inside onboarding.
  rl.close();

  const handle = PLATFORMS[chosen]!;
  console.log(`\n── ${handle.displayName} ──`);
  const result = await handle.onboarding({
    flagValues: rawOpts as unknown as Record<string, string | undefined>,
    interactive,
  });

  const insert = db.prepare(`
    INSERT INTO platform_accounts (
      client_id, platform, external_account_id, display_handle,
      credentials, added_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertRes = insert.run(
    client.id,
    chosen,
    result.external_account_id,
    result.display_handle ?? null,
    result.credentials,
    new Date().toISOString(),
  );
  const paId = Number(insertRes.lastInsertRowid);

  console.log(
    `\n✓ Attached ${handle.displayName} platform_account (id=${paId}) to '${client.short_name}'.`,
  );
  if (!handle.capabilities.audit) {
    console.log(
      `  ⚠ ${handle.displayName} audit support is not yet implemented; ` +
        `npm run audit will skip this platform until then.`,
    );
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
} finally {
  try {
    rl.close();
  } catch {
    // already closed
  }
}
