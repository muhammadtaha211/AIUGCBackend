-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- credit_costs: a NEW key c_text_block_credits = 25 — one Service C (גוש טקסט)
-- render, flat, floor-exempt. The founder's price, recorded for phase 2 in
-- docs/vault/decisions/0089-service-c-text-block-exists-admin-only-phase-1.md
-- §4 and made live by 0099 (phase 2, the customer wizard).
--
-- BEFORE: no c_text_block_credits key (the ten keys 0043 restated)
-- AFTER:  {"c_text_block_credits": 25} beside the ten, which this file never touches
--
-- ⚠️ DEPLOY ORDER — APPLY THIS BEFORE THE COMMIT DEPLOYS (0039's rule,
-- .claude/rules/migrations.md rule 9). creditCostsSchema (packages/core/src/pricing.ts)
-- makes the key REQUIRED, like every other key, and quoteContext
-- (pipelines/sets.ts) and loadPlansView (apps/web/src/lib/plans.ts) parse the
-- whole row. A build carrying the schema key against a row without it does not
-- mis-price — it throws, and A, B, C and /pricing stop together. The other way
-- round is benign: today's code reads the row through a plain z.object, which
-- strips the unknown key.
--
-- Unconditional, like 0039: the value IS the founder's decision, so a re-run
-- restates it rather than silently keeping a hand edit.
--
-- VERIFY BY READ-BACK, BEFORE AND AFTER, through the code's own parse (rule 6):
--   select value ? 'c_text_block_credits' from app_config where key = 'credit_costs';
--   select jsonb_typeof(value -> 'c_text_block_credits'), value -> 'c_text_block_credits'
--     from app_config where key = 'credit_costs';
-- BEFORE: false; AFTER: true, 'number', 25 — a bare jsonb number, never '"25"',
-- which z.number() would refuse at the next quote. Then
-- packages/core/scripts/verify-credit-costs.ts on the branch: every check PASS.
UPDATE "app_config"
SET "value" = "value" || '{"c_text_block_credits": 25}'::jsonb,
    "updated_at" = now()
WHERE "key" = 'credit_costs';
