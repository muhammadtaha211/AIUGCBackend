import type { SafeRect } from "@aiugc/core/hook-geometry";
import {
  A_STEPS_MAX_DEFAULT,
  A_STEPS_MIN_DEFAULT,
  MAX_LABEL_WORDS,
  MIN_LABEL_WORDS,
  PLAN_SKIP_SCREEN_KINDS,
  readTimeMs,
  totalRuntimeMs,
} from "@aiugc/core/plan-format";
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

/**
 * Pre-upload aspect gate — the browser already decoded the metadata for the
 * duration check, so a horizontal video fails HERE instead of after a
 * possibly-1GB upload. Same Hebrew the ingest probe stores as rejectReason.
 * NB this saves the upload and the wait, never analysis money: reject-at-probe
 * already precedes the analysis enqueue. Undecodable metadata (undefined)
 * skips the gate, same as the duration check — the server re-checks.
 */
export function clientDemoAspectError(width?: number, height?: number): string | null {
  if (width === undefined || height === undefined || width === 0 || height === 0) return null;
  return height <= width ? "הסרטון אופקי — צריך וידאו אנכי (9:16)" : null;
}

// ---------------------------------------------------------------------------
// The duplicate-upload brake (8d): a fumbled re-upload of footage that is
// already analyzed costs a full fresh analysis. Duration is the only signal
// the browser has before the bytes move — a match is a QUESTION, never a gate.
// ---------------------------------------------------------------------------

/**
 * Browser-decoded duration vs ffprobe-on-normalized rarely agree exactly;
 * measured drift is well under this. Tight on purpose — a false "you already
 * uploaded this" on genuinely new footage erodes trust in the warning.
 */
export const DUPLICATE_DURATION_TOLERANCE_MS = 250;

/** One ready demo's identity for the duplicate check + the "use existing"
 *  offer — every ready row, not just the visible page (route sends all). */
export type ReadyDemoDuration = {
  id: string;
  durationMs?: number;
  description?: string;
  createdAt: string;
};

/** The newest ready demo whose duration matches the picked file, or null. */
export function duplicateDemoMatch(
  seconds: number,
  rows: ReadyDemoDuration[],
): ReadyDemoDuration | null {
  const ms = seconds * 1000;
  const matches = rows.filter(
    (row) =>
      row.durationMs !== undefined &&
      Math.abs(row.durationMs - ms) <= DUPLICATE_DURATION_TOLERANCE_MS,
  );
  if (matches.length === 0) return null;
  return matches.reduce((newest, row) => (row.createdAt > newest.createdAt ? row : newest));
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
  /** Ingest pipeline progress — present on the demo GET while ingesting. */
  ingest?: JobProgressWire;
  /** Newest analysis attempt's status ("missing" = none yet) — present on the
   *  demo GET once ready; absent on locally-constructed states (reuse rows). */
  analysis?: { status: string };
};

/** A demo still moving through ingest — the step keeps polling while true. */
export function isIngestingDemoStatus(status: string): boolean {
  return status === "uploaded" || status === "probing" || status === "normalizing";
}

// ---------------------------------------------------------------------------
// Pipeline progress (8d): the queue has no push channel, so the wait surfaces
// derive "is anything processing this" from core's getJobProgress payload.
// ---------------------------------------------------------------------------

/** core's JobProgress on the wire (demo GET `ingest`, analysis/plan/render
 *  GET `job`). */
export type JobProgressWire = {
  state: "missing" | "queued" | "running" | "failed" | "done";
  ahead?: number;
  elapsedMs?: number;
  /** Queued but deliberately scheduled in the future (backoff, budget park). */
  resumeAtMs?: number;
  /** Running only: the handler's checkpointed 0-1 fraction (render frames). */
  progress?: number;
  heartbeat: "alive" | "stale" | "unknown";
};

/** "רץ כבר X" — whole minutes, never implying seconds-scale progress. */
export function fmtElapsedHe(elapsedMs: number): string {
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return "פחות מדקה";
  if (minutes === 1) return "דקה";
  return `${minutes} דקות`;
}

export type AnalysisWaitView =
  | { kind: "waiting"; line: string; sub?: string }
  | { kind: "stuck"; line: string }
  /** The analyze job died with no analysis row — the caller renders its
   *  existing failed-analysis copy. Without this the card spins forever. */
  | { kind: "failed" };

