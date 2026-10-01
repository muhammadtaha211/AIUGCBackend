---
type: defect
status: verified
verified: 2026-10-01
method: "Read stepDurations and screenEnds in packages/core/src/pipelines/demo-step-plans.ts and analysisFps in demo-analysis.ts on feat/steps-end-on-screen-change; reproduced by the 2026-10-01 diff review with a throwaway script on a synthetic timeline (5 fps grid, sample 500); app_config read-only the same day: no a_analysis_fps row."
source: code
---

# The screen cut assumes the analysis ran at today's `a_analysis_fps`

**MEASURED in the code.** [[0072-step-cap-no-padding-cut-early]] ends a screen one analysis sample
after its last state. `stepDurations` takes that sample from the `a_analysis_fps` in force **now**.
`demo_analyses` stores no fps, so the rate an old timeline was sampled at is unknown when it is
re-planned, edited or previewed.

- **Raising the knob is safe.** The sample shrinks and the cut only moves earlier.
- **Lowering the knob is the risk.** The sample grows past the old grid. For example, 5 fps → 2 fps
  turns 200 ms into 500 ms, so a stored screen's cut lands after that timeline's own next sample, and
  the "never shows a frame of what follows" guarantee no longer holds for analyses made at the
  higher rate.

**Partly guarded.** The cut never passes the next screen's first state (`screenEnds` takes the
minimum with it), so the overshoot is bounded and cannot reach the next screen's representative
frame. It can still show transition frames of up to one old sample. A sample of 0 (an fps over 1000)
is clamped to 1 ms.

**Not fixed, deliberately.** No row exists today (**MEASURED** 2026-10-01), so production runs 5 fps
end to end. The full fix is to store the analysis fps on each analysis row, which needs a schema
change, and to fall back to 5 for older rows. It is worth doing before anyone tunes
`a_analysis_fps` down.
