---
type: fact
status: verified
verified: 2026-10-01
method: "Same scratch as [[screen-spans-from-the-footage-2026-10-01]] (packages/core/.work/screen-span/, gitignored): spans.ts and table-b.ts over the four analyses of file 752bf15a (T5), the founder's segments placed on the footage by two independent vision judges on 5 fps sheets (wf_dff556e7-048) and re-checked by two skeptics each on 10 fps strips (wf_468b8a97-a56); every moment's 2 s window judged on a 10 fps strip (wf_9a9ea393-da0); handadd.ts replays a hand-added moment through the shipped assembleSteps on plan d3864d05. Read-only production rows from export.ts."
source: db + code + inference + founder
---

# The 84 s recording against the founder's timeline

Measured 2026-10-01. Tags:

- **FOUNDER-REPORTED** — his timeline, [[founder-timeline-of-the-84s-recording]].
- **MEASURED** — the code and the stored rows.
- **REASONED** — Claude vision on frames, two independent judges each.

The recording is take T5: one raw file, uploaded five times, with four ready analyses (`4113d37d`
`4219e82e` `6658999c` `fc30dc8e`). All four hold the same 65 moments
([[repeat-analyses-of-one-file-2026-10-01]]). Tables are for the newest, `fc30dc8e` (demo
`6a997717`), unless a line says otherwise.

## His eight boundaries in the footage — REASONED

Two judges placed every boundary on 5 fps sheets and agreed exactly. Two skeptics per boundary
re-checked each on a 10 fps strip. At 10 fps four sit on the same frame and four sit one 0.1 s
frame away. **Every one of his seconds is early**, by 0.5–2.3 s at 10 fps.

| his boundary | first frame of the later segment (5 fps → 10 fps check) | what changes                                     | his second is early by |
| -----------: | ------------------------------------------------------- | ------------------------------------------------ | ---------------------: |
|         0:06 | 6.8 s → 6.7 s                                           | the public landing page → the signed-in app home |                  0.7 s |
|         0:09 | 9.8 s, upheld                                           | app home → the character grid                    |                  0.8 s |
|         0:13 | 14.0 s, upheld                                          | character grid → the opener-clip page            |                  1.0 s |
|         0:17 | 17.4 s → 17.5 s                                         | opener-clip page → the opener-line page          |                  0.5 s |
|         0:30 | 31.6 s, upheld                                          | opener-line page → the product-video upload page |                  1.6 s |
|         0:44 | 45.2 s → 45.1 s                                         | upload page → the steps plan                     |                  1.1 s |
|         0:53 | 53.6 s, upheld                                          | steps plan → the "how the ad will be built" page |                  0.6 s |
|         1:00 | 62.2 s → 62.3 s                                         | "creating the ad" progress → "the ad is ready"   |                  2.3 s |

**His 1:00 is not a screen change.**

- **REASONED:** the summary, the progress state and the result are one wizard step, the same
  `step=5` URL, swapped in place at 59.2 s and at 62.2–62.3 s. He splits at the second swap.
- His "0:44" falls where the example video inside the upload page's player cuts to a new shot.
  That is the player's picture changing, not a page change.

**His first segment holds two real screens:** typing the URL on a new-tab page (0–4.8 s), then the
product's public landing page (5.0–6.6 s), which is shown for 1.8 s before the redirect to the
signed-in home.

The tables below use the 5 fps placements, which the windows were judged against. **One moment
sits on a boundary:** moment 57 at 62.2 s. The analysis's own 62.2 s sample shows the result. At
10 fps the result starts at 62.3 s, so one frame decides which segment that moment is in.

## One row per founder segment (`fc30dc8e`)

- **"Analysis boundaries inside"** counts boundaries more than 0.5 s inside the segment.
  **REASONED** for each: real change, in-place swap, or none (no screen change at all).
- **Clean windows** are pool moments with a 2 s window inside their unit.
- **"Crosses"** is the vision verdict on each moment's founder-segment window.
- **"Uncovered"** is the time in the segment that no moment's 2 s window covers.

