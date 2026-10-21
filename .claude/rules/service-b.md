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
  - "packages/core/src/cutaway-structure.ts"
  - "packages/core/src/pipelines/cutaways.ts"
  - "packages/core/test/cutaway*.test.ts"
  - "apps/web/src/app/api/businesses/*/cutaway-plans/**"
  - "apps/web/test/cutaway*.test.ts"
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
`0023-hook-is-a-remotion-animation-opener-clips-retired.md` (the hook),
`0024-hook-effect-is-a-render-param-the-customer-picks.md` (the three animations and how the name
travels), `0121-service-b-demo-cutaways-and-no-sway.md` (the opt-in demo cutaways, no sway) and
`0122-service-b-clips-before-the-effect-first-cut-at-the-product-mention.md` (their order, draft and edits).

## Personas and the render

- 5–10 consistent generated personas. Each has a pinned ElevenLabs voice and one default **selfie**
  reference image (`persona_images.kind='selfie'`). A render resolved from a persona's default
  refuses any other kind; an explicit image or an approved composite bypasses that.
- A render is that single image plus ElevenLabs Eleven v4 audio (vault 0119) with ~800ms of leading silence prepended
  (`lipsync_lead_in_ms`, pinned on `params.leadInMs`). It goes through HeyGen lip-sync at the
  `expressiveness` and motion prompt in `app_config` (migration 0034 seeded **medium** and a generic,
  hand-free prompt, vault 0022; production reads **low** and a long stillness-first prompt since at
  least 2026-10-20, the founder's edits — `docs/vault/facts/app-config-live-state.md`). HeyGen
  ignores staged actions in the prompt, and `high` read as fake and hallucinated a prop.
- **One clip, start to finish; nothing is ever stitched in front of it.** Opt-in demo cutaways
  (below) cut away from the running clip and back; they never stop, restart or replace it.

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
- The picture holds still: no camera motion on any B render (vault 0120 §2, removed by 0121).
  `OVERSCAN` (1.06) stays a static scale, so the framing — and the wizard preview, which never
  simulated the sway — is unchanged.
- `b_script` (v9+) emits the draft `hook_text` with the script. The FINAL string is copied into the
  render params at enqueue, never pointed at (vault 0017).
- The layout is `serviceBTimeline` in core. The composition converts it to frames and drives the
  hook animation (`hookZoomScale` / `hookFocusState` / `hookWhipState` in
  `packages/remotion/src/timing.ts`).

## The web wizard (`apps/web/src/components/b-wizard`)

- The steps are persona → pointers → script → audio → effect → render, plus a **demo** step (the
  clips) between audio and effect only when the customer ticks the cutaway option on the audio card
  (vault 0121; before the effect since 0122, so the effect is set last).
- The effect step places the animation and its hook text over the persona's selfie. It PLAYS the
  real animation once and then offers a replay button (`hook-effect-preview.tsx`, vault 0026).
- There is no image step, and the only product input is the optional cutaway step: the persona
  card shows its selfie via `personaSelfie` in
  `apps/web/src/lib/service-b.ts`, the one resolver for both the card and the render source.
- The wizard sends that image's id with the render, and the render route refuses anything that is
  not that persona's live selfie. Nothing on the customer path depends on `is_default`.

## Demo cutaways (vault 0120 §4, 0121)

- **Opt-in, never the default.** An unticked checkbox on B's ready-audio card; off = today's six
  steps and today's request body, byte for byte. Ticked, the clips step comes right after the card.
- **Source:** the customer's analysed demo (Service A's inventory), reused free. The upload is A's
  own; B never charges `a_demo_analysis_credits` (0048) and the quote is unchanged.
- **Structure as data:** `none | alternate` in `packages/core/src/cutaway-structure.ts`, never in
  the DB (not the `structures` table). The structure is the DRAFT's rule (vault 0122):
  - The first cut is never before the phrase where the script first names the product
    (`productMention`: `product_name`, else the business name, else 40% of the voice — no model
    call), nor before the script's own hook text leaves; then the earliest chunk start within 5 s
    of that floor that lays out.
  - Cutaways are 4–6 s; head runs 1–5 s (5.5 s only when nothing fits under 5); at most 8 clips.
  - The ad ends on the head.
  - Cuts sit on chunk starts. A word start inside a line is used only when no chunk-start layout
    exists.
- **The customer's edits** (vault 0122) answer only to `cutawayEditError`: on spoken words, 4–6 s,
  after the hook text, inside the voice, no overlap in the script, no reused footage. Move a clip
  to any phrase, add one (the next unused stretch of the demo, no model call), remove one; zero
  clips is today's ad. A head run past ~5.5 s after the mention gets a one-line note, never a block.
- **Identity:** each clip has an `id` (1–8) — one letter and one colour on the script, its card and
  the picker.
- **Picks live on `cutaway_plans`** (0068), one row per (audio, analysis, structure, the script's
  hook text). An edit names the row's version (`updated_at`); a stale one is a 409 and the step
  reloads the plan.
- **A longer final hook text** moves the clip it reaches to the next free phrase (or drops it):
  `clearHookText`, derived in the effect step for its line and in `resolveCutawaysForRender`,
  never written.
- **Copied at enqueue:** `createBRender` copies the windows onto `params.cutaways` and never points
  at the row; no clip left means no `cutaways` key.
- **The draft is the demo in order.** A Claude matcher was tested and not adopted
  (`facts/cutaway-matcher-hit-rate-2026-10-20.md`).
- **The window picker** snaps to the analysis moments and never lets two windows share footage. A
  drag selects nothing and scrolls nothing (vault 0122).
- **The composition:**
  - each window is a muted `OffthreadVideo` over the still-running head;
  - outside the static overscan;
  - under the hook text, captions and watermark;
  - every boundary on the frame the captions change on (`voBoundaryFrame` in `timing.ts`).
- **`buildServiceBProps`** clamps against the probed video stream and drops what cannot play with a
  `cutaway_render_degraded` event. It never throws after HeyGen is paid.

## Retired 2026-09-06 (vault 0023) — do not build on it

- The opener-clip bank (`opener_clips`, `bank add-opener`).
- The hard cut at `reveal_at_ms`.
- The seam colour grade and pixel alignment (vault 0021, `facts/service-b-seam-constants.md`).
- The wizard's opener step.

The code is still in the tree with no customer-facing path; its render runs only from the CLI's
`render-b --opener`. One leftover web route (`GET /api/personas/[personaId]/openers`) still answers a
hand-built request: `docs/vault/defects/retired-formats-keep-two-live-web-routes.md`.
