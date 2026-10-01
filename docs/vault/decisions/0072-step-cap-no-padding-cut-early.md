---
type: decision
status: verified
verified: 2026-10-01
method: "Proposed by the planning session in the 2026-10-01 task prompt (section 2, 'Proposed … not yet confirmed') and in the plan built on feat/steps-end-on-screen-change; the founder approved that plan on 2026-10-01 without edits. The numbers come from read-only scratch measurement in packages/core/.work/steps-screen/ (gitignored), written up in facts/screen-change-signal-2026-10-01.md and facts/stored-plans-under-the-screen-rule-2026-10-01.md."
source: founder + db + code
---

# 0072 — Steps: a 4 s cap, no padding, and cut early when unsure

> **2026-10-01 — decided, NOT YET BUILT:**
> [[0076-every-step-is-a-fixed-2s-window-inside-its-screen]] replaces this note's 4 s cap and its
> "no floor" with a fixed 2 s step. It also replaces the bounds this note kept from
> [[0002-runtime-band-floor-is-15s]]: 5–7 steps and 15–21 s become 5–10 steps, with the band
> retired. The code runs this note until 0076 is built.
>
> **Re-confirmed in code the same day:** a stored `timestampMs` is the lower median of its cluster
> (`ffmpeg.ts` `clusterStates`), and `demo-analysis.ts` never reads a cluster's `startMs` or
> `endMs`. Where screens really start and end was measured from the footage instead:
> [[screen-spans-from-the-footage-2026-10-01]].

How [[0070-a-step-ends-on-a-real-screen-change]] is built. Tags: **PROPOSED → APPROVED** (put to the
founder in the plan and approved with it, 2026-10-01), **MEASURED** (the facts notes cited),
**REASONED** (inference from what is cited).

## The three proposals the founder approved

1. **Keep a cap on step length: 4000 ms**, the shipped `MAX_STEP_MS` (config `a_step_ms_max`). Until
   now no step ever reached it, because the 3 s floor bound everything.
2. **A step is never padded past its screen to reach a minimum.** A caption that needs longer than
   its screen lasts is a warning to the customer, never a longer clip. So the floor (`MIN_STEP_MS`,
   `a_step_ms_min`), the per-kind `DEFAULT_STEP_MS` table and `a_step_ms_by_action` are deleted. No
   `app_config` row existed for any of them (**MEASURED** 2026-10-01).
3. **When the signal is unsure, cut early: a short step beats a bleed.**

## The rule as built (`packages/core/src/pipelines/demo-step-plans.ts`)

`durationMs = min(the state's own clip, the gap to the next selected state)`. The state's own clip
is `timelineClipMs`: from the picked state to its screen's end, or the cap, or the recording's end.

**The signal — `isNewScreen`.** A state starts a new screen when its `sameStateAsPrevious` is false
and **two of three** of the analysis model's signals agree:

- `actionType` is `navigate`;
- the two `screenName`s are not similar: not equal, not the same text before " - ", neither name's
  words inside the other's, and under half the words shared;
- the transcribed `visibleText` overlaps by less than 25 % (token Jaccard).

**MEASURED** against the footage, this was the only candidate with no bleed and no missed change.
It caught all 11 real screen changes in the tavnit recording and cut 0 of 64 plan steps late. Seven
other rules built from the same fields were compared; each either missed changes or cut more steps
short ([[screen-change-signal-2026-10-01]]).

**The cut — one analysis sample after the last state still on the screen.** **MEASURED** in the code:
a stored `timestampMs` is the LOWER median of a cluster of at least 2 samples (`ffmpeg.ts`
`clusterStates`, `MIN_CLUSTER_FRAMES = 2`), so the next sample is still inside that cluster. The cut
therefore never shows a frame of what follows, unless the signal itself missed the change. The
sample is `floor(1000 / a_analysis_fps)`, read through the same `analysisFps` helper the analysis
uses, and never a literal 200: a skeptic showed a literal 200 breaks above 5 fps.

Options offered for the cut, all **MEASURED** on the same 64 steps:

| cut                                               |    bleeds | cut ≥ 1 s early |
| ------------------------------------------------- | --------: | --------------: |
| the next state's own timestamp                    |        11 |               2 |
| the midpoint                                      |         6 |               6 |
| the next state − 1.4 s                            |         2 |               6 |
| a provable cluster bound from the review          | 2 (0.4 s) |               7 |
| **one sample after the last state on the screen** |     **0** |           **9** |

**The price.** A state picked last on its screen gets a very short clip, down to 0.2 s. **MEASURED:**
82 of 389 selectable production states have a clip under 1.6 s, 49 of them 0.2 s.

## The numbers

- **Cap 4000 ms.** **MEASURED:**
  - The median selectable state's own clip is the full 4.0 s, and 221 of 389 reach the cap.
  - At 4.0 s, five steps reach at least 16.2 s on every recording.
  - At 3.5 s, recording `f6e343d1` tops out at 14.7 s with five steps. That forces a sixth step: 0002's padding trap.
  - At 3.0 s, 9 of the 17 stored plans fall under the band.
- **Min gap `MIN_GAP_MS` = 1600 ms**, derived as the read time of the shortest caption the prompt
  allows (3 words). It replaces "a step is at least 3 s" in the min-gap violation, the minimum-steps
  walk, the reachability DP and the canned DRY_RUN planner. It is not a knob.
- **Steps 5–7 and the 15–21 s band are unchanged** ([[0002-runtime-band-floor-is-15s]]). **REASONED:**
  coherence holds for every n in 5..7:
  - n × 4000 ≥ 15000;
  - n × 1600 ≤ 21000;
  - 5 × 4000 = 20000 ≤ 21000.

  The old "7 × 3 s fills 21 s exactly" invariant is gone: 6 or 7 full-length steps exceed 21 s,
  which is the ordinary "drop a step" retry.

