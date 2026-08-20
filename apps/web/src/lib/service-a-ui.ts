import type { SafeRect } from "@aiugc/core/hook-geometry";
import { readTimeMs } from "@aiugc/core/plan-format";
import { endingCostClause, VO_SHORT_ESTIMATE_NOTICE, VO_SHORT_MEASURED_NOTICE } from "./quote-ui";

/**
 * Pure, client-safe helpers for the Service A wizard. No imports from
 * @aiugc/core's main entry (client bundle) — the "hook-geometry" and
 * "plan-format" subpaths are the deliberate exceptions: pure math + constants,
 * safe in the client. Server rules live in src/lib/service-a.ts and are
 * re-validated on every request; the duplicates here only save a round-trip.
 * Mirrors src/lib/service-b-ui.ts.
 */

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export type AWizardStep =
  "persona" | "hook" | "hookStudio" | "demo" | "plan" | "script" | "audio" | "render";

export type AWizardFormat = "steps" | "full";

/**
 * Format-aware, mirroring B's wizardSteps(category). "steps" is the web
 * wizard: silent format, no persona (the render path consumes none, hook lines
 * default to feminine first person and stay freely editable in the hook
 * studio), no script, no audio. "full" is the voiced seven-step path — today
 * CLI-only; the shape stays here so the two formats are one decision apart,
 * not two files apart.
 */
export function aWizardSteps(format: AWizardFormat): AWizardStep[] {
  return format === "steps"
    ? ["hook", "hookStudio", "demo", "plan", "render"]
    : ["persona", "hook", "hookStudio", "demo", "script", "audio", "render"];
}

// ---------------------------------------------------------------------------
// Demo pre-checks (client-side copy of src/lib/service-a.ts rules)
// ---------------------------------------------------------------------------

export const MAX_DEMO_BYTES = 1024 * 1024 * 1024;
const DEMO_TYPES = ["video/mp4", "video/quicktime"];

export const MIN_DEMO_SECONDS = 8;
export const MAX_DEMO_SECONDS = 180;

export function clientDemoFileError(file: { type: string; size: number }): string | null {
  if (!DEMO_TYPES.includes(file.type)) return "אפשר להעלות רק וידאו בפורמט MP4 או MOV.";
  if (file.size === 0) return "הקובץ שהועלה ריק.";
  if (file.size > MAX_DEMO_BYTES) return "הסרטון גדול מדי — המקסימום הוא 1GB.";
  return null;
}

