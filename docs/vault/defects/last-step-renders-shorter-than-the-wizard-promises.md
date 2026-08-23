---
type: defect
status: verified
verified: 2026-08-23
method: "read packages/core/src/pipelines/demo-step-plans.ts:799-810 and renders.ts:598; compared every stored plan's last step against its demo's duration_ms (read-only) — all 12 currently fit"
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
is the floor, `MIN_STEP_MS = 3000` ([[steps-format-defaults-are-code-constants]]).

**Nothing between that number and the render ever compares it against the demo's own length.**
`updatePlanSteps` calls `assembleSteps` without loading the demo row at all; the plan API route
never references `durationMs`; and `buildServiceAStepsProps` passes the stored value straight
through (`packages/core/src/pipelines/renders.ts:598`). The wizard then displays that same stored
number, and the confirm screen sums it into the total runtime the customer approves.

The source video does not care. If the last step starts 1.2s before the recording ends, the
composition has 1.2s of footage to show for a step billed and displayed at 3.0s.

## Nobody has hit it — yet

I checked every stored plan and every steps-format render against its demo's `duration_ms`. **All 12
plan rows with steps and all 6 steps renders have negative overrun** — every last step fits, with
room to spare. The two demos that have plans have comfortable tails: last step at 45,000 ms of an
88,089 ms recording, and 51,400 ms of 57,498 ms.

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
was truncated. It is a correctness bug in the number the product asks the customer to agree to,
which is the same class as a wrong price — small in seconds, not small in kind.

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
