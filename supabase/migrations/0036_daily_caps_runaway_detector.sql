-- Hand-written. Portable SQL: applies to any Postgres (Supabase, PGlite, plain PG).

-- daily_caps: the platform ceilings become a runaway detector, and the one
-- per-account cap that was the wrong shape is tightened.
--
-- Founder decision 2026-09-10, implementing
-- docs/vault/decisions/0040-the-hard-ceiling-moves-to-the-providers.md: the
-- HARD ceiling moves to the providers (prepaid balances and organisation spend
-- limits at Anthropic, ElevenLabs and HeyGen). The in-app platform cap is
-- demoted to a high circuit breaker, and the per-account cap keeps doing the
-- real work.
--
-- BEFORE (live 2026-09-10, and what 0001/0004/0022/0027 replay to):
--   {"images":100,"tts_chars":100000,"llm_tokens":2000000,"gpu_seconds":7200,
--    "per_account":{"tts_chars":25000,"llm_tokens":1500000,"gpu_seconds":2000}}
-- AFTER:
--   {"images":400,"tts_chars":400000,"llm_tokens":8000000,"gpu_seconds":32000,
--    "per_account":{"tts_chars":25000,"llm_tokens":500000,"gpu_seconds":2000}}
--
-- Exactly one per_account value moves: llm_tokens, 1500000 -> 500000. It is the
-- outlier 0040 named — one account could legitimately consume 75% of the whole
-- platform's daily LLM budget, and two ordinary heavy users tripped it.
-- tts_chars and gpu_seconds are deliberately untouched.
--
-- WHY THE TWO LEVELS ARE NOT THE SAME KIND OF NUMBER
-- They have opposite failure modes, so they are sized for opposite things.
--   * per_account -> assertAccountBudget (packages/core/src/budget.ts:73-112)
--     throws AccountBudgetError BEFORE anything is enqueued, surfacing as an
--     immediate Hebrew rejection. This is the ABUSE ceiling. Safe to trip.
--   * platform -> assertBudget (budget.ts:25-48) throws BudgetError, which
--     PARKS the job at +1h with no attempt burned. The 6h valve
--     (MAX_BUDGET_PARK_MS, pipelines/janitor.ts:25) only reaches render_video
--     and lipsync, so a parked synth_tts or analyze_demo re-queues FOREVER with
--     its row stuck mid-state and the wizard spinning. So the platform cap must
--     be a nearly-unreachable RUNAWAY DETECTOR, never a budget.
--
-- THE 16x RULE, so these numbers stay re-derivable
-- Every platform cap is exactly 16x its per_account pair:
--   tts_chars    400000 = 16 x 25000
--   llm_tokens  8000000 = 16 x 500000
--   gpu_seconds   32000 = 16 x 2000
-- i.e. it takes sixteen accounts each spending a full day's allowance to reach
-- the platform ceiling, at every unit. `images` has NO per_account pair and is
-- therefore not covered by the rule; it is raised 4x (100 -> 400) to keep it
-- from becoming the effective ceiling on its own.
--
-- Deliberately NOT added: per_account.images. assertAccountBudget's `kind` is
-- typed keyof …["per_account"] (budget.ts:75), so a SQL-only key would be
-- stripped on read by the plain z.object, there is no call site anywhere, and
-- zero usage_events rows of kind `images` have ever existed. A dead key is
-- worse than no key — docs/vault/facts/per-account-cap-blind-spot.md.
--
-- CALIBRATION — REASONED, NOT MEASURED, AND RESTING ON STALE FIGURES
-- The sizing below is an argument, not a measurement. It leans on two numbers
-- that are both `verified: 2026-08-23` and therefore ~19 days old at the time
-- of writing — past this repo's 14-day staleness rule (CLAUDE.md). Re-measure
-- before treating any of this as current:
--   * A clean analyze_demo is 125k-159k tokens over 8-9 Claude calls, and a
--     plan generation 40.9k-59.3k over 2 (docs/vault/facts/analyze-demo-cost.md,
--     docs/vault/facts/token-and-money-budgets.md). So per_account 500000 is
--     roughly three demo uploads plus several plans in a day — an honest
--     customer does not reach it.
--   * The largest platform 24h window ever recorded is 899,599 tokens
--     (2026-08-22). 8000000 is ~8.9x that, which is the point: legitimate load
--     must not be able to reach the parking ceiling.
--
-- Verify by READ-BACK, never by "the UPDATE succeeded". Nothing validates
-- writes to app_config, and dailyCapsSchema (config.ts:39-54) is a plain
-- z.object at both levels — strip mode — so an unknown or mistyped key is
-- silently dropped on read and the cap never moves
-- (docs/vault/facts/token-and-money-budgets.md). The read-back that goes
-- through the schema is scripts/verify-daily-caps.ts.
--
-- A migration and not a hand UPDATE because 0027's literal seeds
-- per_account.llm_tokens and a hand UPDATE would silently diverge from the seed
-- lineage — the 0022 precedent, where the live gpu_seconds had drifted to a
-- hand-set, recorded-nowhere 36000. 0027 is left exactly as it is: it runs
-- before this file, so a rebuilt database lands on these values by replay.
UPDATE "app_config"
SET "value" = jsonb_set(
      "value" || '{"images": 400, "tts_chars": 400000, "llm_tokens": 8000000, "gpu_seconds": 32000}'::jsonb,
      '{per_account,llm_tokens}',
      '500000'
    ),
    "updated_at" = now()
WHERE "key" = 'daily_caps';
