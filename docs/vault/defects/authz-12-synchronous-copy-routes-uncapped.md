---
type: defect
status: verified
verified: 2026-09-23
method: "Security audit phase 1 (.work/security/01-authz.md, AUTHZ-12), a PGlite probe run against
  main before any fix: usage recorded under business A alone (8,000,000, the platform llm_tokens
  cap) -> assertAccountBudget(B) resolves, assertAccountBudget(A) rejects AccountBudgetError,
  assertBudget('llm_tokens') rejects BudgetError for EVERY account, and generateHookLines(A) still
  ran and inserted 3 rows with both caps already exhausted, because nothing on the route called
  either check. The probe was deleted per the audit's RULES.md limit 2; rebuilt as a permanent
  regression test on this fix, apps/web/test/authz-12-llm-caps.test.ts, run against
  origin/main@3fd2c33 first (5 of 10 cases fail — exactly the ones the fix changes) and against
  branch fix/authz-12-llm-caps (10/10 pass)."
source: code
---

# AUTHZ-12 — the synchronous copy routes made paid Anthropic calls with no cap

## FIXED 2026-09-23 on branch `fix/authz-12-llm-caps`

**What was open.** `POST /api/businesses/[businessId]/hook-lines`, `/scripts` and `/vo-script`
each make 1-2 Anthropic calls per request (`generateHookLines`, `generateBScript` — plus a second
call when `hookTextOrDerived` falls back — and `generateVoScript`, all in
`packages/core/src/pipelines/copy.ts`) with **no per-account cap, no platform cap and no rate
limit**. `callClaude` (`copy.ts:24-42`) is `renderPrompt -> generateObject -> recordUsage` —
`recordUsage` only inserts, it asserts nothing. The only web copy route that was gated was
`POST /api/demos/[id]/plan` (`assertAccountBudget` before enqueueing the job that makes the actual
call). `POST /api/scripts/[id]/text` (`deriveHookText`, found in this task's sweep of every
LLM-calling web route) had the **platform** cap only (`assertBudget` inside
`deriveHookTextWithVersion`, `copy.ts:641`) and no per-account cap; a platform trip there fell
through `api-errors.ts` to an unmapped generic 500 rather than a clean refusal.

**MEASURED (the probe above).** A free account (A1, no admin bypass, zero credits) could:

1. Spend without bound — every request is a real Anthropic call at the founder's expense, bounded
   only by the attacker's request rate and whatever ceiling the Anthropic organisation itself
   enforces (EXTERNAL, unchanged by this fix).
2. Fill the shared `daily_caps.llm_tokens` platform window by itself (the per-account cap was
   1.33-16x tighter than the platform cap depending on when measured — see
   [[per-account-cap-blind-spot]] and [[0040-the-hard-ceiling-moves-to-the-providers]] — but nothing
   stopped an account from reaching the platform ceiling directly since nothing ever checked it on
   this path). Once tripped, every OTHER customer's `analyze_demo`, `plan_demo_steps` and
   `synth_tts` jobs park for +1h at a time, repeatedly, because `assertBudget`'s only consumer
   outside this fix is job code that treats a `BudgetError` as "wait and retry" — `budget.ts`'s own
   comment says a platform trip is meant to mean "something is BROKEN — a runaway loop or a leaked
   key," not ordinary load from one free account.

**REASONED — what the fix bounds, and how.** Per the decision that the checks must not go inside
`callClaude` or any pipeline function reachable from the `generate_copy` job handler
(`packages/core/src/handlers.ts` wires `generateHookLines`/`generateBScript`/`generateVoScript` to
job kind `generate_copy` — nothing enqueues that kind today, but the registry entry exists, so a
check placed inside those functions would silently start parking a real job the day something
does): the checks sit in the **web route**, the one layer these three functions are actually
reached from today. Each of the four routes above now calls, immediately after its ownership check
and before its first Anthropic call:

```ts
await assertAccountBudget(db, "llm_tokens", businessId); // 429, fast, typed rejection
await assertBudget(db, "llm_tokens"); // 503, the shared backstop
```

(`/api/scripts/[id]/text` gets only the new `assertAccountBudget` call — its existing `assertBudget`
inside `deriveHookText` already ran before the call and stays there, untouched.) Neither function's
own logic changed — both already existed, both already had the right semantics
(`AccountBudgetError` rejects fast without enqueueing anything; `BudgetError` is what a job parks
on). What changed is that these four routes now call them. `BudgetError` gained a web mapping in
`apps/web/src/lib/api-errors.ts`: 503, "המערכת עמוסה כרגע. נסו שוב מאוחר יותר." — never a park,
never the generic 500 `/api/scripts/[id]/text` used to give it.

**What the fix does NOT bound — two residuals, neither closed by this task:**

(a) **Concurrency.** The check reads usage recorded so far and the write happens inside the
generation call, seconds later. Concurrent requests from the same account can each pass the
per-account check before any of them records its usage, so one burst can overshoot the cap by
roughly `concurrency × tokens per call`. No lock, no reservation — `assertAccountBudget` is a
read-then-maybe-proceed, same as it always was for the one route that already had it
(`demos/[id]/plan`).

(b) **Sybil accounts.** N free accounts, each under its own per-account ceiling, still sum to fill
the shared platform window and park every paying customer's jobs — the per-account cap bounds one
account, not N of them. This is the same shape [[per-account-cap-blind-spot]] describes for the
NULL-`business_id` case, but here it needs no gap at all: distinct real accounts are enough. This
belongs to phase 5 (rate limiting / abuse detection across accounts), not to this fix.

**Usage attribution, verified rather than assumed.** `callClaude`'s `businessId` parameter is
required (not optional) and every call site in `copy.ts` — `generateHookLines`, `generateBScript`
(both its own call and the `hookTextOrDerived` fallback), `generateVoScript`,
`deriveHookTextWithVersion` — passes its own `opts.businessId`. No usage row on these four paths
was ever written with `business_id` NULL; the per-account cap [[per-account-cap-blind-spot]]
describes (a NULL row invisible to the INNER JOIN) was never this defect's blind spot. Pinned as a
permanent regression: `packages/core/test/authz-12-usage-attribution.test.ts`.

**Sweep result (00-surface.md S1, every web route whose paid work includes a synchronous LLM
call).** Five rows: the three named above (new checks), `/api/scripts/[id]/text` (new per-account
check, found by the sweep), and `/api/demos/[id]/plan` (already had the per-account check at
enqueue time; its Anthropic calls run inside the `plan_demo_steps` job, which this task's hard
constraint forbids touching, and which already calls `assertBudget` itself before its own call).
Every row now reaches both a per-account and a platform check before its first Anthropic call.

## Related

- [[per-account-cap-blind-spot]] — the NULL-`business_id` blind spot this defect's paths never hit.
- [[0040-the-hard-ceiling-moves-to-the-providers]] — why the platform cap is a circuit breaker, not
  the primary bound, and what it does and does not catch.
- [[content-policy-classifier-never-runs]] — the same shape of gap (a control that existed and was
  never wired to its only reachable caller), fixed the same way: one call, at the actual choke
  point, not inside the shared low-level function.
