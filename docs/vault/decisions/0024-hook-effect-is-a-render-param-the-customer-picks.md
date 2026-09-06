---
type: decision
status: verified
verified: 2026-09-06
method: "founder in chat, 2026-09-06, after watching four free mocks on the stored medium HeyGen take ([[service-b-hook-animation-mocks-2026-09-06]]): 'I really like 1 and 2, i didnt like the punches, I also liked the zoom in from the previous session' and 'make all 3 of these effects available for the user to pick in the wizard'"
source: founder
---

# 0024 — `hookEffect`: three animations plus "none", picked in the wizard

**Founder-decided.** The Service B wizard's effect step offers four options and
the render carries the chosen one as a **name**:

| name    | Hebrew     | what it does                                               |
| ------- | ---------- | ---------------------------------------------------------- |
| `none`  | ללא אפקט   | plain talking head, no burned line — today's behaviour     |
| `zoom`  | זום אחורה  | opens at 1.35× creeping to 1.42×, eases to full frame      |
| `focus` | פוקוס      | opens at 20px of blur, pulls sharp                         |
| `whip`  | כניסה מהצד | slides in 140px under a directional blur, settles in 420ms |

Rejected in the same message: the emphasis punches (`hookBeats`). No verdict
either way on the kinetic hook text (`hookTextReveal`) — its props stay in
`packages/remotion` with no name here, so it is unreachable from the product
until he asks for it.

## The shape

- **A name, never numbers.** `params.hookEffect` holds `"zoom" | "focus" |
"whip"`, absent for none. The tuned values live in
  `pipelines/renders.ts`, the vocabulary in `core/src/hook-effect.ts`, the
  Hebrew in `apps/web/src/lib/service-b-ui.ts`. Three homes, three audiences:
  a retune is a deploy, never a rewrite of every stored render's params.
  **No migration** — `video_renders.params` is bare jsonb.
- **The hook text comes with the animation, never alone** — the rule the
  opener had, re-pointed. `none` means no burned line, exactly as "no opener"
  did. If the founder wants a centred line with no animation, that is one line
  in two places (`renderRequestSchema`'s refine and `createBRender`'s pairing).
- **The rect defaults to `CENTRED_HOOK_TEXT_RECT`** {25, 768, 1055, 473} — the
  rect every judged mock burned in, centred rather than the opener's
  lower-third seed. The wizard's placement editor opens on the same constant,
  so preview and burn cannot disagree.

## The two rulings I made, and why

**1. Timing is clocked off speech, not off frame 0.** Every mock ran at a
cut-to-speech gap of 800ms; the pipeline's `GAP_MS` is 250. Pinning the judged
literals (`atMs` 1200) would put the whole move ~950ms into her talking instead
of the ~400ms he watched. So `HOOK_LANDS_AFTER_SPEECH_MS = 400` is the
constant, and the run-up takes whatever silence the gap leaves. Rendered free
at gap 250 and sent for confirmation
(`.work/seam-handover/prod-gap/rerender-none-2700-gap250-zoom.mp4`).

**2. The caption handoff is the timeline's, and it snaps to a chunk start.**
The founder's rule — the line stays until speech passes its last word, then the
captions start from the NEXT line — is now `hookHandoffMs` in
`service-b-timeline.ts`, not a scratch script. Only a line spoken in FULL
leaves on its last spoken word — hearing it is the reading. Anything less (the
customer edited the tail, the script call wrote a paraphrase, the pronunciation
map respelled a word — all ordinary) is partly unread, so it ALSO keeps the
clamped read-time floor and hands off at the first chunk boundary after
whichever comes later. Never mid-line either way.

That distinction was a real bug for one round: the first version applied the
floor only to a line with NO matching words, so a one-word coincidence — and
Hebrew UGC scripts open from a tiny set of words (אני, אז, זה) — dropped a
six-word line to ~1.4s, which is the "hands off at chunk 1 regardless"
behaviour this rule exists to avoid. An adversarial review of the diff caught
it and the repo's own test had pinned it as if it were correct.

## What this does NOT change

The opener path. `openerClipId`, the bank, the seam grade and alignment all
stay in the tree, CLI-only, refused in the same enqueue as an animation
([[0023-hook-is-a-remotion-animation-opener-clips-retired]] retired them;
removal is its own task). The QC gate, the credit debit, the price
(`quoteBRender` prices off audio length — an animation adds no GPU seconds and
no HeyGen call) and the persona/selfie rules are untouched.

## Related

- [[0023-hook-is-a-remotion-animation-opener-clips-retired]] — the format decision this implements
- [[service-b-hook-animation-mocks-2026-09-06]] — the four mocks and their numbers
- [[service-b-timeline-constants]] — GAP_MS, and the handoff that now sits beside it
- [[atomic-inline-words-reverse-a-latin-run-in-rtl]] — why the kinetic text needs work if it is ever picked
