-- Task-level Hebrew groupings of the analysis timeline for the wizard's step
-- inventory (e.g. "פרסום פוסט", "מעקב אחרי משתמשים"). Written once by the
-- text-only group_analysis_states job after the analysis lands ready
-- (founder-approved auto spend, 2026-08-25 — see
-- docs/vault/decisions/0003-sections-are-a-model-call.md). NULL = not grouped
-- (pre-0030 analyses, model/validation failure, budget refusal) and the UI
-- falls back to the flat two-tier grid — a grouping is a nicety, never a gate.
ALTER TABLE "demo_analyses" ADD COLUMN IF NOT EXISTS "sections" jsonb;
ALTER TABLE "demo_analyses" ADD COLUMN IF NOT EXISTS "sections_prompt_version" text;
