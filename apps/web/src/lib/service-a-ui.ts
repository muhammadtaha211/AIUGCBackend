import type { SafeRect } from "@aiugc/core/hook-geometry";
import { endingCostClause } from "./quote-ui";

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

/** The reuse picker pages ready demos four at a time (route + step agree). */
export const DEMO_PAGE_SIZE = 4;

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

/**
 * One generation: all ten frames in prompt order, plus the coin-flip that
 * decides which five go on screen first.
 *
 * The parity lives on the batch, not on the component, because it belongs to
 * this generation. A fixed parity would pin frame 1 (POV) to the first screen
 * for every customer forever — the second screen would be structurally
 * POV-less, and the angle-pick data would record display position rather than
 * which frames actually win.
 */
export type HookBatch = { options: HookLineOption[]; parity: 0 | 1 };

/**
 * The five on screen. Interleaved by FRAME INDEX, never split down the middle:
 * the model wrote all ten in one pass at equal effort, so a rank-ordered split
 * would serve the weaker five on reroll and the second screen would feel flat.
 * Interleaving makes the two halves simply different shapes.
 */
export function hookHalfOptions(batch: HookBatch, half: 0 | 1): HookLineOption[] {
  return batch.options.filter((_, index) => index % 2 === (half ^ batch.parity));
}

/**
 * Whether two personas speak with the same voice as far as the COPY is
 * concerned. Hook lines are written in the persona's first person and Hebrew
 * first person is gendered, so a cross-gender swap invalidates them — but a
 * female→female swap leaves all ten valid. A null gender generates feminine
 * copy (core's documented default), so null and "female" are the same speaker.
 */
export function sameSpeakerGender(a: string | null, b: string | null): boolean {
  return (a ?? "female") === (b ?? "female");
}

// ---------------------------------------------------------------------------
// The projected ending (script step: estimated; audio step: exact) — advisory.
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

export type AEndingMode = AShape["outroMode"];

/**
 * Which ending a VO remainder (vo minus demo, in seconds) points at. Mirrors
 * core's planAOutro thresholds (a_outro_min_seconds default 2) — advisory
 * only; createSet re-decides server-side.
 */
export function endingForRemainder(remainderSeconds: number): AEndingMode {
  if (remainderSeconds <= 0) return "none";
  if (remainderSeconds < 2) return "freeze";
  return "avatar";
}

/**
 * The ending the CURRENT script length points at. Gates on the DISPLAYED
 * rounded values so the prose never contradicts the numbers beside it —
 * sub-second overruns that round away read as "none" (the post-audio advisory
 * is exact). null = inputs unusable (no budget yet).
 */
export function estimatedEnding(
  words: number,
  demoSeconds: number,
  wordBudget: number,
): AEndingMode | null {
  const estimate = estimateVoSeconds(words, demoSeconds, wordBudget);
  if (estimate <= 0) return null;
  if (Math.round(estimate) <= Math.round(demoSeconds)) return "none";
  return endingForRemainder(estimate - demoSeconds);
}

/**
 * THE sentence naming the projected ending — the script step (exact=false, an
 * estimate from the word budget, בערך framing) and the audio step (exact=true,
 * from the measured recording) both speak through this, so the wording never
 * forks. The render step's shapeSummary stays the full numeric display; do
 * not add a third phrasing.
 */
export function endingSentence(mode: AEndingMode, exact: boolean): string {
  if (mode === "freeze") {
    return exact
      ? "ההקלטה ארוכה מעט מסרטון המוצר — הפריים האחרון יוקפא לרגע קצר בסוף."
      : "לפי האורך הנוכחי, הקריינות תסתיים בערך רגע אחרי סרטון המוצר — הפריים האחרון יוקפא לרגע קצר בסוף.";
  }
  if (mode === "avatar") {
    return exact
      ? "ההקלטה ארוכה מסרטון המוצר — הדמות שבחרתם תופיע בסוף ותסגור את הסרטון."
      : "לפי האורך הנוכחי, הקריינות תימשך בערך גם אחרי סרטון המוצר — הדמות שבחרתם תופיע בסוף ותסגור את הסרטון.";
  }
  return exact
    ? "ההקלטה מסתיימת יחד עם סרטון המוצר — בלי סיום נוסף."
    : "לפי האורך הנוכחי, הקריינות תסתיים בערך יחד עם סרטון המוצר.";
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
  /**
   * What the ending adds to the price, differenced server-side. null = admin
   * bypass (nothing is charged, so no credits are named).
   */
  outroCredits: number | null;
};

const formatSeconds = (seconds: number): string => `${Math.round(seconds * 10) / 10}`;

/**
 * Hebrew summary of the projected ad, so a long ending is chosen, never
 * discovered. The ending and what it costs are ONE sentence: an overrun is not
 * a defect to be told about separately, it is a choice with a price. Advisory
 * only — nothing blocks. quoteLine still carries the total and the balance.
 */
export function shapeSummary(shape: AShape): string {
  const base = `פתיח ${formatSeconds(shape.hookSeconds)} שנ׳ ← סרטון המוצר ${formatSeconds(shape.demoSeconds)} שנ׳`;
  const cost = endingCostClause(shape.outroCredits);
  if (shape.outroMode === "freeze") {
    return `${base} — הקריינות ממשיכה עוד ${formatSeconds(shape.outroSeconds)} שנ׳ על הפריים האחרון${cost}.`;
  }
  if (shape.outroMode === "avatar") {
    return `${base} ← סיום עם הדמות ${formatSeconds(shape.outroSeconds)} שנ׳ (הדמות מופיעה ומסיימת את הקריינות)${cost}.`;
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
