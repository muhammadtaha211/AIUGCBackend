---
type: defect
status: verified
verified: 2026-10-01
method: "Read subsampleClusters and assembleTimeline in packages/core/src/pipelines/demo-analysis.ts and screenEnds/isNewScreen in demo-step-plans.ts on feat/steps-end-on-screen-change; reproduced by the 2026-10-01 diff review with a throwaway script (160 clusters thinned to 80, c11 dropped between c10 and c12)."
source: code
---

# A screen missing from the timeline is invisible to the screen cut

**MEASURED in the code.** The screen cut ([[0072-step-cap-no-padding-cut-early]]) compares
consecutive **timeline** states, but the timeline can skip clusters:

- `subsampleClusters` thins a busy recording to `a_analysis_max_states` (default 80), index-even.
- `assembleTimeline` drops a cluster whose vision frame came back empty.

So consider a list → detail → back-to-list sequence where the detail cluster was thinned out. The
two list states sit side by side, and `isNewScreen` sees one screen. A step picked on the first list
state then runs through the hidden detail screen, up to the cap.

**How often — REASONED, not measured.** It takes a thinned or dropped cluster that is itself a
different screen, flanked by two states of the same screen. Of the 12 production analyses read on
2026-10-01, all had at most 65 states, under the 80 cap. **Measured** off the box
([[analysis-clustering-does-not-reproduce-across-machines]]), the 84 s recording has 146 runs before
the noise filter. Whether any production analysis was thinned was not measured.

**Not fixed.** The analysis keeps no record of what it thinned. Fixing it means persisting cluster
spans or the dropped ranges, which is an analysis-side change outside 0072.
