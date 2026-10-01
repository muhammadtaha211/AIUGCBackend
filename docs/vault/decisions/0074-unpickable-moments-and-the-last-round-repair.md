---
type: decision
status: verified
verified: 2026-10-01
method: "Founder decisions, all 2026-10-01: D1-D6 in that day's task prompt (section 2, 'Decided … not up for relitigation'); three answers to questions put to him in the planning session; two amendments he wrote when approving the plan. The build choices were proposed in the plan and approved with it. Evidence: read-only production reads and offline replays under packages/core/.work/plan-repair/ (gitignored; export.ts, screens.ts) and the tests in packages/core/test/plan-repair.test.ts."
source: founder + db + code
---

# 0074 — The model is offered only pickable moments, and the last round is repaired

Decided 2026-10-01, on branch `fix/steps-plan-repair`. Tags: **FOUNDER-DECIDED** (his words or his
pick among options), **PROPOSED → APPROVED** (put to him in the plan and approved with it),
**MEASURED**, **REASONED**.

## Why

Two live `plan_demo_steps@v15` plans failed on 2026-10-01 with «יצירת תוכנית הצעדים נכשלה — נסו שוב»,
both on the founder's 84 s tavnit.ai recording. **MEASURED**, read-only, from the two rows:

- **`bd0913b4`** (analysis `4219e82e`). Round 1 picked state 9 (1 200 ms clip) and state 12 (2 000 ms
  clip, a caption needing 2 800 ms). Round 2 kept state 9. Round 3 was a whole plan 600 ms over:
  `the steps total 21600ms`.
- **`ce687d4a`** (analysis `6658999c`). Round 1 picked states 9 and 12, round 2 moved the caption to
  state 11, round 3 moved it back to state 12. States 11 and 12 each have a 200 ms clip. Its rounds
  carry PR #75's wording, so that advice was live and did not work
  ([[pr-75-retry-advice-gets-the-model-to-drop-the-step]]).

Both rows store `steps: null`; a failed plan keeps only its violations.

## The decision (FOUNDER-DECIDED, task prompt)

- **D1.** A moment whose own clip is shorter than the shortest caption's read time (1 600 ms) is
  not pickable by the model. Enforced by construction, not by prompt wording. His reason: every
  violation in `ce687d4a` and state 9 in `bd0913b4` was such a pick, and advice to the model failed
  live twice.
- **D2.** After the last call, code repairs instead of failing. A step whose caption cannot be read
  in its clip is dropped. A total over 21 s is brought under by dropping steps; the access pin and
  the ending step are not the ones dropped. His reason: `bd0913b4`'s last round was a whole plan
  0.6 s over and `ce687d4a`'s had one bad step, and
  [[0070-a-step-ends-on-a-real-screen-change]] already makes deleting the step the remedy.
- **D3.** A repaired plan is not held to the 15 s floor or the 5-step minimum. His reason:
  hand-edited plans are never band-checked ([[0072-step-cap-no-padding-cut-early]]), and a short
  draft the customer can extend beats a failure.
- **D4.** The drop is silent: no new customer copy or UI. A repaired plan must still be
  distinguishable from a clean one on its row, "for us". The task prompt gives no further reason.
- **D5.** No prompt rewording as the fix; touch the prompt only where D1 makes its text false. No
  reason is given under D5 itself; D1's is that advice to the model failed live twice.
- **D6.** The cut rule stays (0070, 0072). The screen count is "evidence for a later decision,
  nothing more" ([[screens-with-no-pickable-moment-2026-10-01]]).

## Decided in the planning session (FOUNDER-DECIDED, options as offered)

| Question                                                                         | Options offered                                                                       | His pick                                                                                                                          |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| The last round is clean except under 15 s or under 5 steps, with nothing to drop | store it as a draft; fail as today                                                    | **Store it.** Otherwise an identical plan is stored when the model's answer also held a droppable step and fails when it did not. |
| A last plan over 21 s: which step goes                                           | the shortest that is enough; the earliest after the pin; the latest before the ending | **The shortest that is enough.** On `bd0913b4` that is the 2.0 s step (19.6 s left); the other two drop a 4.0 s step (17.6 s).    |
| The unreadable step is the ending itself                                         | fail as today; keep the ending as written; store without the ending                   | **Fail as today.**                                                                                                                |

