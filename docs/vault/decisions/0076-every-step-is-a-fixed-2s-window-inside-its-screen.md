---
type: decision
status: verified
verified: 2026-10-01
method: "Founder decisions in chat, 2026-10-01, relayed in that day's task prompt (section 2, 'Decided … not up for relitigation'); the reasons are his. Recorded on branch docs/screen-span-measurement. NOT YET BUILT: the code still runs 0072 (4 s cap, no floor, 5–7 steps, 15–21 s)."
source: founder
supersedes: "the length rules of [[0070-a-step-ends-on-a-real-screen-change]] and [[0072-step-cap-no-padding-cut-early]], and the runtime band of [[0002-runtime-band-floor-is-15s]]; the code runs those until this is built"
---

# 0076 — Every step is a fixed 2 s window inside its screen, 5–10 steps

**DECIDED, NOT YET BUILT.** Every item below is **FOUNDER-DECIDED**: decided in chat on 2026-10-01,
relayed in that day's task prompt, and not up for relitigation. Until a later task builds it,
production keeps [[0072-step-cap-no-padding-cut-early]]: a clip runs to its screen's end, at most
4 s, with no floor; 5–7 steps; 15–21 s.

## The decisions

1. **Every step is a fixed 2 s.**
   - **His reason:** long enough to follow, short enough to keep pace, and a fixed length removes
     the clip arithmetic both failed plans died on.
   - It supersedes [[0070-a-step-ends-on-a-real-screen-change]]'s "length follows the footage".
   - It supersedes [[0072-step-cap-no-padding-cut-early]]'s 4 s cap and its "no floor".
   - **"A step never runs into the next screen" stays** (0070).

   _Recorder's note, not his words: the two failed live plans are `bd0913b4` and `ce687d4a`
   ([[0074-unpickable-moments-and-the-last-round-repair]])._

2. **5–10 steps. The 15–21 s band is retired.** This amends [[0002-runtime-band-floor-is-15s]].
   The demo runs steps × 2 s, so 10–20 s.
   - **His reason for the minimum of 5:** it keeps 0002's reason, never force padding.
3. **Every existing moment stays in the inventory** ([[0064-the-inventory-is-one-tier]] stands).
   - Each moment plays a 2 s window inside its screen. When the moment is near the screen's end,
     the window slides earlier.
   - Extra windows are added only where a long screen has too few moments.

## Open — not decided

The founder named these three as open:

- **Screens shorter than 2 s.**
- **Caption length at 2 s.**
- **What counts as "its screen".**

The measurement taken for them is [[screen-spans-from-the-footage-2026-10-01]] and
[[the-84s-recording-against-the-founder-timeline-2026-10-01]]. It reports facts, not a choice.

## Options

There was no menu. These arrived as the founder's decisions, made in chat and relayed in the task
prompt. The rules they replace are the alternative:

- 0070's footage-length clip;
- 0072's 4 s cap with no floor;
- 0002's 15–21 s band.

## Related

- [[0075-more-moments-over-fewer]] — decided the same day.
- [[0071-the-3s-step-floor-was-an-undecided-default]] — the floor before 0072.