const ANALYSIS_QUEUED_LINE = "הסרטון בתור לניתוח — זה לוקח כמה דקות.";
const PIPELINE_STUCK_LINE =
  "משהו נתקע אצלנו וה{מה} לא מתקדם כרגע — זה לא בצד שלכם. הסרטון שמור, והוא יימשך אוטומטית. אפשר לחזור לכאן מאוחר יותר.";
const stuckLine = (what: string) => PIPELINE_STUCK_LINE.replace("{מה}", what);

/**
 * What the plan step's analysis wait shows. Real timescale, honest states:
 * queue position while queued (analyze_demo shares the heavy lane with
 * renders — the wait is minutes to tens of minutes), elapsed while running,
 * "stuck" when no worker has claimed anything past the heartbeat window, and
 * "failed" when the job is dead. No payload (older server, first poll still
 * in flight) degrades to the pre-8d generic line.
 */
export function analysisWaitView(job?: JobProgressWire): AnalysisWaitView {
  if (!job) return { kind: "waiting", line: ANALYSIS_QUEUED_LINE };
  if (job.state === "failed") return { kind: "failed" };
  if (job.heartbeat === "stale" && (job.state === "queued" || job.state === "running")) {
    return { kind: "stuck", line: stuckLine("ניתוח") };
  }
  if (job.state === "running") {
    return {
      kind: "waiting",
      line:
        job.elapsedMs !== undefined
          ? `מנתחים את הסרטון עכשיו — רץ כבר ${fmtElapsedHe(job.elapsedMs)}.`
          : "מנתחים את הסרטון עכשיו.",
    };
  }
  if (job.state === "queued") {
    // A deliberately-rescheduled job (backoff, budget park) is PAUSED, not in
    // line — "starts soon" over an hours-long park would be a lie.
    if (job.resumeAtMs !== undefined) {
      return {
        kind: "waiting",
        line: ANALYSIS_QUEUED_LINE,
        sub: "הניתוח מושהה כרגע ויתחדש אוטומטית מאוחר יותר.",
      };
    }
    // ahead undefined = the queue depth is unknown (no lane named) — say
    // nothing rather than promising "soon" from behind three renders.
    const sub =
      job.ahead === undefined
        ? undefined
        : job.ahead === 1
          ? "לפני הסרטון שלכם יש עוד עבודה אחת בתור."
          : job.ahead > 1
            ? `לפני הסרטון שלכם יש עוד ${job.ahead} עבודות בתור.`
            : "הניתוח יתחיל בקרוב.";
    return { kind: "waiting", line: ANALYSIS_QUEUED_LINE, ...(sub ? { sub } : {}) };
  }
  // missing/done: enqueue race or a just-finished job — the next poll resolves.
  return { kind: "waiting", line: ANALYSIS_QUEUED_LINE };
}

export type PlanWaitView =
  | { kind: "waiting"; line: string; sub?: string }
  | { kind: "stuck"; line: string }
  /** The plan job died with the row stuck pending/planning — the caller
   *  renders a failure card with retry (a retry is a NEW plan row, so the
   *  button genuinely works here, unlike the analysis). */
  | { kind: "failed" };

/**
 * The plan-generation wait — analysisWaitView's twin over the plan GET's 8d
 * payload. The staged copy rides the plan ROW's real transition: "pending"
 * (enqueued, the light lane may be busy) vs "planning" (flipped right before
 * the paid Claude call — the model is working now). Elapsed is garnish on the
 * planning stage; a stale heartbeat or a dead job stops the spinner lying.
 * No queue position: the plan GET passes no lane (core exports no light-lane
 * type list), so `ahead` is undefined and nothing is promised.
 */
