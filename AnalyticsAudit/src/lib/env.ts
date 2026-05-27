import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv({ path: ".env.local", quiet: true });

const envSchema = z.object({
  META_APP_ID: z.string().min(1, "missing or empty"),
  META_APP_SECRET: z.string().min(1, "missing or empty"),
  META_PAGE_ACCESS_TOKEN: z.string().min(1, "missing or empty"),
  META_INSTAGRAM_BUSINESS_ACCT_ID: z.string().min(1, "missing or empty"),
  META_PAGE_ID: z.string().min(1, "missing or empty"),
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