## Guards the zero-bleed cut needed (G1–G3)

- **G1:** on the model path, a state whose own clip is under `MIN_GAP_MS` can carry no caption. So it
  is not a required success ending, and it is not counted toward the minimum-steps waiver or the
  reachability DP. **REASONED:** otherwise the ending rule and the read-time rule would demand
  opposite things of one state, and the plan would die after its three calls. **Since
  [[0074-unpickable-moments-and-the-last-round-repair]]** the model is not shown such a state at
  all, and a pick of one is stripped before the validator runs. One predicate serves both.
- **G2:** the access pin's clip must carry "כנסו לכאן" (1200 ms), because the pin is re-pinned every
  round and a read-time violation on it could never be fixed. Which candidate on the address-bar
  screen gets pinned:
  - the **earliest** candidate whose clip reaches that screen's end inside the cap and is readable;
  - otherwise the latest candidate whose capped clip is readable;
  - otherwise no pin at all.

  The pin's drop zone runs to at least the pin plus `MIN_GAP_MS`. Nothing licensed next to it can
  then be a min-gap violation.

- **G3:** the recording end is `max(floor(demos.duration_ms / sample) · sample, last state + 1
sample)`. `duration_ms` is the raw upload's container length. A missing length falls back to the
  last state plus one sample. This also fixes [[last-step-renders-shorter-than-the-wizard-promises]].
- **The reachability bound, after the 2026-10-01 diff review.** The final whole clip counts only for a
  plan that ends on a success candidate, when one exists. The pin is a fixed part of every plan, never
  a slot a longer state could take. **MEASURED:** before these two fixes, the bound could certify a
  "too short" that no retry could clear. Both cases were reproduced by independent verifiers and are
  now pinned by tests.
- **Known limits, not fixed:** [[screen-cut-assumes-the-current-analysis-fps]] (the cut is bounded by
  the next screen's first state) and [[a-screen-missing-from-the-timeline-is-invisible-to-the-cut]].

## Plans under 15 s

- **Generated:** "too short" fires only when the exact reachability DP says 15 s is reachable on that
  timeline. The DP now uses screen-bounded clips. Otherwise the plan ships its honest, shorter length.
  **Since [[0074-unpickable-moments-and-the-last-round-repair]]** "too short" drives the corrective
  calls only: a plan still under 15 s after the last call is stored as a draft, down to 3 steps.
- **Human-edited:** never band-checked, as before; the editor's total line shows the number.
- **Stored plans:** untouched until re-saved. **MEASURED:** under the new rule, 4 of the 17 would land
  under 15 s and 2 over 21 s ([[stored-plans-under-the-screen-rule-2026-10-01]]).

## What else changed with it

- **Prompt `plan_demo_steps@v15`.** Each timeline entry the model sees carries `clipMs`. The timing
  section says a clip runs until its screen changes, at most the cap, cut by the next selected state.
  v14's "cut off by the next state YOU selected" and "runs its floor length" were false after this
  change. **The model's behaviour under v15 is unverified until a paid `aiugc plan regress`.**
- **Wizard previews.** The inventory and added-step previews play the state's own clip (`clipMs` from
  the analysis route), replacing `PREVIEW_FALLBACK_MS` (a restated 3 s floor).
- **The read-time warning copy, approved with the plan.** It changed from «הצעד הזה קצר מדי לכיתוב — הוא
  ייחתך לצעד הבא לפני שיספיקו לקרוא אותו …» to «הצעד נגמר לפני שיספיקו לקרוא את הכיתוב (חסרות X שנ׳). קצרו
  את הכיתוב, או מחקו את הצעד ובחרו רגע אחר.» The old copy was false whenever the screen, not the next
  step, ended the clip.

## To take effect

Both deploy axes ([[0039-three-deploy-axes-and-the-box-is-the-one-that-forgets]]):

- **Vercel**, for `updatePlanSteps` and the analysis route.
- **The box**, for the plan job: `git pull`, then a worker restart.

**The pull and the restart must go together.** The prompt file is read on every call, so a process
started before the pull would render v15's prose without `clipMs` in its timeline.

## Pinned by

**`packages/core/test/demo-step-plans.test.ts`:**

- "isNewScreen — two of three signals (decision 0070)": a popup, a typing run and a scroll stay
  inside a screen; a navigation leaves it; one signal alone or a duplicate frame never cuts.
- "assembleSteps ends a step where its screen ends (decisions 0070, 0072)": the cut lands one sample
  after the screen's last state. The next selected state cuts sooner, and the last step never outruns
  the recording or the cap.
- "recordingEndMs (where the last step must stop)".
- "the tavnit recording's screens (measured)": the table above, state by state.
- "every fixture: no step outruns its screen, its neighbour or the recording": a property test over
  all five fixtures.
- "timelineClipMs is what a one-step pick renders": the analysis route's `clipMs` equals what a
  one-step plan stores.
- "the render lays the steps out at the length the customer was shown": `serviceAStepsTimeline`
  frames equal `totalRuntimeMs`, the number the wizard and the confirm screen show, and no step is
  clamped.
- "band coherence — every legal step count fits the shipped band", plus the G1 tests.

**`packages/core/test/plan-access-step.test.ts`** pins the new pins: tavnit 1, six-word 3, study-app

1. It also holds G2, in "no pin when the address bar leaves before its caption can be read".

**`packages/core/test/plan-prompt.test.ts`** has "plan_demo_steps prompt v15".
