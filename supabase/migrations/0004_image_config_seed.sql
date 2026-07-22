-- Hand-written companion to 0003_composites_and_images.sql.
-- Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- Composite image generation joins the daily spend caps (abuse guard — no
-- credit charge for composites in V0).
UPDATE "app_config"
SET "value" = "value" || '{"images": 100}'::jsonb, "updated_at" = now()
WHERE "key" = 'daily_caps' AND NOT ("value" ? 'images');

-- Cost estimate per generated image, in agorot: fal nano-banana (Gemini 2.5
-- Flash Image) is $0.039/image ≈ 15 agorot (verified 2026-07). A price change
-- is an UPDATE here, not a deploy.
INSERT INTO "app_config" ("key", "value") VALUES
  ('imagegen_cost_agorot', '15')
ON CONFLICT ("key") DO NOTHING;
