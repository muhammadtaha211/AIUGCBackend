-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- Credits become per-second and honest. The old row was a flat placeholder
-- ({"a_render": 1, "b_render": 15}) from a subscription-shaped business model
-- that no longer exists: A cost one credit whatever its length, and B's 15 was
-- a guess at a 15s render. Both are now arrived at from seconds.
--
-- The rates express the founder's D1 answer (hybrid): a flat covering assembly
-- and the 2s bank hook, a small per-demo-second rate paying for the TTS funnel
-- (~1.75 syntheses per delivered video), and the FULL per-second rate on the
-- avatar outro, which is where the GPU money actually goes. A 35s demo with a
-- 6s avatar ending prices at 15 credits — the same as a 15s Service B ad.
--
-- Rates are fractional on purpose (packages/core/src/pricing.ts parses them as
-- z.number(), not .int()): whole-credit-per-second steps make tuning
-- impossible. The CHARGE is always an integer — pricing.ts ceils once.
--
-- Changing any of these is an UPDATE here, never a deploy. The code does not
-- know which pricing model won.
UPDATE "app_config"
SET "value" = '{
  "a_assembly_flat": 3,
  "a_demo_per_second": 0.15,
  "a_outro_per_second": 1,
  "a_minimum_credits": 5,
  "b_per_second": 1,
  "b_minimum_credits": 0,
  "a_ending_reroll_per_second": 1,
  "a_remix_assembly_credits": 2
}'::jsonb,
    "updated_at" = now()
WHERE "key" = 'credit_costs';
