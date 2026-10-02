---
type: decision
status: verified
verified: 2026-10-02
method: "Founder decision D7 in the 2026-10-02 task prompt (section 2). How each path refuses an overlap was proposed in the plan built on feat/steps-fixed-2s-clips and approved by him the same day, with the Hebrew strings. The code is findPlanViolations, repairPlanSteps and updatePlanSteps in packages/core/src/pipelines/demo-step-plans.ts, and the editor in apps/web."
source: founder + code
---

# 0087 — Two steps in one plan never share footage

Decided 2026-10-02, built the same day on `feat/steps-fixed-2s-clips`. Tags: **FOUNDER-DECIDED**,
**PROPOSED → APPROVED**.

## The decision (FOUNDER-DECIDED, D7)

Two steps in one plan never overlap in footage. The task prompt gives no reason under D7; the
brief left "how the editor refuses an overlap and how the repair adapts" to the build.

## As built (PROPOSED → APPROVED)

Each moment has one fixed clip ([[0084-clips-are-placed-from-the-footage-instants]]), so "overlap"
is a property of two moments: their clips share at least one frame. Clips that only touch do not
overlap. Every pair is checked, not neighbours only.

- **Generated plans.** Two picked moments whose clips overlap is a violation naming both clips and
  which to give up (the other, when one is the ending). It drives the corrective calls. After the
  last call the repair keeps the largest set of steps that share no footage and holds the pin and
  the ending; among equal sets, more steps the re-check will accept (not unreadable, not a
  skipped kind), then more calm clips, then fewer two-page ones, then the earlier steps.
  The 1.6 s minimum gap of [[0072-step-cap-no-padding-cut-early]] is gone; this replaces it.
- **Hand edits.** `updatePlanSteps` refuses a selection with overlapping clips. In the editor an
  inventory moment whose clip overlaps a step in the draft cannot be added and says which:
  «חופף לצעד 3 בתוכנית», «חופף לצעדים 3 ו־4 בתוכנית».
- **Old plans being edited.** A save re-places every step stored before clips existed
  ([[0088-stored-plans-are-untouched-until-edited]]), and two of them can then overlap. The editor
  marks the later one — «חופף לצעד 2 — אותן שניות בסרטון. מחקו אחד מהם.» — and holds the save:
  «יש צעדים חופפים — מחקו אחד מכל זוג כדי לשמור.» The server answers the same line.
- **The access pin.** A moment whose clip overlaps the pin's clip is in the pin's zone and is
  stripped from a generated plan, like the rest of the address-bar run. So is every moment before
  the address bar's end: the pin is fixed first, and nothing may sit in front of it (added
  2026-10-02 after the diff review; before it, a moment from before the typing could be picked
  and the stored plan then opened on it).

## What it leaves

- **MEASURED:** on the recording with the fewest moments (T4, `f6e343d1`) only 9 pickable clips can
  be used together, so a full plan leaves most inventory tiles blocked
  ([[clip-placement-replay-2026-10-02]]).
- The minimum of 5 steps is waived when the recording cannot offer five separate clips ending on
  its success moment. The count is exact.

## Related

- [[0076-every-step-is-a-fixed-2s-window-inside-its-screen]]
- [[0074-unpickable-moments-and-the-last-round-repair]]
