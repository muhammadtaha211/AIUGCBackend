---
type: decision
status: verified
verified: 2026-10-01
method: "Founder statement in chat, 2026-10-01 (that day's task prompt, section 2). The commit was read with `git log -S 'MIN_STEP_MS = 3000'` and `git show b60b5b6 -- packages/core/src/pipelines/demo-step-plans.ts` (2026-10-01)."
source: founder + code
---

# 0071 — The 3 s step floor was an undecided default

**FOUNDER-REPORTED, 2026-10-01:** the founder does not recall deciding the step floor's move from
1400 ms to 3000 ms. So it is treated as an undecided default, not a decision.

**MEASURED:** the move is `b60b5b6` (2026-08-23), whose subject advertises "introduce a_steps_max
configuration and enhance readTimeMs logic". The same diff took `MIN_STEP_MS` 1400 → 3000, the band
11–16 s → 16–21 s, and the step cap 8 → 7 ([[steps-format-defaults-are-code-constants]]).

## What it supersedes

[[0002-runtime-band-floor-is-15s]]'s sentence "The uniform-3s pacing (every step exactly the floor)
stands as the format's shipped behaviour" — that sentence only. The rest of 0002 stands: the band
floor is 15 s and the reason (never force padding) still binds.

## What followed

With no decision behind the floor, [[0070-a-step-ends-on-a-real-screen-change]] could let steps
follow the footage, and [[0072-step-cap-no-padding-cut-early]] removed the floor outright: no step is
padded past its screen to reach a minimum.
