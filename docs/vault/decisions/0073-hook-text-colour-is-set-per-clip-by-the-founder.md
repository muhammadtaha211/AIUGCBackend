---
type: decision
status: verified
verified: 2026-10-01
method: "Founder decision in chat, 2026-10-01, recorded from that day's task prompt; the reasons and the options dropped are his. Code read on feat/hook-text-color, branched from origin/main 67448de: packages/remotion/src/ServiceA.tsx (HookLine, its color prop and the hard-coded TEXT_OUTLINE), packages/remotion/src/overlays.tsx:29-35 (TEXT_OUTLINE), packages/remotion/src/ServiceASteps.tsx (the hook line and the step labels' calls), packages/remotion/src/ServiceB.tsx (B's hook text), packages/core/src/pipelines/renders.ts buildServiceAStepsProps (reads the hook_clips row at render time), apps/admin/src/app/(admin)/hooks/* and apps/admin/src/app/api/admin/hooks/** (the PATCH's editable fields, the client-side duplicate prefill, the SafeAreaEditor sample line), apps/web/src/components/a-wizard/placement-editor.tsx + step-hook-studio.tsx (the wizard preview), apps/web/src/app/api/hooks/route.ts, supabase/migrations/0002_supabase_rls.sql:99-101 (the row-level policy). The frame grabs: packages/core/.work/hook-text-color-grab.ts (gitignored) over bank clip 1b4a1a71, local Remotion render through core's renderVideo, no remote writes."
source: founder + code
---

# 0073 — The hook line's colour is set per clip by the founder: white or black

Decided 2026-10-01. "The decision" below is the founder's ruling. From "Why" on, each checkable
claim carries one tag: **FOUNDER-REPORTED** (his statement or reasoning, not checkable here),
**MEASURED** (the tree, a test or a local render, see `method`), **REASONED** (inference from what
is cited).

## The decision

Every bank clip carries a hook-text colour, **`white` or `black`**, that the founder sets on admin
`/hooks`: on an existing clip's card, or when registering a new one. A Service A **steps** render
burns its hook line over that clip in the clip's colour. The founder, in chat: _"just let me set the
color to either black or white, from the admin page"_.

- **Two values only, stored as a name and never a hex**: `hook_clips.text_color`, migration 0049,
  text with a named `CHECK (text_color IN ('white','black'))`.
- **White is the default** for every existing clip and for any clip registered without a choice,
  CLI included (the column default). A white render is unchanged from before this decision.
- **Black gets a light outline at today's outline weight.** It is `TEXT_OUTLINE`'s own five layers
  (the four ±5px offsets and the soft 26px drop) at the same alphas, drawn in `255,255,255` instead
  of `0,0,0`. That makes black the exact inverse of white.
- **Scope is the Service A hook line only.** Step labels (yellow), Service B's hook text, captions
  and the watermark render as before. So do the retired paths: the "full" format's `ServiceA`
  composition and the opener clips.
- **"שכפול לדמות" carries the source clip's colour across**, exactly as it carries the rect. The
  founder can still change it in the prefilled form.
- **The colour is never accepted from a customer request.** The customer sees it only as the
  colour the hook studio's preview draws, which is the colour the render burns.

## Why

**FOUNDER-REPORTED, not measured:** some clips make white text hard to read. Nobody measured this;
it is the founder's observation of the bank.

**FOUNDER-REPORTED:**

- Legibility depends on the clip.
- The bank is founder-curated.
- A customer should never pay for a render they can't read.

So the choice belongs on the clip, made once, by the person who curates it.

## Options offered and not chosen

- **A customer picker in the wizard** (white/black/gray, or yellow). The founder proposed it and
  then replaced it with this. Legibility is a property of the clip, and a customer choosing wrongly
  pays for an unreadable render.
- **A free colour picker.** Rejected by the founder: it allows unreadable text, and brand colours
  read as an ad.

## How it is built — the calls made within the latitude

