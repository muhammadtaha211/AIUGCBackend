-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- The steps format prices as a FLAT: one analysis amortised over unlimited
-- variants plus one Remotion render is near-constant marginal cost. The
-- full-format quote (assembly + demo-per-second) would bill the UPLOADED
-- duration — a 3-minute recording would price ~31 credits for a ~20s output,
-- at a rate calibrated to subsidise a TTS funnel this format does not use.
--
-- Seeded at 5, the existing Service A floor (a_minimum_credits), so a steps
-- video launches at the platform's own "no video costs less than X" price.
-- pricing.ts applies NO floor to this flat — tuning it below 5 works, and
-- tuning it at all is an UPDATE here, never a deploy.
--
-- `||` merges the key in rather than rewriting the row: the other rates may
-- have been hand-tuned in production since 0017 seeded them. The `?` guard
-- makes a re-run a true no-op — migrations here are applied by hand, and a
-- second application must never silently reset a hand-tuned value to 5.
UPDATE "app_config"
SET "value" = "value" || '{"a_steps_credits": 5}'::jsonb,
    "updated_at" = now()
WHERE "key" = 'credit_costs'
  AND NOT ("value" ? 'a_steps_credits');
