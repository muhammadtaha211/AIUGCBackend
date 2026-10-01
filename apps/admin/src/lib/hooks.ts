import { textSafeAreaSchema, type SafeRect } from "@aiugc/core/hook-geometry";
import { hookTextColorSchema, type HookTextColor } from "@aiugc/core/hook-text-color";
import { z } from "zod";

/**
 * Pure, unit-testable parts of the hook-clip bank admin: upload validation and
 * request body schemas. Route handlers and the editor component wire these to
 * auth + DB + pointer events. Mirrors src/lib/admin.ts. The safe-area editor's
 * coordinate mapping lives in @aiugc/core/hook-geometry (shared with the
 * customer wizard's placement editor) and is re-exported below so existing
 * imports keep working.
 */

export {
  DEFAULT_HOOK_TEXT_RECT,
  HOOK_FRAME,
  MIN_SAFE_AREA,
  framePoint,
  moveRect,
  oppositeCorner,
  rectFromPoints,
  textSafeAreaSchema,
  type Corner,
  type FramePoint,
  type SafeRect,
} from "@aiugc/core/hook-geometry";

// ---------------------------------------------------------------------------
// Upload validation. The clip file never passes through a route (signed upload
// straight to storage, like the customer demo upload), so there is nothing to
// probe server-side — no ffmpeg exists on Vercel. Duration and dimensions are
// the client's HTMLVideoElement readings; this is a founder-only tool, so the
// server bounds-checks them and otherwise takes them at their word.
// ---------------------------------------------------------------------------

export const HOOK_DURATION = { minMs: 500, maxMs: 10_000 } as const;
export const MAX_HOOK_BYTES = 50 * 1024 * 1024;

/**
 * Dimensions only have to be close to 9:16, not exactly 1080x1920: the
 * composition and the safe-area preview both object-fit: cover the clip into
 * the 1080x1920 frame, so a near-9:16 clip loses a few edge pixels and renders
 * identically otherwise. 3% lets through the 1072x1936 exports the founder
 * actually has (1.6% off) and still rejects landscape and 19.5:9 phone frames.
 */
export const HOOK_ASPECT_TOLERANCE = 0.03;

function isNear9x16(width: number, height: number): boolean {
  const target = 9 / 16;
  return Math.abs(width / height - target) / target <= HOOK_ASPECT_TOLERANCE;
}

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
  if (!isNear9x16(meta.width, meta.height)) {
    return `הווידאו חייב להיות ביחס 9:16 (למשל 1080×1920) — הקובץ הוא ${meta.width}×${meta.height}.`;
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
 * Bank clips are pre-rendered finals, so the signed upload targets the assets
 * bucket directly, in the same key shape the CLI's addHookClip writes (the
 * path uuid is minted before the row exists, so it does not match the row id;
 * file_path is the source of truth). Registering the row queues one
 * normalize_hook_clip job — the only thing the browser cannot check is the
 * frame rate, and the composition needs exactly 30fps.
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
  /** Persona this clip belongs to — the wizard lists one persona's clips; a
   *  clip without one is shown to nobody. */
  personaId: z.string().uuid().optional(),
  /** Lineage: the clip this swap was generated from ("שכפול לדמות"). */
  sourceClipId: z.string().uuid().optional(),
  /** The hook line's colour (decision 0073); absent = the column default, white. */
  textColor: hookTextColorSchema.optional(),
});

/** One PATCH per clip action: active toggle, safe-area update, persona (re)assignment, or text colour. */
export const hookPatchSchema = z
  .object({
    active: z.boolean().optional(),
    textSafeArea: textSafeAreaSchema.optional(),
    /** null unassigns the clip (drops it out of every gallery until reassigned). */
    personaId: z.string().uuid().nullable().optional(),
    textColor: hookTextColorSchema.optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "empty patch",
  });

/** The colour select's options, card and upload form alike. */
export const HOOK_TEXT_COLOR_LABEL: Record<HookTextColor, string> = {
  white: "טקסט לבן",
  black: "טקסט שחור",
};

/**
 * "שכפול לדמות": the upload form opens on the source clip's safe area, text
 * colour, tags and duration, with source_clip_id recorded for lineage. The
 * colour carries across exactly like the rect (decision 0073).
 */
export function duplicatePrefill(
  clip: {
    id: string;
    textSafeArea: SafeRect;
    textColor: HookTextColor;
    tags: Record<string, string>;
    durationMs: number;
  },
  personaId: string,
) {
  return {
    sourceClipId: clip.id,
    personaId,
    textSafeArea: clip.textSafeArea,
    textColor: clip.textColor,
    tags: clip.tags,
    durationMs: clip.durationMs,
  };
}
