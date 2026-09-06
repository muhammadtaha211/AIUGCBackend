---
type: decision
status: superseded
verified: 2026-09-05
method: "founder in chat, 2026-09-05, on watching the first real opener render (video_renders 1397ffcd…) and a free re-render of the same take: 'the hold: Kill it'"
source: founder
---

# 0019 — Nothing is frozen: the opener plays from frame 0 and the hook text outlives the reveal

> **Superseded 2026-09-06 by [[0023-hook-is-a-remotion-animation-opener-clips-retired]]** — the opener and its reveal are retired. What survives:
> nothing is ever frozen; the hook text burns from frame 0. What replaces the read-time rule: the text
> stays centred until speech has passed its last word and the captions take over from the next line
> (not yet in `serviceBTimeline`).

Amends one sentence of [[0017-service-b-single-setting-selfie-talking-head]] — "the hook text
burns over the clip during the palm phase and hard-cuts at the reveal". The **video** cut is
unchanged and still hard. The **text** now lives its own life.

## What the founder saw

The first real render froze the opener's first frame — a palm over the lens — for 2.4 seconds
under the hook text, with digital silence, because the clip's covered phase (433ms) was far
shorter than any readable hook (1200–2500ms). His words: "2 seconds of the first frame frozen,
no audio no video playing … just the frame where she has her hand covering the camera".
Measured: frames 0–72 identical, silence to 3.11s ([[service-b-timeline-constants]]).

## Options offered

1. Shorten the hold (credit the palm phase against the read time). Still ~1.7s frozen on the
   real clip.
2. Keep a hold but put handheld camera motion over it, so the still reads as "holding the
   pose". The person is still frozen.
3. Slow down or loop the palm phase to cover the read time. Visible slow-motion on a hand.
4. Ask for bank clips whose covered phase is ≥ 2.5s. Asset-side; every future short clip
   freezes again.
5. **Kill the hold**: the opener plays from its first frame; the hook text stays from frame 0
   for `max(clamp(readTimeMs(text), 1200, 2500), reveal_at_ms)` — its read time, never leaving
   while the palm still covers the face — over the talking head if that outlives the cut.

## Decided

Option 5. Reason: it removes the defect class — the composition can no longer freeze a human,
whatever the asset. The cost, the hook text sitting over the talking head's chest for a second
or so after the cut, is what real UGC ads do. The karaoke captions wait for the hook text to
leave (one text element at a time; the first spoken chunk usually repeats the on-screen line)
— and the founder has now ruled how (2026-09-06, on the first zoom-hook mock): the hook text stays centred until speech has passed its last word, and the captions take over from the next caption line — [[0023-hook-is-a-remotion-animation-opener-clips-retired]]. Not yet in `serviceBTimeline`.

## Consequences in the tree

- `serviceBTimeline`: `holdMs` → `hookTextMs`; `revealAbsMs = reveal_at_ms`;
  `HOLD_MIN/MAX_MS` → `HOOK_TEXT_MIN/MAX_MS` (values unchanged, 1200/2500 — still chosen, not
  measured).
- `ServiceB.tsx`: no `<Freeze>` of the first frame; the opener Sequence runs 0 → reveal; the
  `HookLine` Sequence runs 0 → hookTextMs; `<Captions>` mounts from hookTextMs.
- The wizard's effect step previews the hook rect over the opener's first frame only, so a
  customer places it against a palm and it lands on the talking head unseen —
  [[effect-step-placement-previews-frame-0-only]].
- Retired 2026-09-06: there is no palm phase — the only leading silence is the 800ms lead-in — and the zoom hook's wind whoosh is baked into the export; the founder ruled a whoosh is not music, so locked decision #7 is untouched ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]).

Retired 2026-09-06 with the opener step ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]); the effects step that replaces it has no opener to preview over — check it against [[effect-step-placement-previews-frame-0-only]] when built.

- The opener Sequence, `revealAbsMs` and the `reveal_at_ms` floor are **retired 2026-09-06** and still in the tree; the `hookTextMs` read-time rule is to be replaced by the speech-tied handoff — [[0023-hook-is-a-remotion-animation-opener-clips-retired]].

## Related

- [[0017-service-b-single-setting-selfie-talking-head]] — amended
- [[service-b-timeline-constants]] — the first-render measurements that triggered this
- [[handheld-sway-constants]] — the camera motion decided alongside
