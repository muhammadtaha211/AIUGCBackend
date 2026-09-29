---
paths:
  - "packages/remotion/**"
  - "apps/web/src/components/b-wizard/**"
  - "apps/web/src/lib/service-b*.ts"
  - "apps/web/src/app/home/b/**"
  - "apps/web/src/app/api/businesses/*/renders/**"
  - "apps/web/src/app/api/businesses/*/scripts/**"
  - "apps/web/src/app/api/personas/**"
  - "apps/web/src/lib/persona-catalog.ts"
  - "apps/web/test/service-b*.test.ts"
  - "apps/admin/src/app/*/personas/**"
  - "apps/admin/src/lib/admin.ts"
  - "apps/cli/src/index.ts"
  - "packages/core/src/hook-effect.ts"
  - "packages/core/src/hook-text.ts"
  - "packages/core/src/service-b-timeline.ts"
  - "packages/core/src/db/schema.ts"
  - "packages/core/src/media/grade.ts"
  - "packages/core/src/providers/lipsync.ts"
  - "packages/core/src/providers/remotion.ts"
  - "packages/core/src/pipelines/bank.ts"
  - "packages/core/src/pipelines/copy.ts"
  - "packages/core/src/pipelines/renders.ts"
  - "packages/core/src/pipelines/sets.ts"
  - "packages/core/test/service-b-timeline.test.ts"
  - "packages/core/test/hook-effect.test.ts"
  - "packages/core/test/hook-text.test.ts"
  - "packages/core/test/lipsync*.test.ts"
  - "prompts/b_script/**"
  - "prompts/hook_text/**"
  - "assets/sfx/**"
---

# Service B — the talking-head pipeline

Moved out of CLAUDE.md's "What we're building" on 2026-09-29. It loads when you touch the B
pipeline, `packages/remotion` or the B wizard. The format decisions are in `docs/vault/decisions/`:
`0017-service-b-single-setting-selfie-talking-head.md` (the selfie talking head),
`0022-heygen-expressiveness-medium-generic-motion-prompt.md` (the engine settings),
`0023-hook-is-a-remotion-animation-opener-clips-retired.md` (the hook) and
`0024-hook-effect-is-a-render-param-the-customer-picks.md` (the three animations and how the name
travels).

## Personas and the render

- 5–10 consistent generated personas. Each has a pinned ElevenLabs voice and one default **selfie**
  reference image (`persona_images.kind='selfie'`). A render resolved from a persona's default
  refuses any other kind; an explicit image or an approved composite bypasses that.
- A render is that single image plus ElevenLabs V3 audio with ~800ms of leading silence prepended
  (`lipsync_lead_in_ms`, pinned on `params.leadInMs`). It goes through HeyGen lip-sync at
  `expressiveness` **medium** with a generic, hand-free motion prompt (`app_config` rows, migration
  0034; vault 0022). HeyGen ignores staged actions in the prompt, and `high` read as fake and
  hallucinated a prop.
- **One clip, start to finish; nothing is ever stitched in front of it.**

## The hook animation (vault 0023, 0024)

- The hook is a **Remotion animation** the composition performs on that clip, under the customer's
  burned **hook text**.
- The customer picks one by NAME in the wizard's effect step. `hookEffect` is one of:
  - `none`
  - `zoom`: opens tight at 1.35→1.42×, eases to full frame
  - `focus`: opens blurred, pulls sharp
  - `whip`: slides in under a directional blur
- The name travels route → `createBRender` → `params.hookEffect` → `buildServiceBProps`, which turns
  it into the tuned numbers and the composition prop.
- The numbers live in `hook-effect.ts` and NEVER in the DB, so a retune is a deploy. They moved out
  of `pipelines/renders.ts` on 2026-09-06 so the wizard's preview animates the same values the
  render burns (vault 0026).
- Two of the animations carry a soft SFX from `assets/sfx/`. Both files are synthesized placeholders.
  An SFX is not music: founder ruling on locked decision 7.
- The animations are clocked off SPEECH ONSET, not frame 0 (`HOOK_LANDS_AFTER_SPEECH_MS`), because
  every mock the founder judged ran at an 800ms gap and production's `GAP_MS` is 250.
- The hook text comes with an animation and never alone; `none` burns no line, exactly as "no
  opener" did. The text stays centred until speech has passed its last word, then the captions take
  over from the next caption line (`hookHandoffMs` in `serviceBTimeline`). An unspoken line stays
  for its read time and still leaves on a chunk boundary.
- Two more animations were built and NOT picked: emphasis punches (`hookBeats`, rejected) and
  kinetic hook text (`hookTextReveal`, no verdict). Their props exist in `packages/remotion` with no
  name in `hook-effect.ts`, so nothing can reach them.
- The whole picture rides a seeded handheld camera path.
- `b_script` (v9+) emits the draft `hook_text` with the script. The FINAL string is copied into the
  render params at enqueue, never pointed at (vault 0017).
- The layout is `serviceBTimeline` in core. The composition converts it to frames and drives the
  hook animation (`hookZoomScale` / `hookFocusState` / `hookWhipState` in
  `packages/remotion/src/timing.ts`).

## The web wizard (`apps/web/src/components/b-wizard`)

- The steps are persona → pointers → script → audio → effect → render.
- The effect step places the animation and its hook text over the persona's selfie. It PLAYS the
  real animation once and then offers a replay button (`hook-effect-preview.tsx`, vault 0026).
- There is no image step, no product step: the persona card shows its selfie via `personaSelfie` in
  `apps/web/src/lib/service-b.ts`, the one resolver for both the card and the render source.
- The wizard sends that image's id with the render, and the render route refuses anything that is
  not that persona's live selfie. Nothing on the customer path depends on `is_default`.

## Retired 2026-09-06 (vault 0023) — do not build on it

- The opener-clip bank (`opener_clips`, `bank add-opener`).
- The hard cut at `reveal_at_ms`.
- The seam colour grade and pixel alignment (vault 0021, `facts/service-b-seam-constants.md`).
- The wizard's opener step.

The code is still in the tree, reachable only from the CLI's `render-b --opener`.
