---
type: decision
status: verified
verified: 2026-10-02
method: "Founder decision D5 in the 2026-10-02 task prompt (section 2), and his message approving the plan the same day, which amended it ('Record D5 as can watch, not watches') and added the marking of risky steps with a draft Hebrew line. The signal's numbers are facts/clip-placement-replay-2026-10-02.md."
source: founder + code
---

# 0085 — A generated draft may show two pages in one step, and the editor says which

Decided 2026-10-02, built the same day on `feat/steps-fixed-2s-clips`. Tags: **FOUNDER-DECIDED**,
**PROPOSED → APPROVED**, **MEASURED**.

## The decision (FOUNDER-DECIDED)

**D5, task prompt:** a generated draft may sometimes include a step with a flash of the next
screen; the customer watches each step's clip before approving.

- **His reason:** the alternatives were failed analyses or no plan.

**Amended when he approved the plan, the same day:** D5 is recorded as "the customer **can**
watch", not "watches". The plan had reported that the editor only offers a play button and that
nothing forces a watch before approving. His addition:

> So mark the risky steps: a step whose clip likely shows two pages (your rule 3a count above
> zero, or a better signal you propose) gets an amber line asking the customer to watch it before
> approving. Draft: «ייתכן שרואים כאן שני מסכים — צפו בצעד לפני האישור.» Only on steps in a plan,
> never on inventory tiles (0064).

## As built

- **The signal is his: rule 3a above zero.** A clip is marked when it is not calm and it crosses,
  inside it or within 0.2 s of either end, at least one instant at which the analysis itself also
  saw a different page ([[0084-clips-are-placed-from-the-footage-instants]]). With no instants
  stored, the analysis alone decides: a later moment inside the clip that it put on a different
  page.
- **MEASURED on the five takes:** it marks 70 of the 536 pickable clips. Of the 35 that hold a
  keyed real change it marks 31 and misses 4. By frames, 37 non-calm clips hold a real flip, and
  33 of them are marked. Other signals tried: an instant of any kind inside the clip marks 373 and
  misses 1; a confirmed instant strictly inside (no margin) marks 55 and misses 8. No better one
  was found, so his was kept.
- **Where it shows:** the amber line «ייתכן שרואים כאן שני מסכים — צפו בצעד לפני האישור.» under a
  step card in the plan editor, while the plan is not approved. Never on an inventory tile
  ([[0064-the-inventory-is-one-tier]]). The flag is stored on the step (`twoPages`), so the line
  stays with the clip the customer saw.
- **The model is told too.** Each moment it is shown carries `twoPages` when set, and v16 asks it
  to avoid such a moment unless nothing else shows that part of the journey.
- **The preview is the clip.** The editor's player used to stop on a browser timer that ticks
  about four times a second, so a preview could run up to 0.25 s past its clip — further than the
  0.2 s a calm clip keeps from the next change. It now seeks to the clip's first frame and stops on
  its last, per presented frame (`apps/web/src/components/a-wizard/clip-player.tsx`).

## What it leaves

- Nothing forces the customer to watch a step. He chose a line that asks, not a gate.
- 4 of the 35 clips that hold a keyed change carry no line: the analysis did not see those changes
  either ([[a-missed-screen-change-lets-a-step-run-into-the-next-screen]]).
- 39 marked clips hold no keyed change. The line says "ייתכן" (may).

## Related

- [[0076-every-step-is-a-fixed-2s-window-inside-its-screen]]
- [[clip-placement-replay-2026-10-02]]