**Two amendments, written with his approval of the plan:**

1. **A floor of 3 steps.** "If the repair leaves fewer than 3 steps, fail as today. Reason: one or
   two steps is a failure shown as a ready plan." The pin is counted as a step (**PROPOSED →
   APPROVED**), so the pin plus the ending alone fails.
2. **Every plan is marked.** "Mark every plan generated after this change, not only repaired ones:
   add a suffix to prompt_version the way +access-pin is added, so the 'model sees only pickable
   moments' boundary is on the row. +repaired stays as designed."

## As built (`packages/core/src/pipelines/demo-step-plans.ts`; PROPOSED → APPROVED)

**One definition.** `captionableClip`: a state's own clip (`timelineClipMs`) is at least
`MIN_GAP_MS`. It replaces the validator's and the canned planner's inline copies of G1 (0072), and
the generation path now reads it too.

**D1, two halves.**

- `planPromptTimeline` is the timeline the model is sent: every captionable state plus the pin.
  Entries keep their absolute `index`, so the indexes skip. `findAccessMoment` still runs on the
  full timeline, so the pin and its candidates are untouched.
- A model pick of a hidden state is stripped from the plan before any check, in every round, the
  way `withPin` strips the pin's drop zone.

**The repair, `repairPlanSteps`,** runs where the job used to throw:

1. Not attempted when an index is outside the timeline or picked twice.
2. **Read time, last step to first.** Re-assemble; drop a step whose clip is shorter than its
   caption's read time. A later drop can rescue an earlier step, never the reverse. **The ending is
   never dropped:** when the unreadable step is the last selected `result` state the plan is not
   repaired at all and fails as today, also when the model's `notes` waive the ending rule (his
   third pick; the validator alone would have let that case through). An unreadable last step
   that is not a `result` state is dropped like any other.
3. **Trim, while the total is over 21 s.** If dropping one step is enough, the one that leaves the
   longest ad goes; otherwise the one that shortens it most, and look again. Ties go to the earlier
   step. Never the pin, the last step, or the ending. Every total is re-assembled, because a
   dropped step's time is often absorbed by the step before it.
4. Fewer than 3 steps left: fail as today.
5. Re-check with `findPlanViolations`, the floor and the minimum switched off (`minSteps: 1`,
   `runtime.minMs: 0`). Clean: stored `ready`. Anything left: `PlanViolationError`, same rounds,
   exactly as before.

**MEASURED** (96 000 random single drops over the five fixtures and `4219e82e`, cap 4000/2500,
sample 200/500): a drop never shortened another step, never lengthened the total, and never
brought two picks closer. So no pass can undo an earlier one.

**The bar is the model's rules minus two, not the hand-save bar.** D3 names the floor and the
minimum; the task prompt's section 3 said to leave every other class as it is. `updatePlanSteps`
accepts more than this (skip kinds, a 7-word label, two picks 400 ms apart, a plan that ends
anywhere). A repaired plan is held to all of those still.

## What still fails for the customer

On the last round, after the repair:

- fewer than 3 steps left;
- the ending's own caption cannot be read in its clip;
- the plan does not end on the success state;
- a skipped-kind screen (the one class with its own customer line), a state the analysis marked
  `unreadable`, a label over 6 words or 60 characters, an empty label;
- two picks under 1.6 s apart whose earlier caption can still be read in the gap: one word with
  0.8 s or more, two words with 1.2 s or more. Any caption that cannot be read in the gap is
  dropped, and the pair goes with it;
- more than 7 steps still left, an index outside the timeline or picked twice, zero steps.

Unchanged: the account's daily quota, a missing questionnaire, an analysis that is not ready, and
a transient error on the last attempt. **REASONED:** the task prompt's goal line ("violations that
dropping steps would clear") is wider than this. A plan that runs past its success state, a
skipped-kind or `unreadable` pick and an over-long label would each be cleared by dropping a step;
section 3 narrowed the repair to D2's two classes.

## What the row says

- `prompt_version` is `plan_demo_steps@v15+pickable`, then `+access-pin` when a pin exists, then
  `+repaired`. Bare `@v15` rows are from before this change: the model was shown every state.
  DRY_RUN stub rows keep `@dry-run` (no model, no timeline sent).
