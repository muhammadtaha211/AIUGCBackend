---
type: fact
status: verified
verified: 2026-10-01
method: "Read-only export of every demo_step_plans row, every ready demo_analyses timeline and the demos rows, inside one `set transaction read only` transaction (packages/core/.work/steps-screen/export.ts), plus the plan demos' normalized.mp4 via storage download (download-demos.ts). Candidate rules: rules.ts + disagree.ts. Visual truth: ffmpeg `-ss <start> -t 4.8 -vf fps=5,scale=180:320,tile=8x3` strips per plan-step start (strips.ts) and 20 overlapping 4.8 s sheets of demo 29c5ed05, judged by two independent Claude vision passes, the one disagreement by a third (workflow wf_5ab5b0b0-470), scored by compare.ts and tavnit-truth.ts. Cluster spans: `pnpm --filter @aiugc/cli dev demo audit --all --json` (read-only, off-box recompute). All scratch is gitignored, 2026-10-01, at origin/main 67448de plus the working tree of feat/steps-end-on-screen-change."
source: db + code + inference
---

# Which analysis fields mark a screen change, measured against the footage

Measured 2026-10-01 for [[0070-a-step-ends-on-a-real-screen-change]] and
[[0072-step-cap-no-padding-cut-early]]. Tags: **MEASURED** (production read-only, or the tree),
**REASONED** (the "truth" below is Claude vision on extracted frames, not the founder's eye).

## The data — MEASURED

- 12 ready analyses, all `analyze_demo@v3`, spanning 7 distinct recordings: four demos share one
  57.5 s file, two share an 89.6 s file and two a 72.6 s file. That is 583 consecutive-state
  transitions.
- 18 plan rows; 17 carry steps, 95 steps in all, and 64 distinct (analysis, state) picks.
- `app_config` holds 13 rows, none of them `a_step%`, `a_steps%`, `a_analysis%` or `%step%`.
- A stored `timestampMs` is the LOWER median of its cluster (`ffmpeg.ts` `clusterStates`).
  Clusters' start and end are stored nowhere, neither in the timeline nor in the job checkpoint,
  whose `resumeKey` lists representatives only.

## Candidate rules from existing fields — MEASURED

Each rule decides, for consecutive states, whether the later one starts a new screen.
`sameStateAsPrevious = true` is never a new screen under any of them.

| rule                                                                                              | new screens in 583 transitions | disagrees with MAJ |
| ------------------------------------------------------------------------------------------------- | -----------------------------: | -----------------: |
| NAV: `actionType` is `navigate`                                                                   |                             86 |         37 (6.3 %) |
| NAME: `screenName` differs at all                                                                 |                            202 |        95 (16.3 %) |
| FUZZY: names not similar (same text before " - ", word subset, or Jaccard ≥ 0.5 count as similar) |                            127 |         32 (5.5 %) |
| NAV or FUZZY                                                                                      |                            141 |         32 (5.5 %) |
| NAV and FUZZY                                                                                     |                             72 |         37 (6.3 %) |
| TEXT: `visibleText` token Jaccard < 0.25                                                          |                            127 |         44 (7.5 %) |
| TEXTV14: plan prompt v14's one-beat test (shared entries / longer list < 1/3)                     |                            199 |       106 (18.2 %) |
| **MAJ: at least 2 of NAV, FUZZY, TEXT**                                                           |                        **109** |                  — |

Exact `screenName` equality is unusable on its own. The vision pass names every frame afresh and
drifts at batch seams; on the 84 s recording, OCR fragments such as "והמיקום שלו" and "זה והמיקום שלו"
name one page.

## Against the footage — REASONED (vision-judged)

**How the truth was judged:**

- **The step strips.** Every plan step's start was cut into a 5 fps strip of 4.8 s, 51 distinct
  strips after deduplicating identical files.
- **The tavnit sheets.** The whole tavnit recording (demo 29c5ed05) was cut into 20 overlapping
  sheets.
- **The judges.** Two independent passes marked the first frame showing a different screen, under
  the founder's definitions: popup, typing and scroll stay inside a step; navigation ends it.
- **Agreement.** The passes agreed on 50 of 51 strips (a third look settled the 51st) and on every
  tavnit change.
- **What tavnit holds.** 11 new-screen moments (0:05.6, 0:06.8, 0:09.8, a blank 0:11.4–0:13.2, 0:13.2,
  0:17.8, 0:31.8, 0:49.4, 1:01.4, 1:08.6, 1:15.0), a player popup at 1:18.0, and in-place swaps
  (loading → loaded) at 0:18.2, 0:24.4, 0:34.8, 0:47.0 and 1:03.2.

**Scored with each rule's cut one sample after the last state on the screen:**

| rule          | tavnit caught / missed / cut early | 64 picks: run > 200 ms past the change | cut ≥ 1 s early |
| ------------- | ---------------------------------- | -------------------------------------: | --------------: |
| NAV           | 8 / 3 / 3                          |                                      3 |               6 |
| NAME          | 11 / 0 / 10                        |                                      0 |              25 |
| FUZZY         | 9 / 2 / 5                          |                                      4 |              14 |
| NAV or FUZZY  | 11 / 0 / 5                         |                                      0 |              16 |
| NAV and FUZZY | 6 / 5 / 3                          |                                      8 |               4 |
| TEXT          | 11 / 0 / 7                         |                                      0 |              17 |
| TEXTV14       | 11 / 0 / 14                        |                                      0 |              29 |
| **MAJ**       | **11 / 0 / 3**                     |                                  **0** |           **9** |

**MAJ's three early cuts on tavnit:**

- a `loading` state read while the New Tab was still on screen;
- the script page's generating → generated swap;
- one mislabelled `navigate` at 0:47.6.

If in-place swaps count as screen changes, MAJ runs past 4 of the 64 picks.

**Where to cut, with MAJ deciding the change** (64 picks; tavnit's 11 changes):

| cut point                                                        | 64 picks: late > 200 ms | cut ≥ 1 s early | tavnit late           |
| ---------------------------------------------------------------- | ----------------------: | --------------: | --------------------- |
| the next state's own timestamp                                   |                      11 |               2 | 10 of 11, up to 1.4 s |
| the midpoint between the two states                              |                       6 |               6 | 3, 0.4 s each         |
| the next state − 1.4 s                                           |                       2 |               6 | 0                     |
| `max(t+1, min(next, 2·next − after-next + 1))` (a cluster bound) |                       2 |               7 | 2, 0.4 s              |
| **last state on the screen + one sample**                        |                   **0** |           **9** | **0**                 |

The cluster bound never reaches the next _cluster_. It does reach the unclustered transition frames,
and on the tavnit "מה מפרסמים?" step those already show the next question.

**Checked independently:**

- A re-implementation written from a prose spec reproduced every number in the stored-plan table
  ([[stored-plans-under-the-screen-rule-2026-10-01]]).
- A skeptic re-checked, frame by frame, the 15 strips where the cut sits closest to a real change and
  found no bleed. A 16th strip was named under the wrong file and could not be opened, so it was not
  checked.

## What the measurement cannot say

- **The truth is model vision, not the founder.**
- **The off-box audit's cluster spans are approximate.** They do not reproduce the box's clustering
  ([[analysis-clustering-does-not-reproduce-across-machines]]). They were used only for secondary
  estimates, never for the chosen cut, whose guarantee rests on how the box clusters.
- **The selections tested were made under the old rule.** What a model picks when it can see each
  state's `clipMs` is untested until a paid regress.
