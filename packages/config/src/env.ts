import { z } from "zod";

/**
 * Single source of truth for environment configuration, shared by apps/web
 * and any future worker process. Validated eagerly so a missing/malformed
 * var fails fast at boot rather than surfacing as a confusing runtime error
 * deep inside an adapter or AI call.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // AI providers — Anthropic is the only required one; others are optional
  // and only unlock their respective AIProvider implementation when present.
  ANTHROPIC_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1).optional(),
  GOOGLE_AI_API_KEY: z.string().min(1).optional(),
  VOYAGE_API_KEY: z.string().min(1).optional(),

  // Database (Supabase Postgres)
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),

  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Application-layer credential encryption (ConnectedAccount tokens, etc.)
  ENCRYPTION_KEY: z
    .string()
    .length(64, "ENCRYPTION_KEY must be a 32-byte key hex-encoded (64 chars)"),

  // Optional: outreach contact-enrichment provider, off by default
  EMAIL_DISCOVERY_PROVIDER: z.enum(["none", "hunter"]).default("none"),
  HUNTER_API_KEY: z.string().min(1).optional(),

  // Optional: Gmail OAuth (outreach sending + inbox status scanning). Real
  // sending/reading stays disabled — ConnectedAccount rows simply can't be
  // created — until these are set.
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),

  // Optional: Adzuna job search API (real public multi-company aggregator,
  // https://developer.adzuna.com) — the Adzuna search feature on the Jobs
  // page just won't be offered until both are set.
  ADZUNA_APP_ID: z.string().min(1).optional(),
  ADZUNA_APP_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Parses and caches process.env against the schema. Call once at startup
 * (e.g. imported by the root layout / a server-only module) rather than
 * scattering `process.env.X` reads throughout the codebase.
 */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
