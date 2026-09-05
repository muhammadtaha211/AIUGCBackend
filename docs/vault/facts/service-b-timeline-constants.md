---
type: fact
status: verified
verified: 2026-09-05
method: "constants read off packages/core/src/service-b-timeline.ts (the only place they are written; the composition receives them as props); values chosen by the founder in chat 2026-09-05 — no measurement of any kind behind any of them"
source: founder + code
---

# The Service B timeline constants — every one reasoned, none measured

`packages/core/src/service-b-timeline.ts` is the one place these are written. `buildServiceBProps`
computes the layout there and passes it (plus the three effect constants) to the `ServiceB`
composition, which only converts milliseconds to frames. `serviceBTimeline` is unit-tested in
`packages/core/test/service-b-timeline.test.ts`; the Remotion preview fixtures mirror its output
as literals and that test pins them.

| constant           | value | what it does                                                                                  | provenance                    |
| ------------------ | ----- | --------------------------------------------------------------------------------------------- | ----------------------------- |
| `GAP_MS`           | 250   | silence between the reveal cut and the first spoken word; the clip starts `leadInMs − GAP` in | **reasoned** (chosen in chat) |
| `HOLD_MIN_MS`      | 1200  | floor on how long the opener's first frame freezes under the hook text                        | **reasoned** (chosen in chat) |
| `HOLD_MAX_MS`      | 2500  | ceiling on the same hold                                                                      | **reasoned** (chosen in chat) |
| `CROSSFADE_FRAMES` | 5     | the opener→talking-head dissolve, centred on the reveal (2 frames before, 3 after)            | **reasoned** (chosen in chat) |
| `PUNCH_IN_SCALE`   | 1.06  | the talking head's scale after the reveal, held                                               | **reasoned** (chosen in chat) |
| `PUNCH_IN_MS`      | 300   | how long the punch-in takes from the reveal                                                   | **reasoned** (chosen in chat) |

The hold itself is `clamp(readTimeMs(hookText), HOLD_MIN_MS, HOLD_MAX_MS)` — `readTimeMs` is
`plan-format.ts`'s step-label reading-time guess (400ms + words / 2.5 wps), which its own
comment labels "A GUESS ... nobody has measured Israeli viewers reading these". A 3-word hook
text holds 1600ms; 4 words hold 2000ms; anything from 6 words up hits the 2500ms ceiling.

## What this note does NOT say

- That any of these values is right. No viewer has watched an opener render; the only render
  that exists is `packages/remotion/out/sample-b-opener.mp4` over a synthetic lavfi clip
  (2026-09-05, frames extracted and checked by eye for the hold, the cut and the caption
  onset — mechanics, not taste).
- That `GAP_MS` is the right distance from the reveal to speech. It rests on
  [[heygen-avatar-iv-idles-on-leading-silence]], whose tolerance is unmeasured; the lead-in
  default (800ms, `lipsync_lead_in_ms`) and this gap have never been tuned together.

The first real render on a real opener clip is where any of these gets a second column.

## Related

- [[0017-service-b-single-setting-selfie-talking-head]] — the format the timeline implements
- [[heygen-avatar-iv-idles-on-leading-silence]] — why the lead-in and the gap exist
