---
type: phase
status: verified
verified: 2026-08-25
method: "git show 269f2ce (the diff — the commit body is empty); git show 269f2ce:<path> | grep -n for every historical citation; ordering from git log --format='%h A:%ad C:%cd %P' --date=iso; gates re-run at 269f2ce in a detached git worktree with its own pnpm install"
source: code
---

# Phase 8e — the render step: steps quote/create routes, pinned-plan continue

**Commit:** `269f2ce`, 2026-08-21 23:36 +0300. 9 files, +508 −88.
**The commit body is empty** — `git log -1 --format=%B 269f2ce` is the subject line and a
`Co-Authored-By` trailer. Everything below is the diff.

**Follow-on:** `3cf0302`, 43 minutes later. It belongs to 8e — its single test lands inside 8e's own
`describe("the render step, steps format (8e)")` and its code comment cites "the 8e walkthrough" —
but it is **not** repairing something 8e broke. See below.

**8e landed before 8d.** `269f2ce` is 2026-08-21 23:36; `ecc3dfc` (Phase 8d) is 2026-08-22 04:30 —
4 h 54 m later, and `ecc3dfc`'s parent chain runs through `3cf0302` to `269f2ce`. Author and
committer timestamps are identical on every commit in the range, so this is not a rebase artifact.
[[8d-demo-step-rework]] carries what that ordering means.

## What shipped — read off the diff

- **Two new routes** under `apps/web/src/app/api/businesses/[businessId]/a-sets/steps/`:
  - `quote/route.ts` (GET, 39 lines) — `quoteStepsASet`, returning credits, balance and shortfall,
    or `null` on the admin bypass because nothing is charged.
  - `route.ts` (POST, 91 lines) — a silent 1×1 set from an **approved** plan pinned by id, never
    "latest". It re-checks that the demo, the plan's demo, the hook-line script and the hook clip
    all belong to this business, and that the hook clip is still `active`, so a foreign or retired
    id gets a proper 403/404 instead of an unmapped 500.
  - The two agree on price by construction: `createSet` prices steps through the same function the
    quote route calls (`packages/core/src/pipelines/sets.ts:206`).
- **Pinned-plan continue.** `pinnedPlanFrom` (`269f2ce:apps/web/src/lib/service-a-ui.ts:695`)
  freezes the plan id and the summed stored durations at continue-click time; `renderCompositionKey`
  (`:734`) keys the lifted render on all four composition inputs — plan, hook clip, hook line,
  placement — so a same-plan hook swap discards the old video instead of re-showing it as the new
  ad. The render state is lifted into the wizard so back-navigation mid-render re-attaches to the
  poll instead of landing on a fresh confirm that could double-charge, and the step rail locks once
  a render exists.
- **`StepARender` was repurposed, not added.** At `0629cbb` the file is the 321-line **voiced**
  step, still taking `audioId` and `personaId`; at `269f2ce` it is 369 lines taking `hook`,
  `hookLine`, `rect` and `plan`. After 8e the web has no voiced Service A render step at all —
  confirmed two ways: `aWizardSteps("full")` has no caller outside a test, and `StepARender` has
  exactly one importer, `a-wizard.tsx`.
- **The 400 ms mount-under-cursor arm originates here.** `approvedActionsArmed`
  (`269f2ce:apps/web/src/components/a-wizard/step-plan.tsx:648`) keeps continue and "edit a copy"
  disabled for 400 ms after the approve swap. The comment records why geometry was abandoned: the
  add-a-step button unmounting above lifts the whole block, so no in-block arithmetic keeps the
  controls out of a double-click's cursor band. 8d later generalised this into `useArmedOnMount`
  (`apps/web/src/components/a-wizard/step-demo.tsx:88`), whose own comment names this pattern.

## The gate

8e pinned **5 new tests** — 4 in `apps/web/test/service-a-ui.test.ts` under a new
`describe("the render step, steps format (8e)")`, 1 in `service-a.test.ts`
(`git show 269f2ce -- '<file>' | grep -cE '^\+\s*(it|test)\('`). `3cf0302` added a 6th into the same
describe.

- `it("pinnedPlanFrom pins the id and sums the stored durations")`
- `it("renderCompositionKey changes when ANY composition input changes")` — the comment above it
  records the review finding it exists for: keying on `planId` alone let a same-plan hook swap
  re-show the old video as the new ad
- `it("retryableCreateFailure: only the approval 409 takes the retry away")`
- `it("steps render body: plan pinned by id, silent — no audio, no persona")`

### Gates re-run at `269f2ce` on 2026-08-25

