---
type: defect
status: verified
verified: 2026-08-25
method: "grep -rn 'נסו שוב מחר' over the tree; read apps/web/src/lib/service-a-ui.ts:535-556 and apps/web/test/service-a-ui.test.ts:233-252; fix verified by the failKind cases in apps/web/test/service-a-ui.test.ts"
source: code
---

# The test that is supposed to stop the "lying retry button" cannot

## FIXED for plan rows 2026-08-25 — option 2 shipped

`demo_step_plans.fail_kind` (0029) carries the distinction structurally: the plan job writes
`quota | validator | input | internal | transient`, `planFailureNotice` branches on the kind when
present, and the wording of `fail_reason` decides nothing on any row written since. The substring
marker survives only as the fallback for the nine pre-0029 failed rows (whose stored Hebrew is
immutable, so the marker cannot drift out from under THEM), and for the 429 route body which
carries no row. The two "the test protects this" comments are rewritten to say exactly that.

Still open: the render/TTS/playback quota lines (`renders.ts`, `api-errors.ts`) still ride the
substring — unchanged blast radius, see below.

---

## The mechanism

Whether a failed plan offers the customer a retry is decided by a **substring match on Hebrew
copy**:

```ts
// apps/web/src/lib/service-a-ui.ts:541
const QUOTA_MARKER = "נסו שוב מחר";
// :558
return { message: failReason, retryable: !failReason.includes(QUOTA_MARKER) };
```

The string it matches against is written 2,000 lines away in another package —
`packages/core/src/pipelines/demo-step-plans.ts:1209` sets
`customerMessage: "הגעתם למכסת יצירת התוכן היומית של החשבון — נסו שוב מחר."` on the
`AccountBudgetError` catch, and that lands verbatim in `demo_step_plans.fail_reason`. There is no
shared constant between them.

## The code knows, and says it is protected

`service-a-ui.ts:535-540` is explicit about the hazard and names its guard:

> LOAD-BEARING COPY. … Rewording the quota lines without moving this marker puts the lying button
> back; **the test that pins the exact stored string is what goes red.**

The test comment at `apps/web/test/service-a-ui.test.ts:236-238` says the same:

> If this string is reworded, this test goes red BEFORE the lying button ships.

## Both comments are wrong

The test hardcodes **its own copy** of the Hebrew:

```ts
// apps/web/test/service-a-ui.test.ts:239-243
const stored = "הגעתם למכסת יצירת התוכן היומית של החשבון — נסו שוב מחר.";
const notice = planFailureNotice(stored);
expect(notice.retryable).toBe(false);
```

So reword `demo-step-plans.ts:1209` to drop the marker — say, to `נסו מאוחר יותר` — and:

- production `fail_reason` no longer contains `נסו שוב מחר`
- `planFailureNotice` returns `retryable: true`
- the customer gets a retry button for a failure a retry cannot fix
- **and the test stays green**, because it is asserting against a literal it owns, not against the
  literal the product emits

I checked for a test on the other side: `grep -rn "מכסת יצירת התוכן" packages/core/test apps/web/test`
returns exactly two hits, `apps/web/test/api-errors.test.ts:21` and
`apps/web/test/service-a-ui.test.ts:239` — **both in `apps/web`, both hardcoded copies.** Nothing in
`packages/core` pins the string that `packages/core` produces.

**The sibling path shows what the guard should look like.** `packages/core/test/credits-wiring.test.ts:646`
asserts the _render_ quota string against a row the pipeline actually wrote:

```ts
expect(row.error).toBe("הגעתם למכסת יצירת הסרטונים היומית של החשבון — נסו שוב מחר");
```

That is a core test pinning a core literal, so rewording `renders.ts:118` does go red. The plan path
at `demo-step-plans.ts:1209` is the **only** one of the quota lines with no test on the producing
side — which is exactly the line `planFailureNotice` depends on.

## Blast radius

One wrong button on one failure class, so the user-facing harm is small — they click retry, it fails
again the same way. The larger harm is the false assurance: two comments tell the next developer the
reword is guarded, so the reword will be made confidently.

The same shape covers three more quota lines (`renders.ts:118` for GPU, and the TTS and playback
lines in `apps/web/src/lib/api-errors.ts:95-109`). Note `renders.ts:118` omits the trailing period
the others carry — harmless today, because the marker is a substring, but it shows the literals are
already drifting.

## Fix shape

Two options, in increasing order of cost:

1. **Cheap and honest:** export the marker from `packages/core` and have both the thrower and
   `service-a-ui` import it. The coupling stays, but it becomes a compile-time reference instead of
   a string coincidence.
2. **Correct:** carry the distinction structurally. `jobs` already has an `error_class` column, and
   `demo_step_plans` has no equivalent — a `fail_kind` on the plan row would let the UI branch on
   data instead of copy. This is the fix [[plan-failure-diagnostics-are-unreachable]] also wants,
   so the two are worth doing together.

Either way, the two comments claiming the test protects this should go, because right now they are
the most dangerous part of the file.
