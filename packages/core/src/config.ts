import { z } from "zod";

/**
 * Every environment string is trimmed. A value pasted into Vercel or a .env
 * file can carry a newline, a CRLF or a space at either end, and a provider key
 * with one is refused far from where it was pasted: on 2026-10-17 TikTok
 * answered a `client_key=%0A…`. Trimming here covers Meta's, TikTok's, Resend's,
 * Sumit's and the database's the same way, and keeps a stray " 1" from turning
 * DRY_RUN off. A new key is added through `envString`; the config test fails
 * a string that skips it.
 */
const envString = z.string().trim().optional();

export const envSchema = z.object({
  DATABASE_URL: envString,
  SUPABASE_URL: envString,
  SUPABASE_SERVICE_ROLE_KEY: envString,
  ANTHROPIC_API_KEY: envString,
  ELEVENLABS_API_KEY: envString,
  FAL_KEY: envString,
  HEYGEN_API_KEY: envString,
  SENTRY_DSN: envString,
  // Sumit (the payment stack, decision 0054/0062). All optional: absent means
  // today's behaviour — NotConfiguredGateway, and a 503 from checkout. Which
  // Sumit organisation these name (the founder's test business or the real
  // one) is decided by the values alone; nothing in code knows the difference.
  SUMIT_COMPANY_ID: envString,
  SUMIT_API_KEY: envString,
  // JSON: { "<plan code>": "<the product's payment-page URL>" }.
  SUMIT_CHECKOUT_PAGES: envString,
  // The ₪5 intro offer's own payment page (decision 0109): one https URL, the
  // same shape as a SUMIT_CHECKOUT_PAGES value. Unset hides the offer.
  SUMIT_INTRO_PAGE: envString,
  // Social posting (decision 0101). The Meta app that connects Instagram
  // accounts and publishes Reels; the secret signs the code exchange,
  // appsecret_proof and the data-deletion callback. META_LOGIN_CONFIG_ID is set
  // only when the app dashboard gives Facebook Login a configuration id instead
  // of a scope list. SOCIAL_TOKEN_KEY: 32 random bytes, base64 — the key
  // secret-box.ts seals platform tokens under; needed wherever a token is
  // opened (the web's OAuth and sound routes, the worker's publish job), and
  // nowhere else. All optional: absent means the provider throws at use time,
  // never at boot, so admin — which needs none of them — is untouched.
  META_APP_ID: envString,
  META_APP_SECRET: envString,
  META_LOGIN_CONFIG_ID: envString,
  SOCIAL_TOKEN_KEY: envString,
  // TikTok inbox posting (PR 4, decision 0115): the TikTok app's client key and
  // secret — the sandbox pair until TikTok's review passes, the production pair
  // after (docs/09 has the swap). The web needs both (the authorize link, the
  // code exchange, the webhook signature — TikTok signs with the client secret);
  // the box needs both (refresh, inbox upload, status). Optional like Meta's:
  // a provider throws at use, never at boot.
  TIKTOK_CLIENT_KEY: envString,
  TIKTOK_CLIENT_SECRET: envString,
  // The failure email (decision 0107): a sending-only Resend key, set on the
  // box alone. Absent or empty means no email is sent and nothing breaks, the
  // way an unset SENTRY_DSN means no report (pipelines/social-failure-email.ts).
  RESEND_API_KEY: envString,
  DRY_RUN: envString.transform((v) => v === "1" || v === "true"),
  WORKER_ID: z.string().trim().default("local"),
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