Same detached worktree and method as [[8a-wizard-shell-and-read-only-plan]], which explains both
caveats.

| gate                                                        | exit  | result                                                 |
| ----------------------------------------------------------- | ----- | ------------------------------------------------------ |
| `pnpm typecheck`                                            | 0     | green, 6 of 7 projects (55 s)                          |
| `pnpm lint`                                                 | **1** | red, as it was before Phase 8 began                    |
| `pnpm --filter @aiugc/web test`                             | 0     | **186 / 186** (13 s)                                   |
| `pnpm --filter @aiugc/core test -- --fileParallelism=false` | **1** | 328 passed, 1 failed (329) — the same harness artifact |

186 is 181 (8c) + 5. `packages/core` is untouched between 8b and 8d, so the core numbers are 8b's.

**8e shipped all 9 of its files prettier-clean** — the first Phase 8 commit that did
(`git show 269f2ce:<path> | prettier --check --stdin-filepath <path>` over every changed file).

## What it left behind

### Two API routes with no caller — one of which spends

8e's rewrite of `step-render.tsx` deleted the calls to
`POST /api/businesses/[businessId]/a-sets/preview` **and** `POST /api/businesses/[businessId]/a-sets`
(the full-format create route). Both route files are still tracked, still authenticated, still
deployed. Confirmed two ways: `grep -rn "a-sets"` over `apps/*/src`, `apps/*/test` and
`packages/*/src` finds only the two new `/a-sets/steps…` calls outside the route files themselves,
and ``git log -S'/a-sets`' --oneline`` returns exactly two commits — `2c66d6f` (2026-08-03), which
added the caller, and `269f2ce`, which removed it.

`preview` is advisory (`planAOutro` + `quoteASet`, nothing enqueued, no spend). **`a-sets` is the
one that matters**: it is the voiced Service A create path, and it debits. Nothing in the wizard can
reach it any more.

### The 409 the retry logic is built on is a fan-in, not an identity

`retryableCreateFailure` (`apps/web/src/lib/service-a-ui.ts`, unchanged since 8e) returns
`status !== 409`, and its comment states the reason as a fact: "409 = the pinned plan lost its
approval gate — an identical retry fails identically until the plan step fixes it."

`apps/web/src/lib/api-errors.ts` maps **eight** distinct message patterns to 409 (lines 46, 49, 54,
59, 67, 70, 73, 76), and at least two are reachable from this create route. The second one is the
sharp case: `createSet` throws `"demo is not ready"` (`packages/core/src/pipelines/sets.ts:152`,
before the format branch, so steps creates hit it), which maps to
`"סרטון המוצר עדיין בעיבוד — נסו שוב בעוד רגע."` (`api-errors.ts:67`) — Hebrew that says _try again
in a moment_ — while `retryableCreateFailure` takes the retry button away. The screen contradicts
itself in exactly that case.

### The price was in the wrong place — but 8e did not put it there

`3cf0302` moved the cost onto the confirm button (`stepsConfirmLabel` →
`"צור סרטון · N קרדיטים"`) and cut the supporting line down to balance only. The reason is recorded
twice in the tree: `apps/web/src/lib/quote-ui.ts:19` ("founder ruling, 8e walkthrough") and the test
comment at `apps/web/test/service-a-ui.test.ts:808`.

**The obvious reading — that 8e shipped the bad affordance and fixed it 43 minutes later — is
wrong.** In `git show 269f2ce -- apps/web/src/components/a-wizard/step-render.tsx` both
`{quoteLine(quote)}` and the bare `צור סרטון` button appear as unchanged **context**, not additions;
they were already there at `0629cbb` (lines 161 and 180), and
`git log -S"quoteLine(quote)" -- apps/web/src/components/a-wizard/step-render.tsx` dates the pattern
to `d8df728`, 2026-08-06 — fifteen days before Phase 8a. **8e is when the founder first looked at
this screen, not when the defect was written.** The vault README lists "price-on-button" as a
`decisions/` note still to write; `3cf0302` is the commit, and the founder walkthrough of 8e is the
occasion.

### And the render wait had no pipeline-derived progress

`renderWaitView` — queue position, elapsed, a stale-heartbeat "stuck" — arrived with `b60b5b6`,
extending 8d's pattern to 8e's screen.

## Related

- [[8a-wizard-shell-and-read-only-plan]] · [[8b-plan-editor]] · [[8c-inventory-picker]] · [[8d-demo-step-rework]]
- [[quote-reroll-for-render-is-dead-code]] — a different unreachable pricing path, older than 8e
- [[credit-costs-row]] — what the flat steps price is
