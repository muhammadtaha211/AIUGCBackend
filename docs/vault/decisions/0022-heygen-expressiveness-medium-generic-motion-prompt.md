---
type: decision
status: verified
verified: 2026-09-06
method: "founder in chat, 2026-09-06, after watching the two paid draws of [[heygen-motion-prompt-two-draws]]: on take 1 (expressiveness high) 'that's way too much, I don't like expressiveness set to high' and 'looks way too fake'; on take 2 (medium) 'medium looks natural, I like it, but the model does not respond to any out of the box movement like asking it to cover the camera or anything like that, but I do like the little extra expressiveness from medium so maybe make the motion prompt something generic with expressiveness set to medium'"
source: founder
---

# 0022 — HeyGen renders at expressiveness `medium` with a generic motion prompt

**Founder-decided.** Every Service B HeyGen submit sends `expressiveness: "medium"` and a
generic motion prompt that asks for nothing staged and names no hands. Both live in
`app_config` (`lipsync_expressiveness`, `lipsync_motion_prompt`), read by `handleLipsync`
(`packages/core/src/pipelines/renders.ts`); a render param still overrides them, as before.

## The options as they stood

1. Unset expressiveness, the app_config prompt "gestures casually with one hand while talking,
   warm smile" — the 2026-09-05 baseline every seam mock used. Stiff by the founder's eye.
2. `high` with an "engagement" prompt — **rejected**: "way too much", "looks way too fake";
   it also doubled the motion and hallucinated a red clutch bag into her hand for 23 frames.
3. `medium` — **chosen**: "looks natural, I like it… the little extra expressiveness".
4. Staged actions in the prompt (a palm over the lens as a self-made opener) — **dead**: the
   model ignored it entirely, a small wave instead. HeyGen's image mode does not perform
   directions; the prompt only sets a temperature.

## The prompt

"Speaks naturally to the camera with a warm, relaxed expression, small natural head movements,
steady eye contact." Generic on purpose: no gestures, no props, no hands, no actions — the hand
line in take 1 is the likeliest cause of the bag ([[heygen-motion-prompt-two-draws]]).

## What it does not change

The head still idles through the leading silence and starts moving at 0.60s at every level
tried (unset, medium, high) — [[heygen-head-moves-before-speech-onset]] — so the lead-in and the
cut timing are untouched. Config keys stay provisional under
[[0004-service-b-config-is-provisional]] in the sense that a row edit, not a deploy, changes
them; these two now carry a founder-chosen value instead of a placeholder.

## Related

- [[heygen-motion-prompt-two-draws]] — the measurements behind the choice
- [[heygen-avatar-iv-idles-on-leading-silence]] — the idle, now tested at three levels
- [[0021-nothing-moves-at-the-service-b-seam]]
