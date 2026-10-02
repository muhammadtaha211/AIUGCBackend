---
type: fact
status: verified
verified: 2026-10-02
method: "Offline on the founder's Windows machine (ffmpeg 8.1.2-full_build-www.gyan.dev), local footage only, all scratch gitignored under packages/core/.work/screens/, run from the repo root with apps/cli/node_modules/.bin/tsx. events.ts: the SHIPPED frameSignatures -> footageEvents (packages/core/src/media/ffmpeg.ts, packages/core/src/pipelines/analysis-screens.ts, commit 5b49335) on the 7 distinct normalized files in packages/core/.work/steps-screen/media, written to data/events-<file>.json and compared with plan-mode-events.json. score.ts: one-to-one matching against the 2026-10-01 answer key (packages/core/.work/screen-span/data/units.json 'vision', vision-compare.json swaps), tolerance 400 ms. The hash figures and the clusters-across-changes count were recomputed from packages/core/.work/screen-span/data/signals-*.json (30 fps shipped hashes, localClusters) by an independent reviewer with read-only node one-liners. The 16 jobs' kept lists come from packages/core/.work/screen-span/data/export.json (read-only export of 2026-10-01). No model call, no DB access."
source: code + db + inference
---

# Where the screen changes, found from the footage alone

Measured 2026-10-02 for [[0078-screen-changes-come-from-the-footage-first]]. Tags:

- **MEASURED** — a deterministic computation on the footage, the code, or yesterday's export.
- **REASONED** — the answer key is Claude vision on frames, not the founder's eye, except his own
  timeline of T5 ([[screen-spans-from-the-footage-2026-10-01]]).

The files and takes are those of [[demo-recordings-by-file-and-take-2026-10-01]]: T1 `8b0dc639`,
T2 `133a6304`, T3 `c36f775d` / `28ddab62` / `2e303069`, T4 `b25923dd`, T5 `752bf15a`.

## The shipped hash cannot see screen changes — MEASURED

The 143-bit hash the clustering uses, on every 30 fps frame, across frame pairs 0.2–1 s apart:

| spacing | real changes move it | largest in-screen move |
| ------- | -------------------- | ---------------------- |
| ±0.2 s  | 3–71 bits            | 54–74 bits             |
| ±0.4 s  | 4–78 bits            | 55–81 bits             |
| ±1 s    | 8–67 bits            | 60–88 bits             |

- No threshold separates them: two wizard steps can sit 3 bits apart, a scroll 80.
- **12 of the 57 real changes move it 14 bits or fewer**, the clustering's own same-state threshold
  (`MAX_HAMMING`). This machine's clusters contain a real change 12 times, for example T2
  64.0–74.8 s across the 68.6 s change. So a cluster span can run across a real change. The box's
  own clusters are not readable from here.

## The detector — MEASURED

`frameSignatures` reduces every native frame (30 fps, scaled to 144×256 gray by ffmpeg, `area`) to
two signatures: where the edge detail sits, as shares of the frame; and a 36×64 brightness
thumbnail. `footageEvents` scores each frame "stable – change – stable": the difference across a
gap of ±5 frames, minus the larger difference across the 6 frames beyond on either side. A steady
scroll or pan scores nothing. An instant is a local peak at or over the threshold in either band.

- **Parameters were set once and frozen** (commit `c406d66`): gap 5 frames, hold 6, peak radius 9,
  thresholds 0.12 (edges) and 0.08 (brightness). REASONED, not measurable: they were not tuned
  against the key. What is measured is that the shipped code reproduces the 304 instants the
  plan-mode prototype printed on five files, exactly, and still did after two later changes:
  - `abrupt` was added: the share of the change that happened between two adjacent frames;
  - a tie-break was added: on a perfectly still picture a cut produced ten tied instants, found by
    a unit test on synthetic frames. Real footage has no ties, so no instant moved.
- **Instants per file:** 50, 75, 50, 34, 48, 68, 61 (T1, T2, T3a, T3b, T3c, T4, T5). 386 in all.
- **Time:** one decode takes 9–23 s per file here; scoring takes about 0.1 s.

## Against the answer key — MEASURED against REASONED

One-to-one: each real change takes the nearest unused instant within 0.4 s.

