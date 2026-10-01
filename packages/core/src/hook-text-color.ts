import { z } from "zod";

/**
 * The colour a bank clip's Service A hook line burns in
 * (docs/vault/decisions/0073-hook-text-colour-is-set-per-clip-by-the-founder.md).
 * The founder sets it per clip in admin /hooks — legibility depends on the
 * clip, and the bank is his — and the render reads it off the hook_clips row,
 * never from a customer request. Stored as a NAME (`hook_clips.text_color`,
 * migration 0049); the values behind each name live here, so a retune is a
 * deploy, never a rewrite of every row. Same shape as hook-effect.ts: the
 * composition receives the values, never the name.
 *
 * Pure zod, no server imports: this module is bundled into client components
 * (the admin safe-area editor, the wizard's placement editor) through the
 * "@aiugc/core/hook-text-color" subpath, so preview and burn read one table.
 */
export const HOOK_TEXT_COLORS = ["white", "black"] as const;

export type HookTextColor = (typeof HOOK_TEXT_COLORS)[number];

export const hookTextColorSchema = z.enum(HOOK_TEXT_COLORS);

/** Every existing clip, and any clip registered without a choice (the DB default). */
export const DEFAULT_HOOK_TEXT_COLOR: HookTextColor = "white";

/** The fill, and the rgb its outline is drawn in. */
export interface HookTextInk {
  fill: string;
  outline: string;
}

/**
 * White is the hook line every render burned before 0073: white on the dark
 * outline. Black is its exact inverse — the same outline layers, offsets,
 * blurs and alphas, drawn light — so it stays readable on a bright clip.
 */
export const HOOK_TEXT_INK = {
  white: { fill: "white", outline: "0,0,0" },
  black: { fill: "black", outline: "255,255,255" },
} as const satisfies Record<HookTextColor, HookTextInk>;
