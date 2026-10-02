---
type: decision
status: verified
verified: 2026-10-02
method: "Founder decision D8 in the 2026-10-02 task prompt (section 2), and his two answers the same day in the planning session about the unapproved drafts (the question, its options and his replies are below). Counts: a read-only query on production, 2026-10-02 (demo_step_plans by status and approved_at, and each draft's owner through demos -> businesses -> users). The code is updatePlanSteps in packages/core/src/pipelines/demo-step-plans.ts and stepClip in packages/core/src/plan-format.ts."
source: founder + db + code
---

# 0088 — Plans stored before 2 s clips are untouched until edited

Decided 2026-10-02, built the same day on `feat/steps-fixed-2s-clips`. Tags: **FOUNDER-DECIDED**,
**PROPOSED → APPROVED**, **MEASURED**.

## The decision (FOUNDER-DECIDED)

**D8, task prompt:** approved plans already stored are untouched until edited.

**MEASURED 2026-10-02:** 19 ready plans, 11 approved and 8 unapproved drafts, 106 steps of
2.0–4.0 s. The eighth draft was generated that day, before this change reached the box.

**Asked in the planning session** about the unapproved drafts (7 at the time):

| option                  | what it means                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Re-save before approval | the editor opens an old draft with every step on its 2 s clip, marked unsaved; approve stays disabled until saved |
| Approvable as they are  | they behave like approved plans: untouched until edited, and an ad made from one keeps its old step lengths       |

- **His first answer:** "Confirm read-only that all 7 drafts belong to my own accounts. If any does
  not, stop and tell me. I will not approve them as they are."
- **MEASURED:** six are on his admin account. Two are on a customer account created 2026-08-27,
  which the data could not show to be his.
- **His second answer, asked whether that account is his:** "Yes, it is mine."

So no conversion is built: the drafts stay as they are until edited.

## As built (PROPOSED → APPROVED)

- **The render reads a stored step one way** (`stepClip`): its `startMs` when it has one,
  otherwise its moment's time and the length it was saved with. A plan stored before the change
  therefore gives the render exactly what it always did. No row was rewritten or backfilled.
- **A save places what has no clip.** `updatePlanSteps` keeps the clip of every step already
  stored with one, whatever its caption, and gives every other step — newly added, or stored in
  the old shape — its moment's 2 s clip. So editing an old plan turns all of its steps into 2 s
  clips, and a clip the customer has watched never moves on a later save.
- **"Edit a copy" copies exactly.** Saving an approved plan's own steps unchanged forks a
  verbatim copy, old lengths and all. Otherwise re-placing could make two steps overlap
  ([[0087-two-steps-never-share-footage]]) and the copy could not be opened at all.
- **In the editor** an old-shape draft shows its stored lengths while untouched. Once it is
  edited, every old-shape step shows the clip the save will store.

## What it leaves

- **The 8 old drafts, and a copy of an old approved plan, can be approved untouched and then
  render at their old lengths.** He said he will not approve them as they are.
- **Between the merge and the box restart** the old worker renders a new step from its moment,
  not from its clip's start, and still generates old-length plans. He was offered a first PR for
  the worker alone and declined: "No split PR. I will not approve or render between the merge and
  the box restart."

## Pinned by

`packages/core/test/step-clips.test.ts` ("a step stored before clips existed renders exactly as it
always did") and the edit, fork and old-shape tests in `packages/core/test/demo-step-plans.test.ts`.

## Related

- [[0076-every-step-is-a-fixed-2s-window-inside-its-screen]]
- [[stored-plans-under-the-screen-rule-2026-10-01]]