/** Pre-upload duration gate (same limits the ingest job enforces server-side). */
export function demoDurationError(seconds: number): string | null {
  if (seconds < MIN_DEMO_SECONDS || seconds > MAX_DEMO_SECONDS) {
    return "אורך הסרטון חייב להיות בין 8 שניות ל-3 דקות";
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

/** The state picker pages analysis thumbs twelve at a time (route + picker
 *  agree) — thumb URLs are only signed for the requested page. */
export const ANALYSIS_PAGE_SIZE = 12;

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

// ---------------------------------------------------------------------------
// Durable identity (?demo=<id>&step=<n> on /home/a/new)
// ---------------------------------------------------------------------------

/**
 * Only demo id + step index survive a reload — the rest of the wizard state
 * (hook, hook line, rect) is deliberately session-local. Carried as query
 * params on the static route via history.replaceState: resumable links and
 * browser reload without touching routing, and it survives the sidebar's
 * router.refresh() on a business switch (which is exactly why the restore
 * re-checks ownership — see restoredDemo).
 */
export type AWizardIdentity = { demoId: string | null; step: number };

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse ?demo=&step= — anything malformed degrades to a fresh wizard. */
export function identityFromSearch(search: string, stepCount: number): AWizardIdentity {
  const params = new URLSearchParams(search);
  const demoRaw = params.get("demo");
  const demoId = demoRaw !== null && UUID_SHAPE.test(demoRaw) ? demoRaw : null;
  const stepRaw = Number(params.get("step"));
  const step = Number.isInteger(stepRaw) && stepRaw >= 0 && stepRaw < stepCount ? stepRaw : 0;
  return { demoId, step };
}

/** The inverse — "" when there is nothing worth persisting. */
export function identitySearch(demoId: string | null, step: number): string {
  const params = new URLSearchParams();
  if (demoId) params.set("demo", demoId);
  if (step > 0) params.set("step", String(step));
  const joined = params.toString();
  return joined ? `?${joined}` : "";
}

/**
 * The step a reload can land on. Two rules, both learned the hard way:
 * the plan step needs a READY demo (a mid-ingest demo lands on the demo step,
 * whose own UI handles ingest polling and rejection — the plan step would
 * promise an analysis that may never come), and hookStudio can never be
 * restored (the chosen hook is session-local), so an index pointing at it
 * reroutes to the gallery instead of rendering an empty card.
 */
export function clampRestoredStep(
  step: number,
  steps: AWizardStep[],
  demo: Pick<DemoState, "status"> | null,
): number {
  const target = demo === null ? "hook" : demo.status === "ready" ? "plan" : "demo";
  const max = steps.indexOf(target);
  const clamped = Math.max(0, Math.min(step, max === -1 ? 0 : max));
  return steps[clamped] === "hookStudio" ? Math.max(0, steps.indexOf("hook")) : clamped;
}

/**
 * Whether the wizard may write ?demo=&step= to the URL. Never while restoring
 * — and after a TRANSIENT restore failure (network blip, 5xx), never while the
 * wizard still sits fresh at the start: writing there would replaceState the
 * durable link away, and durability is the whole point. The moment the
 * customer actually moves (a demo lands or the step changes) the wizard owns
 * the URL again. Definitive rejections (403/404, wrong business, rejected
 * demo) are not "failed" — those discard the identity on purpose.
 */
export function shouldSyncIdentity(opts: {
  restoring: boolean;
  restoreFailed: boolean;
  demoId: string | null;
  step: number;
}): boolean {
  if (opts.restoring) return false;
  if (opts.restoreFailed && opts.demoId === null && opts.step === 0) return false;
  return true;
}

/**
 * Accept or discard a restored demo. The business check is the point: the
 * demo GET's requireDemo only proves the USER owns the demo — an account with
 * two businesses would otherwise carry ?demo= across a sidebar business
 * switch and edit business A's demo under business B's chrome. A rejected
 * demo is not resumable either — the demo step starts it over. The stored
 * footage note rides along: without it, restore + back-to-demo + continue
 * would PATCH an empty description over the saved one ("blank clears").
 */
export function restoredDemo(
  demoId: string,
  body: {
    status: string;
    businessId?: string;
    description?: string;
    durationMs?: number;
    thumbUrl?: string;
  },
  businessId: string,
): { demo: DemoState; description: string } | null {
  if (body.businessId !== businessId) return null;
  if (body.status === "rejected") return null;
  return {
    demo: {
      id: demoId,
      status: body.status,
      durationMs: body.durationMs,
      thumbUrl: body.thumbUrl,
    },
    description: body.description ?? "",
  };
}

// ---------------------------------------------------------------------------
// The step plan surface (read-only in 8a; the editor lands in 8b)
// ---------------------------------------------------------------------------

/** One stored plan step on the wire — durationMs is ASSEMBLED (gap-capped). */
export type PlanStepWire = {
  timestampMs: number;
  actionType: string;
  label: string;
  sourceIndex: number;
  durationMs: number;
};

/** stepPlanResponse — the one shape every plan-touching route returns. */
export type StepPlanWire = {
  planId: string;
  demoId: string;
  analysisId: string;
  status: string; // pending | planning | ready | failed
  steps: PlanStepWire[];
  notes?: string;
  failReason?: string;
  approvedAt?: string;
};

/** One analysis state from GET .../analysis (?indexes= adds thumbUrl). */
export type AnalysisStateWire = {
  index: number;
  timestampMs: number;
  screenName: string;
  visibleText: string[];
  thumbUrl?: string;
};

/** A plan still generating — poll, and the retry button stays disabled:
 *  requestDemoPlan collapses onto the in-flight job in this window, so a
 *  click here would be a silent no-op. */
export function isActivePlanStatus(status: string): boolean {
  return status === "pending" || status === "planning";
}

/**
 * demo_analyses statuses that mean "still working" — the plan step keeps its
 * gentle poll up through these. NB the stored spelling is "analysing"
 * (British, matching the pg enum): "analyzing" here would deactivate the poll
 * mid-analysis and strand the customer on a blank card with no spinner.
 */
export function isAnalysisWorkingStatus(status: string): boolean {
  return status === "pending" || status === "analysing";
}

/**
 * The ?indexes= batches for a plan's cards. The route caps one request at
 * ANALYSIS_PAGE_SIZE signed thumbs, and plan size follows the a_steps_max
 * config knob — a single oversized request would 400 on every retry, so the
 * client chunks instead. Deduped; order preserved.
 */
export function analysisIndexBatches(indexes: number[]): number[][] {
  const unique = [...new Set(indexes)];
  const batches: number[][] = [];
  for (let i = 0; i < unique.length; i += ANALYSIS_PAGE_SIZE) {
    batches.push(unique.slice(i, i + ANALYSIS_PAGE_SIZE));
  }
  return batches;
}

const PLAN_FAILED_GENERIC = "יצירת תוכנית הצעדים נכשלה — אפשר לנסות שוב.";

/**
 * The failure line the customer sees. fail_reason is usually customer-facing
 * Hebrew, but PermanentErrors without a customerMessage land as raw English
 * ("demo <id> not found") — that reads as a bug and leaks an id, so anything
 * without Hebrew letters shows the generic line with the raw string kept
 * behind a details toggle (RLS hides jobs.last_error entirely; this is one of
 * the few diagnostics that reaches the client at all).
 */
export function planFailureNotice(failReason?: string): { message: string; raw?: string } {
  if (failReason && /[֐-׿]/.test(failReason)) return { message: failReason };
  return failReason
    ? { message: PLAN_FAILED_GENERIC, raw: failReason }
    : { message: PLAN_FAILED_GENERIC };
}

/**
 * What a plan POST response meant. Same planId back = the request collapsed
 * onto the in-flight job (requestDemoPlan's pending/planning window) — the
 * customer must see "already running", never a silent nothing.
 */
export function retryOutcome(
  currentPlanId: string | null,
  response: { planId: string },
): "started" | "already_running" {
  return response.planId === currentPlanId ? "already_running" : "started";
}

/**
 * Read-time headroom: how much longer the step stays up than the label needs.
 * Negative = the caption is on screen for less time than it takes to read —
 * the exact defect the model path rejects and the human path allows silently.
 * Uses the exported readTimeMs, never a client-side copy of the formula.
 */
export function stepHeadroomMs(step: Pick<PlanStepWire, "label" | "durationMs">): number {
  return step.durationMs - readTimeMs(step.label);
}

/** Chronological display order — order derives from timestamp, nothing else. */
export function sortedPlanSteps(steps: PlanStepWire[]): PlanStepWire[] {
  return [...steps].sort((a, b) => a.timestampMs - b.timestampMs);
}

/** m:ss position of a step inside the demo. */
export function fmtTimestamp(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

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
 *
 * The maths is unchanged by v7; what the budget MEANS is. It is the length
 * that fills the demo — a floor to reach, not a cap — so an estimate above
 * demoSeconds is the ordinary case and one below it is the problem.
 */
export function estimateVoSeconds(words: number, demoSeconds: number, wordBudget: number): number {
  if (wordBudget <= 0 || demoSeconds <= 0) return 0;
  return (words * demoSeconds) / wordBudget;
}

export type AEndingMode = AShape["outroMode"];

/**
 * What the script step can project: the three real endings, plus "short" —
 * not an ending at all, but a narration that stops before the footage does.
 * planAOutro has no such mode; nothing server-side ever returns it.
 */
export type AEstimatedEnding = AEndingMode | "short";

/**
 * How far the projected narration may fall below the demo before the script
 * step names it. Deliberately NOT a_outro_min_seconds: that one means "the
 * smallest remainder worth an avatar ending", this one means "the smallest
 * silence worth telling the customer about". They share the value 2 today by
 * coincidence, and a change to either must not move the other.
 */
const SHORT_VO_TOLERANCE_SECONDS = 2;

/**
 * Which ending a VO remainder (vo minus demo, in seconds) points at. The three
 * positive outcomes mirror core's planAOutro thresholds (a_outro_min_seconds
 * default 2) — advisory only; createSet re-decides server-side.
 *
 * "short" has no server-side counterpart: planAOutro sees any negative
 * remainder as "no ending needed", which is true of the composition and false
 * of the ad — those seconds play in silence. Display names it; nothing acts on
 * it.
 */
export function endingForRemainder(remainderSeconds: number): AEstimatedEnding {
  if (remainderSeconds < -SHORT_VO_TOLERANCE_SECONDS) return "short";
  if (remainderSeconds <= 0) return "none";
  if (remainderSeconds < 2) return "freeze";
  return "avatar";
}

/**
 * The ending the CURRENT script length points at. Gates on the DISPLAYED
 * rounded values so the prose never contradicts the numbers beside it —
 * sub-second overruns that round away read as "none" (the post-audio advisory
 * is exact). null = inputs unusable (no budget yet).
 *
 * A narration falling well short of the demo returns "short" rather than
 * collapsing into "none": the two are opposite outcomes, and "none" claims the
 * narration ends WITH the footage, which is a false thing to tell someone whose
 * ad is about to end in silence.
 */
export function estimatedEnding(
  words: number,
  demoSeconds: number,
  wordBudget: number,
): AEstimatedEnding | null {
  const estimate = estimateVoSeconds(words, demoSeconds, wordBudget);
  if (estimate <= 0) return null;
  // The rounding gate applies to OVERRUNS only. Rounding a shortfall away would
  // hand it back to "none", which is the collapse this state exists to undo.
  const remainder = estimate - demoSeconds;
  if (remainder > 0 && Math.round(estimate) <= Math.round(demoSeconds)) return "none";
  return endingForRemainder(remainder);
}

/**
 * THE sentence naming the projected ending — the script step (exact=false, an
 * estimate from the word budget, בערך framing) and the audio step (exact=true,
 * from the measured recording) both speak through this, so the wording never
 * forks. The render step's shapeSummary stays the full numeric display; do
 * not add a third phrasing.
 *
 * The estimated avatar ending names its projected length (whole seconds,
 * `estimatedOutroSeconds`, בערך framing) but says it costs extra WITHOUT a
 * figure: there is no audio yet, so a credit number here would be an estimate
 * of an estimate. The one exact number appears once, in shapeSummary, after
 * the recording exists.
 */
export function endingSentence(
  mode: AEstimatedEnding,
  exact: boolean,
  estimatedOutroSeconds?: number,
): string {
  if (mode === "short") return exact ? VO_SHORT_MEASURED_NOTICE : VO_SHORT_ESTIMATE_NOTICE;
  if (mode === "freeze") {
    return exact
      ? "ההקלטה ארוכה מעט מסרטון המוצר — הפריים האחרון יוקפא לרגע קצר בסוף."
      : "לפי האורך הנוכחי, הקריינות תסתיים בערך רגע אחרי סרטון המוצר — הפריים האחרון יוקפא לרגע קצר בסוף.";
  }
  if (mode === "avatar") {
    if (exact) {
      return "ההקלטה ארוכה מסרטון המוצר — הדמות שבחרתם תופיע בסוף ותסגור את הסרטון.";
    }
    const overrun =
      estimatedOutroSeconds === undefined
        ? "בערך גם אחרי סרטון המוצר"
        : `בערך ${estimatedOutroSeconds} שניות אחרי סרטון המוצר`;
    return `לפי האורך הנוכחי, הקריינות תימשך ${overrun} — הדמות שבחרתם תופיע בסוף ותסגור את הסרטון, בתוספת קרדיטים שתוצג לפני האישור.`;
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
