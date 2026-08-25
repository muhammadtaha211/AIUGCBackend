---
type: phase
status: verified
verified: 2026-08-25
method: "git show 9dab09a (the diff — the commit body is empty); git show 9dab09a:<path> | grep -n for every historical citation; gates re-run at 9dab09a in a detached git worktree with its own pnpm install"
source: code
---

# Phase 8b — the plan editor: labels, still preview, delete, approve

**Commit:** `9dab09a`, 2026-08-21 07:03 +0300. 7 files, +540 −51.
**The commit body is empty** — `git log -1 --format=%B 9dab09a` is the subject line and a
`Co-Authored-By` trailer, nothing else. Everything below is the diff.

**Follow-on:** `72e374b` (2026-08-21 20:12) landed on 8b's editor but rewrote a string 8a shipped —
attributed to 8a in [[8a-wizard-shell-and-read-only-plan]], not here.

**The subject overstates one of its four nouns.** "labels, still preview, delete, approve" reads as
if approve was built here; 8b adds **zero server code** for it. Every piece already existed, and
`git log -S` dates each one:

| piece                                                                    | first appeared in               |
| ------------------------------------------------------------------------ | ------------------------------- |
| `approvePlan` (`packages/core/src/pipelines/demo-step-plans.ts:1329`)    | `02842ea`, 2026-08-13           |
| `updatePlanSteps` (`…demo-step-plans.ts:1259`)                           | `02842ea`, 2026-08-13           |
| the render-time hard gate in `createSet` (`…/pipelines/sets.ts:165-166`) | `43f96c9`, 2026-08-16 (Phase 6) |
| `PATCH /api/plans/[id]` and `POST /api/plans/[id]/approve`               | `621be1e`, 2026-08-17 (Phase 7) |

What 8b built is the button, and the rule that the button is hidden while the draft is dirty.

8b consumes those routes; it does not add to them.

## What shipped — read off the diff

- **Editable labels with a soft word warning.** `labelWordWarning`
  (`9dab09a:apps/web/src/lib/service-a-ui.ts:356`) fires at `MAX_LABEL_WORDS`. Advisory only: the
  comment states the rule that the model path is hard-capped and the human edit path is never
  rejected on word count.
- **The live still preview.** `StepStill`
  (`9dab09a:apps/web/src/components/a-wizard/step-plan.tsx:502`) draws the step's signed frame with
  the label overlaid in CSS at render geometry.
- **Delete, with a soft floor warning.** `deleteWarning` (`…service-a-ui.ts:364`) names a plan below
  `A_STEPS_MIN_DEFAULT`; the server still accepts any non-empty plan, so deleting stays allowed.
- **Save / discard on a dirty draft.** `draftBlockedReason` (`:372`) blocks only an empty label;
  `stepsPayload` (`:380`) sends exactly `sourceIndex` + trimmed label; `planStepsDirty` (`:392`)
  compares trimmed, so a whitespace-only edit is not dirty because the payload trims it away.
- **The approve gate, and an explicit fork after it.** `PlanEditor`
  (`…step-plan.tsx:560`) posts `/api/plans/${planId}/approve`; approve is hidden while dirty, so
  what gets approved is always exactly what is saved. An approved plan goes read-only and the only
  way onward is "עריכת עותק חדש", which PATCHes and forks a fresh unapproved row server-side.
- **Three constants moved into the client-safe `plan-format` entry** so the editor could import them
  without dragging `db`/`fs`/provider imports into the browser bundle: `MAX_LABEL_WORDS`,
  `MIN_LABEL_WORDS`, and a new `A_STEPS_MIN_DEFAULT = 5`. This continues the thread `9c323aa` began
  and 8a extended.

## The gate

8b pinned **9 new tests** — 8 in `apps/web/test/service-a-ui.test.ts` under a new
`describe("plan editor helpers (8b)")` with a nested `describe("dirty detection")`, and 1 in
`packages/core/test/demo-step-plans.test.ts` under `describe("plan-format editor constants (8b move)")`.
Counted with `git show 9dab09a -- '<file>' | grep -cE '^\+\s*(it|test)\('`.

What they actually pin:

- `it("soft word warning fires at 6 words and stays silent through 5")`
- `it("delete warning names plans below the a_steps_min default only")`
- `it("only an empty label blocks saving — content is never judged")`
- `it("a label edit is dirty; a whitespace-only edit is not (the payload trims)")`
- `it("word band and min-steps default hold their shipped values")` — the core-side pin on the move

### Gates re-run at `9dab09a` on 2026-08-25

Same detached worktree and method as [[8a-wizard-shell-and-read-only-plan]], which also explains
the two caveats below.

| gate                                                        | exit  | result                                                 |
| ----------------------------------------------------------- | ----- | ------------------------------------------------------ |
| `pnpm typecheck`                                            | 0     | green, 6 of 7 projects (110 s)                         |
| `pnpm lint`                                                 | **1** | red, as it was before Phase 8 began                    |
| `pnpm --filter @aiugc/web test`                             | 0     | **175 / 175** (13 s)                                   |
| `pnpm --filter @aiugc/core test -- --fileParallelism=false` | **1** | 328 passed, 1 failed (329) — the same harness artifact |

175 is exactly 146 (8a) + 21 (`f8a8dea`) + 8 (8b's own web tests). The single core failure is the
`e2e.test.ts` `"steps":[{` assertion against a 500-character DRY_RUN props truncation; it fails at
HEAD too inside the same long-path worktree and passes at HEAD in the founder's tree, so it is the
harness, not the commit. Explained in full in [[8a-wizard-shell-and-read-only-plan]].

**8b shipped 3 of its 7 files prettier-dirty**
(`git show 9dab09a:<path> | prettier --check --stdin-filepath <path>`):
`apps/web/src/components/a-wizard/step-plan.tsx`,
`packages/core/src/pipelines/demo-step-plans.ts` and `packages/core/test/demo-step-plans.test.ts`.

## What it left behind

- **`a_steps_max` stayed a bare literal.** 8b replaced the `a_steps_min` fallback with the new
  `A_STEPS_MIN_DEFAULT` constant but left the line below it as
  `await getConfigValueOr(db, "a_steps_max", z.number(), 8)` — visible as unchanged context in
  `git show 9dab09a -- packages/core/src/pipelines/demo-step-plans.ts`. It was not extracted until
  `b60b5b6`, which also lowered it to 7 in the same edit. Both facts are already recorded in
  [[steps-format-defaults-are-code-constants]]; the point here is only that 8b is where the
  asymmetry started.
- **No add-side warning.** `deleteWarning` shipped with 8b; its twin `addWarning`
  (`apps/web/src/lib/service-a-ui.ts:625`, `git log -S"addWarning" --oneline`) only arrived with
  `b60b5b6`. Between 8b and `b60b5b6` the editor named a plan that was too short and said nothing
  about one that was too long — including after 8c made growing a plan a one-click action.
- **The negative-headroom copy 8a shipped** was carried through the editor rewrite unchanged
  (`9dab09a:…/step-plan.tsx:657`) and only fixed 13 hours later by `72e374b`.

## Related

- [[8a-wizard-shell-and-read-only-plan]] · [[8c-inventory-picker]] · [[8e-render-step]] · [[8d-demo-step-rework]]
- [[steps-format-defaults-are-code-constants]] — what the min/max constants actually are today
- [[last-step-renders-shorter-than-the-wizard-promises]] — a defect in the durations this editor displays
