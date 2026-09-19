import { textSafeAreaSchema } from "@aiugc/core/hook-geometry";
import { MAX_LABEL_CHARS } from "@aiugc/core/plan-format";
import { z } from "zod";
import { ANALYSIS_PAGE_SIZE } from "./service-a-ui";

/**
 * Pure, unit-testable parts of the Service A HTTP layer: request body schemas
 * and the direct-upload path rules. Route handlers (src/app/api) wire these to
 * auth + DB. Mirrors src/lib/service-b.ts.
 */

// ---------------------------------------------------------------------------
// Demo direct upload (signed upload URL — bytes never pass through a route)
// ---------------------------------------------------------------------------

// 1GB: ample for a 90-second phone screen recording. Uploads go straight to
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

/**
 * The founder-curated good-input example served on the demo step: a sample
 * recording and the ad it produced. Fixed storage paths — replacing the
 * example is overwriting these two objects (upsert put), never a code change.
 * Currently placeholders; see packages/core/.work/upload-a-samples.ts.
 */
export const A_SAMPLE_RECORDING_PATH = "assets/samples/a-steps/recording.mp4";
export const A_SAMPLE_AD_PATH = "assets/samples/a-steps/ad.mp4";

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

// ---------------------------------------------------------------------------
// Step-plan bodies (Phase 7)
// ---------------------------------------------------------------------------

/**
 * The full ordered step array the picker sends on every edit. Labels cap at
 * core's MAX_LABEL_CHARS, imported rather than repeated so the wizard's field,
 * this schema and findPlanViolations cannot disagree; the array caps at the
 * analysis max_states default (80) — the server re-derives everything else
 * from sourceIndex and re-sorts by timestamp, so order and duplicates are its
 * problem, not ours.
 */
export const planStepsRequestSchema = z.object({
  steps: z
    .array(
      z.object({
        sourceIndex: z.number().int().min(0),
        label: z.string().min(1).max(MAX_LABEL_CHARS),
      }),
    )
    .min(1)
    .max(80),
});

/** One answered unexplained-moment; the server trims and appends. */
export const demoNoteRequestSchema = z.object({
  text: z.string().min(1).max(500),
});

/**
 * `?indexes=3,17,29` on the analysis GET: the exact states a plan's steps point
 * at, signed in one call. Strict on purpose — dedupes, but rejects (null)
 * malformed parts, out-of-range indexes and more than ANALYSIS_PAGE_SIZE
 * entries rather than silently dropping them: a silently-shortened list would
 * render a plan with missing cards and no error anywhere.
 */
export function parseAnalysisIndexes(raw: string, timelineLength: number): number[] | null {
  const parts = raw.split(",");
  const seen = new Set<number>();
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const index = Number(part);
    if (index >= timelineLength) return null;
    seen.add(index);
  }
  if (seen.size === 0 || seen.size > ANALYSIS_PAGE_SIZE) return null;
  return [...seen];
}

/**
 * The one plan shape every plan-touching route returns (GET/POST edit/approve
 * all serialize through here), so the wizard never learns two shapes. steps/
 * unexplainedMoments pass through as stored — core owns their schema.
 */
export function stepPlanResponse(
  plan: {
    id: string;
    demoId: string;
    analysisId: string;
    status: string;
    steps: unknown;
    unexplainedMoments: unknown;
    notes: string | null;
    failReason: string | null;
    failKind: string | null;
    approvedAt: Date | null;
    createdAt: Date;
  },
  now: Date = new Date(),
): {
  planId: string;
  demoId: string;
  analysisId: string;
  status: string;
  steps: unknown;
  unexplainedMoments: unknown;
  notes?: string;
  failReason?: string;
  failKind?: string;
  approvedAt?: Date;
  requestedElapsedMs: number;
} {
  return {
    planId: plan.id,
    demoId: plan.demoId,
    analysisId: plan.analysisId,
    status: plan.status,
    steps: plan.steps ?? [],
    unexplainedMoments: plan.unexplainedMoments ?? [],
    notes: plan.notes ?? undefined,
    failReason: plan.failReason ?? undefined,
    failKind: plan.failKind ?? undefined,
    approvedAt: plan.approvedAt ?? undefined,
    // The customer-facing "רץ כבר X", differenced HERE on the server's clock
    // rather than shipped as a timestamp for the browser to subtract from its
    // own — a client clock behind the server's would otherwise pin the number
    // at "פחות מדקה" for as long as the skew lasted. Clamped for the same
    // reason in the other direction.
    requestedElapsedMs: Math.max(0, now.getTime() - plan.createdAt.getTime()),
  };
}

/** The steps-format create response. `balance` is the post-debit account
 *  balance (null = admin bypass, never debited) — the wizard pushes it into
 *  the sidebar's BalanceProvider the moment the render starts. */
export type AStepsCreateResponse = { renderId: string; balance: number | null };

/** Steps-format render (8e): a silent 1×1 set from an APPROVED plan, pinned
 *  by id. No audio, no persona — the format is silent by definition. */
export const aStepsRenderRequestSchema = z.object({
  demoId: z.string().uuid(),
  stepPlanId: z.string().uuid(),
  hookClipId: z.string().uuid(),
  hookLineScriptId: z.string().uuid(),
  /** The hook-studio placement; absent = the clip's default safe area. */
  textSafeArea: textSafeAreaSchema.optional(),
});
