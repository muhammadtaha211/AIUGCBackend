/**
 * Pure, client-safe helpers for the Service A wizard. No imports from
 * @aiugc/core (client bundle) — server rules live in src/lib/service-a.ts and
 * are re-validated on every request; the duplicates here only save a
 * round-trip. Mirrors src/lib/service-b-ui.ts.
 */

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export type AWizardStep = "demo" | "hook" | "persona" | "script" | "audio" | "render";

/** One fixed path — Service A has no category-driven steps. */
export const A_WIZARD_STEPS: AWizardStep[] = [
  "demo",
  "hook",
  "persona",
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

export type HookClip = { id: string; durationMs: number; previewUrl: string };

export type HookLineOption = { scriptId: string; text: string; angle: string };

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
