import { z } from "zod";

/**
 * Pure, unit-testable parts of the hook-clip bank admin: upload validation,
 * request body schemas, and the safe-area editor's coordinate mapping between
 * the scaled preview and 1080x1920 frame space. Route handlers and the editor
 * component wire these to auth + DB + pointer events. Mirrors src/lib/admin.ts.
 */

// ---------------------------------------------------------------------------
// Upload validation. The clip file never passes through a route (signed upload
// straight to storage, like the customer demo upload), so there is nothing to
// probe server-side — no ffmpeg exists on Vercel. Duration and dimensions are
// the client's HTMLVideoElement readings; this is a founder-only tool, so the
// server bounds-checks them and otherwise takes them at their word.
// ---------------------------------------------------------------------------

export const HOOK_FRAME = { width: 1080, height: 1920 } as const;
export const HOOK_DURATION = { minMs: 500, maxMs: 10_000 } as const;
export const MAX_HOOK_BYTES = 50 * 1024 * 1024;

/** Hebrew validation error for the picked file, or null when fine. */
export function hookFileError(file: { type: string; size: number }): string | null {
  if (file.type !== "video/mp4") return "אפשר להעלות רק וידאו בפורמט MP4.";
  if (file.size === 0) return "הקובץ שהועלה ריק.";
  if (file.size > MAX_HOOK_BYTES) return "הקובץ גדול מדי — המקסימום הוא 50MB.";
  return null;
}

/** Hebrew error naming the actual values, or null when fine. Runs client- and server-side. */
export function hookMetadataError(meta: {
  durationMs: number;
  width: number;
  height: number;
}): string | null {
  if (meta.width !== HOOK_FRAME.width || meta.height !== HOOK_FRAME.height) {
    return `הווידאו חייב להיות בדיוק 1080×1920 — הקובץ הוא ${meta.width}×${meta.height}.`;
  }
  if (meta.durationMs < HOOK_DURATION.minMs || meta.durationMs > HOOK_DURATION.maxMs) {
    return `אורך הקליפ חייב להיות 0.5–10 שניות — הקובץ הוא ${(meta.durationMs / 1000).toFixed(1)} שניות.`;
  }
  return null;
}

export const uploadUrlRequestSchema = z.object({
  type: z.string(),
  size: z.number().int().positive(),
});

/**
 * Bank clips are pre-rendered finals — no ingest/normalize step — so the
 * signed upload targets the assets bucket directly, in the same key shape the
 * CLI's addHookClip writes (the path uuid is minted before the row exists, so
 * it does not match the row id; file_path is the source of truth).
 */
export function hookUploadPath(uploadId: string): string {
  return `assets/bank/hook_clip/${uploadId}/clip.mp4`;
}

/** Register accepts only paths the upload-url route minted. */
export function isHookUploadPath(uploadPath: string): boolean {
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  return new RegExp(`^assets/bank/hook_clip/${uuid}/clip\\.mp4$`).test(uploadPath);
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

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

/** The three known tag facets; blank fields are omitted by the client, never stored. */
export const hookTagsSchema = z.object({
  energy: z.string().trim().min(1).max(60).optional(),
  gender: z.string().trim().min(1).max(60).optional(),
  vibe: z.string().trim().min(1).max(60).optional(),
});

export const registerHookSchema = z.object({
  uploadPath: z.string().min(1).max(300),
  durationMs: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  textSafeArea: textSafeAreaSchema,
  tags: hookTagsSchema.default({}),
});

/** One PATCH per clip action: active toggle or safe-area update. */
export const hookPatchSchema = z
  .object({
    active: z.boolean().optional(),
    textSafeArea: textSafeAreaSchema.optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "empty patch",
  });

// ---------------------------------------------------------------------------
// Safe-area editor geometry. The editor tracks the rect in frame space
// (1080x1920) and converts pointer positions from the scaled preview through
// framePoint; rects stay integer and fully inside the frame at all times.
// ---------------------------------------------------------------------------

export type SafeRect = { x: number; y: number; w: number; h: number };
export type FramePoint = { x: number; y: number };

/** Smaller than this is unusable for a hook line (min font 40px at line-height 1.2). */
export const MIN_SAFE_AREA = 120;

/** Where a fresh clip's rect starts — the sample-render default, mid-frame. */
export const DEFAULT_SAFE_AREA: SafeRect = { x: 90, y: 640, w: 900, h: 520 };

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