| take | file       | instants | real changes | with its own instant | keyed swaps with an instant |
| ---- | ---------- | -------: | -----------: | -------------------: | --------------------------: |
| T1   | `8b0dc639` |       50 |            3 |                    3 |                       0 / 0 |
| T2   | `133a6304` |       75 |           11 |                   11 |                       3 / 3 |
| T3a  | `c36f775d` |       50 |            9 |                    8 |                       3 / 3 |
| T3b  | `28ddab62` |       34 |            7 |                    7 |                       1 / 1 |
| T3c  | `2e303069` |       48 |            8 |                    8 |                       2 / 2 |
| T4   | `b25923dd` |       68 |           11 |                   11 |                       2 / 2 |
| T5   | `752bf15a` |       61 |            8 |                    8 |                       3 / 3 |
|      | **total**  |  **386** |       **57** |               **56** |                 **14 / 14** |

- **The one without its own instant** is T3a's 22.4 s: a 0.2 s blank page between two wizard
  steps, whose two edges (22.2 and 22.4 s) share the instant at 22.233 s. The key has that blank
  page in one of the three T3 exports only.
- **Timing against the key's 0.2 s grid:** 51 of the 56 within 0.2 s, 55 within 0.3 s, worst
  +0.4 s (T2 9.8 s, a motion-blurred transition). The detector tends to sit a few frames after the
  cut: T5's 9.8 s change is placed at 9.9 s while its frames show the cut near 9.6–9.7 s.
- **A random time has an instant within 0.4 s 36–53 % of the time**, so distance alone proves
  little. A match is only proven by its frames.
- **The three T3 exports agree:** every real change they share is placed within 0.1 s across them
  (7.167 / 7.2 / 7.2, 11.2 / 11.233 / 11.233, 11.967 / 12.033 / 12.033, 22.233 ×3, 28.767 ×3,
  47.3 ×3, 75.633 / 75.667, 82.133 / 82.033).
- **Close to the threshold in places.** In multiples of the threshold: T3 28.9 s is 1.3–1.4 on all
  three exports; T3 47.2 s is 1.9–2.1; T4 41.2 s and 55.0 s are 2.2. Of the 304 instants on five
  files, 119 are under 2. A different encode or ffmpeg build could drop a weak one.

## What kind of change it is, the footage cannot tell — MEASURED

- **By strength.** The cut that keeps every real change of a take also keeps in-screen instants:

  | take | weakest real change | instants kept at that cut | of them in-screen |
  | ---- | ------------------: | ------------------------: | ----------------: |
  | T1   |                 4.4 |                         7 |                 4 |
  | T2   |                 2.9 |                        38 |                25 |
  | T3a  |                 1.3 |                        40 |                29 |
  | T4   |                 2.2 |                        43 |                30 |
  | T5   |                 3.3 |                        17 |                 8 |

  The strongest instant in all the footage, 13.4, is a file-picker dialog on T1.

- **By changed area.** A popup repaints as much of the frame as a navigation: the file picker and
  the application-form modal on T1 both change every block.
- **By abruptness.** 48 of the 56 real changes are cuts of 0.6 or more; so are 5–21 in-screen
  instants per file (popups, content loading, a video playing).
- **Not tried:** motion compensation, and reading the address bar.
- **If every instant were a change,** 34–74 % of each recording would sit in units under 2 s:
  67 %, 60 %, 36 %, 44 %, 34 %, 74 % and 54 % on T1, T2, T3a, T3b, T3c, T4 and T5 (44 of 51,
  64 of 76, 36 of 51, 26 of 35, 33 of 49, 64 of 69 and 50 of 62 units).

## The 80-moment cap — MEASURED

No production analysis was thinned by it: the 16 `analyze_demo` jobs kept 36, 36, 38, 46, 46, 53,
53, 60 ×4 and 65 ×5 moments. No `a_analysis_%` row exists, so the cap is the default 80. Two repo
fixtures from the old project hold exactly 80 states.

## What this cannot say

- **Nothing about other kinds of footage.** These are 5 phone-filmed takes of 2 desktop web apps.
  A clean screen recording and a phone-app demo are untested; the tie-break bug above is the kind
  of thing they would turn up.
- **Nothing about the box.** The signatures come from ffmpeg's scaler, which differs between
  machines ([[analysis-clustering-does-not-reproduce-across-machines]]). "Same box, same file,
  same instants" is REASONED from deterministic code, not shown.
- **Swaps depend on the judge.** An earlier pass on T2 listed two more swaps, at 18.2 s and 47.0 s
  ([[screen-change-signal-2026-10-01]]); 47.0 s has no instant within 1.3 s. On the frames it is a
  button turning from greyed to green.

## Related

- [[label-call-test-2026-10-02]] — the vision call that was to name each instant.
- [[0077-moments-keep-their-real-start-and-end]]
