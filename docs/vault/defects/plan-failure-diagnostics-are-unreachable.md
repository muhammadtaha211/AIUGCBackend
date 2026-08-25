---
type: defect
status: verified
verified: 2026-08-25
method: "read demo_step_plans.fail_reason and the matching jobs.last_error for the failed plan jobs (read-only, packages/core/.work/vault-worker-eviD.ts); traced the read path through apps/web/src/lib/api.ts:9 and packages/core/src/db/index.ts:22-30; fix verified by packages/core/test/plan-retry-contract.test.ts (handlePlanDemoSteps diagnostics describe)"
source: db
---

# When a plan fails the customer is told nothing, and the reason it is nothing is not RLS

## FIXED 2026-08-25 (migration 0029 + the same commit's code)

Both symptoms closed, structurally rather than by the join this note proposed:

- `demo_step_plans.fail_kind` (`validator | quota | input | internal | transient`) and
  `retry_violations` (string[][], one entry per model call, written on success AND failure) landed
  in 0029. The English violation text is now durable **on the plan row itself** — better than
  joining `jobs.last_error`, because successes keep their history too.
- `prompt_version` is written on the validator-failure path (`PlanViolationError` carries it; the
  handler writes it), so per-version failure rates are derivable from now on.
- The customer line is classified per failure class in `violationCustomerMessage`
  (`demo-step-plans.ts`): fabrication → "add a demo description and retry", skip-kind picks →
  "refilm focusing on product use", everything else keeps the generic line.
- The wrong RLS comment in `service-a-ui.ts` is corrected in place.

The nine pre-0029 failed rows stay as they are — NULL `fail_kind`, NULL `prompt_version` — and are
the reason the UI keeps a substring fallback ([[quota-marker-test-does-not-protect-it]]).

---

## What the customer gets

All nine failed `demo_step_plans` rows carry the identical string:

```
יצירת תוכנית הצעדים נכשלה — נסו שוב
```

"Creating the step plan failed — try again." That is the whole diagnosis. It is the same for every
failure class, and it does not say what to change.

## What actually exists, one table away

The real violation is in `jobs.last_error`, written from the `PermanentError` at
`packages/core/src/pipelines/demo-step-plans.ts:1076`. Three real examples, read from production:

| job        | `jobs.last_error`                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| `33c4a8dc` | `plan violates label rules after retry: step 2: label "…" is over 6 words`                                              |
| `7584e682` | `… step 4: state 14 is a "loading" screen — login, loading, onboarding, error, tour and system screens are never steps` |
| `f0a1e9c0` | `… step 3: state 14 is a "loading" screen … ; the steps total 10…`                                                      |

Every one of those is actionable, and several are things the customer could fix by re-recording or
editing. None of them reaches the customer.

**The retry the customer is offered is not futile — it is uninformative.** The failures are not
deterministic: 16 of the 19 plan rows belong to one demo (`9553ea19`), and on that demo failed and
ready plans interleave over time — a failure at 2026-08-17 02:13Z, a ready plan on 08-18, three
consecutive failures on 08-20 at 02:39 / 02:50 / 02:52, ready plans after. Pressing retry does
produce a passing plan a fair share of the time. What it does not do is tell the customer what to
change, so each press is 2 paid Claude calls and a coin flip.

## The stated cause is wrong, and it matters

The handover, and the code comment at `apps/web/src/lib/service-a-ui.ts:549-550`, both say **RLS
hides `jobs.last_error`.** That is not the blocker:

- `jobs` does have RLS enabled — `supabase/migrations/0002_supabase_rls.sql:126` — and **no policy
  at all**, so the `anon` and `authenticated` roles see nothing.
- But the web app never queries from the browser. Its server routes use `getDb()` from
  `@aiugc/core`, which connects on `DATABASE_URL` — the service-role connection string
  (`packages/core/src/db/index.ts:22-30`). **The service role bypasses RLS.**
- `apps/web/src/lib/api.ts:9` says so in as many words: "core's `getDb()` bypasses RLS".

So the web app **can** read `jobs.last_error` today, with no migration and no policy change.
**Nothing queries it.** That is the actual defect.

This distinction is the whole reason to write the note: "RLS hides it" makes the fix look like a
security-model change that needs a policy, an audit, and a decision about what customers may see.
"Nothing selects it" makes the fix a query.

## The second symptom: failed plans lose their prompt version

All nine failed rows also record `prompt_version = NULL`, because only the success path writes it
(`demo-step-plans.ts` sets `promptVersion` on the returned draft, and the failure path throws before
there is a draft). Consequence: **a per-version failure rate cannot be computed from this table.**
Any statement like "v12 fails X% of the time" is not derivable — and
[[v10-is-the-last-working-prompt]] is what happened last time someone reasoned from thin
per-version samples.

## What `error_class` does and does not give you

`jobs.error_class` is populated, but it is a coarse enum — live distribution is `permanent` (18),
`transient` (9), `null` (171). Every failed plan job is `permanent`. It separates "retry might work"
from "it won't"; it cannot tell a quota refusal from a validator violation. So it is not the
structured field this needs.

## Fix shape

Two independent pieces, both small:

1. **Surface it.** The plan-status route already has a service-role handle; join `jobs` on the
   plan's job and return `last_error` (or a cleaned subset of it) alongside `fail_reason`. No
   migration.
2. **Record the version on failure.** Write `promptVersion` on the failure path too — the prompt is
   rendered at `demo-step-plans.ts:1021`, well before the throw, so the value is in hand.

A `fail_kind` column on `demo_step_plans` would also let the UI stop substring-matching Hebrew to
decide retryability — see [[quota-marker-test-does-not-protect-it]], which wants the same column.

## Related

- [[first-call-violation-rate]] — the violation history that is durable only for failures
- [[demo-corpus]]
