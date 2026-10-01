---
type: fact
status: verified
verified: 2026-10-01
method: "Read-only production export plus offline footage measurement, 2026-10-01, all scratch gitignored under packages/core/.work/screen-span/ (run from the repo root with apps/cli/node_modules/.bin/tsx unless .mjs). export.ts and files.ts (one `set transaction read only` transaction; storage list + download of the 7 normalized files); base.ts (shipped isNewScreen + timelineClipMs over every stored timeline); signals.ts (shipped frameHashes at 30 fps); measure.ts (holds and pixel cuts); spans.ts (spans and 2 s windows); vispix.ts, table-b.ts, agree.ts. Vision: 5 fps timestamped sheets of every file (ffmpeg fps=5,scale=216:384,drawtext,tile=6x3) judged by two independent passes (workflow wf_dff556e7-048), disagreements by three more at 10 fps; 2 s window strips at 10 fps (strips.ts) judged by two independent passes with a tie-break (wf_9a9ea393-da0); skeptic, re-implementation and code checks (wf_468b8a97-a56); an adversarial review of these notes against the data (wf_3e70fdab-760). Footage, frames and strips stay in that scratch directory."
source: db + code + inference
---

# Where screens really start and end, measured from the footage

Measured 2026-10-01 for [[0076-every-step-is-a-fixed-2s-window-inside-its-screen]], which is
decided and not yet built. Tags:

- **MEASURED** — production read-only, the code, or a deterministic computation on the footage.
- **REASONED** — Claude vision on extracted frames, never the founder's eye. Every vision call
  here had at least two independent judges, and more where they disagreed.
- **FOUNDER-REPORTED.**

The files and takes are those of [[demo-recordings-by-file-and-take-2026-10-01]]. The newest
demo, compared against the founder's own timeline, is
[[the-84s-recording-against-the-founder-timeline-2026-10-01]].

## Why the spans had to come from the footage — MEASURED in code

- **A stored `timestampMs` is the lower median of its cluster.** `clusterStates`
  (`packages/core/src/media/ffmpeg.ts`) picks the earlier of the two middle frames of an even-length
  run. A cluster is at least `MIN_CLUSTER_FRAMES` = 2 samples at 5 fps.
- **The cluster's `startMs` and `endMs` are computed and then dropped.** `demo-analysis.ts`
  never reads either field:
  - the timeline stores `timestampMs: cluster.representativeMs`;
  - the job checkpoint's `resumeKey` lists representatives only.
- **Frames that fall between clusters are stored nowhere.** These are runs shorter than 2 samples,
  clusters thinned by the 80-state cap, and states the vision call never returned.
- **The off-box recompute is not the box's clustering.** It matched the box's representatives in
  only 19–47 of each file's kept states
  ([[analysis-clustering-does-not-reproduce-across-machines]]). So no span here assumes the box's
  clustering. Every span is anchored on the stored timestamps themselves.

## Method

