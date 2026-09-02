---
type: decision
status: verified
verified: 2026-09-02
method: "founder instruction in chat across three rounds on 2026-09-02, each after looking at the built surface in production; final shape verified in the browser at 375/700/820/1440 before the last round landed"
source: founder
---

# 0010 — Where render progress is shown, and which way it fills

## The decision

Two surfaces, deliberately different, and they are not to be made consistent with each other:

| surface                            | what it shows                                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| The A wizard's render step         | The full bar: 28px track, fill, percentage centred **on** the bar, honest caption                                     |
| The dashboard home (`/home`) strip | A live chip in the heading row, a shimmer on the in-flight tile, and the percentage **inside that tile**. **No bar.** |

The dashboard indicator costs the pane **zero** height. The chip rides the existing
`סרטונים אחרונים` heading row and the number goes inside the placeholder tile the render
already occupies. That is load-bearing: `/home` is sized to fit a laptop without scrolling
(see the `zoom: 0.95` on the content pane in `apps/web/src/app/home/layout.tsx`), and every
earlier version of this cost 16–86px.

Both the bar's fill and the indeterminate sweep run **left to right, physically** — a
`left-0` anchor and a `translateX(-100% → 320%)` keyframe, never logical `start-0`, in a
`dir="rtl"` app.

## Why

Three rounds, each after the founder looked at the real thing:

1. **First build** put a bar under the heading row on `/home` and the percent above the bar
   in the wizard. He asked for the number to be on the bar, and for the fill to move
   gradually rather than jump.
2. **Second build** did that. He then said the dashboard bar was too much: _"I like the
   loading animation, but I don't like the whole big loading bar — remove the loading bar
   from the homepage completely, and instead add just the progress percentage number in the
   middle of the render video skeleton."_
3. **Direction**, separately: _"make loading bar fill from left to right not right to left,
   same thing with the sliding thing."_ This is the **second** time he has asked for
   left-to-right — the first is already recorded in the comment on
   `apps/web/src/components/nav-progress.tsx`. Progress reads as a left-to-right axis
   whatever the language, the same reason `a-wizard`'s `StructureStrip` forces `dir="ltr"`
   on its timeline.

The through-line: **the dashboard glances, the wizard watches.** Someone on `/home` wants to
know that something is happening and roughly how far along; someone sitting on the render
step is watching it finish. A full bar on both is the wizard's answer applied where it was
not asked for.

## What this forecloses

- Do not add a progress bar back to `/home` "for consistency". The tile IS the progress
  surface there.
- Do not convert the physical `left-0` anchors to logical `start-0` as an RTL correctness
  fix. `start-0` resolves to the RIGHT edge under `dir="rtl"` and silently reverses all of
  this. The keyframe percentages are measured against a `w-1/3` element on the physical
  left; changing either without the other breaks the sweep.
- `WizardNav`'s mobile bar and the onboarding header still fill from the RTL start. Those
  are step counters, not progress, and were deliberately left alone.

## The honesty constraints that survived all three rounds

Unchanged, and not up for redesign along with the styling:

- The percentage only ever comes from `renderMedia`'s frame loop, and only the head render
  has it (`pickActiveHead`). Tiles behind it show their status word, not a number.
- No percent is invented, and none is latched — a retry clears the checkpoint, and the
  surface falls back to indeterminate rather than holding a stale value.
- When nothing is claiming the job, the shimmer stops on every tile and the amber line says
  so. Motion and copy must never contradict. See [[0009-retry-backoff-is-invisible-to-the-customer]]
  for what deliberately does NOT get said.