export function planWaitView(status: string, job?: JobProgressWire): PlanWaitView {
  if (job?.state === "failed") return { kind: "failed" };
  if (job && job.heartbeat === "stale" && (job.state === "queued" || job.state === "running")) {
    return { kind: "stuck", line: stuckLine("תכנון") };
  }
  // A parked/deep-backoff job is PAUSED whatever the row says — the row sits
  // on "planning" when the budget park hit mid-call (the flip happens before
  // the paid call), and "building now" over an hours-long park is a lie. Same
  // ruling as the analysis wait: resumeAtMs beats the row status.
  if (job?.state === "queued" && job.resumeAtMs !== undefined) {
    return {
      kind: "waiting",
      line: "התוכנית ממתינה בתור…",
      sub: "יצירת התוכנית מושהית כרגע ותתחדש אוטומטית מאוחר יותר.",
    };
  }
  if (status === "planning") {
    const sub =
      job?.state === "running" && job.elapsedMs !== undefined
        ? `רץ כבר ${fmtElapsedHe(job.elapsedMs)}.`
        : undefined;
    return { kind: "waiting", line: "בונים את תוכנית הצעדים…", ...(sub ? { sub } : {}) };
  }
  return { kind: "waiting", line: "התוכנית ממתינה בתור…" };
}

/**
 * The ingest spinner's staged copy. The stages are the REAL demo.status
 * transitions the worker writes as it goes (uploaded -> probing ->
 * normalizing), not invented progress — the poll already carries them, the
 * old spinner just never read them. Elapsed rides the ingest job payload
 * while it runs, whole minutes only (fmtElapsedHe).
 */
export function ingestPhaseView(
  status: string,
  job?: JobProgressWire,
): { line: string; sub?: string } {
  const line =
    status === "probing"
      ? "בודקים את הסרטון…"
      : status === "normalizing"
        ? "מכינים את הסרטון…"
        : "הסרטון בתור לעיבוד…";
  const sub =
    job?.state === "running" && job.elapsedMs !== undefined
      ? `רץ כבר ${fmtElapsedHe(job.elapsedMs)}.`
      : undefined;
  return sub ? { line, sub } : { line };
}

/**
 * The demo step's way out of a stalled ingest. null = still working normally
 * (spinner stays). dead = the job exhausted its retries: nothing will resume
 * it, so re-uploading is the honest remedy; the stale case is the opposite —
 * the upload is safe and processing resumes when a worker returns.
 */
export function ingestStuckView(job?: JobProgressWire): { line: string; dead: boolean } | null {
  if (!job) return null;
  if (job.state === "failed") {
    return { dead: true, line: "עיבוד הסרטון נכשל ולא ימשיך מעצמו — נסו להעלות את הסרטון שוב." };
  }
  if (job.heartbeat === "stale" && (job.state === "queued" || job.state === "running")) {
    return { dead: false, line: stuckLine("עיבוד") };
  }
  return null;
}

/**
 * The ready card's passive line: analysis was enqueued at ingest and runs on
 * behind this screen for minutes — said in the past tense ("was sent") so the
 * line stays true even after the un-polled ready card goes stale. Absent
 * status (a reused demo, constructed locally) shows nothing: its analysis
 * finished long ago and the plan step owns any residual wait.
 */
export function analysisBackgroundLine(analysisStatus?: string): string | null {
  if (analysisStatus === undefined) return null;
  return analysisStatus === "missing" || isAnalysisWorkingStatus(analysisStatus)
    ? "הסרטון נשלח לניתוח שרץ ברקע כמה דקות — אפשר להמשיך בינתיים."
    : null;
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
  /** validator | quota | input | internal | transient — absent on rows from
   *  before 0029, where the quota substring marker is the only signal. */
  failKind?: string;
  approvedAt?: string;
  /** Plan job progress — attached by the GET while pending/planning (8d). */
  job?: JobProgressWire;
};

/** One analysis state from GET .../analysis — the route sends every field on
 *  all three query shapes; only thumbUrl is conditional (?indexes=/?page=). */