1. **A moment's hold — MEASURED.** The native frames around its stored timestamp that stay within
   `MAX_HAMMING` (14, the box's own same-state threshold) of that frame, by the shipped 30 fps
   dHash. Up to two outlier frames are bridged for handheld shake.
2. **Real screens — REASONED.** Two independent vision passes segmented every file on 5 fps sheets
   under the founder's definitions:
   - popups, typing, scrolling, camera motion and a video playing inside an embedded player stay
     inside a screen;
   - a new page, route, wizard step or site, a new-tab page, or a full-page blank is a new screen;
   - in-place swaps were listed separately.

   **Agreement:** the passes agreed on 57 boundaries, each within 0.2 s. They disagreed on 5:
   single blank frames and one spinner → player change. Three judges at 10 fps settled those:
   - there is no blank screen at 28.8 s in take T3 (3 of 3);
   - `c36f775d` changes screen at 82.1 s and swaps in place at 82.8 s (2 of 3; the third called
     82.8 s a new screen).

   **The result:** 64 real screens and 57 real screen changes across the 7 files.

3. **Boundaries between consecutive moments.**
   - Where a real screen change lies between them, the vision boundary is used.
   - Otherwise the pixel cut: the frame that best splits the stretch between the two stored frames
     by dHash distance to each.
   - A moment's **territory** runs from the boundary into it to the boundary out of it.
4. **Units.** A unit's span runs from the boundary into its first moment to the boundary out of
   its last.
   - **A:** the analysis's screens, from the shipped `isNewScreen`.
   - **B:** the coarse unit. On T5 these are the founder's segments, placed on the footage. Elsewhere
     they are the stored groups as the wizard pages them (`inventoryPages`: an unclaimed readable
     moment joins the page of the nearest claimed one).
   - **V:** the real screens, from step 2.
5. **The window.**
   - For a moment at `t` in a unit `[S, E)`, the window is `[w, w + 2 s)` with
     `w = max(S, min(t, E − 2 s))`.
   - A clean window exists if and only if the unit lasts at least 2 s. The moment always lies
     inside its own unit.
   - The window is **slid** when `w < t`.

## Where the pixel method breaks — MEASURED against REASONED

- **What could be scored.** Of the 57 real changes, 56 sit between two consecutive stored moments
  at an analysis-screen boundary, where a pixel cut exists to compare. The 57th (T4, 13.4 s) lies
  inside an analysis screen in both T4 analyses, so no cut is made there.
- **Single changes.** On the 54 of those 56 stretches that hold a single change, the pixel cut
  lands within ±0.2 s of the vision boundary on 46.
- **The 8 misses.** Seven are late, by 0.43–1.77 s, and one is 0.83 s early. Most sit on blank,
  faded or motion-blurred transitions; jobnet's white loading page is +1.07 s.
- **Two stretches hold more than one change:**
  - a 0.2 s blank between two wizard steps (`c36f775d`, 22.2 s);
  - `f6e343d1`'s 23 s gap, 41.2–64.2 s. It holds three real changes and two whole real screens
    with no stored moment at all. Eight of the 9 states the vision call never returned were
    there; the ninth is at 41.0 s, just before.
- **The vision boundaries are only as fine as their 5 fps sheets.** A 2 s window ending exactly on
  one showed a 0.1 s frame of the next screen in 17 of the 190 moment windows judged (below). A
  frame-exact cut needs the boundary located at the native frame rate.

## Per analysis: screens, screens really under 2 s, moments with no clean window — MEASURED + REASONED

Spans come from MEASURED pixel cuts, except where a REASONED vision boundary lies between two
moments. The V columns are the REASONED segmentation itself. "Pool" is the inventory: every state
that is not `unreadable` ([[0064-the-inventory-is-one-tier]]).

| analysis   | file (take)     | moments (pool) | analysis screens | really < 2 s | pool moments, no window (A) | coarse unit (B)    | B < 2 s | no window (B) | real screens (V) | real < 2 s | no window (V) |
| ---------- | --------------- | -------------: | ---------------: | -----------: | --------------------------: | ------------------ | ------: | ------------: | ---------------: | ---------: | ------------: |
| `2c74fe2a` | `8b0dc639` (T1) |        60 (60) |                4 |            1 |                           1 | 4 pages            |       0 |             0 |                4 |          1 |             1 |
| `1e66c926` | `8b0dc639` (T1) |        51 (51) |                5 |            1 |                           1 | 4 pages            |       0 |             0 |                4 |          1 |             1 |
| `0bb10493` | `8b0dc639` (T1) |        60 (60) |                4 |            1 |                           1 | 4 pages            |       0 |             0 |                4 |          1 |             1 |
| `2c8acb7a` | `8b0dc639` (T1) |        60 (60) |                4 |            1 |                           1 | 3 pages            |       0 |             0 |                4 |          1 |             1 |
| `6efb1f49` | `133a6304` (T2) |        53 (52) |               15 |            4 |                           5 | 4 pages            |       0 |             0 |               12 |          3 |             4 |
| `c5cb4d90` | `133a6304` (T2) |        53 (52) |               15 |            4 |                           5 | 4 pages            |       0 |             0 |               12 |          3 |             4 |
| `08b93a8a` | `c36f775d` (T3) |        46 (45) |               13 |            3 |                           2 | 3 pages            |       0 |             0 |               10 |          2 |             0 |
| `bd0005b0` | `28ddab62` (T3) |        38 (37) |                9 |            3 |                           2 | 3 pages            |       0 |             0 |                8 |          2 |             1 |
| `91c89b65` | `2e303069` (T3) |        46 (45) |               12 |            3 |                           3 | 2 pages            |       0 |             0 |                9 |          1 |             0 |
| `f6e343d1` | `b25923dd` (T4) |        27 (26) |               11 |            3 |                           2 | 4 pages            |       0 |             0 |               12 |          1 |             0 |
| `6dac02c8` | `b25923dd` (T4) |        36 (35) |               14 |            3 |                           2 | 4 pages            |       0 |             0 |               12 |          1 |             0 |
| `4113d37d` | `752bf15a` (T5) |        65 (65) |               15 |            4 |                           4 | 9 founder segments |       0 |             0 |                9 |          1 |             1 |
| `4219e82e` | `752bf15a` (T5) |        65 (65) |               14 |            3 |                           4 | 9 founder segments |       0 |             0 |                9 |          1 |             1 |
| `6658999c` | `752bf15a` (T5) |        65 (65) |               16 |            5 |                           6 | 9 founder segments |       0 |             0 |                9 |          1 |             1 |
| `fc30dc8e` | `752bf15a` (T5) |        65 (65) |               17 |            6 |                           7 | 9 founder segments |       0 |             0 |                9 |          1 |             1 |

**Totals.**

- **The analysis's screens:** 790 stored moments, 783 of them in the pool, in 168 analysis
  screens. 45 of those screens are really under 2 s. 46 pool moments (53 of all moments) have no
  clean window inside their analysis screen.
- **The coarse unit:** none is under 2 s, so every moment has a clean window. On T5 the stored
  pages are also never under 2 s.

### What the short analysis screens are — REASONED

- **28 of the 45** are pieces of a real screen that lasts 2 s or more: the analysis split one
  real screen.
- **17** coincide with a real screen under 2 s.
- Of the 53 moments with no clean window inside their analysis screen, **32** sit on a real screen
  of 2 s or more.

**Real screens under 2 s: 11 of 64**, counting files (T3 three times).

- 7 are full-page blank or loading pages between two pages.
- 4 are app pages:
  - two quick onboarding pages in T2, 1.2 s and 1.6 s;
  - a page cut short by an edit in `28ddab62`, 1.6 s;
  - T5's landing page, 1.8 s, shown between typing the URL and the app home.

### The analysis misses real changes too — MEASURED + REASONED

`isNewScreen` misses 9 real screen changes across 8 of the 15 analyses: the change lies between two
moments it keeps on one screen.

| file | change missed                             | missed in       |
| ---- | ----------------------------------------- | --------------- |
| T1   | 29.8 s, home → results                    | 3 of 4 analyses |
| T4   | 13.4 s, one questionnaire step → the next | both analyses   |
| T5   | 6.8 s, landing page → app home            | 3 of 4 analyses |
| T5   | 14.0 s, character grid → clip page        | `4219e82e`      |

Two consequences follow:

- **The shipped 0072 rule bleeds there.** 18 pool moments get a clip that runs past a real change,
  on these analyses: `2c74fe2a`, `0bb10493`, `2c8acb7a`, `f6e343d1`, `6dac02c8`, `4113d37d`,
  `4219e82e` and `6658999c`. In T5 the landing-page moment (5.2 s) gets 4.0 s and runs 2.4 s
  into the app home. The note is
  [[a-missed-screen-change-lets-a-step-run-into-the-next-screen]].
- **A 2 s window inside such an analysis screen can cross the change without being slid.** 10
  unslid pool-moment windows do, all in those analyses. They were not among the windows judged by
  eye below, which were the slid ones.

### Why 0072 gives short clips — MEASURED + REASONED

Under [[0072-step-cap-no-padding-cut-early]], 254 of the 783 pool moments have a clip under 2 s.

| the moment's clip would reach 2 s by running to…                      | moments |
| --------------------------------------------------------------------- | ------: |
| the real end of its analysis screen (0072's cut is early)             |      32 |
| only the real end of its real screen (the analysis split it)          |      71 |
| neither: the real screen changes less than 2 s after the moment       |     151 |
| (of those 151, sitting on a real screen under 2 s, so no window fits) |      14 |

## The 2 s windows by eye — REASONED

Every window below was judged on a 10 fps strip. Two judges agreed on 135 of 136 strips; a
tie-break settled the last. The rows are disjoint: each moment's window is counted once, 190 in
all.

**The windows judged come from one analysis per file:**

| file | analysis judged                                          |
| ---- | -------------------------------------------------------- |
| T1   | `2c74fe2a` (its windows match `0bb10493` and `2c8acb7a`) |
| T2   | `c5cb4d90`                                               |
| T3   | `08b93a8a`, `bd0005b0` and `91c89b65`, one per file      |
| T4   | `6dac02c8`                                               |
| T5   | `fc30dc8e`                                               |

15 moment windows of the other analyses were never judged. At least one of them crosses a real
change: `f6e343d1`'s page window for moment 5 (5.4–7.4 s) spans the 6.4 s change.

"Edge" means the next screen showed for 0.1 s in the window's last frame, where the 5 fps
boundary was one frame late. "Crosses" means a different real screen appears inside the window.

| windows (per moment)                                                 | judged | stay on one screen | edge | crosses |
| -------------------------------------------------------------------- | -----: | -----------------: | ---: | ------: |
| T5, founder segment, every moment                                    |     65 |                 57 |    3 |       5 |
| T5, analysis screen, each slid window                                |     19 |                 17 |    2 |       0 |
| T1–T4, analysis screen, each slid window                             |     62 |                 52 |   10 |       0 |
| T1–T4, wizard page, for moments with no clean analysis-screen window |     20 |                  5 |    0 |      15 |
| T1–T4, wizard page, each other slid window                           |     24 |                 14 |    2 |       8 |

- **T5's 5 crossings** are moments 4–8. Their windows reach 5.1 s, where the landing page appears
  inside the founder's "typing in the URL".
- **T1–T4's crossings** are pages that hold several real screens: home → results, a blank page
  between pages, one wizard step → the next. The judged wizard-page windows crossed in 23 of 44.
- **No judged window inside an analysis screen crossed a real change;** their only bleed was the
  0.1 s edge. Only slid windows were judged. The unslid ones that cross are the 10 counted under
  the missed changes above.

## What a new analysis would have to keep, and what the existing ones can get for free

- **To store moment spans:** each kept cluster's `startMs` and `endMs`. `clusterStates` already
  computes both.
- **To store screen spans as well,** something has to record where each change between two
  consecutive stored moments happens: the frames between two clusters belong to no cluster today.
  - **Either** that boundary is stored as a time;
  - **or** the 5 fps hash sequence the clusters came from is stored: about 420 values of 143 bits
    for an 84 s demo. Being the box's own hashes, spans recomputed from them later would match the
    box's clustering by construction.
- **Free on the existing analyses, no model call** (REASONED from the MEASURED box consistency):
  - Re-running `frameHashes` → `clusterStates` **on the box** should reproduce each analysis's
    clusters. The check is mechanical: the recomputed kept list must equal the job's `resumeKey`
    string. The box gave identical kept sets for every re-upload of a file, from 2026-08-27 to
    2026-10-01.
  - Off the box the recompute does not reproduce, so the cluster bounds are not obtainable here.
  - The footage method in this note needs no clustering and no paid call. Its error is as measured
    above: within one 0.1 s frame where vision decides a boundary, and up to 1.8 s where only a
    pixel cut does.
- **Not free:** the 9 moments `f6e343d1` never got back from the vision call. Its 41.2–64.2 s holds
  two whole real screens with no moment. Only a new paid vision call puts a moment there.

## Checked independently

- **A blind re-implementation reproduced every count.** An agent got a prose spec and only
  `base.json`, `measure.json` and `units.json`; it was not shown the original scripts. Its numbers
  matched every count in the per-analysis table, on all 15 analyses, across all 12 columns.
- **A separate reader re-checked the code claims,** with file:line evidence:
  - the lower median;
  - the 2-sample minimum;
  - nothing persists a cluster's bounds or a frame hash;
  - the `resumeKey`;
  - thinning keeps the last cluster.

  It added one correction. The `resumeKey` also carries the fps (`analyze_demo@v3/5/10/…`, 5 in
  all 16 jobs), so the sampling rate of every past analysis is recoverable from its job.
  [[screen-cut-assumes-the-current-analysis-fps]] now carries that correction.

- **Two skeptics per claim tried to refute 13 vision claims on T5:**
  - all five no-screen-change claims were upheld;
  - of the eight boundaries, four sit on the same frame at 10 fps and four sit one 0.1 s frame
    away ([[the-84s-recording-against-the-founder-timeline-2026-10-01]]).
- **An adversarial review of these notes against the data** found wrong counts and overstated
  claims before commit. All are corrected here.

## What this cannot say

- **The truth is model vision, not the founder,** except for his own timeline of T5.
- **"Too few moments"** is not defined by any decision. The newest-demo note reports moments per
  segment and the seconds no window covers, nothing more.
- **Caption length at 2 s.** No stored label was read, so how often today's captions run long is
  unmeasured. What the shipped rule says, MEASURED in code:
  - `readTimeMs` (`packages/core/src/plan-format.ts`) gives 400 ms plus 400 ms per word: 3 words
    1.6 s, 4 words 2.0 s, 5 words 2.4 s, 6 words 2.8 s;
  - captions may run 3 to 6 words (`MIN_LABEL_WORDS`, `MAX_LABEL_WORDS`);
  - so under that rule a 2 s step can carry a caption of 3 or 4 words.
