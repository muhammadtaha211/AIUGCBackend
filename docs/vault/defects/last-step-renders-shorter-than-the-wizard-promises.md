---
type: defect
status: verified
verified: 2026-10-01
method: "2026-10-01: read assembleSteps, handlePlanDemoSteps and updatePlanSteps on feat/steps-end-on-screen-change (the FIXED section). Originally: read packages/core/src/pipelines/demo-step-plans.ts:799-810 and renders.ts:598; compared every stored plan's last step against its demo's duration_ms (read-only) — all 12 currently fit"
source: code
---

# The last step can render shorter than the duration the customer approved

## The mechanism

`assembleSteps` gives every step the gap to its neighbour as a ceiling. The last step has no
neighbour, so it gets no ceiling at all:

```ts
// packages/core/src/pipelines/demo-step-plans.ts:801
const room = next ? next.timestampMs - step.timestampMs : Number.POSITIVE_INFINITY;
```

The comment two lines up states the intent — "the last step gets what it asks for". What it asks for
is `clamp(max(byActionType[kind], readTimeMs(label)), minMs, maxMs)`. For plans generated **from now
on** that is the floor, `MIN_STEP_MS = 3000` ([[steps-format-defaults-are-code-constants]]). Every
last step currently stored is **2800** — the `result` kind's own default — because all ten plans
predate `b60b5b6`, when the floor was 1400 and did not bind.

**Nothing between that number and the render ever compares it against the demo's own length.**
`updatePlanSteps` calls `assembleSteps` without loading the demo row at all; the plan API route
never references `durationMs`; and `buildServiceAStepsProps` passes the stored value straight
through (`packages/core/src/pipelines/renders.ts:598`). The wizard then displays that same stored
number, and the confirm screen sums it into the total runtime the customer approves.

The source video does not care. If the last step starts 1.2s before the recording ends, the
composition has 1.2s of footage to show for a step billed and displayed at 3.0s.

## Nobody has hit it — yet

I checked every stored plan against its demo's `duration_ms`. Of the 19 plan rows, **10 carry a
non-empty `steps` array** (the other 9 are `failed` with `steps = null`), and **all 10 have negative
overrun** — every last step fits. The tightest is plan `0d1b5f41` on demo `3828bab7`: last step
starts at 51,400 ms, runs 2,800 ms, against a 57,498 ms recording — **3,298 ms of slack.** All 6
steps-format renders are among those 10.

It is one recording away. Demos `ee69edfa`, `724d68df` and `ba70c3d7` are all the 122,561 ms
BotTeacher study-app recording, whose **last analysed state sits at 121,400 ms — 1,161 ms of tail**
against a 3,000 ms step. Any plan that ends on that state loses 1.8s silently. That recording is
already in the repo as a regress fixture.

## What `b60b5b6` did and did not do

It did **not** make the trigger much likelier. The last step is normally a `result` state, whose
per-kind default was already 2,800 ms, so raising `MIN_STEP_MS` from 1,400 to 3,000 moved the
required tail from 2,800 ms to 3,000 ms — 200 ms. The floor only bites hard when the ending is some
other kind.

It did make the **consequence** worse: `MIN_RUNTIME_MS` went 11,000 → 16,000, so a silent 1–2s loss
now eats into a certified floor that is 5 seconds higher, and the confirm screen promises a bigger
number to be wrong about.

## Blast radius

A customer approves "20.5s" and gets 18.7s, with no warning anywhere and no way to tell which step
was truncated.

**It is not a billing defect.** `quoteStepsASet` (`packages/core/src/pipelines/sets.ts:268`, called
at `:206`) prices a steps set flat, without reading runtime at all
([[credit-costs-row]]) — so nobody is overcharged per second. The harm is consent: the number the
product asks the customer to agree to is not the number it delivers.

**There is a second consequence nobody would look for.** The wizard's legibility warning is computed
from the same overstated duration — `stepHeadroomMs(step) = step.durationMs - readTimeMs(step.label)`
(`apps/web/src/lib/service-a-ui.ts:583-584`), consumed at
`apps/web/src/components/a-wizard/step-plan.tsx:774`. A last step that renders 1.2 s can therefore
pass the "caption outlasts its read time" check computed against 3.0 s. The customer is told the
caption is readable when the shipped frames do not give it time to be read.

## Fix shape

One line. Give `assembleSteps` the demo's length and use it as the last step's `room`:

```ts
const room = next ? next.timestampMs - step.timestampMs : demoDurationMs - step.timestampMs;
```

The existing `Math.min(..., room)` at `:807` then produces the truthful number, which flows for free
into the wizard, the total runtime and the confirm screen. The caller already has the demo row on
the generate path; `updatePlanSteps` would need it passed in.

Worth pairing with a runtime-band check: a truncated last step can drop the total below
`MIN_RUNTIME_MS`, and today nothing notices.

## FIXED — 2026-10-01, feat/steps-end-on-screen-change

**MEASURED** in the tree. `assembleSteps` no longer gives the last step unlimited room. Every step now
ends at `min(its screen's end, the 4 s cap, the recording's end, the next selected state)`
([[0070-a-step-ends-on-a-real-screen-change]], [[0072-step-cap-no-padding-cut-early]]). The
recording end is `max(floor(demos.duration_ms / sample) · sample, last state + 1 sample)`. Both
callers now pass it:

- the generation path, from the demo row `handlePlanDemoSteps` already loads;
- `updatePlanSteps`, which now loads the demo row itself.

So the wizard's numbers, the confirm total and the rendered frames agree. A test pins this through
`serviceAStepsTimeline`. **The local re-render of plan ca8d5b72** came to 94 hook frames + 498 step
frames, exactly its 16.6 s plan total.

The runtime-band pairing suggested above is in: the band and its reachability escape run on the
assembled lengths. **Stored plans keep their old durations until edited**, so the Remotion end clamp
stays in place as the net for them.
