---
type: defect
status: verified
verified: 2026-10-01
method: "Offline over the read-only production export of 2026-10-01 (packages/core/.work/screen-span/, gitignored). The shipped isNewScreen and timelineClipMs (base.ts, cap 4000 ms, sample 200 ms, demos.duration_ms) over every ready timeline, against the real screens two independent Claude vision passes segmented on 5 fps sheets of each normalized file (vispix.ts, spans.ts). Found by the adversarial review of [[screen-spans-from-the-footage-2026-10-01]] and recomputed."
source: code + db + inference
---

# A missed screen change lets a step run into the next screen

[[0070-a-step-ends-on-a-real-screen-change]] says a step never runs into the next screen.
[[0072-step-cap-no-padding-cut-early]] enforces that only where `isNewScreen` flags the change.
Where it does not, the clip runs on to the cap.

- **MEASURED + REASONED:** `isNewScreen` misses 9 of the vision-judged real screen changes, across
  8 of the 15 ready analyses. Each missed change lies between two stored moments the analysis keeps
  on one screen.
- **18 pool moments** in those analyses get a 0072 clip (`timelineClipMs`) that runs past the real
  change, so a step picked there shows the next screen. Examples:
  - **T5.** The landing-page moment at 5.2 s gets 4.0 s in 3 of the 4 analyses, running 2.4 s into
    the app home.
  - **T1 (jobnet).** States from 26.6 s to 29.0 s get 4.0 s, running past the home → results
    change at 29.8 s, in 3 of the 4 analyses.

The earlier measurement found no miss on the tavnit recording it scored
([[screen-change-signal-2026-10-01]]). These misses are on other files, and on repeat analyses of
the same file: the same change is caught by one analysis and missed by another
([[repeat-analyses-of-one-file-2026-10-01]]).

**Not the same as** [[a-screen-missing-from-the-timeline-is-invisible-to-the-cut]]. That defect is
about a screen with no stored state at all. Here the states exist and the signal misses the change
between them.

**Not fixed.** Production runs 0072 as written. [[0076-every-step-is-a-fixed-2s-window-inside-its-screen]],
decided and not yet built, keeps "a step never runs into the next screen". So what counts as "its
screen" (open) decides whether this carries over.