| founder segment | in the footage (s) |      real screens | analysis boundaries inside         | moments (not duplicate) | clean window: analysis screen / founder segment |   slid | windows that cross a real screen | uncovered (s) | 2 s slots |
| --------------- | ------------------ | ----------------: | ---------------------------------- | ----------------------: | ----------------------------------------------- | -----: | -------------------------------- | ------------: | --------: |
| 0:00–0:06       | 0.0–6.8            |                 2 | 1: real at 5.0                     |                   9 (9) | 8 / 9                                           |      1 | 5 (moments 4–8 reach 5.1 s)      |           1.2 |         3 |
| 0:06–0:09       | 6.8–9.8            |                 1 | —                                  |                   2 (1) | 2 / 2                                           |      2 | 0                                |           1.0 |         1 |
| 0:09–0:13       | 9.8–14.0           |                 1 | 1: none at 12.2                    |                   2 (2) | 1 / 2                                           |      1 | 0                                |           1.6 |         2 |
| 0:13–0:17       | 14.0–17.4          |                 1 | 1: none at 16.2                    |                   2 (2) | 1 / 2                                           |      1 | 0                                |           1.4 |         1 |
| 0:17–0:30       | 17.4–31.6          |                 1 | 3: none 18.8, swap 24.8, none 30.6 |                 17 (10) | 14 / 17                                         |      3 | 0                                |           0.6 |         7 |
| 0:30–0:44       | 31.6–45.2          |                 1 | 1: none at 33.2                    |                 13 (12) | 12 / 13                                         |      2 | 0 (3 show 0.1 s of 45.1 s)       |           0.8 |         6 |
| 0:44–0:53       | 45.2–53.6          |                 1 | —                                  |                   6 (4) | 6 / 6                                           |      1 | 0                                |           0.4 |         4 |
| 0:53–1:00       | 53.6–62.2          | 1, with 1:00–1:23 | 1: swap at 59.3                    |                   6 (3) | 6 / 6                                           |      1 | 0                                |           0.6 |         4 |
| 1:00–1:23       | 62.2–84.2          |     (same screen) | —                                  |                   8 (6) | 8 / 8                                           |      0 | 0                                |           6.4 |        11 |
| **total**       |                    |             **9** | **8**                              |             **65 (49)** | **58 / 65**                                     | **12** | **5**                            |               |           |

**Notes on the table.**

- **Every segment is at least 3.0 s**, so every moment has a clean window inside its segment.
- **One segment has fewer moments than 2 s slots:** 1:00–1:23, with 8 moments for 11 slots.
  Counting a duplicate frame once (`sameStateAsPrevious`), 0:53–1:00 also has fewer: 3 for 4.
- **1:00–1:23 is the only segment with more than 1.6 s uncovered:** 6.4 s, the finished ad playing
  in its player. "Too few" is not defined by any decision, so this is the count, not a verdict.
- **The 7 moments with no clean window inside their analysis screen** are 8, 12, 14, 15, 30, 31 and 32. Six of them sit on a real screen of at least 2 s. Moment 8, the landing page, sits on a real
  screen of 1.8 s.

## Where the analyses put screen boundaries against his eight

| analysis   | analysis screens | his boundaries matched within 0.5 s | added inside his segments: real / swap / none |
| ---------- | ---------------: | ----------------------------------: | --------------------------------------------- |
| `4113d37d` |               15 |                 7 of 8 (misses 6.8) | 1 / 2 / 4                                     |
| `4219e82e` |               14 |        6 of 8 (misses 6.8 and 14.0) | 1 / 2 / 4                                     |
| `6658999c` |               16 |                 7 of 8 (misses 6.8) | 1 / 2 / 5                                     |
| `fc30dc8e` |               17 |                              8 of 8 | 1 / 2 / 5                                     |

- **The 1:00 match is an in-place swap,** at 61.9 s by the pixel cut.
- **The "real" boundary added inside a segment** is 5.0 s, the landing page inside "typing in the
  URL".
- **The "none" boundaries** are the analysis splitting one real screen. Two skeptics each upheld
  that no screen change happens at 12.2, 16.2, 18.8, 30.6 or 33.2 s:
  - camera panning across the character grid and the clip carousel;
  - the opener-line page panning;
  - the upload page's placeholders loading into its player.
- **The misses cost a bleed today.** Under the shipped 0072 rule:
  - the three analyses that miss 6.8 s give moment 8 (the landing page, 5.2 s) a 4.0 s clip,
    which runs 2.4 s into the app home;
  - `4219e82e` also misses 14.0 s, and gives moment 12 a 2.0 s clip that runs 1.6 s into the
    clip page.

  The defect note is [[a-missed-screen-change-lets-a-step-run-into-the-next-screen]].

**This tests the planning session's reasoning in the task prompt,** which was to be tested, not
assumed (REASONED):

- **Confirmed:** his segments are all at least 3 s, and "choose a character" (9.8–14.0 s, 4.2 s)
  is one real screen that the analysis splits into two one-moment screens, of 2.4 s and 1.8 s.
- **Not the whole story for short clips.**
  [[screen-spans-from-the-footage-2026-10-01]] counts it on every analysis. Of this analysis's 27
  pool moments with a 0072 clip under 2 s:
  - 1 is short because 0072's cut is early;
  - 11 because the analysis split the screen;
  - 15 because the real screen changes less than 2 s after the moment. Sliding the window earlier
    fixes 14 of those; running it forward does not. The 15th is moment 8, on the 1.8 s landing
    page, where no 2 s window fits however it slides.

