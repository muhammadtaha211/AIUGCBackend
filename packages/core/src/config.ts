import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  FAL_KEY: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
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
});

export const retentionDaysSchema = z.object({
  raw_after_normalize: z.number().int(),
  released_renders: z.number().int(),
  watermarked_samples: z.number().int(),
  audio_previews: z.number().int(),
});

export const creditCostsSchema = z.object({
  a_render: z.number().int(),
  b_render: z.number().int(),
});

export const dunningSchema = z.object({
  retry_days: z.array(z.number().int()),
  suspend_after_days: z.number().int(),
});

export const wordsPerSecondSchema = z.record(z.string(), z.number());
