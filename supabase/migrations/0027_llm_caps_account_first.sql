-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- Account-first LLM caps. Phase 7 exposes plan generation over HTTP
-- (POST /api/demos/[id]/plan): requestDemoPlan is 1-2 paid Claude calls per
-- press and had no per-account ceiling — only the platform llm_tokens cap,
-- which parks jobs for everyone when one account loops. Same shape as
-- 0018/0022: the plan route entry checks assertAccountBudget("llm_tokens")
-- and rejects fast in Hebrew, and both LLM job handlers (analyze_demo,
-- plan_demo_steps) re-check at execution so a queued backlog cannot outrun
-- the route's usage-based gate (renders.ts confirm-to-execution precedent).
--
-- per_account.llm_tokens = 500000 is 25% of the 2,000,000 platform cap,
-- mirroring tts (25000/100000) and gpu (2000/7200). It covers roughly two
-- full 80-state analyses plus dozens of replans in a day — an honest
-- customer never sees it. Worst-case exposure ~28 ILS/account/day if it were
-- all output tokens; in practice mostly input (~6 ILS).
--
-- dailyCapsSchema (packages/core/src/config.ts) is a CLOSED zod object, so
-- the key and the schema must land together or every read throws.
-- 1500000, not the 500000 the sizing above derives: prod was raised by hand
-- on 2026-08-21, and this literal was edited after the fact to match, so a
-- fresh environment comes up agreeing with production.
UPDATE "app_config"
SET "value" = jsonb_set("value", '{per_account,llm_tokens}', '1500000'),
    "updated_at" = now()
WHERE "key" = 'daily_caps';
