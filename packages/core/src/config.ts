import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  FAL_KEY: z.string().optional(),
  HEYGEN_API_KEY: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  // Sumit (the payment stack, decision 0054/0062). All optional: absent means
  // today's behaviour — NotConfiguredGateway, and a 503 from checkout. Which
  // Sumit organisation these name (the founder's test business or the real
  // one) is decided by the values alone; nothing in code knows the difference.
  SUMIT_COMPANY_ID: z.string().optional(),
  SUMIT_API_KEY: z.string().optional(),
  // JSON: { "<plan code>": "<the product's payment-page URL>" }.
  SUMIT_CHECKOUT_PAGES: z.string().optional(),
  // The ₪5 intro offer's own payment page (decision 0109): one https URL, the
  // same shape as a SUMIT_CHECKOUT_PAGES value. Unset hides the offer.
  SUMIT_INTRO_PAGE: z.string().optional(),
  // Social posting (decision 0101). The Meta app that connects Instagram
  // accounts and publishes Reels; the secret signs the code exchange,
  // appsecret_proof and the data-deletion callback. META_LOGIN_CONFIG_ID is set
  // only when the app dashboard gives Facebook Login a configuration id instead
  // of a scope list. SOCIAL_TOKEN_KEY: 32 random bytes, base64 — the key
  // secret-box.ts seals platform tokens under; needed wherever a token is
  // opened (the web's OAuth and sound routes, the worker's publish job), and
  // nowhere else. All optional: absent means the provider throws at use time,
  // never at boot, so admin — which needs none of them — is untouched.
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_LOGIN_CONFIG_ID: z.string().optional(),
  SOCIAL_TOKEN_KEY: z.string().optional(),
  // The failure email (decision 0107): a sending-only Resend key, set on the
  // box alone. Absent or empty means no email is sent and nothing breaks, the
  // way an unset SENTRY_DSN means no report (pipelines/social-failure-email.ts).
  RESEND_API_KEY: z.string().optional(),
  DRY_RUN: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
  WORKER_ID: z.string().default("local"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) cached = envSchema.parse(process.env);
  return cached;
}

/** Test hook: force re-reading process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}

// ---------------------------------------------------------------------------
// app_config accessors — every operational knob is a DB row (see the seed in
// supabase/migrations/0001_extras_and_seed.sql), so changing policy is an
// UPDATE, not a deploy.
// ---------------------------------------------------------------------------

export const dailyCapsSchema = z.object({
  tts_chars: z.number().int(),
  gpu_seconds: z.number().int(),
  llm_tokens: z.number().int(),
  images: z.number().int(),
  /**
   * Per-ACCOUNT ceilings, checked before the platform-wide ones. Abuse control,
   * not capacity: a breach here is a fast rejection, never a parked job.
   * Closed object — see 0018/0022/0027, which add the keys in the same change.
   */
  per_account: z.object({
    tts_chars: z.number().int(),
    gpu_seconds: z.number().int(),
    llm_tokens: z.number().int(),
  }),
});

export const retentionDaysSchema = z.object({
  raw_after_normalize: z.number().int(),
  released_renders: z.number().int(),
  watermarked_samples: z.number().int(),
  audio_previews: z.number().int(),
});

// creditCostsSchema lives in ./pricing — it is parsed by client bundles too,
// and this module reads process.env.

export const dunningSchema = z.object({
  retry_days: z.array(z.number().int()),
  suspend_after_days: z.number().int(),
});

export const wordsPerSecondSchema = z.record(z.string(), z.number());
