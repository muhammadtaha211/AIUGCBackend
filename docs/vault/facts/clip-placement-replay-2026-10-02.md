---
type: fact
status: verified
verified: 2026-10-02
method: "Offline on the founder's Windows machine, free: no model call, no DB access. apps/cli/node_modules/.bin/tsx packages/core/.work/screens/clips-replay.ts (gitignored scratch) runs the SHIPPED placeClips (packages/core/src/pipelines/demo-step-plans.ts) over the 15 ready analyses in the 2026-10-01 read-only export (packages/core/.work/screen-span/data/export.json), each with this machine's instants for its file (packages/core/.work/screens/data/events-<file>.json), against the 2026-10-01 answer key (screen-span/data/units.json 'vision' and 'founder') and the measured flip frames (screens/data/instant-offsets.json). The alternative orders and signals were run from inline node scripts over the same files during the planning session, in frames, before the function was written; the shipped function reproduces their totals. The frame-rounding count is a loop over every integer start from 0 to 90,000 ms through round((ms/1000)*30)."
source: code + inference
---

# The 2 s clip rule replayed on the five takes

Measured 2026-10-02 for [[0084-clips-are-placed-from-the-footage-instants]] and
[[0085-a-draft-may-show-two-pages-and-says-so]]. Tags: **MEASURED** (deterministic, on the footage
and the export), **REASONED** (the answer key is Claude vision on frames, except the founder's own
segments of T5).

"Pickable" is what a generated plan may pick: not unreadable, not "same as the previous state",
not a login, loading, onboarding, error, tour or system screen. 536 of the 790 moments.

## Per analysis — MEASURED

| take | analysis   | moments | pickable | calm | marked two-pages | non-calm holding a keyed change | by frames, a real flip inside (non-calm / calm) | clips usable together |
| ---- | ---------- | ------: | -------: | ---: | ---------------: | ------------------------------: | ----------------------------------------------: | --------------------: |
| T1   | `2c74fe2a` |      60 |       39 |    6 |                0 |                               0 |                                           0 / 0 |                    17 |
| T1   | `1e66c926` |      51 |       33 |    4 |                1 |                               0 |                                           0 / 0 |                    15 |
| T1   | `0bb10493` |      60 |       40 |    6 |                0 |                               0 |                                           0 / 0 |                    17 |
| T1   | `2c8acb7a` |      60 |       41 |    6 |                0 |                               0 |                                           0 / 0 |                    17 |
| T2   | `6efb1f49` |      53 |       33 |    6 |                7 |                               4 |                                           5 / 0 |                    23 |
| T2   | `c5cb4d90` |      53 |       33 |    6 |                7 |                               4 |                                           5 / 0 |                    23 |
| T3a  | `08b93a8a` |      46 |       24 |    8 |                1 |                               0 |                                           0 / 0 |                    16 |
| T3b  | `bd0005b0` |      38 |       25 |    4 |                3 |                               2 |                                           2 / 0 |                    14 |
| T3c  | `91c89b65` |      46 |       30 |    6 |                2 |                               2 |                                           2 / 0 |                    18 |
| T4   | `f6e343d1` |      27 |       17 |    0 |                7 |                               3 |                                           3 / 0 |                     9 |
| T4   | `6dac02c8` |      36 |       24 |    2 |               10 |                               5 |                                           5 / 0 |                    15 |
| T5   | `4113d37d` |      65 |       50 |   12 |                7 |                               3 |                                           3 / 0 |                    26 |
| T5   | `4219e82e` |      65 |       49 |   12 |                7 |                               5 |                                           5 / 0 |                    26 |
| T5   | `6658999c` |      65 |       50 |   12 |                8 |                               3 |                                           3 / 0 |                    27 |
| T5   | `fc30dc8e` |      65 |       48 |   12 |               10 |                               4 |                                           4 / 0 |                    25 |

Over the 15 analyses:

- **Every one of the 790 moments has a 2 s clip that holds it**, inside the recording, of exactly
  60 frames, and none runs past the decoded file.
- **102 of the 536 pickable moments are calm** (142 of the 783 readable ones the inventory shows).
- **No calm clip holds a keyed change, and none holds a real flip by frames.**
- **35 of the 434 non-calm pickable clips hold a keyed real change; by frames, 37 hold a real
  flip.**
