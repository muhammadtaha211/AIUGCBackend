---
type: fact
status: verified
verified: 2026-10-01
method: "Read-only export (packages/core/.work/steps-screen/export.ts, one `set transaction read only` transaction) of demo_step_plans, demo_analyses, demos and video_renders (service 'a', params ? 'stepPlanId'); lengths recomputed offline with the screen rule (measure.ts `MAJ E3`, cap 4000), and independently re-implemented from a prose spec with identical output; 'run past a change' scored against the vision-judged strips of facts/screen-change-signal-2026-10-01.md. Released-render counts from the same export. Local renders: packages/core/.work/steps-screen/rerender.ts (scratch rule, --old for today) and rerender-real.ts (the branch code), frame counts by `ffprobe -count_frames`."
source: db + inference
---

# The 17 stored plans under the screen rule

Measured 2026-10-01, before any stored plan was touched (none was). **MEASURED** except the "run past
a change" column, which is scored against vision-judged frames (**REASONED**,
[[screen-change-signal-2026-10-01]]). `*` marks a step shorter than its caption's read time.

| plan                         | today (s)      | today: steps run past a screen change | under the rule (s)             | total |
| ---------------------------- | -------------- | ------------------------------------- | ------------------------------ | ----: |
| 9010eb99, 0bfcfbfd           | 3.0 × 5 = 15.0 | 0                                     | 4.0 4.0 4.0 4.0 4.0            |  20.0 |
| a2c0c328                     | 3.0 × 6 = 18.0 | 0                                     | 4.0 × 6                        |  24.0 |
| f26f1fd1, e47f3ffb, 6d64d3ce | 18.0           | 2 (1.8, 2.0 s)                        | 4.0 1.2* 0.8* 4.0 4.0 4.0      |  18.0 |
| ca8d5b72                     | 21.0           | 4 (1.8, 2.0, 0.4, 0.4 s)              | 4.0 1.2* 0.8* 2.4 4.0 0.2* 4.0 |  16.6 |
| ba4c201b                     | 18.0           | 3                                     | 2.6 1.2* 4.0 2.4 0.2* 4.0      |  14.4 |
| 7a6d7208                     | 15.0           | 0                                     | 3.4 2.0 4.0 4.0 3.2            |  16.6 |
| 4af7365e                     | 18.0           | 0                                     | 3.4 2.0 4.0 4.0 4.0 4.0        |  21.4 |
| 02422b91, ea17b3d2, 20b7436f | 15.0           | 0                                     | 3.4 4.0 4.0 3.0 4.0            |  18.4 |
| 4307d1b5                     | 15.0           | 3                                     | 2.0 1.0* 0.2* 1.6* 4.0         |   8.8 |
| 3799ef3b, bc429f16           | 15.6           | 3 (2.6, 0.6, 2.0 s)                   | 2.0 0.2* 1.6* 0.2* 4.0         |   8.0 |
| ba616a37                     | 21.8           | 2                                     | 3.6 1.2* 0.2* 4.0 4.0 4.0 4.0  |  21.0 |

**Totals:**

- 95 steps; 24 of them run past a real screen change today.
- Under the rule, 30 steps get shorter, and 22 fall under their caption's read time (0 today).
- Under the rule, plans land 11 in the band, 4 under 15 s and 2 over 21 s.
- **12 released renders**, across 6 plans, carry a jump today: f26f1fd1 1, e47f3ffb 1, ca8d5b72 1,
  3799ef3b 1, bc429f16 5 and ba616a37 3.

## The local A/B, plan ca8d5b72 (tavnit), released render 05d31794's hook

All three renders are free and local, with no rows written: the same footage, the same hook clip and
the same hook line. **MEASURED** frame counts:

| render                   | frames                         |
| ------------------------ | ------------------------------ |
| today's stored durations | 724 = 94 (hook) + 630 (21.0 s) |
| the rule (scratch model) | 592 = 94 + 498 (16.6 s)        |
| the branch's own code    | 592 = 94 + 498 (16.6 s)        |

The third row uses the branch's `assembleSteps` and `clipBounds`, with `stepDurations` reading the
production config read-only: cap 4000, sample 200, recording end 89400. Its steps match the scratch
rule's exactly: 4.0 1.2 0.8 2.4 4.0 0.2 4.0. Every rendered frame is accounted for by the plan total.
The files are under `packages/core/.work/steps-screen/renders/` (gitignored), the third as
`ca8d5b72-real-code.mp4`.

## Not done

No plan was rewritten or backfilled. A stored plan takes the rule's lengths only when someone saves
an edit to it (`updatePlanSteps` re-assembles every step).
