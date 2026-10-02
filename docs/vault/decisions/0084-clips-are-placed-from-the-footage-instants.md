---
type: decision
status: verified
verified: 2026-10-02
method: "Founder decision D4 in the 2026-10-02 task prompt (section 2, 'Decided … not up for relitigation'); the placement rule was proposed in the plan built on feat/steps-fixed-2s-clips and approved by him the same day. The numbers are facts/clip-placement-replay-2026-10-02.md. The code is placeClips in packages/core/src/pipelines/demo-step-plans.ts."
source: founder + code
---

# 0084 — Clips are placed from the footage instants; no model judges a screen change

Decided 2026-10-02, built the same day on `feat/steps-fixed-2s-clips`. Tags: **FOUNDER-DECIDED**
(his task prompt), **PROPOSED → APPROVED** (put to him in the plan and approved with it),
**MEASURED** ([[clip-placement-replay-2026-10-02]]).

## The decision (FOUNDER-DECIDED, D4)

No model judges screen changes ([[0083-no-model-names-the-instants-for-now]]). Windows are placed
from the stored instants and the fields the analysis already has; when unsure, treat an instant
as a change and place away from it. Nothing in the new rule is called a "screen", so the
in-place-swap question is closed.

- **His reason:** the label call missed about one change in ten, and calm-only clips cover about
  half the real screens.

It goes with [[0076-every-step-is-a-fixed-2s-window-inside-its-screen]] (every step a fixed 2 s,
every moment keeps a 2 s clip that contains it) and replaces that note's "inside its screen".

## The rule as built (PROPOSED → APPROVED)

Every moment gets one clip of 60 frames (2 s). One function, `placeClips`, computes it; the
inventory, a generated plan, a hand-added step and — through what they store — the render all use
that clip.

1. The clip contains the moment. It may start at the moment or up to 1.8 s before it (2 s less
   one analysis sample), never outside the recording. If the two conflict, the recording wins.
2. **Calm:** no instant inside the clip or closer than 0.2 s (6 frames) to either end, and the
   clip clear of the first and last 0.37 s of the recording, where the detector cannot place an
   instant. If a calm clip exists it is used: the one starting closest to the moment.
3. **Otherwise the best-fitting clip**, in this order:
   a. the fewest instants at which the analysis itself also saw a different page;
   b. the moment's own picture on screen the longest (the stretch between the instants either
   side of it, every instant treated as a change — [[0079-when-unsure-it-is-a-change]]);
   c. the least slide.
4. **No instants stored** for the analysis (no footage row, a failed decode, a detector other than
   `screens@1`): nothing is calm and the clip starts at the moment.

- **3a is the analysis's existing two-of-three judgement** between neighbouring moments
  (`isNewScreen`, [[0072-step-cap-no-padding-cut-early]]). It ranks clips that all cross
  something. It calls no model and shortens no clip. An instant before the first moment or after
  the last has no pair of moments around it and counts as a change.
- **Clips are placed in frames**, not milliseconds. The render lays a step out as
  `round(end·30) − round(start·30)` frames, which is exactly 60 only when the start sits on the
  30 fps frame grid (**MEASURED:** 24 of the 90,000 integer-millisecond starts in 90 s give 59
  or 61). A moment that falls between two frames takes the frame before it, so a clip never
  starts after its moment. At the 5 fps every production analysis ran at, each moment is on a
  frame and this changes nothing.
- **A generated plan prefers calm clips** by being told to (prompt `plan_demo_steps@v16`: each
  moment the model sees carries `calm`, and `twoPages` when its clip probably shows two pages).
  The model sees every moment; none is hidden for being non-calm. **MEASURED the same day, one
  paid run on each of five takes:** 7 of the model's 24 picks were calm, and 3 crossed a real
  change, each carrying the amber line ([[v16-paid-check-2026-10-02]]). The request moves the
  model little; code does not enforce it.

## Options and what was measured

| option                                                                                            | measured on the 15 analyses of the five takes                                                                                                               |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a generated plan uses only calm clips (his earlier proposal, [[instant-free-windows-2026-10-02]]) | with a 0.2 s margin 106 of 536 pickable moments qualify; 4 of the 15 analyses cannot reach 5 steps; three of his nine segments of the newest take hold none |
| **prefer calm, otherwise the best-fitting clip (chosen — D3, D5)**                                | 102 calm; every analysis offers 9 to 27 clips usable together                                                                                               |
| best-fitting = fewest instants first                                                              | 51 of the 434 non-calm clips hold a keyed real change                                                                                                       |
| best-fitting = the moment's own picture first                                                     | 74                                                                                                                                                          |
| **best-fitting = the analysis's page changes, then own picture (built)**                          | **35**                                                                                                                                                      |
| the clip always starts at the moment, never slid                                                  | 40 calm instead of 102                                                                                                                                      |

## What it leaves

- **A non-calm clip can show two pictures** ([[0085-a-draft-may-show-two-pages-and-says-so]]).
- **"Nothing is called a screen" is true of the rule's words, not of the code.** 3a and the access
  pin's run still read the analysis's page judgement. Demoted to the second key, the keyed
  crossings double (35 → 74), which is why it is first.
- **Calm is the detector's word.** It was measured on five phone-filmed takes of two desktop web
  apps, and the 0.2 s margin is a result on those recordings, not a guarantee
  ([[instant-free-windows-2026-10-02]]).
- **A recording of 8–10 s cannot offer five steps**: five clips are 10 s of footage. The
  minimum-step rule forgives it.
- **The recording's end is the raw upload's length**
  ([[the-recording-end-is-the-raw-uploads-length]]).
- **Existing analyses have no instants** until the backfill is run on the box
  ([[0081-existing-demos-keep-working-no-paid-re-analysis]]); until then rule 4 applies to them.

## Pinned by

`packages/core/test/step-clips.test.ts`: each rule on a synthetic timeline; a property test over
300 random timelines (every clip holds its moment, lies inside the recording, is exactly 60
frames, and a calm one is clear of every instant); the three recordings under
`packages/core/test/data/`. Added after the diff review, each killing a change the suite had let
through: an instant before the first moment alone, an instant on a moment's own frame, the 1.8 s
lead at its exact limit, and a moment off the frame grid.

## Related

- [[0076-every-step-is-a-fixed-2s-window-inside-its-screen]]
- [[0087-two-steps-never-share-footage]]
- [[0088-stored-plans-are-untouched-until-edited]]
- [[box-and-local-instants-agree-2026-10-02]]
