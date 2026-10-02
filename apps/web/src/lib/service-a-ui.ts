import type { SafeRect } from "@aiugc/core/hook-geometry";
import type { HookTextColor } from "@aiugc/core/hook-text-color";
import {
  A_STEPS_MAX_DEFAULT,
  A_STEPS_MIN_DEFAULT,
  clipsOverlap,
  isInventoryState,
  labelTooLong,
  overlappingPairs,
  readableWords,
  splitWords,
  STEP_MS,
  stepClip,
  totalRuntimeMs,
  type Clip,
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
 * wizard, persona-first: the hook bank is a persona × clip matrix — every
 * clip belongs to one persona, and the gallery shows only the chosen
 * persona's clips — so the character is picked before the clip. The render
 * path still consumes no persona (it only scopes the gallery and is the
 * first-person speaker of the hook lines, which stay freely editable in the
 * hook studio); silent format, no script, no audio. "full" is the voiced
 * seven-step path — today CLI-only; the shape stays here so the two formats
 * are one decision apart, not two files apart.
 */
export function aWizardSteps(format: AWizardFormat): AWizardStep[] {
  return format === "steps"
    ? ["persona", "hook", "hookStudio", "demo", "plan", "render"]
    : ["persona", "hook", "hookStudio", "demo", "script", "audio", "render"];
}

// ---------------------------------------------------------------------------
// Demo pre-checks (client-side copy of src/lib/service-a.ts rules)
// ---------------------------------------------------------------------------

export const MAX_DEMO_BYTES = 1024 * 1024 * 1024;
const DEMO_TYPES = ["video/mp4", "video/quicktime"];

export const MIN_DEMO_SECONDS = 8;
export const MAX_DEMO_SECONDS = 90;

export function clientDemoFileError(file: { type: string; size: number }): string | null {
  if (!DEMO_TYPES.includes(file.type)) return "אפשר להעלות רק וידאו בפורמט MP4 או MOV.";
  if (file.size === 0) return "הקובץ שהועלה ריק.";
  if (file.size > MAX_DEMO_BYTES) return "הסרטון גדול מדי — המקסימום הוא 1GB.";
  return null;
}

/** Pre-upload duration gate (same limits the ingest job enforces server-side). */
export function demoDurationError(seconds: number): string | null {
  if (seconds < MIN_DEMO_SECONDS || seconds > MAX_DEMO_SECONDS) {
    // COPY PENDING FOUNDER REVIEW — byte-identical to the Hebrew the ingest
    // probe stores as rejectReason (packages/core/src/pipelines/demos.ts).
    return "אורך הסרטון חייב להיות בין 8 שניות ל-90 שניות";
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

/**
 * How far a queued job's resumeAtMs must sit in the future before the wait
 * surfaces call it a PAUSE rather than ordinary waiting. core's own
 * JOB_DELAY_VISIBLE_MS (60s) is what makes resumeAtMs appear at all — it
 * can't distinguish a 90s retry backoff from a multi-hour budget park, and
 * conflating the two read as a fault to the founder twice in one session
 * (2026-09-18). This is a view-only threshold, deliberately not
 * JOB_DELAY_VISIBLE_MS itself: that constant is shared by every surface
 * (queue position, stuck detection) and changing it would move all of them.
 */
export const LONG_PARK_THRESHOLD_MS = 10 * 60_000;

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
 *
 * requestedElapsedMs is the wall clock since demo_analyses.created_at,
 * computed by the ROUTE on the server's own clock (see the analysis GET). It
 * replaces job.elapsedMs for the customer-facing number, which is measured
 * from job.lockedAt and so resets at every re-claim — it once showed "less
 * than a minute" on a job's third attempt eight minutes in. When the server
 * sends no number (older server, or a payload without it) the line shows NO
 * number rather than falling back to job.elapsedMs: a missing number beats a
 * decreasing one.
 *
 * `now` stays a parameter because the PARK GATE below needs it, and that
 * comparison tolerates the client's clock being off — the nearest boundary is
 * a ~4min backoff against a 10min threshold, or a 60min park against the
 * same. Only the displayed duration was skew-sensitive, and that left.
 */
export function analysisWaitView(
  job?: JobProgressWire,
  requestedElapsedMs?: number,
  now: Date = new Date(),
): AnalysisWaitView {
  if (!job) return { kind: "waiting", line: ANALYSIS_QUEUED_LINE };
  if (job.state === "failed") return { kind: "failed" };
  if (job.heartbeat === "stale" && (job.state === "queued" || job.state === "running")) {
    return { kind: "stuck", line: stuckLine("ניתוח") };
  }
  if (job.state === "running") {
    return {
      kind: "waiting",
      line:
        requestedElapsedMs !== undefined
          ? `מנתחים את הסרטון עכשיו — רץ כבר ${fmtElapsedHe(requestedElapsedMs)}.`
          : "מנתחים את הסרטון עכשיו.",
    };
  }
  if (job.state === "queued") {
    // Keyed on the JOB, not the row — renderWaitView's rule. A deliberately
    // rescheduled job (backoff, budget park) is not in line at all, so it
    // gets neither a queue position nor "starts soon": both describe a job
    // the claim loop will pick up next, and this one it will not. Only a
    // genuinely LONG park is named as a pause; a short retry backoff falls
    // back to the standing queued line and says nothing about the retry,
    // which is 0009's ruling for renders applied here.
    if (job.resumeAtMs !== undefined) {
      return job.resumeAtMs - now.getTime() > LONG_PARK_THRESHOLD_MS
        ? {
            kind: "waiting",
            line: ANALYSIS_QUEUED_LINE,
            sub: "הניתוח מושהה כרגע ויתחדש אוטומטית מאוחר יותר.",
          }
        : { kind: "waiting", line: ANALYSIS_QUEUED_LINE };
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
 *
 * requestedElapsedMs is the wall clock since demo_step_plans.created_at,
 * computed server-side by stepPlanResponse. The plan row is inserted
 * synchronously by the POST route before the job is enqueued, so it IS the
 * request moment exactly. See analysisWaitView for why this beats
 * job.elapsedMs and why a missing number shows no number.
 */
export function planWaitView(
  status: string,
  job?: JobProgressWire,
  requestedElapsedMs?: number,
  now: Date = new Date(),
): PlanWaitView {
  if (job?.state === "failed") return { kind: "failed" };
  if (job && job.heartbeat === "stale" && (job.state === "queued" || job.state === "running")) {
    return { kind: "stuck", line: stuckLine("תכנון") };
  }
  // Keyed on the JOB, not the row — renderWaitView's rule, and the reason
  // this sits above the status check rather than inside it: requestDemoPlan
  // flips the row to "planning" BEFORE the paid call, so a park that hit
  // mid-call arrives as status "planning" + state "queued" and must not fall
  // through to the "building now" line. A rescheduled job is not building.
  // Long parks are named as a pause; a short retry backoff gets the standing
  // queued line and says nothing about the retry (0009's ruling for renders).
  if (job?.state === "queued" && job.resumeAtMs !== undefined) {
    return job.resumeAtMs - now.getTime() > LONG_PARK_THRESHOLD_MS
      ? {
          kind: "waiting",
          line: "התוכנית ממתינה בתור…",
          sub: "יצירת התוכנית מושהית כרגע ותתחדש אוטומטית מאוחר יותר.",
        }
      : { kind: "waiting", line: "התוכנית ממתינה בתור…" };
  }
  if (status === "planning") {
    const sub =
      job?.state === "running" && requestedElapsedMs !== undefined
        ? `רץ כבר ${fmtElapsedHe(requestedElapsedMs)}.`
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

/** At most twelve analysis thumbs are signed per ?indexes= request (route +
 *  picker agree; larger want-sets go through analysisIndexBatches), and the
 *  inventory's ungrouped fallback pages hold twelve moments. */
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
 * (persona, hook, hook line, rect) is deliberately session-local. Carried as query
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
 * promise an analysis that may never come), and neither the hook gallery nor
 * hookStudio can ever be restored (persona and hook are both session-local,
 * and the gallery is one persona's column of the matrix — without the
 * persona there is nothing to list), so an index landing on either reroutes
 * to the persona step instead of rendering an empty card. No demo at all
 * means the persona step, full stop.
 */
export function clampRestoredStep(
  step: number,
  steps: AWizardStep[],
  demo: Pick<DemoState, "status"> | null,
): number {
  const target = demo === null ? "persona" : demo.status === "ready" ? "plan" : "demo";
  const max = steps.indexOf(target);
  const clamped = Math.max(0, Math.min(step, max === -1 ? 0 : max));
  const landed = steps[clamped];
  return landed === "hook" || landed === "hookStudio"
    ? Math.max(0, steps.indexOf("persona"))
    : clamped;
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

/** One stored plan step on the wire. A step saved since steps became 2 s clips
 *  (decisions 0076, 0084) carries `startMs`, where its clip starts, and
 *  durationMs 2000. An older one has no startMs: it plays from its moment for
 *  the length it was saved with. Core's stepClip reads both. */
export type PlanStepWire = {
  timestampMs: number;
  actionType: string;
  label: string;
  sourceIndex: number;
  durationMs: number;
  startMs?: number;
  /** The clip probably shows two different pages — the editor asks the
   *  customer to watch the step before approving (decision 0085). */
  twoPages?: boolean;
  /** The label's own tokens that came from none of the state's screen text,
   *  the questionnaire or the demo description (core's findOffScreenWords,
   *  decision 0049) — the editor marks them for the customer to check. Absent
   *  on rows from before it; [] after a human edit. */
  offScreenWords?: string[];
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
  /** Wall clock since demo_step_plans.created_at, measured on the SERVER's
   *  clock by stepPlanResponse — planWaitView's "רץ כבר X". Always present
   *  (the column is NOT NULL). Deliberately not on JobProgressWire: that
   *  shape is core's, and its per-job elapsedMs stays as it is for logs and
   *  admin. */
  requestedElapsedMs: number;
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
  /** Always STEP_MS. Still sent for tabs opened before steps became 2 s
   *  clips, which read it as the preview's length. */
  clipMs: number;
  /** Where this moment's 2 s clip starts (core's placeClips): what a tile
   *  preview plays and what adding the moment stores. */
  clipStartMs: number;
  /** That clip probably shows two different pages. Said on a STEP in the
   *  plan, never on an inventory tile — the inventory is one tier (0064). */
  clipTwoPages: boolean;
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

/** Chronological display order — order derives from timestamp, nothing else. */
export function sortedPlanSteps(steps: PlanStepWire[]): PlanStepWire[] {
  return [...steps].sort((a, b) => a.timestampMs - b.timestampMs);
}

// ---------------------------------------------------------------------------
// The plan editor (8b) — pure decisions behind step-plan.tsx's editor
// ---------------------------------------------------------------------------

/**
 * The soft long-caption warning: the caption needs longer to read than its
 * clip is on screen (core's labelTooLong — on a 2 s step, more than 4 words;
 * the number named is what the clip's own length allows, so it is true on a
 * step stored at an older length too). ADVISORY ONLY (decision 0086): the
 * human edit path is never rejected on length, and nothing client-side ever
 * validates a label against visibleText — the provenance highlight below
 * marks the MODEL's off-screen words for the customer to check, and never
 * blocks.
 */
export function labelWordWarning(label: string, durationMs: number = STEP_MS): string | null {
  return labelTooLong(label, durationMs)
    ? `כיתוב ארוך — בזמן שהצעד מוצג מספיקים לקרוא עד ${readableWords(durationMs)} מילים.`
    : null;
}

/**
 * The marks a draft step carries after its label input changes: the stored
 * step's while the text is still the model's (trimmed, the way the payload
 * and the dirty check compare), none once it differs. Typing a letter and
 * deleting it again must bring the marks back — otherwise the draft is not
 * dirty (nothing to save), the row still carries the words, and the customer
 * approves a label whose highlight they made vanish by accident. The server
 * applies the same rule on save (updatePlanSteps).
 */
export function marksAfterEdit(
  stored: Pick<PlanStepWire, "label" | "offScreenWords"> | undefined,
  label: string,
): string[] {
  return stored !== undefined && stored.label.trim() === label.trim()
    ? (stored.offScreenWords ?? [])
    : [];
}

/**
 * The provenance highlight (decision 0049): the label split into runs, each
 * token that is in `marked` — the step's offScreenWords, the label's own
 * tokens as the server split them — a marked run, everything else (the
 * separators included) unmarked, adjacent runs of one kind merged. Splits
 * with core's splitWords so the client never re-implements the tokenizer:
 * the words the server flagged are, by construction, tokens of this split.
 * Exact match on purpose — "ואזור" is not "אזור"; normalization is the
 * server's matching concern, not the mark's.
 */
export function labelRuns(
  label: string,
  marked: readonly string[],
): { text: string; marked: boolean }[] {
  const text = label.normalize("NFC");
  const set = new Set(marked);
  const runs: { text: string; marked: boolean }[] = [];
  const push = (piece: string, isMarked: boolean) => {
    if (!piece) return;
    const last = runs[runs.length - 1];
    if (last && last.marked === isMarked) last.text += piece;
    else runs.push({ text: piece, marked: isMarked });
  };
  let cursor = 0;
  for (const token of splitWords(text)) {
    // Tokens come in order and separators carry no token characters, so the
    // first occurrence at or after the cursor is this token's own position.
    const at = text.indexOf(token, cursor);
    push(text.slice(cursor, at), false);
    push(token, set.has(token));
    cursor = at + token.length;
  }
  push(text.slice(cursor), false);
  return runs;
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

/** What the server answers a save whose steps share footage, and what the
 *  editor says when it can see the overlap itself (decision 0087). */
export const STEPS_OVERLAP_BLOCK = "יש צעדים חופפים — מחקו אחד מכל זוג כדי לשמור.";

/** A reason the draft cannot be saved, or null: an empty label (the input's
 *  own maxLength enforces MAX_LABEL_CHARS), or two steps sharing footage. */
export function draftBlockedReason(
  draft: Pick<PlanStepWire, "label">[],
  overlapping = false,
): string | null {
  if (draft.some((step) => step.label.trim().length === 0)) {
    return "יש צעד בלי כיתוב — כתבו כיתוב או מחקו את הצעד.";
  }
  return overlapping ? STEPS_OVERLAP_BLOCK : null;
}

/** The PATCH body: exactly what the customer can edit. The server derives
 *  timestamp, actionType and the clip from sourceIndex and orders by timestamp. */
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

/** One stored grouping, as the analysis GET serves it (0030). */
export type InventorySectionWire = { title: string; stateIndexes: number[] };

/** One page of the inventory: a group's label and its moments, in order. */
export type InventoryPage = { title: string; states: AnalysisStateWire[] };

/**
 * The inventory as pages, one group per page (decision 0064): every
 * readable state (isInventoryState — the same predicate the grouping job
 * pools on) shown equally, no "less fitting" tier.
 *
 * With a stored grouping: one page per section, pages ordered by their
 * earliest moment, moments chronological inside a page. Indexes outside the
 * pool are dropped; an index claimed twice stays with its first claim. A pool
 * state no section claims joins the page of its nearest claimed state by
 * timestampMs (tie -> the earlier one) — there is no leftover bucket. That is
 * how analyses grouped over the old quality pool place their other states
 * without a paid regroup.
 *
 * No grouping, an empty one, or one that claims nothing in the pool ->
 * chronological pages of ANALYSIS_PAGE_SIZE titled by their time range: a
 * neutral label, never a judgement.
 */
export function inventoryPages(
  states: AnalysisStateWire[],
  sections?: InventorySectionWire[],
): InventoryPage[] {
  // Stable sort: equal timestamps keep timeline (index) order.
  const pool = states.filter(isInventoryState).sort((a, b) => a.timestampMs - b.timestampMs);
  const inPool = new Set(pool.map((state) => state.index));
  /** state index -> position of the section that claimed it first. */
  const owner = new Map<number, number>();
  sections?.forEach((section, position) => {
    for (const index of section.stateIndexes) {
      if (inPool.has(index) && !owner.has(index)) owner.set(index, position);
    }
  });
  if (!sections || owner.size === 0) return timeRangePages(pool);

  const claimed = pool.filter((state) => owner.has(state.index));
  const nearestOwner = (state: AnalysisStateWire): number => {
    let best = claimed[0]!;
    for (const candidate of claimed) {
      // Strict < over a chronological list: a tie keeps the earlier one.
      const distance = Math.abs(candidate.timestampMs - state.timestampMs);
      if (distance < Math.abs(best.timestampMs - state.timestampMs)) best = candidate;
    }
    return owner.get(best.index)!;
  };
  const buckets = sections.map((): AnalysisStateWire[] => []);
  for (const state of pool) {
    buckets[owner.get(state.index) ?? nearestOwner(state)]!.push(state);
  }
  return buckets
    .map((pageStates, position) => ({ title: sections[position]!.title, states: pageStates }))
    .filter((page) => page.states.length > 0)
    .sort((a, b) => a.states[0]!.timestampMs - b.states[0]!.timestampMs);
}

function timeRangePages(pool: AnalysisStateWire[]): InventoryPage[] {
  const pages: InventoryPage[] = [];
  for (let i = 0; i < pool.length; i += ANALYSIS_PAGE_SIZE) {
    const pageStates = pool.slice(i, i + ANALYSIS_PAGE_SIZE);
    const from = fmtTimestamp(pageStates[0]!.timestampMs);
    const to = fmtTimestamp(pageStates[pageStates.length - 1]!.timestampMs);
    // The range rides in an LTR isolate (U+2066 … U+2069) inside the string:
    // the title is plain text, so the isolate has to travel with it.
    pages.push({ title: `מסכים \u2066${from}–${to}\u2069`, states: pageStates });
  }
  return pages;
}

/** A step in the editor's draft. Since every step is its moment's 2 s clip an
 *  added step is complete the moment it is picked — nothing is "computed on
 *  save" any more — so a draft step is just a plan step. */
export type DraftStep = PlanStepWire;

/**
 * Insert a picked state into the draft — chronological by construction: order
 * derives from timestamp, and the server orders anyway. The step carries its
 * moment's clip, exactly what a save stores for a new step. `stored` is the
 * saved plan's step for the same moment, when it has one: a step deleted and
 * re-added gets back the clip it was saved with, which is the one the server
 * keeps (a saved clip never moves — updatePlanSteps).
 */
export function insertDraftStep(
  draft: DraftStep[],
  state: Pick<
    AnalysisStateWire,
    "index" | "timestampMs" | "actionType" | "clipStartMs" | "clipTwoPages"
  >,
  label: string,
  stored?: Pick<PlanStepWire, "startMs" | "twoPages">,
): DraftStep[] {
  const kept = stored?.startMs;
  const twoPages = kept !== undefined ? stored?.twoPages : state.clipTwoPages;
  const step: DraftStep = {
    sourceIndex: state.index,
    timestampMs: state.timestampMs,
    actionType: state.actionType,
    label: label.trim(),
    startMs: kept ?? state.clipStartMs,
    durationMs: STEP_MS,
    ...(twoPages ? { twoPages: true } : {}),
  };
  return [...draft, step].sort((a, b) => a.timestampMs - b.timestampMs);
}

/**
 * The clip a draft step shows — and, once the draft is saved, renders.
 *
 * A step with a clip (`startMs`) shows it. A step stored before steps had
 * clips shows what is stored while the draft is untouched — that is what
 * approving it would render — and, once the draft is edited, its moment's
 * 2 s clip: the next save places every such step, so the edited draft shows
 * what that save will store. Until the step's card has loaded the placed clip
 * is not known and the stored one stays.
 */
export function draftStepClip(
  step: PlanStepWire,
  state: Pick<AnalysisStateWire, "clipStartMs" | "clipTwoPages"> | undefined,
  dirty: boolean,
): Clip & { twoPages: boolean } {
  if (step.startMs === undefined && dirty && state) {
    return { startMs: state.clipStartMs, durationMs: STEP_MS, twoPages: state.clipTwoPages };
  }
  return { ...stepClip(step), twoPages: step.twoPages ?? false };
}

/** The amber line on a step whose clip probably shows two pages (decision
 *  0085). On steps in a plan only — never on an inventory tile. */
export const TWO_PAGES_LINE = "ייתכן שרואים כאן שני מסכים — צפו בצעד לפני האישור.";

/** "צעד 3" / "צעדים 3 ו־4" / "צעדים 3, 4 ו־5" — step numbers as shown on the cards. */
function stepsPhrase(numbers: number[]): string {
  if (numbers.length === 1) return `צעד ${numbers[0]}`;
  return `צעדים ${numbers.slice(0, -1).join(", ")} ו־${numbers[numbers.length - 1]}`;
}

/** Per draft position, the numbers (1-based, as the cards show them) of the
 *  EARLIER steps whose clip shares footage with this one. Every pair, not
 *  neighbours only. Only an old plan being edited can have any: adding a
 *  moment that overlaps is refused at the tile. */
export function overlapsBefore(clips: Clip[]): number[][] {
  const earlier = clips.map((): number[] => []);
  for (const [a, b] of overlappingPairs(clips)) earlier[b]!.push(a + 1);
  return earlier;
}

/** The line on a step that shares footage with earlier ones. */
export function stepOverlapLine(earlier: number[]): string | null {
  return earlier.length === 0
    ? null
    : `חופף ל${stepsPhrase(earlier)} — אותן שניות בסרטון. מחקו אחד מהם.`;
}

/**
 * An inventory moment as its tile shows it. A moment the saved plan holds with
 * a clip gets that clip back when it is re-added (insertDraftStep), so its
 * tile previews, and is judged for overlap, on the saved clip — today's
 * placement of the moment can differ from it (a saved clip never moves).
 */
export function tileState<T extends Pick<AnalysisStateWire, "index" | "clipStartMs">>(
  state: T,
  saved: Pick<PlanStepWire, "sourceIndex" | "startMs">[],
): T {
  const kept = saved.find((step) => step.sourceIndex === state.index)?.startMs;
  return kept === undefined ? state : { ...state, clipStartMs: kept };
}

/** Why an inventory moment cannot be added: its clip shares footage with
 *  steps already in the draft (decision 0087). `planClips` are the draft's
 *  clips in card order — as they will be once an add has made the draft
 *  edited, which is what the save stores. Null = it can be added. */
export function tileOverlapLine(
  state: Pick<AnalysisStateWire, "clipStartMs">,
  planClips: Clip[],
): string | null {
  const tile = { startMs: state.clipStartMs, durationMs: STEP_MS };
  const hits = planClips.flatMap((clip, i) => (clipsOverlap(tile, clip) ? [i + 1] : []));
  return hits.length === 0 ? null : `חופף ל${stepsPhrase(hits)} בתוכנית`;
}

/** m:ss position of a step inside the demo. */
export function fmtTimestamp(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** The preview window for a clip — the same start and length the render
 *  uses, so the preview shows exactly the frames the ad will. */
export function clipWindow(clip: Clip): { startMs: number; endMs: number } {
  return { startMs: clip.startMs, endMs: clip.startMs + clip.durationMs };
}

export type HookClip = {
  id: string;
  durationMs: number;
  previewUrl: string;
  /** The clip's default safe area — seeds the hook studio's placement editor. */
  textSafeArea: SafeRect;
  /** The colour the clip's hook line burns in — set by the founder, shown in
   *  the hook studio's preview, never picked here (decision 0073). */
  textColor: HookTextColor;
  /** Set on persona-swapped clips — every clip the wizard's gallery shows.
   *  Absent = a generic source clip, returned only by the legacy persona-less
   *  listing (no customer path). */
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
  /**
   * No worker is claiming this job at all (stale heartbeat, or no job row and
   * nothing alive). The caller says so in words; the bar keeps its wash but
   * stops sweeping, so motion never contradicts an amber "nothing is moving".
   *
   * A backoff park is deliberately NOT paused: it resumes on its own within
   * minutes, so from the customer's side the video is still being made, and
   * the retry machinery is ours to worry about rather than theirs to read
   * about (founder call, 2026-09-02).
   */
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
  // A backoff-parked job says NOTHING to the customer. It resumes by itself in
  // seconds to minutes, so the video is still being made; surfacing the retry
  // as "paused, will resume automatically" turned a normal self-healing hiccup
  // into something that reads like a fault, and it flickered on and off as the
  // job hopped queued<->running (founder call 2026-09-02, after watching it
  // alternate for a whole render). The bar keeps running. The honest signals
  // are kept elsewhere: the amber line above when nothing is claiming the job
  // at all, and the failure card when the retries actually run out.
  //
  // Keyed on the JOB, not the render row: handleRenderVideo flips the row to
  // "rendering" before the attempt and failTransient re-queues the job without
  // touching it, so a parked retry arrives as status "rendering" + state
  // "queued" and must not fall through to the queue-position branch.
  if (job?.state === "queued" && job.resumeAtMs !== undefined) {
    return { kind: "waiting", bar: { paused: false } };
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
