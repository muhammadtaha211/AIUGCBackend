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
