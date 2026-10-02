---
type: fact
status: verified
verified: 2026-10-02
method: "PAID, founder OK 2026-10-02, cap ₪30. Scratch under packages/core/.work/screens/ (gitignored), run from the repo root with apps/cli/node_modules/.bin/tsx. label-eval.ts <layout> <width> <run> <files> [chunk] [side] [mode]: frames by the shipped extractFramesAt from the local normalized files, one call per chunk through generateRawWithImages (claude-sonnet-4-6, thinking off) or, for the s46-*/s55-* modes, the SDK directly with adaptive thinking; strict structured output; no retries; every call's worst case reserved in data/spend.json before it is sent. sheet-eval.ts <mode> <run> <files>: yesterday's 5 fps sheets plus the instant list, one call per file. score.ts <tag>: one-to-one against the 2026-10-01 key, tolerance 400 ms, through the shipped screenChanges. union.ts <tag>: the same run with the stored analyses' isNewScreen boundaries added (free, from packages/core/.work/screen-span/data/base.json). The prompt drafts are label_screen_events.v1-draft.md in the same scratch; nothing was committed under prompts/. No DB write; usage_events untouched. AFTER THE TEST (decision 0083): extractFramesAt, the label schema and screenChanges were removed from src; they are in commit 5b49335, which label-eval.ts and sheet-eval.ts need to run. score.ts and union.ts still run, through a scratch copy of screenChanges (label-as-tested.ts)."
source: code + inference
---

# The label call, tested with API models: no variant passed

Measured 2026-10-02 for [[0082-the-label-call-is-a-paid-call-tested-first]]. Tags: **MEASURED**
(the calls and their usage), **REASONED** (the answer key is Claude vision, and so is the
reading of why a call went wrong).

The call was to name each footage instant ([[footage-screen-changes-2026-10-02]]): a new screen,
the same screen with its content replaced (swap), or the same screen.

## The bar, fixed before the test

No real change missed; at most 3 false changes per file; every real change a change in all
repeat runs; at least 95 % of labels equal between runs; at most 10 % unsure. **No variant met the
first two, so the repeat runs were not bought.**

## Spend — MEASURED

**1 420 agorot (₪14.20) of the ₪30 cap, in 81 calls, all settled.** By the code's own estimate
(`llmCostAgorot`: $3 / $15 per million tokens at 3.70; $2 / $10 for `claude-sonnet-5-5`).

## Every variant — MEASURED against REASONED

"Missed" is real changes whose own instant was not stored as a change; the T3a blank page that
shares an instant is not counted. "False" is stored changes, swaps included, that match no real
change and no keyed swap. `claude-sonnet-4-6` with thinking off unless the row says otherwise.

| run                    | what was sent per instant                                           | takes        | real | missed | false | cost (agorot) |
| ---------------------- | ------------------------------------------------------------------- | ------------ | ---: | -----: | ----: | ------------: |
| `stretch-256-r1`       | one frame per stable stretch, 256 px; first wording                 | T1           |    3 |      0 |     7 |            17 |
| `stretch-384-r1`       | the same at 384 px                                                  | T1, T2, T3a  |   23 |      1 |    12 |            98 |
| `pairs-384-r1`         | a frame 0.27 s before and after, 384 px; first wording              | T1, T2, T3a  |   23 |      0 |    12 |           166 |
| `pairs-384-b1`         | the same; "find the screen's anchors" wording, a `what` field first | T1, T2, T3a  |   23 |      1 |     6 |           176 |
| `pairs-384-c1`         | the same; "the heading is the strongest anchor" added               | all seven    |   57 |      6 |    16 |           388 |
| `pairs-384-c15`        | the same, 15 instants per call instead of 45                        | T5           |    8 |      1 |     3 |            67 |
| `pairs-384-w18`        | the same, frames up to 0.6 s away                                   | T5           |    8 |      2 |     5 |            67 |
| `pairs-384-d1`         | the same, each instant marked `cut` or `gradual` from the footage   | T5           |    8 |      1 |     5 |            67 |
| `pairs-384-t46low`     | the same, adaptive thinking at low effort                           | T5           |    8 |      1 |     5 |            67 |
| `pairs-384-t55low`     | the same on `claude-sonnet-5-5`, low effort                         | T5           |    8 |      1 |     2 |            51 |
| `strip-192-s1`         | one strip of four frames (−0.4, −0.1, +0.1, +0.4 s), 192 px each    | T5           |    8 |      1 |     4 |            44 |
| `strip-192-f1`         | the same; five labels, and a cut called `moved` counts as a change  | T3a, T3b, T5 |   24 |      3 |    13 |           102 |
| `sheets-s55-medium-r1` | the whole recording as 5 fps sheets, `claude-sonnet-5-5` medium     | T5           |    8 |      1 |    10 |            43 |

