---
type: decision
status: verified
verified: 2026-10-01
method: "Founder decision in chat, 2026-10-01, recorded from that day's task prompt (section 2, 'Decided … not up for relitigation'); the reasons are his. Implemented and measured on feat/steps-end-on-screen-change, branched from origin/main 67448de; the measurement is facts/screen-change-signal-2026-10-01.md and facts/stored-plans-under-the-screen-rule-2026-10-01.md."
source: founder
---

# 0070 — A step ends on a real screen change

> **2026-10-02 — BUILT, and one line below no longer holds:** every step is now a fixed 2 s clip
> placed from the footage instants ([[0076-every-step-is-a-fixed-2s-window-inside-its-screen]],
> [[0084-clips-are-placed-from-the-footage-instants]]). No clip is cut at a screen change any
> more. **"A step never runs into the next screen" is no longer a rule:** a generated draft may
> hold a clip that shows two pages, and the editor marks it
> ([[0085-a-draft-may-show-two-pages-and-says-so]], founder D5). The analysis's page judgement
> below survives as a ranking between clips and as the bound of the access pin's run.

> **2026-10-02 — decided, NOT YET BUILT:** "'Same screen' is the analysis model's judgement, not
> pixel distance alone … never a frame hash" below is amended by
> [[0078-screen-changes-come-from-the-footage-first]]: real screen changes come from the footage
> first and repeat for the same file, with the model only where the footage cannot tell. The
> definitions here stay. Measured the same day: the footage finds when the picture changes and
> cannot tell what kind of change it is ([[footage-screen-changes-2026-10-02]]), and the vision
> call that was to tell it did not pass its test ([[label-call-test-2026-10-02]]). Until something
> is built the code runs this decision as written.

> **2026-10-01 — decided, NOT YET BUILT:** "Step length follows the footage" is superseded by
> [[0076-every-step-is-a-fixed-2s-window-inside-its-screen]]. Every step becomes a fixed 2 s
> window inside its screen, slid earlier near the screen's end, and the step count becomes 5–10.
> **"A step never runs into the next screen" stays.** Two lines below now read against 0076:
>
> - "10 steps × 2 s is dropped as a target" — 0076 sets 5–10 steps of 2 s each;
> - the 15–21 s band listed as unchanged — 0076 retires it.
>
> See also [[0075-more-moments-over-fewer]]. Until 0076 is built the code runs this decision as
> written.

Decided 2026-10-01. Every item below is **FOUNDER-DECIDED** (his task prompt, not up for
relitigation), except where a line says otherwise. How the code implements it, and the numbers, are
[[0072-step-cap-no-padding-cut-early]].

## The decision

In a steps-format ad each step shows one screen. Its clip starts at the picked moment and ends when
the app moves to a different screen, or at the cap, whichever comes first. It never runs on into the
next screen. The length the wizard shows, the confirm total and the rendered frames are the same
number.

- **A step ends only on a real screen change.** A popup that belongs to the flow, typing, and
  scrolling down the same page all stay inside the step. Reason: the fixed-length clips ran past the
  screen change and the ad jumped. **MEASURED** before the change: 24 of the 95 stored plan steps ran
  past a real screen change, by 0.4 to 2.6 s, and 12 released renders carry such a jump
  ([[stored-plans-under-the-screen-rule-2026-10-01]]).
- **"Same screen" is the analysis model's judgement, not pixel distance alone.** Reason: a scroll
  changes most of the frame and is still the same step. The code reads the model's own fields —
  `actionType`, `screenName`, `visibleText`, `sameStateAsPrevious` — and never a frame hash.
- **"10 steps × 2 s" is dropped as a target.** Step length follows the footage; the step count
  floats inside the existing bounds.
- **The customer's remedy for a bad cut is deleting the step or picking another moment.** There are
  no trim controls.
- **CLAUDE.md locked decision #1 is amended** to: "One format for Service A. No timeline editor.
  Steps are cut automatically from the analysis; the customer picks and captions moments, never
  trims." Reason: the analysis has detected screen changes since the steps format shipped; the old
  "No automatic scene detection" wording was stale.

## What this does not change

The 15–21 s runtime band ([[0002-runtime-band-floor-is-15s]]), the analyze_demo prompt and its
version, frame clustering and its thresholds, the inventory ([[0064-the-inventory-is-one-tier]]),
label provenance ([[0049-the-label-provenance-rule-is-a-highlight-not-a-gate]]), the refilm gate
([[0069-the-refilm-gate-counts-unreadable-only]]), credits and pricing. Stored plans keep the
durations they were saved with until someone edits them; nothing was rewritten or backfilled.

## Related

- [[0071-the-3s-step-floor-was-an-undecided-default]] — why the 3 s floor could go.
- [[0072-step-cap-no-padding-cut-early]] — the cap, no padding, cut early, and the signal.
- [[last-step-renders-shorter-than-the-wizard-promises]] — fixed by the same change.