- **The two-pages mark** is on 70 pickable clips. It is on 31 of the 35 that hold a keyed change
  and on 33 of the 37 that hold a flip by frames.
- **Every analysis offers at least 9 pickable clips that share no footage** (T4 `f6e343d1`: 9;
  the most is 27).

## The newest take (T5) per founder segment — MEASURED against his own timeline

Pickable moments in the segment: calm / not calm and unmarked / marked two-pages. The four
analyses of T5 differ by one or two with how each labelled its states; this is `4219e82e`.

| segment | time (s)  | pickable | calm | plain | marked |
| ------- | --------- | -------: | ---: | ----: | -----: |
| 1       | 0–6.8     |        9 |    0 |     8 |      1 |
| 2       | 6.8–9.8   |        1 |    0 |     1 |      0 |
| 3       | 9.8–14.0  |        2 |    1 |     0 |      1 |
| 4       | 14.0–17.4 |        2 |    0 |     1 |      1 |
| 5       | 17.4–31.6 |        9 |    0 |     7 |      2 |
| 6       | 31.6–45.2 |       12 |    4 |     7 |      1 |
| 7       | 45.2–53.6 |        4 |    1 |     3 |      0 |
| 8       | 53.6–62.2 |        4 |    2 |     1 |      1 |
| 9       | 62.2–84.2 |        6 |    4 |     2 |      0 |

Every segment has something a generated plan can pick. Segments 1, 2, 4 and 5 have no calm clip.

## The orders tried for a clip that cannot be calm — MEASURED

Same data, non-calm pickable clips holding a keyed change, of 434:

| order of preference                                                                 | holding a keyed change | the moment's own picture on screen, mean |
| ----------------------------------------------------------------------------------- | ---------------------: | ---------------------------------------: |
| fewest instants, then the analysis's page changes, then least slide                 |                     51 |                                   0.84 s |
| own picture longest, then the analysis's page changes                               |                     74 |                                   1.13 s |
| the analysis's page changes, then fewest instants, then least slide                 |                     37 |                                   0.83 s |
| **the analysis's page changes, then own picture longest, then least slide (built)** |                 **35** |                               **1.08 s** |
| never start before the last instant ahead of the moment, then as built              |                     73 |                                   0.78 s |

With the slide limited to 1.0 s instead of 1.8 s, the first-tried order gave 59 against 39 (run in
milliseconds, before the frame grid). With no slide at all, 40 pickable clips are calm, not 102.

## The signals tried for the two-pages mark — MEASURED

Of 536 pickable clips, 35 hold a keyed change.

| signal                                                                                     | marked | of the 35 caught | marked without one |
| ------------------------------------------------------------------------------------------ | -----: | ---------------: | -----------------: |
| **an instant the analysis also saw as a page change, in the clip or within 0.2 s (built)** |     70 |               31 |                 39 |
| the same, strictly inside the clip                                                         |     55 |               27 |                 28 |
| any instant inside the clip                                                                |    373 |               34 |                339 |
| a page change by the analysis alone, anywhere the clip reaches                             |    209 |               35 |                174 |

## Frames — MEASURED

- A step renders `round(end·30) − round(start·30)` frames. Of the 90,001 integer-millisecond
  starts from 0 to 90 s, 24 give 59 or 61 frames for a 2000 ms step (50 ms → 59, 2050 ms → 61).
  None of the 2,701 starts on the 30 fps frame grid does. So clips are placed in frames.
- The recording end the plan code uses (the raw upload's length, floored to 0.2 s) falls 0 to 5
  frames before the end of the decoded normalized file on all 7 files, and exactly on it for T4.
  See [[the-recording-end-is-the-raw-uploads-length]].

## What this cannot say

- **Nothing about other footage.** Five phone-filmed takes of two desktop web apps.
- **The instants here are this machine's.** On the one file the box has analysed since, the box's
  instants match this machine's within one frame ([[box-and-local-instants-agree-2026-10-02]]).
  The committed test data for T5 uses the box's.
- **What the model does with `calm` and `twoPages` is unmeasured** until the paid check of
  `plan_demo_steps@v16`.
- **The key is model vision**, on a 0.2 s grid, except the founder's segments of T5.

## Related

- [[instant-free-windows-2026-10-02]] — the measurement taken before the rule, for the stricter
  "calm only" proposal.
- [[footage-screen-changes-2026-10-02]]