export type AnalysisStateWire = {
  index: number;
  timestampMs: number;
  screenName: string;
  visibleText: string[];
  action: string;
  actionType: string;
  screenKind?: string;
  sameStateAsPrevious: boolean;
  legibility: string;
  salienceNote?: string;
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
 * The tail every daily-quota line ends with. A quota refusal is the one plan
 * failure a retry cannot fix — the rolling 24h window has to clear first, and
 * the customer cannot raise their own cap — so the failure card drops its
 * retry button when it sees this.
 *
 * LEGACY FALLBACK since 0029: rows written by the current job carry the
 * structured fail_kind and never reach this substring. It stays only for
 * failed rows from before the column existed (and the 429 route body, which
 * carries no row at all).
 */
const QUOTA_MARKER = "נסו שוב מחר";

/**
 * The failure line the customer sees. fail_reason is usually customer-facing
 * Hebrew, but PermanentErrors without a customerMessage land as raw English
 * ("demo <id> not found") — that reads as a bug and leaks an id, so anything
 * without Hebrew letters shows the generic line with the raw string kept
 * behind a details toggle. (jobs.last_error never reaches any route — nothing
 * queries it, not an RLS matter — so this is one of the few diagnostics that
 * reaches the client at all.)
 *
 * failKind (demo_step_plans.fail_kind, 0029) decides retryability when
 * present; the QUOTA_MARKER substring is the pre-0029 fallback.
 */
export function planFailureNotice(
  failReason?: string,
  failKind?: string,
): {
  message: string;
  raw?: string;
  /** false = a daily quota refused it; offering "try again" here would lie. */
  retryable: boolean;
} {
  const quotaHit = failKind ? failKind === "quota" : (failReason?.includes(QUOTA_MARKER) ?? false);
  if (failReason && /[֐-׿]/.test(failReason)) {
    return { message: failReason, retryable: !quotaHit };
  }
  return failReason
    ? { message: PLAN_FAILED_GENERIC, raw: failReason, retryable: !quotaHit }
    : { message: PLAN_FAILED_GENERIC, retryable: !quotaHit };
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

// ---------------------------------------------------------------------------
// The plan editor (8b) — pure decisions behind step-plan.tsx's editor
// ---------------------------------------------------------------------------

/** Whitespace words, the same split readTimeMs counts. */
export function labelWordCount(label: string): number {
  return label.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * The soft word warning, firing at MAX_LABEL_WORDS (the model path's hard
 * ceiling; the target band is 3–5). ADVISORY ONLY: the human edit path is
 * never rejected on word count, and nothing client-side ever validates a
 * label against visibleText — the anti-fabrication rule constrains the
 * model, not the customer.
 */
export function labelWordWarning(label: string): string | null {
  return labelWordCount(label) >= MAX_LABEL_WORDS
    ? `כיתוב ארוך — עדיף ${MIN_LABEL_WORDS}–${MAX_LABEL_WORDS - 1} מילים כדי שיספיקו לקרוא אותו.`
    : null;
}

/** Soft: below the a_steps_min default the ad starts feeling thin. The server
 *  accepts any non-empty plan — deleting stays allowed, this only names it. */
export function deleteWarning(stepCount: number): string | null {
  return stepCount < A_STEPS_MIN_DEFAULT
    ? `בתוכנית פחות מ-${A_STEPS_MIN_DEFAULT} צעדים — המודעה עלולה להרגיש קצרה מדי.`
    : null;
}

/** Soft, the add-side twin: past the a_steps_max default (the MODEL's cap —
 *  the founder's ruling is that hand edits are never capped) the ad outgrows
 *  the format. Advisory only; adding stays allowed, this only names it. */
export function addWarning(stepCount: number): string | null {
  return stepCount > A_STEPS_MAX_DEFAULT
    ? `בתוכנית יותר מ-${A_STEPS_MAX_DEFAULT} צעדים — הפורמט הזה עובד הכי טוב במודעות קצרות, שקלו להשאיר רק את הצעדים החשובים.`
    : null;
}

/** A reason the draft cannot be saved, or null. Only the empty label — the
 *  input's own maxLength enforces MAX_LABEL_CHARS. */
export function draftBlockedReason(draft: Pick<PlanStepWire, "label">[]): string | null {
  return draft.some((step) => step.label.trim().length === 0)
    ? "יש צעד בלי כיתוב — כתבו כיתוב או מחקו את הצעד."
    : null;
}

/** The PATCH body: exactly what the customer can edit. The server re-derives
 *  timestamp/actionType/duration from sourceIndex and re-sorts by timestamp. */
export function stepsPayload(
  draft: Pick<PlanStepWire, "sourceIndex" | "label">[],
): { sourceIndex: number; label: string }[] {
  return draft.map((step) => ({ sourceIndex: step.sourceIndex, label: step.label.trim() }));
}

/**
 * Whether the draft differs from the stored plan. Both sides are ordered by
 * timestamp (the draft seeds from sortedPlanSteps and is never reordered), so
 * position-wise comparison suffices. Labels compare trimmed because the
 * payload trims — a whitespace-only edit would round-trip to "no change".
 */
export function planStepsDirty(
  draft: Pick<PlanStepWire, "sourceIndex" | "label">[],
  stored: PlanStepWire[],
): boolean {
  const base = sortedPlanSteps(stored);
  if (draft.length !== base.length) return true;
  return draft.some(
    (step, i) =>
      step.sourceIndex !== base[i]!.sourceIndex || step.label.trim() !== base[i]!.label.trim(),
  );
}

// ---------------------------------------------------------------------------
// The inventory picker (8c) — pure decisions behind state-picker.tsx
// ---------------------------------------------------------------------------

/** Client mirror of core's isSkippedKind. Absent screenKind means "no
 *  information" and stays visible — the documented per-state semantics, which
 *  is also the whole v1 handling: detected on the data, not on promptVersion,
 *  so a v1 analysis (no screenKind anywhere) simply lands in the main grid. */
export function isSkippedScreenKind(screenKind?: string): boolean {
  return (
    screenKind !== undefined && (PLAN_SKIP_SCREEN_KINDS as ReadonlySet<string>).has(screenKind)
  );
}

/**
 * The picker's two tiers, mirroring core's quality/legal pool split
 * (dryRunPlan): the main grid prefers exactly what the model path prefers;
 * the collapsed tier keeps everything legal-but-poor pickable — a human may
 * legitimately want the OAuth screen in a signup-flow ad. Unreadable states
 * are dropped entirely: the server rejects them whoever selected them, so a
 * tile for one would be a dead pick.
 */
export function pickerPools(states: AnalysisStateWire[]): {
  quality: AnalysisStateWire[];
  other: AnalysisStateWire[];
} {
  const quality: AnalysisStateWire[] = [];
  const other: AnalysisStateWire[] = [];
  for (const state of states) {
    if (state.legibility === "unreadable") continue;
    const preferred =
      state.legibility === "high" &&
      !state.sameStateAsPrevious &&
      state.actionType !== "idle" &&
      !isSkippedScreenKind(state.screenKind);
    (preferred ? quality : other).push(state);
  }
  return { quality, other };
}

/** One stored grouping, as the analysis GET serves it (0030). */
export type InventorySectionWire = { title: string; stateIndexes: number[] };

/** A rendered inventory section. `title: null` = the untitled flat grid —
 *  both the no-grouping fallback and the whole pre-0030 world. */
export type InventorySection = { title: string | null; states: AnalysisStateWire[] };

/**
 * Fold the stored groupings over the QUALITY pool (sections never touch the
 * collapsed "פחות מתאימים" tier). Absent/empty groupings collapse to one
 * untitled section holding today's exact flat grid — the fallback for old
 * analyses, failed groupings and capped accounts. Quality states the
 * grouping missed land in a trailing "עוד מסכים" bucket; indexes outside
 * the quality pool (or claimed twice) are dropped, mirroring the server-side
 * validator's rules on the client's stricter pool.
 */
export function inventorySections(
  quality: AnalysisStateWire[],
  sections?: InventorySectionWire[],
): InventorySection[] {
  if (!sections || sections.length === 0) return [{ title: null, states: quality }];
  const byIndex = new Map(quality.map((state) => [state.index, state]));
  const used = new Set<number>();
  const out: InventorySection[] = [];
  for (const section of sections) {
    const states: AnalysisStateWire[] = [];
    for (const index of section.stateIndexes) {
      if (!byIndex.has(index) || used.has(index)) continue;
      used.add(index);
      states.push(byIndex.get(index)!);
    }
    states.sort((a, b) => a.timestampMs - b.timestampMs);
    if (states.length > 0) out.push({ title: section.title, states });
  }
  const leftovers = quality.filter((state) => !used.has(state.index));
  if (leftovers.length > 0) {
    out.push({ title: out.length > 0 ? "עוד מסכים" : null, states: leftovers });
  }
  return out;
}

/** A plan step that exists only in the draft until the next save. The server
 *  assembles the real durationMs on PATCH; until then the card says so
 *  instead of showing a number that was never computed. */
export type DraftStep = PlanStepWire & { added?: boolean };

/** Insert a picked state into the draft — chronological by construction:
 *  order derives from timestamp, and the server re-sorts anyway. */
export function insertDraftStep(
  draft: DraftStep[],
  state: Pick<AnalysisStateWire, "index" | "timestampMs" | "actionType">,
  label: string,
): DraftStep[] {
  const step: DraftStep = {
    sourceIndex: state.index,
    timestampMs: state.timestampMs,
    actionType: state.actionType,
    label: label.trim(),
    durationMs: 0,
    added: true,
  };
  return [...draft, step].sort((a, b) => a.timestampMs - b.timestampMs);
}

/** m:ss position of a step inside the demo. */
export function fmtTimestamp(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** What an inventory state or a draft-added step previews for: the render
 *  floor every unsqueezed step actually runs (MIN_STEP_MS, server-side in
 *  demo-step-plans.ts — unimportable into a browser bundle, hence restated).
 *  A fixed window on purpose: raw gaps between neighbouring states range
 *  from ~400ms flashes to tens of seconds, neither of which previews what
 *  picking the state buys. */
export const PREVIEW_FALLBACK_MS = 3000;

/** The preview window for a clip. A stored step plays its assembled window;
 *  a draft-added step or an inventory state (durationMs 0/absent) plays the
 *  fallback. No clamp against the video's end — the <video> element's own
 *  `ended` event stops playback there. */
export function clipWindow(
  startMs: number,
  durationMs: number,
): { startMs: number; endMs: number } {
  return { startMs, endMs: startMs + (durationMs > 0 ? durationMs : PREVIEW_FALLBACK_MS) };
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
// The render step, steps format (8e)
// ---------------------------------------------------------------------------

/**
 * What the render step composes from, PINNED at continue-click time — never
 * "latest", so a fork created after the click cannot silently switch what
 * renders (createSet's approval gate on the pinned id is the backstop).
 * Carries the two display numbers so the render step needs no plan fetch.
 */
export type PinnedPlan = { planId: string; stepCount: number; stepsTotalMs: number };

export function pinnedPlanFrom(plan: Pick<StepPlanWire, "planId" | "steps">): PinnedPlan {
  return {
    planId: plan.planId,
    stepCount: plan.steps.length,
    stepsTotalMs: totalRuntimeMs(plan.steps),
  };
}

/**
 * The steps analog of shapeSummary — same voice, no VO and no ending to name.
 * "בלי קריינות" is load-bearing: silent is the format's design, and a customer
 * who expected sound must learn it here, before paying, not from the video.
 */
export function stepsShapeSummary(
  plan: Pick<PinnedPlan, "stepCount" | "stepsTotalMs">,
  hookDurationMs: number,
): string {
  const total = formatSeconds((hookDurationMs + plan.stepsTotalMs) / 1000);
  return `פתיח ${formatSeconds(hookDurationMs / 1000)} שנ׳ ← ${plan.stepCount} צעדים מסרטון המוצר שלכם — סך הכול ${total} שנ׳, בלי קריינות.`;
}

/**
 * Whether "נסה שוב" can be honest after a failed steps create. 409 = the
 * pinned plan lost its approval gate — an identical retry fails identically
 * until the plan step fixes it. A 402 stays retryable on purpose: the 402
 * handler refreshes the quote, and the shortfall gate on the FRESH numbers is
 * what decides the button — after a top-up the retry is legitimate.
 */
export function retryableCreateFailure(status: number): boolean {
  return status !== 409;
}

/**
 * The confirm button's own label carries the price (founder ruling after the
 * 8e walkthrough: the 13px quoteLine under the summary did not read as a
 * price — the number the click costs belongs ON the thing being clicked).
 * null = admin bypass: nothing is charged, so no price is named.
 */
export function stepsConfirmLabel(quote: { credits: number } | null): string {
  return quote ? `צור סרטון · ${quote.credits} קרדיטים` : "צור סרטון";
}

/** The supporting line under the summary: balance only — the price itself
 *  lives on the button now, and repeating it here would just dilute it. */
export function stepsBalanceLine(quote: { balance: number }): string {
  return `היתרה שלכם: ${quote.balance} קרדיטים.`;
}

/**
 * Everything a steps render is made from, as one comparable key. The lifted
 * render must be discarded when ANY of these change — a render made with the
 * old hook clip, hook line, rect or plan must never answer for a new
 * composition (review finding: keying the reset on planId alone let a
 * same-plan hook swap re-show the old video as the new ad).
 */
export function renderCompositionKey(
  planId: string,
  hook: Pick<HookClip, "id">,
  hookLine: Pick<HookLineOption, "scriptId">,
  rect: SafeRect | null,
): string {
  const rectKey = rect ? `${rect.x},${rect.y},${rect.w},${rect.h}` : "default";
  return [planId, hook.id, hookLine.scriptId, rectKey].join("|");
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

/**
 * How the progress bar renders, derived from the SAME payload as the line
 * beside it so the two can never disagree — a bar animating under a line that
 * says nothing is progressing is the same contradiction the timeline discs
 * already avoid.
 */
export type RenderBarView = {
  /**
   * Whole percent, 0-100. Present ONLY while renderMedia's frame loop is
   * reporting, so it must never be latched: a retry clears the checkpoint
   * (renders.ts's `ctx.checkpoint({})` at the top of every attempt) and the
   * bar has to fall back to indeterminate rather than hold a stale 95%.
   */
  percent?: number;
  /** Nothing is known to be moving — parked, or no worker claiming. The bar
   *  freezes; motion here would contradict the line. */
  paused: boolean;
};

export type RenderWaitView =
  | { kind: "waiting"; sub?: string; bar: RenderBarView }
  | { kind: "stuck"; line: string; bar: RenderBarView };

/**
 * The line under the render-stage timeline (8d payload from the renders GET),
 * plus the progress bar's state.
 *
 * Queue position while queued (the heavy lane can hold a whole demo analysis
 * ahead of this render); elapsed while rendering, with the percent handed to
 * the bar rather than to the sentence — the percent is renderMedia's frame
 * loop only, so elapsed keeps running through the bundling before it and the
 * upload after it, and the bar's caption is what says "frames". Amber stuck
 * line when no worker is claiming. No "failed" kind: a dead render job always
 * lands the render row itself on "failed" (failRenderOnTerminal), which the
 * step's existing failure card owns.
 */
export function renderWaitView(status: string, job?: JobProgressWire): RenderWaitView {
  if (job && job.heartbeat === "stale" && (job.state === "queued" || job.state === "running")) {
    return { kind: "stuck", line: stuckLine("עיבוד"), bar: { paused: true } };
  }
  // A backoff-delayed job is PAUSED, not next in line — "starts soon" over a
  // minutes-long park is a lie (same ruling as the other wait views). Keyed on
  // the JOB, not the render row, and hoisted above the status branches
  // deliberately: handleRenderVideo flips the row to "rendering" before the
  // attempt and failTransient re-queues the job without touching the row, so a
  // parked retry arrives as status "rendering" + state "queued". Gated on the
  // row (as it used to be) that pair fell through to a moving bar.
  if (job?.state === "queued" && job.resumeAtMs !== undefined) {
    return {
      kind: "waiting",
      sub: "העיבוד מושהה כרגע ויתחדש אוטומטית בעוד כמה דקות.",
      bar: { paused: true },
    };
  }
  // No job row under this key AND no worker known to be alive. Nothing here
  // justifies animating "we're working on it" — the row may be purged, or the
  // live job may be the lipsync one, but neither is something we can claim.
  if (job?.state === "missing" && job.heartbeat !== "alive") {
    return { kind: "waiting", bar: { paused: true } };
  }
  if (status === "queued" && job?.state === "queued") {
    const sub =
      job.ahead === undefined
        ? undefined
        : job.ahead === 1
          ? "לפני הסרטון שלכם יש עוד עבודה אחת בתור."
          : job.ahead > 1
            ? `לפני הסרטון שלכם יש עוד ${job.ahead} עבודות בתור.`
            : "העיבוד יתחיל בקרוב.";
    return { kind: "waiting", ...(sub ? { sub } : {}), bar: { paused: false } };
  }
  if (status === "rendering" && job?.state === "running") {
    const pct = job.progress !== undefined ? Math.floor(job.progress * 100) : undefined;
    const elapsed = job.elapsedMs !== undefined ? fmtElapsedHe(job.elapsedMs) : undefined;
    const sub = elapsed ? `רץ כבר ${elapsed}.` : undefined;
    return {
      kind: "waiting",
      ...(sub ? { sub } : {}),
      bar: { ...(pct !== undefined ? { percent: pct } : {}), paused: false },
    };
  }
  return { kind: "waiting", bar: { paused: false } };
}
