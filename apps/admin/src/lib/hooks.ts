import { HOOK_FRAME, textSafeAreaSchema } from "@aiugc/core/hook-geometry";
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
  DEFAULT_SAFE_AREA,
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
  /** Persona-swapped clip: shown only in that persona's gallery. Absent = generic. */
  personaId: z.string().uuid().optional(),
  /** Lineage: the clip this swap was generated from ("שכפול לדמות"). */
  sourceClipId: z.string().uuid().optional(),
});

/** One PATCH per clip action: active toggle, safe-area update, or persona (re)assignment. */
export const hookPatchSchema = z
  .object({
    active: z.boolean().optional(),
    textSafeArea: textSafeAreaSchema.optional(),
    /** null clears the assignment back to generic (shown to everyone). */
    personaId: z.string().uuid().nullable().optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "empty patch",
  });
