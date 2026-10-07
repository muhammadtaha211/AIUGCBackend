import { textSafeAreaSchema } from "@aiugc/core/hook-geometry";
import { hookTextColorSchema } from "@aiugc/core/hook-text-color";
import { speakerGenderSchema, TEXT_BLOCK_MAX_CHARS } from "@aiugc/core/text-block";
import { z } from "zod";

/**
 * Pure, unit-testable parts of the גוש טקסט admin (Service C, decisions
 * 0089–0091): upload validation and request body schemas. Route handlers and
 * the page components wire these to auth + DB. Mirrors src/lib/hooks.ts, with
 * the clip bank's own bounds: a text block is read over the whole clip, so the
 * clip runs seconds, not a hook's 0.5–10 s.
 */

export { DEFAULT_TEXT_BLOCK_RECT, type SafeRect } from "@aiugc/core/hook-geometry";

// ---------------------------------------------------------------------------
// Upload validation — the same stance as hooks.ts: the bytes never pass through
// a route (signed upload straight to storage), there is no ffmpeg on Vercel,
// so duration and dimensions are the browser's readings, bounds-checked here.
// ---------------------------------------------------------------------------

export const TEXT_BLOCK_DURATION = { minMs: 3_000, maxMs: 60_000 } as const;
export const MAX_TEXT_BLOCK_BYTES = 100 * 1024 * 1024;

/** Same 3% tolerance as the hook bank: the composition object-fit: covers the clip. */
const ASPECT_TOLERANCE = 0.03;

function isNear9x16(width: number, height: number): boolean {
  const target = 9 / 16;
  return Math.abs(width / height - target) / target <= ASPECT_TOLERANCE;
}

/** Hebrew validation error for the picked file, or null when fine. */
export function textBlockFileError(file: { type: string; size: number }): string | null {
  if (file.type !== "video/mp4") return "אפשר להעלות רק וידאו בפורמט MP4.";
  if (file.size === 0) return "הקובץ שהועלה ריק.";
  if (file.size > MAX_TEXT_BLOCK_BYTES) return "הקובץ גדול מדי — המקסימום הוא 100MB.";
  return null;
}

/** Hebrew error naming the actual values, or null when fine. Runs client- and server-side. */
export function textBlockMetadataError(meta: {
  durationMs: number;
  width: number;
  height: number;
}): string | null {
  if (!isNear9x16(meta.width, meta.height)) {
    return `הווידאו חייב להיות ביחס 9:16 (למשל 1080×1920) — הקובץ הוא ${meta.width}×${meta.height}.`;
  }
  if (meta.durationMs < TEXT_BLOCK_DURATION.minMs || meta.durationMs > TEXT_BLOCK_DURATION.maxMs) {
    return `אורך הקליפ חייב להיות 3–60 שניות — הקובץ הוא ${(meta.durationMs / 1000).toFixed(1)} שניות.`;
  }
  return null;
}

/**
 * The signed upload targets the assets bucket directly, under the bank's own
 * entity (core's storageKey `text_block_clip`); the path uuid is minted before
 * the row exists, so file_path is the source of truth.
 */
export function textBlockUploadPath(uploadId: string): string {
  return `assets/bank/text_block_clip/${uploadId}/clip.mp4`;
}

/** Register accepts only paths the upload-url route minted. */
export function isTextBlockUploadPath(uploadPath: string): boolean {
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  return new RegExp(`^assets/bank/text_block_clip/${uuid}/clip\\.mp4$`).test(uploadPath);
}

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export const registerTextBlockSchema = z.object({
  uploadPath: z.string().min(1).max(300),
  durationMs: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Hebrew first person is gendered: the generator writes in this voice. */
  speakerGender: speakerGenderSchema,
  textSafeArea: textSafeAreaSchema,
  /** The block's colour (same vocabulary as the hook line, 0073); absent = white. */
  textColor: hookTextColorSchema.optional(),
});

/** One PATCH per clip action: active toggle, safe-area update, colour, or gender. */
export const textBlockPatchSchema = z
  .object({
    active: z.boolean().optional(),
    textSafeArea: textSafeAreaSchema.optional(),
    textColor: hookTextColorSchema.optional(),
    speakerGender: speakerGenderSchema.optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "empty patch",
  });

export const generateTextBlocksSchema = z.object({
  businessId: z.string().uuid(),
  clipId: z.string().uuid(),
});

/**
 * The edit body. The bound here only keeps a runaway body out; the real
 * rule — the character set and the TEXT_BLOCK_MAX_CHARS cap — is
 * textBlockTextError in the route, the same check generation and the render
 * run.
 */
export const editTextBlockSchema = z.object({
  text: z
    .string()
    .min(1)
    .max(TEXT_BLOCK_MAX_CHARS * 4),
});

export const createTextBlockRenderSchema = z.object({
  businessId: z.string().uuid(),
  clipId: z.string().uuid(),
  scriptId: z.string().uuid(),
});
