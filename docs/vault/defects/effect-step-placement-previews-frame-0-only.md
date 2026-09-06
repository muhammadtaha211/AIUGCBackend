---
type: defect
status: verified
verified: 2026-09-05
method: "read apps/web/src/components/b-wizard/step-effect.tsx (the placement editor mounts a paused <video> of the opener — first frame only, no scrubbing) against decision 0019, under which the hook text stays on screen past the reveal"
source: code
---

# The effect step lets the customer place the hook text against the opener's first frame only

Retired 2026-09-06 ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]): the opener step and 0019 are gone — the hook text is centred over the one HeyGen clip until speech passes its last word, and the step offers animation effects (zoom hook, none). Kept for the record: under 0019 the text stayed for its read time over the talking head after the cut, and the wizard's effect step showed the rect over the opener's first frame — the palm — only.
The wizard's effect step shows the rect over the opener's **first frame** — the palm — so the
customer never sees where the line lands once the face is there. On the first real render the
customer's rect (y 768–1241) put the line across her chest; a rect placed higher would cover
her face.

## Fix shape (not built)

Moot since 2026-09-06: no opener, no reveal frame. The effects step that replaces the opener step ([[0023-hook-is-a-remotion-animation-opener-clips-retired]], still to build) previews over the HeyGen clip, and the text is centred — no placement against a palm exists. — or constrain the customer's placement to the
bank rect's band. Either is a wizard task; neither is scheduled.

## Related

- [[0019-hook-text-outlives-the-reveal]]
