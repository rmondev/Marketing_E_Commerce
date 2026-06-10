import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv({ path: ".env.local", quiet: true });

const envSchema = z.object({
  META_APP_ID: z.string().min(1, "missing or empty"),
  META_APP_SECRET: z.string().min(1, "missing or empty"),
  META_PAGE_ACCESS_TOKEN: z.string().min(1, "missing or empty"),
  META_INSTAGRAM_BUSINESS_ACCT_ID: z.string().min(1, "missing or empty"),
  META_PAGE_ID: z.string().min(1, "missing or empty"),
  // TikTok credentials are optional at env-load — the audit, onboarding,
  // and refresh commands check them only when the operator actually uses
  // a TikTok platform_account. Operators who only use Meta don't need
  // these.
  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  TIKTOK_REDIRECT_URI: z.string().url().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration in .env.local:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  console.error("\nSee .env.example for the full list of expected variables.");
  process.exit(1);
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