**The one run on all seven files, `pairs-384-c1`, per take:**

| take |   real |  found | missed               |  false | swaps marked | cost (agorot) |
| ---- | -----: | -----: | -------------------- | -----: | -----------: | ------------: |
| T1   |      3 |      3 | — (29.8 s as a swap) |      2 |        0 / 0 |            51 |
| T2   |     11 |     11 | —                    |      2 |        3 / 3 |            74 |
| T3a  |      9 |      7 | 28.9 s (+ the blank) |      1 |        2 / 3 |            51 |
| T3b  |      7 |      5 | 28.9 s, 48.8 s       |      1 |        0 / 1 |            34 |
| T3c  |      8 |      7 | 28.9 s               |      1 |        1 / 2 |            49 |
| T4   |     11 |     11 | —                    |      5 |        0 / 2 |            68 |
| T5   |      8 |      6 | 9.8 s, 17.4 s        |      4 |        0 / 3 |            61 |
|      | **57** | **50** | **6**                | **16** |   **6 / 14** |       **388** |

## What goes wrong — MEASURED on the model's own words, REASONED as to why

Each entry carried a `what`: eight plain words written before the label.

- **A page change read as a scroll.** On T5 the home → character-grid change at 9.8 s, the
  strongest real change in the footage, came back as "page scrolled to avatar selection section"
  in every two-frame and strip variant, on both models, and still did when its label said `cut`.
  The landing → home change at 6.8 s came back as "page scrolled to different section". From
  stills, two pages of one product look like two parts of one page.
- **A subtle step change read as the camera.** T3's 28.9 s (one wizard step to the next, through a
  washed-out frame, heading partly cut off) came back as the same screen.
- **False changes are camera zooms and scrolls called new**, and popups, dropdowns and progress
  bars called swaps under the first wording.
- **The models almost never said "unsure":** 0–6 of 34–75 instants per file. So "unsure is a
  change" rescued few misses.
- **Wording moves the errors rather than removing them.** The first wording missed nothing on three
  takes with 12 false; the next halved the false and missed one; the next fixed that one and missed
  another.

## With the stored fields added — MEASURED, free

`pairs-384-c1` with each stored analysis's own `isNewScreen` boundaries added, each pinned to the
strongest instant between its two moments, over the 15 ready analyses (112 change-instances):

|                         | missed | false | false per analysis |
| ----------------------- | -----: | ----: | -----------------: |
| the label call alone    |     12 |    41 |                2.7 |
| the stored fields alone |     19 |    44 |                2.9 |
| both, either says so    |      1 |    65 |                4.3 |

The one miss is T3a's 28.9 s on `08b93a8a`. On the newest take the union has 7–8 false per
analysis. The two witnesses fail in different places: the label call misses changes a reader of
headings catches, and the stored fields miss changes the picture shows.

## Cost per analysis — MEASURED

| layout                             | measured on             | per analysis |
| ---------------------------------- | ----------------------- | ------------ |
| two frames per instant, 384 px     | 34–75 instants, 7 files | ₪0.34–0.74   |
| one four-frame strip, 192 px       | 34–61 instants, 3 files | ₪0.24–0.44   |
| whole-recording sheets, 5.5 medium | 61 instants, 1 file     | ₪0.43        |

- A call of 45 instants takes 9–21 s; a call of 15 takes 7–9 s. Frame extraction takes 11–29 s
  per file on this machine.
- An analysis earns 20 credits = ₪3.00 and costs ₪1.13–2.72 today, mean ₪1.82
  ([[analyze-demo-cost]]). With the strip layout the mean lands near ₪2.2 and the costliest
  measured analysis at ₪3.16; with two frames per instant, near ₪2.4 and ₪3.39.

## Against the plan-mode proxy

The proxy that looked like a pass used session judges with reasoning, on the whole recording at
5 fps ([[footage-screen-changes-2026-10-02]] is the footage half). **MEASURED:** the same input
given to `claude-sonnet-5-5` at medium effort missed one of T5's 8 changes and stored 10 false. So
the gap is the model, not only the two-frame input.

## What this cannot say

- **Stronger models were not tried** (`claude-opus-5-5`, or high effort). They cost more per token.
- **One run each.** Label agreement between runs was never measured, because no variant was worth
  repeating.
- **The key is model vision.** T1's 29.8 s was called a swap by every variant; yesterday's judges
  called it a navigation and noted it "could instead be an in-place swap".
