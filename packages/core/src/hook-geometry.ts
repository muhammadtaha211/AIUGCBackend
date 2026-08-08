import { z } from "zod";

/**
 * Hook-line placement geometry, shared by the admin safe-area editor, the
 * customer wizard's placement editor, and the render pipeline. Pure math +
 * zod only — this module is bundled into client components via the
 * "@aiugc/core/hook-geometry" subpath, so it must never import server code.
 *
 * All rects are {x, y, w, h} integers in 1080x1920 frame space.
 */

export const HOOK_FRAME = { width: 1080, height: 1920 } as const;

export type SafeRect = { x: number; y: number; w: number; h: number };
export type FramePoint = { x: number; y: number };

/** Smaller than this is unusable for a hook line (min font 40px at line-height 1.2). */
export const MIN_SAFE_AREA = 120;

/**
 * Where a fresh clip's rect starts in the admin register editor. A SEED, not a
 * fallback: the rect stays required at register, and "שכפול לדמות" inherits the
 * source clip's rect instead of this.
 *
 * The vertical centre sits at 40% of frame height measured from the bottom
 * (y 1152), which keeps the burned line clear of the bottom band where TikTok
 * and Instagram lay their own caption text and UI chrome. Height 179 is the
 * measured two-line envelope: 2 lines fit at ≤74px, 3 only at the 48px
 * legibility floor.
 */
export const DEFAULT_HOOK_TEXT_RECT: SafeRect = { x: 25, y: 1062, w: 1009, h: 179 };

/**
 * The legibility floor: below this fitted font size (px at 1080x1920) a burned
 * hook line reads poorly on a phone. Advisory only — the wizard shows a gentle
 * note, nothing blocks (inform, never restrict).
 */
export const HOOK_LINE_LEGIBLE_MIN_PX = 48;

export const textSafeAreaSchema = z
  .object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    w: z.number().int().min(1),
    h: z.number().int().min(1),
  })
  .refine((r) => r.x + r.w <= HOOK_FRAME.width && r.y + r.h <= HOOK_FRAME.height, {
    message: "safe area outside the 1080x1920 frame",
  });

/**
 * THE rect resolution chain — variant rect first, then the clip's default rect
 * (required at admin register, so no geometric fallback exists). Implemented
 * once; the render pipeline, the wizard's placement editor, and the sample
 * render all resolve through here.
 */
export function resolveHookTextSafeArea(
  variantRect: SafeRect | undefined,
  clipRect: SafeRect,
): SafeRect {
  return variantRect ?? clipRect;
}

/** A pointer position inside the preview box (display px) -> frame space, clamped. */
export function framePoint(
  displayX: number,
  displayY: number,
  displayW: number,
  displayH: number,
): FramePoint {
  return {
    x: Math.min(Math.max((displayX / displayW) * HOOK_FRAME.width, 0), HOOK_FRAME.width),
    y: Math.min(Math.max((displayY / displayH) * HOOK_FRAME.height, 0), HOOK_FRAME.height),
  };
}

/**
 * Two frame-space corners (any drag direction) -> a normalized, integer,
 * min-sized rect kept fully inside the frame. Used for both drawing a new
 * rect and resizing from a corner handle (anchor = the opposite corner).
 */
export function rectFromPoints(a: FramePoint, b: FramePoint): SafeRect {
  const w = Math.min(Math.max(Math.round(Math.abs(a.x - b.x)), MIN_SAFE_AREA), HOOK_FRAME.width);
  const h = Math.min(Math.max(Math.round(Math.abs(a.y - b.y)), MIN_SAFE_AREA), HOOK_FRAME.height);
  const x = Math.min(Math.max(Math.round(Math.min(a.x, b.x)), 0), HOOK_FRAME.width - w);
  const y = Math.min(Math.max(Math.round(Math.min(a.y, b.y)), 0), HOOK_FRAME.height - h);
  return { x, y, w, h };
}

/** Slide a rect by a frame-space delta, kept fully inside the frame. */
export function moveRect(rect: SafeRect, dx: number, dy: number): SafeRect {
  return {
    ...rect,
    x: Math.min(Math.max(Math.round(rect.x + dx), 0), HOOK_FRAME.width - rect.w),
    y: Math.min(Math.max(Math.round(rect.y + dy), 0), HOOK_FRAME.height - rect.h),
  };
}

export type Corner = "nw" | "ne" | "sw" | "se";

/** The fixed anchor when resizing from `corner` — the diagonally opposite one. */
export function oppositeCorner(rect: SafeRect, corner: Corner): FramePoint {
  return {
    x: corner === "nw" || corner === "sw" ? rect.x + rect.w : rect.x,
    y: corner === "nw" || corner === "ne" ? rect.y + rect.h : rect.y,
  };
}
