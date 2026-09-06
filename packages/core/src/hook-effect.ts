import { z } from "zod";

/**
 * The hook animation the composition performs on the one HeyGen clip
 * (docs/vault/decisions/0023-hook-is-a-remotion-animation-opener-clips-retired.md).
 * The customer picks a NAME and only a name; the tuned numbers behind each one
 * live in `pipelines/renders.ts` and the Hebrew labels in the web app. Three
 * homes, three audiences: a retune is then a code change, never a rewrite of
 * every render row that already stored the old numbers.
 *
 * The founder picked these three on 2026-09-06 after watching a free mock of
 * each on the same HeyGen take
 * ([[service-b-hook-animation-mocks-2026-09-06]]). Two more were built and not
 * picked — emphasis punches (rejected) and the kinetic hook text (no verdict);
 * their props still exist in @aiugc/remotion and simply have no name here.
 *
 * Pure zod, no server imports: this module is bundled into client components
 * through the "@aiugc/core/hook-effect" subpath, like hook-geometry and
 * hook-text.
 */
export const HOOK_EFFECTS = ["none", "zoom", "focus", "whip"] as const;

export type HookEffect = (typeof HOOK_EFFECTS)[number];

export const hookEffectSchema = z.enum(HOOK_EFFECTS);

/** An animation, as opposed to "none" — the case that carries a burned hook line. */
export function isHookAnimation(effect: string | undefined): effect is Exclude<HookEffect, "none"> {
  return effect !== undefined && effect !== "none" && HOOK_EFFECTS.includes(effect as HookEffect);
}

/**
 * The tuned numbers behind each animation. These ARE the product: the founder
 * judged one free mock per effect on 2026-09-06 and picked these three
 * (docs/vault/facts/service-b-hook-animation-mocks-2026-09-06.md).
 *
 * They live in this pure module rather than in the DB so a retune is a deploy,
 * never a rewrite of every stored render's params — and, since 2026-09-06,
 * rather than in `pipelines/renders.ts` so the wizard's preview animates the
 * SAME numbers the render burns. Two homes is how a preview starts lying.
 */
export const HOOK_ZOOM = { from: 1.35, to: 1.42, durationMs: 450 } as const;
export const HOOK_FOCUS = { blurPx: 20, pullMs: 850 } as const;
export const HOOK_WHIP = { fromX: 140, durationMs: 420, blurPx: 20 } as const;

/**
 * When the move LANDS, measured from speech onset rather than from frame 0.
 *
 * Every mock was rendered at a cut-to-speech gap of 800ms; the pipeline's
 * GAP_MS is 250 ([[service-b-timeline-constants]]). Pinning the judged
 * literals (zoom `atMs` 1200, focus sharp at 1200) would put the whole move
 * ~950ms deep into speech instead of the ~400ms the founder watched. So the
 * one thing held constant is what he actually judged — the move settles
 * 400ms after she starts talking — and the run-up takes whatever silence the
 * gap leaves. The whip is exempt: it runs from frame 0 and is over before
 * speech at any gap.
 */
export const HOOK_LANDS_AFTER_SPEECH_MS = 400;

/**
 * One animation's numbers, in the shape both the composition props and the
 * wizard's preview take them. At most one key is ever set.
 */
export interface HookAnimation {
  zoom?: { from: number; to: number; atMs: number; durationMs: number };
  focus?: { blurPx: number; holdMs: number; durationMs: number };
  whip?: { fromX: number; durationMs: number; blurPx: number };
}

/**
 * Name -> numbers, given the render's speech onset (`serviceBTimeline`'s
 * captionOffsetMs). A name this build does not know returns {} and never
 * throws: QC regeneration replays old params wholesale (pipelines/qc.ts), so a
 * renamed effect from an older deploy would otherwise fail a render the
 * customer has already paid HeyGen for.
 */
export function hookAnimation(effect: string | undefined, captionOffsetMs: number): HookAnimation {
  if (!isHookAnimation(effect)) return {};
  const landsAtMs = captionOffsetMs + HOOK_LANDS_AFTER_SPEECH_MS;
  if (effect === "zoom") return { zoom: { ...HOOK_ZOOM, atMs: landsAtMs } };
  if (effect === "focus") {
    // The pull ends where the zoom's does; it starts as early as the silence
    // allows, never before frame 0.
    const durationMs = Math.max(1, Math.min(HOOK_FOCUS.pullMs, landsAtMs));
    return { focus: { blurPx: HOOK_FOCUS.blurPx, holdMs: landsAtMs - durationMs, durationMs } };
  }
  return { whip: { ...HOOK_WHIP } };
}

/**
 * How long the whole move takes, from frame 0 — what a preview has to play
 * before the picture is at rest. 0 for "none" and for an unknown name.
 */
export function hookAnimationDurationMs(animation: HookAnimation): number {
  if (animation.zoom) return animation.zoom.atMs + animation.zoom.durationMs;
  if (animation.focus) return animation.focus.holdMs + animation.focus.durationMs;
  if (animation.whip) return animation.whip.durationMs;
  return 0;
}
