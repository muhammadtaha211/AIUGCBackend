-- Plan-failure diagnostics (docs/vault/defects/plan-failure-diagnostics-are-unreachable.md):
-- all nine production failures carry one identical Hebrew string, prompt_version NULL, and no
-- record of which rule broke — nothing distinguishes a validator failure from a quota hit.
--
-- fail_kind: structured failure class (validator | quota | input | internal | transient),
--   written by handlePlanDemoSteps alongside fail_reason. Replaces substring-matching the
--   Hebrew "נסו שוב מחר" marker to decide retryability (the substring guard's test was fake —
--   docs/vault/defects/quota-marker-test-does-not-protect-it.md).
-- retry_violations: jsonb string[][] — per model call, the validator violations found AFTER
--   that call (last entry empty on success). Written on success AND failure paths, so the
--   per-rule and per-version failure rate is measurable.
ALTER TABLE "demo_step_plans" ADD COLUMN IF NOT EXISTS "fail_kind" text;
ALTER TABLE "demo_step_plans" ADD COLUMN IF NOT EXISTS "retry_violations" jsonb;
