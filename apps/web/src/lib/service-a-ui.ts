import type { SafeRect } from "@aiugc/core/hook-geometry";

/**
 * Pure, client-safe helpers for the Service A wizard. No imports from
 * @aiugc/core's main entry (client bundle) — the "hook-geometry" subpath is
 * the deliberate exception: pure math + zod, safe in the client. Server rules
 * live in src/lib/service-a.ts and are re-validated on every request; the
 * duplicates here only save a round-trip. Mirrors src/lib/service-b-ui.ts.
 */

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export type AWizardStep =
  "persona" | "hook" | "hookStudio" | "demo" | "script" | "audio" | "render";

/**
 * One fixed path — Service A has no category-driven steps. Persona first: the
 * hook gallery filters by the chosen persona (swapped clips + generic ones)
 * and the structure strip shows the face that narrates and closes the video.
 */
export const A_WIZARD_STEPS: AWizardStep[] = [
  "persona",
  "hook",
  "hookStudio",
  "demo",
  "script",
  "audio",
  "render",
];

// ---------------------------------------------------------------------------
// Demo pre-checks (client-side copy of src/lib/service-a.ts rules)
// ---------------------------------------------------------------------------

export const MAX_DEMO_BYTES = 200 * 1024 * 1024;
const DEMO_TYPES = ["video/mp4", "video/quicktime"];

export const MIN_DEMO_SECONDS = 8;
export const MAX_DEMO_SECONDS = 60;

export function clientDemoFileError(file: { type: string; size: number }): string | null {
  if (!DEMO_TYPES.includes(file.type)) return "אפשר להעלות רק וידאו בפורמט MP4 או MOV.";
  if (file.size === 0) return "הקובץ שהועלה ריק.";
  if (file.size > MAX_DEMO_BYTES) return "הסרטון גדול מדי — המקסימום הוא 200MB.";
  return null;
}

/** Pre-upload duration gate (same limits the ingest job enforces server-side). */
export function demoDurationError(seconds: number): string | null {
  if (seconds < MIN_DEMO_SECONDS || seconds > MAX_DEMO_SECONDS) {
    return "אורך הסרטון חייב להיות בין 8 ל-60 שניות";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Wizard state carried across steps
// ---------------------------------------------------------------------------

export type DemoState = {
  id: string;
  status: string; // uploaded | probing | normalizing | ready | rejected
  rejectReason?: string;
  durationMs?: number;
  thumbUrl?: string;
};

/** A demo still moving through ingest — the step keeps polling while true. */
export function isIngestingDemoStatus(status: string): boolean {
  return status === "uploaded" || status === "probing" || status === "normalizing";
}

/** One row of GET /api/businesses/[id]/demos — reuse picker + demo library. */
export type DemoSummary = {
  id: string;
  status: string;
  rejectReason?: string;
  description?: string;
  durationMs?: number;
  thumbUrl?: string;
  createdAt: string;
};

export type HookClip = {
  id: string;
  durationMs: number;
  previewUrl: string;
  /** The clip's default safe area — seeds the hook studio's placement editor. */
  textSafeArea: SafeRect;
  /** Set on persona-swapped clips; absent = generic (shown to everyone). */
  personaId?: string;
};

export type HookLineOption = { scriptId: string; text: string; angle: string };

// ---------------------------------------------------------------------------
// Soft VO-length heads-up (script approval) — seconds only, advisory only.
// ---------------------------------------------------------------------------

/**
 * Inverts core's word-budget mapping (wordBudget = floor(demoSeconds * wps))
 * using data the wizard already has: implied wps = wordBudget / demoSeconds,
 * so estimated seconds = words * demoSeconds / wordBudget. An estimate — real
 * speech rate varies and TTS may stretch ≤5%; the post-audio advisory stays
 * the exact word.
 */
export function estimateVoSeconds(words: number, demoSeconds: number, wordBudget: number): number {
  if (wordBudget <= 0 || demoSeconds <= 0) return 0;
  return (words * demoSeconds) / wordBudget;
}

/**
 * The gentle Hebrew note under the script textarea when the VO likely outlasts
 * the demo, with the approximate ending shape. Mirrors core's 2s freeze/avatar
 * threshold (a_outro_min_seconds default) — advisory only, nothing blocks.
 * Gates on the DISPLAYED rounded values so the prose never contradicts the
 * numbers beside it; sub-second remainders that round away stay silent (the
 * post-audio advisory is exact).
 */
export function voLengthHeadsUp(
  words: number,
  demoSeconds: number,
  wordBudget: number,
): string | null {
  const estimate = estimateVoSeconds(words, demoSeconds, wordBudget);
  const remainder = estimate - demoSeconds;
  const rounded = Math.round(estimate);
  if (rounded <= Math.round(demoSeconds)) return null;
  const shape =
    remainder < 2
      ? "הפריים האחרון של הסרטון יוקפא לרגע קצר בסוף"
      : "הדמות שבחרתם תופיע בסוף ותסגור את הסרטון";
  return `לפי הערכה, הקריינות תימשך כ־${rounded} שניות — יותר מסרטון המוצר (${Math.round(demoSeconds)} שנ׳), ולכן ${shape}. זו הערכה בלבד — המבנה המדויק יוצג אחרי ההקלטה.`;
}

// ---------------------------------------------------------------------------
// The advisory composition shape (shown after audio approval, before enqueue)
// ---------------------------------------------------------------------------

export type AShape = {
  hookSeconds: number;
  demoSeconds: number;
  voSeconds: number;
  outroMode: "none" | "freeze" | "avatar";
  outroSeconds: number;
};

const formatSeconds = (seconds: number): string => `${Math.round(seconds * 10) / 10}`;

/**
 * Hebrew summary of the projected ad, so a long ending is chosen, never
 * discovered. Advisory only — nothing blocks.
 */
export function shapeSummary(shape: AShape): string {
  const base = `פתיח ${formatSeconds(shape.hookSeconds)} שנ׳ ← סרטון המוצר ${formatSeconds(shape.demoSeconds)} שנ׳`;
  if (shape.outroMode === "freeze") {
    return `${base} — הקריינות ממשיכה עוד ${formatSeconds(shape.outroSeconds)} שנ׳ על הפריים האחרון.`;
  }
  if (shape.outroMode === "avatar") {
    return `${base} ← סיום עם הדמות ${formatSeconds(shape.outroSeconds)} שנ׳ (הדמות מופיעה ומסיימת את הקריינות).`;
  }
  return `${base} — הקריינות מסתיימת יחד עם הסרטון.`;
}

// ---------------------------------------------------------------------------
// Render status timeline (A auto-releases — no QC stage)
// ---------------------------------------------------------------------------

export const A_RENDER_STAGES = ["בתור", "בעיבוד", "מוכן"] as const;

export function aRenderStageIndex(status: string): number {
  switch (status) {
    case "queued":
      return 0;
    case "rendering":
    case "qc_pending": // not expected for A; treat as still working
      return 1;
    case "released":
      return 2;
    default:
      return -1;
  }
}

/** A render still moving through the pipeline (avatar endings pass lipsync first). */
export function isActiveARenderStatus(status: string): boolean {
  return status === "queued" || status === "rendering" || status === "qc_pending";
}
