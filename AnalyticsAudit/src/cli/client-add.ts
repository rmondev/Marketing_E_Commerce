import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { z } from "zod";
import { db } from "../core/db/client.js";
import { askMasked, maskToken } from "../core/lib/prompt.js";

const nameSchema = z.string().trim().min(1, "must be non-empty");
const shortNameSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z0-9][a-z0-9_-]*$/,
    "must be lowercase alphanumeric with optional _ or - (e.g. rmondev, symmetry-esthetics)",
  );
const idSchema = z.string().trim().regex(/^\d+$/, "must be all digits");
const tokenSchema = z
  .string()
  .trim()
  .min(20, "looks too short to be a real token");

const program = new Command();
program
  .name("client:add")
  .description(
    "Add a client to AnalyticsAudit. Any required flag omitted is prompted for interactively. The page-token prompt hides input.",
  )
  .option("--name <name>", "Human-readable display name")
  .option("--short-name <shortName>", "CLI identifier, e.g. rmondev")
  .option("--ig-account-id <id>", "Instagram Business Account ID")
  .option("--page-id <id>", "Facebook Page ID")
  .option("--page-token <token>", "Page Access Token (input hidden if prompted)")
  .option("--notes <notes>", "Optional free-text notes");

program.parse();

type RawOpts = {
  name?: string;
  shortName?: string;
  igAccountId?: string;
  pageId?: string;
  pageToken?: string;
  notes?: string;
};
const rawOpts = program.opts() as RawOpts;

const interactive =
  rawOpts.name === undefined ||
  rawOpts.shortName === undefined ||
  rawOpts.igAccountId === undefined ||
  rawOpts.pageId === undefined ||
  rawOpts.pageToken === undefined;

const rl = createInterface({ input: process.stdin, output: process.stdout });

try {
  const name = await resolveField("name", rawOpts.name, "Display name", nameSchema);
  const shortName = await resolveField(
    "short-name",
    rawOpts.shortName,
    "Short name (lowercase alphanumeric)",
    shortNameSchema,
  );
  const igAccountId = await resolveField(
    "ig-account-id",
    rawOpts.igAccountId,
    "Instagram Business Account ID",
    idSchema,
  );
  const pageId = await resolveField(
    "page-id",
    rawOpts.pageId,
    "Facebook Page ID",
    idSchema,
  );

  // Notes is prompted before the token so we can close rl and hand stdin
  // exclusively to the raw-mode masked prompt without a two-consumer fight.
  let notes = rawOpts.notes;
  if (notes === undefined && interactive) {
    const raw = (await rl.question("Notes (optional, Enter to skip): ")).trim();
    notes = raw === "" ? undefined : raw;
  }

  rl.close();

  const pageToken = await resolveField(
    "page-token",
    rawOpts.pageToken,
    "Page Access Token (input hidden)",
    tokenSchema,
    { masked: true },
  );

  const insert = db.prepare(`
    INSERT INTO clients (
      short_name, display_name, ig_business_account_id, fb_page_id,
      page_access_token, created_at, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    const result = insert.run(
      shortName,
      name,
      igAccountId,
      pageId,
      pageToken,
      new Date().toISOString(),
      notes ?? null,
    );
    console.log(`\nAdded client '${shortName}' (id=${result.lastInsertRowid}).`);
    console.log(`  display_name:           ${name}`);
    console.log(`  ig_business_account_id: ${igAccountId}`);
    console.log(`  fb_page_id:             ${pageId}`);
    console.log(`  page_access_token:      ${maskToken(pageToken)}`);
    if (notes) console.log(`  notes:                  ${notes}`);
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("UNIQUE constraint failed: clients.short_name")
    ) {
      console.error(`\nClient with short_name '${shortName}' already exists.`);
      console.error("  Use 'npm run client:list' to see existing clients.");
      process.exit(1);
    }
    throw err;
  }
} finally {
  rl.close();
}

async function resolveField<T extends string>(
  flagName: string,
  flagValue: string | undefined,
  promptLabel: string,
  schema: z.ZodType<T>,
  options: { masked?: boolean } = {},
): Promise<T> {
  if (flagValue !== undefined) {
    const parsed = schema.safeParse(flagValue);
    if (!parsed.success) {
      console.error(
        `Invalid --${flagName}: ${parsed.error.issues[0]?.message ?? "invalid"}`,
      );
      process.exit(1);
    }
    return parsed.data;
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const raw = options.masked
      ? await askMasked(`${promptLabel}: `)
      : await rl.question(`${promptLabel}: `);
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    console.error(`  ${parsed.error.issues[0]?.message ?? "invalid"} (try again)`);
  }
  console.error(`Too many invalid attempts for ${promptLabel}. Aborting.`);
  process.exit(1);
}

