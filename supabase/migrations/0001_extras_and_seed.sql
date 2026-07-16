-- Hand-written companion to 0000_init.sql (drizzle-generated).
-- Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- Circular reference deliberately left out of the drizzle schema:
-- sets.parent_variant_id -> video_renders.id ("more like this" spawns a set
-- from a starred variant), while video_renders.set_id -> sets.id.
ALTER TABLE "sets"
  ADD CONSTRAINT "sets_parent_variant_id_video_renders_id_fk"
  FOREIGN KEY ("parent_variant_id") REFERENCES "video_renders"("id");

-- A business holds at most one live subscription (canceled ones may pile up).
CREATE UNIQUE INDEX "subscriptions_one_live_per_business"
  ON "subscriptions" ("business_id")
  WHERE "status" IN ('active', 'past_due', 'suspended');

-- ---------------------------------------------------------------------------
-- Seed: placeholder plan tiers (founder tunes prices/quotas before launch).
-- Prices in agorot. Credit costs per render kind live in app_config.
-- ---------------------------------------------------------------------------
INSERT INTO "plans" ("code", "name", "price_agorot", "monthly_credits", "allows_service_b", "active", "config") VALUES
  ('starter', 'Starter', 29900, 40, false, true, '{}'),
  ('pro',     'Pro',     59900, 100, true,  true, '{}'),
  ('studio',  'Studio',  99900, 200, true,  true, '{}')
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Seed: runtime configuration. Every operational knob the docs mention lives
-- here so changing policy is an UPDATE, not a deploy.
-- ---------------------------------------------------------------------------
INSERT INTO "app_config" ("key", "value") VALUES
  -- Service B QC gate: flip to true once quality variance is proven.
  ('auto_release_b', 'false'),

  -- Hard platform-wide daily spend caps, enforced at job claim time from
  -- usage_events sums. Units are native per provider.
  ('daily_caps', '{"tts_chars": 100000, "gpu_seconds": 300, "llm_tokens": 2000000}'),

  -- Hebrew narration pace per voice, measured once with test renders
  -- (word budget = demo_seconds * words_per_second). Keyed by voice_id,
  -- "default" used until a voice is calibrated.
  ('words_per_second', '{"default": 2.2}'),

  -- Storage retention windows (days); enforced by the daily janitor job.
  ('retention_days', '{"raw_after_normalize": 30, "released_renders": 90, "watermarked_samples": 14, "audio_previews": 30}'),

  -- Audio previews are free (not credit-debited) but rate-capped per business.
  ('audio_preview_daily_limit', '20'),

  -- Credits debited per render at enqueue time (refunded on terminal failure).
  ('credit_costs', '{"a_render": 1, "b_render": 15}'),

  -- Failed recurring charge: retry offsets in days from the failure, then suspend.
  ('dunning', '{"retry_days": [2, 5], "suspend_after_days": 7}')
ON CONFLICT ("key") DO NOTHING;
