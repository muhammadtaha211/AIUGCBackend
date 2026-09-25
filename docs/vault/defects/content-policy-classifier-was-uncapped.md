---
type: defect
status: verified
verified: 2026-09-25
method: "Security audit phase 4 (.work/security/04-input.md, INP-01), audited at 80103a4. PROVEN
  there by a probe (packages/core/test/inp-classifier.secprobe.test.ts, PGlite, generateObject
  mocked, deleted per the audit's RULES.md limit 2): zero-credit account -> classifierCalls:0
  (refused first by assertAffordable); 45 flagged-text confirms against an account with credits ->
  presses:45, refused:45, classifierCalls:45, balanceBefore:75, balanceAfter:75, debitRows:0, and
  the loop still ran the classifier after both the per-account and platform llm caps were already
  tripped. Fix built on branch fix/inp-01-classifier-budget off a43e5ed (docs-only since 80103a4 —
  no drift in packages/, apps/, or supabase/ between the two, confirmed by
  `git diff --stat 80103a4 a43e5ed -- packages/ apps/ supabase/`, empty). Rebuilt as a permanent
  regression suite, packages/core/test/content-policy-gate-budget.test.ts: run against the
  unmodified worktree first (T1, T2 and T3 fail exactly as expected — T1 asserts a
  ContentPolicyError where an AccountBudgetError should have fired, T2 and T3 resolve where they
  should reject; T4, the admin-bypass guard, already passes unmodified) and again after the fix (4/4
  pass), plus the full packages/core suite (56 files, 735 tests, all green — including
  content-policy-gate.test.ts's fail-open tests unchanged and authz-12-usage-attribution.test.ts)."
source: code
---

# INP-01 — the content-policy classifier spent with no budget check ahead of it

## FIXED 2026-09-25 on branch `fix/inp-01-classifier-budget`

**What was open.** `assertContentPolicy` (`packages/core/src/pipelines/sets.ts:197-245` at the
audited SHA) calls `contentPolicyCheck` (`copy.ts:692-718`) → `callClaude` (`copy.ts:24-41`) — a
real, paid `claude-sonnet-4-6` call — with **no `assertAccountBudget` and no `assertBudget`**
anywhere on the path. [[authz-12-synchronous-copy-routes-uncapped]] capped four other synchronous
copy routes in the same style of gap; its sweep did not reach this call, because this one sits
inside a pipeline function reached from two web routes rather than at a route itself
([[content-policy-classifier-never-runs]] is the earlier, different defect — that the call was
never wired at all; this is that it was wired but never metered).

The call sits **after** `assertAffordable` and **before** the debit transaction in both
`createSet` and `createBRender`. A flag throws `ContentPolicyError` pre-debit, and every fail-open
`return` also exits pre-debit — so a refused or unclassified confirm charges nothing and can be
repeated with no bound. An account with one render's worth of credits could press confirm
indefinitely, each press a real Anthropic spend, none of it ever billed. The usage also lands in
the shared platform `llm_tokens` window that [[authz-12-synchronous-copy-routes-uncapped]] already
showed can park every tenant's analysis/plan/enhance jobs.

**MEASURED (the probe cited above).** A zero-credit account was refused before the classifier ran
(`assertAffordable` catches that case already). An account with credits and flagged text ran the
classifier 45 times for 45 presses, refused every time, debited nothing, and kept running the
classifier even after both the per-account and platform LLM caps had already been exhausted by
other means — because nothing on this path ever read either cap.

**The fix.** Two checks added to `assertContentPolicy`, after the `isAdminOwned` bypass and the
empty-text return, and OUTSIDE the try/catch that fails open on classifier errors:

```ts
await assertAccountBudget(db, "llm_tokens", businessId);
await assertBudget(db, "llm_tokens");
```

Same order [[authz-12-synchronous-copy-routes-uncapped]] used at its four routes: the fast,
typed per-account rejection first, the platform backstop second. Placed outside the try/catch (not
inside `callClaude`, which the audit report considered and rejected: `callClaude` is shared with
`generate_copy`-job-reachable functions, and a `BudgetError` swallowed by `assertContentPolicy`'s
own fail-open catch would have shipped the render unclassified anyway) — so a budget refusal is a
refusal, not a reason to let the render through. As defense-in-depth against a future change that
throws one of these classes from _inside_ the try, the catch itself also rethrows
`AccountBudgetError`/`BudgetError` by `instanceof` before its fail-open branch; today neither
originates there, so the two checks above are what actually fire.

**Usage attribution, verified rather than assumed (READ AND REPORT item, not a new probe).**
`callClaude`'s `businessId` parameter is required, and `contentPolicyCheck` passes its own
`opts.businessId` straight through — so the account-budget check sees the classifier's own spend,
the same property [[authz-12-synchronous-copy-routes-uncapped]] verified for its four routes.

**What this fix does NOT change.** `BudgetError` and `AccountBudgetError` were already mapped to
503/429 in `apps/web/src/lib/api-errors.ts` by [[authz-12-synchronous-copy-routes-uncapped]] — both
confirm routes (`a-sets/steps/route.ts`, `renders/route.ts`) already route every error through
`coreErrorResponse`, so no web-layer change was needed.

**Residuals — REASONED, not measured, and not closed by this fix:**

- A concurrent burst can still overshoot the per-account cap by the calls in flight — the same
  read-then-maybe-proceed shape [[authz-12-synchronous-copy-routes-uncapped]] residual (a) already
  named; this fix adds no lock or reservation.
- Enough distinct accounts can still fill the platform window between them — residual (b) of the
  same note, phase 5 (cross-account rate limiting), not this task. A platform trip now also refuses
  render confirms outright rather than silently letting them through unclassified, which is a
  behaviour change worth naming: before this fix, a platform-window exhaustion was invisible on this
  path (the classifier call would simply have had nothing stopping it either); after, it is a clean 503.
- Non-budget classifier errors still fail open exactly as before — [[content-policy-classifier-never-runs]]'s
  fail-open trade-off, and the separate open item INP-02 (schema mismatch and an oversize-input 400
  both still proceed unchecked; not touched here).
- If `generateObject`'s parse failure records no usage (docs/vault/state-of-play.md item 11, true
  at this SHA), a call whose output fails to parse debits no `usage_events` row and so is invisible
  to both caps — harmless today only because that same failure also fails open and the render still
  debits normally; INP-02 has to close that hole before either check here could be made to fail
  closed instead of open.

## Related

- [[authz-12-synchronous-copy-routes-uncapped]] — same shape of gap, same fix pattern, one call
  earlier in the pipeline than that sweep reached.
- [[content-policy-classifier-never-runs]] — the earlier defect on this same function: the call
  itself was missing entirely (fixed 2026-09-11), not just unmetered (fixed here). A different gap,
  same call site.
- [[per-account-cap-blind-spot]] — why `businessId` threading through `callClaude` matters here too.
