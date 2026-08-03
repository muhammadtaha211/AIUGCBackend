import { z } from "zod";

/**
 * Pure, unit-testable parts of the Service A HTTP layer: request body schemas
 * and the direct-upload path rules. Route handlers (src/app/api) wire these to
 * auth + DB. Mirrors src/lib/service-b.ts.
 */

// ---------------------------------------------------------------------------
// Demo direct upload (signed upload URL — bytes never pass through a route)
// ---------------------------------------------------------------------------

export const MAX_DEMO_BYTES = 200 * 1024 * 1024;

/** MIME -> stored extension; also the allowlist. Phone footage is mp4 or mov. */
export const DEMO_EXTENSIONS: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
};

/** Hebrew validation error for the demo file, or null when fine. */
export function demoFileError(file: { type: string; size: number }): string | null {
  if (!DEMO_EXTENSIONS[file.type]) return "אפשר להעלות רק וידאו בפורמט MP4 או MOV.";
  if (file.size === 0) return "הקובץ שהועלה ריק.";
  if (file.size > MAX_DEMO_BYTES) return "הסרטון גדול מדי — המקסימום הוא 200MB.";
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

// ---------------------------------------------------------------------------
// Copy + set bodies
// ---------------------------------------------------------------------------

export const voScriptRequestSchema = z.object({
  demoId: z.string().uuid(),
  personaId: z.string().uuid(),
  /** Questionnaire advantages ticked as visible in the footage. */
  selectedAdvantages: z.array(z.string().min(1).max(200)).max(12),
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
});