## The stored groups against his segments

The wizard's pages, with `inventoryPages` re-applied to the stored sections, are coarser than his
nine segments:

| analysis   | pages (s)                                | page boundaries on one of his |
| ---------- | ---------------------------------------- | ----------------------------- |
| `4113d37d` | 0–6.8 · 6.8–59.3 · 59.3–84.2             | 1 of 2                        |
| `4219e82e` | 0–9.8 · 9.8–31.6 · 31.6–59.3 · 59.3–84.2 | 2 of 3                        |
| `6658999c` | 0–6.8 · 6.8–31.6 · 31.6–45.2 · 45.2–84.2 | 3 of 3                        |
| `fc30dc8e` | 0–6.8 · 6.8–31.6 · 31.6–45.2 · 45.2–84.2 | 3 of 3                        |

The one page boundary that misses his is 59.3 s, the summary → progress swap.

## The analysis's screens, with their real spans (`fc30dc8e`)

| analysis screen | states | real span (s) | length (s)     | starts with      | his segment          |
| --------------: | ------ | ------------- | -------------- | ---------------- | -------------------- |
|               0 | 0–7    | 0.0–5.0       | 5.00           | recording start  | 0:00–0:06            |
|               1 | 8      | 5.0–6.8       | 1.80 **< 2 s** | real change      | 0:00–0:06            |
|               2 | 9–10   | 6.8–9.8       | 3.00           | real change      | 0:06–0:09            |
|               3 | 11     | 9.8–12.2      | 2.43           | real change      | 0:09–0:13            |
|               4 | 12     | 12.2–14.0     | 1.77 **< 2 s** | no screen change | 0:09–0:13            |
|               5 | 13     | 14.0–16.2     | 2.20           | real change      | 0:13–0:17            |
|               6 | 14     | 16.2–17.4     | 1.20 **< 2 s** | no screen change | 0:13–0:17            |
|               7 | 15     | 17.4–18.8     | 1.40 **< 2 s** | real change      | 0:17–0:30            |
|               8 | 16–23  | 18.8–24.8     | 6.03           | no screen change | 0:17–0:30            |
|               9 | 24–29  | 24.8–30.6     | 5.73           | in-place swap    | 0:17–0:30            |
|              10 | 30–31  | 30.6–31.6     | 1.03 **< 2 s** | no screen change | 0:17–0:30            |
|              11 | 32     | 31.6–33.2     | 1.60 **< 2 s** | real change      | 0:30–0:44            |
|              12 | 33–44  | 33.2–45.2     | 12.00          | no screen change | 0:30–0:44            |
|              13 | 45–50  | 45.2–53.6     | 8.40           | real change      | 0:44–0:53            |
|              14 | 51–55  | 53.6–59.3     | 5.73           | real change      | 0:53–1:00            |
|              15 | 56     | 59.3–61.9     | 2.60           | in-place swap    | 0:53–1:00            |
|              16 | 57–64  | 61.9–84.2     | 22.30          | in-place swap    | 0:53–1:00, 1:00–1:23 |

Six of the 17 are under 2 s. **Five of those six are pieces of a longer real screen. Only screen 1,
the landing page, is a real screen under 2 s.**

The per-moment table (hold, territory, both windows, the vision verdict) is
`packages/core/.work/screen-span/data/newest-tables.md`. It is gitignored and stays out of the repo
because it sits next to the footage.

## The newest plan and the 0.4 s hand-added moment

- **MEASURED.** Plan `d3864d05` (demo `6a997717`) was created 19:23:58 UTC. Its job `439f7ebc`,
  created the same second, was claimed by `hetzner:light`. The row reads:
  - `ready`, `plan_demo_steps@v15+pickable+access-pin`, not approved, `notes` null;
  - `retry_violations`: one violation, then none. The first call's caption on state 49 needed
    2 400 ms in a 2 000 ms clip, and the second call was clean, so the plan was not repaired;
  - 5 steps on states 0, 40, 45, 49 and 57, totalling 17.6 s.

  So the box ran the repair branch's code for this plan (the `+pickable` suffix).

- **FOUNDER-REPORTED:** a moment he added by hand from the inventory ran 0.4 s.
- **MEASURED:** no stored plan row holds a step under 1 s. Replaying every possible hand-add on
  `d3864d05` through the shipped `assembleSteps`:
  - exactly one moment runs 0.4 s: state 39 at 38.6 s, cut by step 40 at 39.0 s;
  - 16 others would run 0.2 s.

  Which moment he added is stored nowhere.