- **Storage: text + CHECK, not an enum.** This follows 0048's reasoning: each new enum value needs
  its own migration file. **MEASURED** (`migrations.test.ts` "0049", PGlite): the constant default
  backfills every existing row to `white`. **REASONED** (Postgres ≥11 fast-default behaviour, not
  measured here): adding it is metadata-only, with no table rewrite.
- **The render reads the colour off the `hook_clips` row at render time, never from params.**
  **MEASURED:** `buildServiceAStepsProps` already loads the whole row for the clip file and its
  rect. Nothing on the customer path (`POST …/a-sets/steps` → `createSet` → `video_renders.params`)
  carries a colour, so "never from a customer" holds by construction. **REASONED:** the cost is
  that a founder flip also reaches renders still queued for that clip. For a curated bank, the
  latest call winning is the intended behaviour.
- **The names and the values live together in core** (`packages/core/src/hook-text-color.ts`,
  subpath `@aiugc/core/hook-text-color`), as [[0024-hook-effect-is-a-render-param-the-customer-picks]]
  does for the hook effects.
  - `HOOK_TEXT_INK` maps each name to its fill and outline rgb.
  - The composition receives those values (`hookTextInk`), never the name.
  - The admin safe-area editor and the wizard's placement editor draw from the same table, so
    preview and burn cannot disagree.
  - The Hebrew labels ("טקסט לבן" / "טקסט שחור") live in `apps/admin/src/lib/hooks.ts`
    (**MEASURED**, `HOOK_TEXT_COLOR_LABEL`).
- **The two existing previews follow the colour; no new preview was built.** **MEASURED:** both
  already drew a hook line over the clip, in white:
  - admin `SafeAreaEditor`, in the upload form and card edit mode;
  - the A hook studio's `PlacementEditor`.

  B's effect step shares `PlacementEditor` and passes no colour, so it stays white (**MEASURED**,
  `apps/web/src/components/b-wizard/step-effect.tsx`, unchanged by this work).

## What this does not change

**MEASURED** from the diff and the tree:

- `TEXT_OUTLINE` itself is not edited (`overlays.tsx:29-35`, pinned by `hook-text-ink.test.tsx`).
- `HookLine`'s defaults are white fill and `TEXT_OUTLINE`. B's hook text and the retired
  composition get both. The step labels keep `TEXT_OUTLINE` with their own yellow fill
  (`ServiceASteps.tsx`, `color={ACTIVE_WORD_COLOR}`).
- The QC gate and the price are untouched.
- The RLS policy is untouched: it is row-level (`0002_supabase_rls.sql:99-101`, `USING (active)`),
  and no migration grants anything on `hook_clips`.
- The CLI has no colour flag; `aiugc bank add-hook` gets white from the column default.
- **MEASURED** (local render, bank clip `1b4a1a71`): the white render on the new code decodes
  identically, on all 197 frames, to a render of the unchanged pipeline.

## Pinned by

- `packages/core/test/migrations.test.ts` "0049":
  - an existing clip backfills white;
  - a new one defaults white;
  - the CHECK refuses anything but white and black, both on insert and on update.
- `packages/core/test/hook-text-color.test.ts`: the vocabulary, the default and the ink.
- `packages/core/test/e2e.test.ts`:
  - a clip registered through `addHookClip` (the CLI path) echoes the white ink;
  - a clip set black echoes the black ink even with a colour salted into the render's params.
- `packages/remotion/test/hook-text-ink.test.tsx`:
  - `TEXT_OUTLINE` is unchanged;
  - `HookLine` defaults to white on `TEXT_OUTLINE`;
  - the steps hook line takes the ink while every label stays yellow with no override;
  - B's hook text passes no ink.
- `packages/remotion/test/render-args.test.ts`: the ink crosses `renderServiceASteps` into the
  composition's props.
- `apps/admin/test/hooks.test.ts`:
  - register and patch accept white and black only;
  - `duplicatePrefill` carries the colour.
- `apps/web/test/service-a.test.ts`: the steps render body strips any colour field.

## To take effect

1. Apply 0049.
2. Merge (Vercel deploys web + admin).
3. Pull and restart the worker box. That is what makes black burn.
4. Only then set any clip to black.
