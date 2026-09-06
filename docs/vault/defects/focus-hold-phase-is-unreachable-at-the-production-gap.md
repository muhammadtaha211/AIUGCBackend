---
type: defect
status: verified
verified: 2026-09-06
method: "apps/cli/node_modules/.bin/tsx packages/core/.work/hook-anim-check.ts — hookAnimation('focus', GAP_MS) returns {blurPx: 20, holdMs: 0, durationMs: 650} for GAP_MS 250; hookAnimation('focus', 900) returns holdMs 450, durationMs 850. Pinned both ways in packages/core/test/hook-effect.test.ts."
source: code
---

# The focus effect has no held-blur phase in production, and `HOOK_FOCUS.pullMs` never applies

The mock the founder judged was `FOCUS="20,350,850"` — blur 20px **held for
350ms**, then a pull sharp over 850ms
([[service-b-hook-animation-mocks-2026-09-06]]). What ships is neither number.

`hookAnimation` derives the pull from the silence available:

```
landsAtMs  = captionOffsetMs + HOOK_LANDS_AFTER_SPEECH_MS
durationMs = max(1, min(HOOK_FOCUS.pullMs, landsAtMs))
holdMs     = landsAtMs - durationMs
```

`captionOffsetMs` is `min(leadInMs, GAP_MS)` with no opener, so it is **always
250** — `GAP_MS` — for every render at `lipsync_lead_in_ms` 800. Therefore
`landsAtMs` is always 650, `min(850, 650)` is always 650, and `holdMs` is always
**0**. The picture opens blurred and starts clearing on frame 1; the held
opening the founder actually watched never happens, and `HOOK_FOCUS.pullMs = 850`
is dead unless the gap grows past 450ms.

The same squeeze affects the zoom, though less visibly: judged at `atMs` 1200,
it lands at 650 and the whole move is over by 1.1s. That trade is documented and
deliberate (`HOOK_LANDS_AFTER_SPEECH_MS`: hold the 400ms-after-speech
relationship, let the run-up take whatever silence the gap leaves). The focus is
the case where the trade silently deletes a phase rather than shortening one.

## Why it is not fixed here

Retuning is the founder's call and now costs one edit
(`packages/core/src/hook-effect.ts` — [[0026-the-effect-step-plays-the-real-animation-not-a-canned-clip]]).
Since 2026-09-06 he can also just watch it: the wizard's effect step plays the
production timing on his own persona. The three candidate fixes, cheapest first:
lower `HOOK_FOCUS.pullMs` to ~450 so a ~200ms hold survives at the real gap;
raise `GAP_MS`; or let the focus start before frame 0 conceptually by holding the
blur for a fixed slice of `landsAtMs` instead of taking the remainder.

## Related

- [[service-b-hook-animation-mocks-2026-09-06]]
- [[service-b-timeline-constants]]
- [[0024-hook-effect-is-a-render-param-the-customer-picks]]