- `+repaired` means the stored plan is not the model's last answer as given: the repair stored it,
  or a hidden pick was stripped from an answer that was otherwise clean. A pick inside the pin's
  drop zone is not marked; `withPin` has always removed those.
- `retry_violations` stays one entry per model call. A `ready` row whose last entry is non-empty
  went through the repair, and that entry is what was cleared or waived:
  `select id from demo_step_plans where status = 'ready' and jsonb_array_length(retry_violations -> -1) > 0`.
- That query does not count the other `+repaired` case, a hidden pick stripped from a clean
  answer: those rows end on an empty round. They are
  `prompt_version like '%+repaired' and jsonb_array_length(retry_violations -> -1) = 0`.
- A hand edit keeps the suffix: an in-place save keeps both columns, and a fork of an approved plan
  copies `prompt_version` (like `+access-pin`) and leaves `retry_violations` null. So count by the
  two queries above, never by the suffix alone.
- `aiugc plan regress` never counts a repaired plan green and prints `REPAIRED by code` with what
  the model's last call left. Before the repair such a run failed outright, and the regress exists
  to show the model's own answer.
- Neither column is sent to the browser (`stepPlanResponse` whitelists its fields). RLS lets an
  owner read his own row directly, as it always has.

## The two cases under this code

| Case                                       | Before                         | Dropped                         | Stored          |
| ------------------------------------------ | ------------------------------ | ------------------------------- | --------------- |
| `bd0913b4`'s last round                    | states 0 8 12 45 51 57, 21.6 s | state 12 (2.0 s), by the trim   | 5 steps, 19.6 s |
| `6658999c`, a last round carrying state 12 | states 0 12 45 51 57           | state 12 (0.2 s clip), stripped | 4 steps, 15.6 s |

**MEASURED** on the exported timelines through the plan job with a mocked model
(`plan-repair.test.ts`). The exports under `packages/core/test/data/` keep production's timing and
screen structure and none of its text: the recording's browser chrome put other tabs' titles into
`visibleText`, so every word is a placeholder token, and the export proves each clip and the pin
unchanged. The first is a **reconstruction**: its total matches the stored round-3
violation exactly, and its captions are plausible, not stored. **What the model does with the
filtered timeline is unmeasured**; the tests prove the code path only.

## Consequences accepted with the plan

- **A draft can be 3 or 4 steps.** Under 5, the editor opens with its existing amber
  "פחות מ-5 צעדים" line. **MEASURED** in the tree: the customer cannot regenerate from a ready draft.
  `requestPlan` is called from three places in `apps/web/src/components/a-wizard/step-plan.tsx`
  (no plan yet, a dead job, a failed plan) and from none in the ready editor. The route would
  accept it, and `aiugc demo plan` does it from the CLI.
- **The model sees less.** **MEASURED:** 205 of 725 states across the 14 ready production analyses
  are hidden, and each of the 14 keeps at least one captionable `result` state. On 4 of the 5 repo
  fixtures every `result` state is hidden; `v15` then tells the model to write the customer-visible
  "no clear finish, refilm" note.
- **Prompt `v15` is unchanged.** Lines 96–98 and 121–122 speak of "the last state before a screen
  change", which the model no longer sees. They stay true of the recording and push toward longer
  clips. The plan he approved said so and offered a `v16` on request; he did not ask for one and
  gave no reason.
- **The fixtures' live pins** all include hidden states ([[timeline-fixtures]]).
- **The retry advice still names exits that may not exist**
  ([[plan-retry-advice-names-exits-that-may-not-exist]]). A bad exit now costs a round, not the plan.

## To take effect

The box only ([[0039-three-deploy-axes-and-the-box-is-the-one-that-forgets]]): `git pull` and a
worker restart. The plan job is the only reader of this code; the prompt file did not change.

## Pinned by

`packages/core/test/plan-repair.test.ts`: the offered timeline on both production analyses; a
1 200 ms pin stays offered; the repair's passes, ties and protected steps; `bd0913b4` and
`6658999c` through the job; state 9 stripped and never echoed; a 1 200 ms pin never stripped; the
too-short-only draft; the 3-step floor; the unreadable ending, with and without `notes`; the
too-close pair with 2 and 3 words; the marks on ready and failed rows.
`packages/core/test/plan-access-step.test.ts` and `plan-retry-contract.test.ts` carry `+pickable`.
