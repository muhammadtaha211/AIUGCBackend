import { textSafeAreaSchema } from "@aiugc/core/hook-geometry";
import { z } from "zod";

/**
 * Pure, unit-testable parts of the Service A HTTP layer: request body schemas
 * and the direct-upload path rules. Route handlers (src/app/api) wire these to
 * auth + DB. Mirrors src/lib/service-b.ts.
 */

// ---------------------------------------------------------------------------
// Demo direct upload (signed upload URL — bytes never pass through a route)
// ---------------------------------------------------------------------------

// 1GB: up to 3 minutes of phone screen recording. Uploads go straight to
// storage via signed URL, so no route body limit applies — but the Supabase
// bucket's own file_size_limit must be raised to match (dashboard setting).
export const MAX_DEMO_BYTES = 1024 * 1024 * 1024;

/** MIME -> stored extension; also the allowlist. Phone footage is mp4 or mov. */
export const DEMO_EXTENSIONS: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
};

/** Hebrew validation error for the demo file, or null when fine. */
export function demoFileError(file: { type: string; size: number }): string | null {
  if (!DEMO_EXTENSIONS[file.type]) return "אפשר להעלות רק וידאו בפורמט MP4 או MOV.";
  if (file.size === 0) return "הקובץ שהועלה ריק.";
  if (file.size > MAX_DEMO_BYTES) return "הסרטון גדול מדי — המקסימום הוא 1GB.";
  return null;
}

export const uploadUrlRequestSchema = z.object({
  type: z.string(),
  size: z.number().int().positive(),
});

/**
 * The one key shape the upload-url route mints. A fixed basename (never the
 * user's filename) keeps arbitrary characters out of storage keys; ownership
 * is the businessId prefix.
 */
export function demoUploadPath(businessId: string, uploadId: string, type: string): string {
  return `raw/${businessId}/demo/${uploadId}/demo${DEMO_EXTENSIONS[type] ?? ".mp4"}`;
}

/** Register accepts only paths this business's own upload-url route minted. */
export function isOwnedDemoUploadPath(businessId: string, uploadPath: string): boolean {
  const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  return new RegExp(`^raw/${businessId}/demo/${uuid}/demo\\.(mp4|mov)$`).test(uploadPath);
}

export const registerDemoRequestSchema = z.object({ uploadPath: z.string().min(1).max(300) });

/** The optional footage note; blank clears (server trims and nulls). */
export const demoDescriptionRequestSchema = z.object({
  description: z.string().max(500),
});

// ---------------------------------------------------------------------------
// Copy + set bodies
// ---------------------------------------------------------------------------

/**
 * Hook-line generation. Both fields optional: the first request of a session
 * has nothing to avoid, and the CLI path has no persona. The `avoid` cap is 20
 * (two batches) — past that the prompt bloats and the model gets so
 * over-constrained the output degrades.
 */
export const hookLinesRequestSchema = z.object({
  personaId: z.string().uuid().optional(),
  avoid: z.array(z.string().min(1).max(200)).max(20).optional(),
});

export const voScriptRequestSchema = z.object({
  demoId: z.string().uuid(),
  personaId: z.string().uuid(),
  /** Questionnaire advantages ticked as visible in the footage. */
  selectedAdvantages: z.array(z.string().min(1).max(200)).max(12),
  /** The chosen hook line, so the VO opener escalates past it instead of repeating it. */
  hookLineText: z.string().min(1).max(200).optional(),
});

export const aPreviewRequestSchema = z.object({
  demoId: z.string().uuid(),
  audioId: z.string().uuid(),
  hookClipId: z.string().uuid(),
});

export const aRenderRequestSchema = z.object({
  demoId: z.string().uuid(),
  hookClipId: z.string().uuid(),
  hookLineScriptId: z.string().uuid(),
  audioId: z.string().uuid(),
  personaId: z.string().uuid(),
  /** The hook-studio placement; absent = the clip's default safe area. */
  textSafeArea: textSafeAreaSchema.optional(),
});
