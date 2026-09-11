import { and, eq, inArray, isNotNull, isNull, lt, notInArray, sql } from "drizzle-orm";
import { getConfigValue } from "../appConfig";
import { retentionDaysSchema } from "../config";
import type { Db } from "../db";
import {
  audioRenders,
  composites,
  demoAnalyses,
  demos,
  demoStepPlans,
  jobs,
  videoRenders,
} from "../db/schema";
import type { Job } from "../jobs/queue";
import type { JobContext, JobResult } from "../jobs/worker";
import { getStorage } from "../storage";
import {
  failRenderAndRefund,
  RENDER_PARK_EXPIRED_MESSAGE,
  RENDER_RETRIES_EXHAUSTED_MESSAGE,
  WORK_PARK_EXPIRED_MESSAGE,
} from "./renders";

export const REAPER_INTERVAL_MS = 60_000;

/**
 * Max park age: how long a render's job may sit parked on BudgetError before
 * we stop holding the customer's money — fail + refund instead. A safety
 * valve, not a policy: it works under any cap design; without it a parked
 * render spins forever with the money already taken. 6h is long enough for a
 * genuine capacity blip to clear (parks recheck hourly) and short enough that
 * a customer's credits are never held hostage overnight.
 */
export const MAX_BUDGET_PARK_MS = 6 * 60 * 60 * 1000;

/**
 * Dead render/lipsync jobs whose render is still non-terminal — i.e. a job
 * that died WITHOUT running its terminal path. In normal operation the last
 * attempt already failed+refunded the render (renders.ts), so this is empty;
 * rows appear only when no handler code ran at all (worker OOM/kill).
 */
export async function findDeadStuckRenders(db: Db): Promise<{ videoRenderId: string }[]> {
  return db
    .select({ videoRenderId: videoRenders.id })
    .from(jobs)
    .innerJoin(videoRenders, sql`${videoRenders.id} = (${jobs.payload}->>'videoRenderId')::uuid`)
    .where(
      and(
        inArray(jobs.type, ["render_video", "lipsync"]),
        eq(jobs.status, "dead"),
        notInArray(videoRenders.status, ["released", "failed", "rejected"]),
      ),
    );
}

/**
 * Renders whose job has sat parked on a budget cap past MAX_BUDGET_PARK_MS.
 * jobs.created_at is the park-age anchor: render jobs are enqueued at confirm
 * and normally live minutes, so a budget-parked job hours old has spent
 * nearly all of that time parked. The job itself is left alone — when its
 * window frees it runs, sees the terminal render, and completes as a no-op.
 */
export async function findOverparkedRenders(db: Db): Promise<{ videoRenderId: string }[]> {
  return db
    .select({ videoRenderId: videoRenders.id })
    .from(jobs)
    .innerJoin(videoRenders, sql`${videoRenders.id} = (${jobs.payload}->>'videoRenderId')::uuid`)
    .where(
      and(
        inArray(jobs.type, ["render_video", "lipsync"]),
        eq(jobs.status, "queued"),
        eq(jobs.errorClass, "budget"),
        lt(jobs.createdAt, new Date(Date.now() - MAX_BUDGET_PARK_MS)),
        notInArray(videoRenders.status, ["released", "failed", "rejected"]),
      ),
    );
}

/**
 * The same 6h valve, for parked work that is NOT a render — and it ends the
 * JOB, which is the deliberate difference from findOverparkedRenders above.
 *
 * The render valve can leave the job alone because the render's own terminal
 * path owns it: the row goes `failed`, and when the job's window frees it runs,
 * sees a terminal render and completes as a no-op. Nothing plays that part for
 * an analysis, a plan, an audio preview or a composite — a parked one re-queues
 * at +1h forever (errors.ts: BudgetError's default resumeAt) with its domain row
 * stuck mid-state. So here the valve ends the job as well as the row.
 *
 * An ALLOWLIST, not a denylist. A job type added later is invisible to this
 * valve until someone adds it here on purpose, which is the right default for
 * something that writes `failed` on a customer's row. Absent and staying absent:
 * `render_video` and `lipsync` (the render valve owns them, unchanged);
 * `janitor`, `reap_dead_renders` and `billing_renewals` (no domain row to land);
 * `generate_copy` (reaches assertBudget through generateBScript, but nothing in
 * the tree enqueues that type, and `scripts` has no status column to land);
 * `ingest_demo` and `normalize_hook_clip` (no paid call, so no BudgetError);
 * `group_analysis_states` (it catches its own BudgetError and returns done —
 * demo-analysis.ts — so it cannot park at all).
 *
 * Each entry reuses the terminal write its handler's own PermanentError branch
 * already performs. No new status value, no new column, no new failure path.
 */
const PARK_VALVE_TYPES: {
  type: string;
  /** Where the domain row's id sits on the job row. */
  rowId: (job: ParkedJob) => string | undefined;
  /** The handler's own terminal write. True when it actually landed a row. */
  land: (db: Db, rowId: string, message: string) => Promise<boolean>;
}[] = [
  {
    // demo-analysis.ts: the analysis row is created IN the handler and its id
    // checkpointed onto jobs.state before the first paid call, so by the time a
    // BudgetError can be thrown the id is there. payload carries only the demo.
    type: "analyze_demo",
    rowId: (job) => (job.state as { analysisId?: string } | null)?.analysisId,
    land: async (db, rowId, message) =>
      landed(
        await db
          .update(demoAnalyses)
          .set({ status: "failed", failReason: message, updatedAt: new Date() })
          .where(
            and(
              eq(demoAnalyses.id, rowId),
              notInArray(demoAnalyses.status, ["ready", "failed", "rejected"]),
            ),
          )
          .returning({ id: demoAnalyses.id }),
      ),
  },
  {
    type: "plan_demo_steps",
    rowId: (job) => (job.payload as { planId?: string }).planId,
    land: async (db, rowId, message) =>
      landed(
        await db
          .update(demoStepPlans)
          .set({
            status: "failed",
            failReason: message,
            // The closed set demo-step-plans.ts documents is
            // validator | quota | input | internal | transient. A park that
            // outlived the valve is a capacity condition that never cleared —
            // the same class as the handler's own last-attempt branch, which is
            // why it reuses that value rather than introducing a sixth.
            failKind: "transient",
            updatedAt: new Date(),
          })
          .where(
            and(eq(demoStepPlans.id, rowId), notInArray(demoStepPlans.status, ["ready", "failed"])),
          )
          .returning({ id: demoStepPlans.id }),
      ),
  },
  {
    type: "synth_tts",
    rowId: (job) => (job.payload as { audioRenderId?: string }).audioRenderId,
    land: async (db, rowId, message) =>
      landed(
        await db
          .update(audioRenders)
          .set({ status: "failed", error: message })
          .where(
            and(eq(audioRenders.id, rowId), notInArray(audioRenders.status, ["ready", "failed"])),
          )
          .returning({ id: audioRenders.id }),
      ),
  },
  {
    type: "generate_composite",
    rowId: (job) => (job.payload as { compositeId?: string }).compositeId,
    land: async (db, rowId, message) =>
      landed(
        await db
          .update(composites)
          .set({ status: "failed", error: message })
          .where(and(eq(composites.id, rowId), notInArray(composites.status, ["ready", "failed"])))
          .returning({ id: composites.id }),
      ),
  },
];

/** Only the columns the valve reads back off a claimed job. */
type ParkedJob = Pick<Job, "id" | "type" | "payload" | "state">;

const landed = (rows: { id: string }[]): boolean => rows.length > 0;

/** jobs.last_error after the valve: the diagnostic, never what the customer reads. */
const PARK_VALVE_JOB_ERROR =
  "budget park expired: parked past MAX_BUDGET_PARK_MS with no window free — failed by the reaper";

/**
 * Claim and end every non-render job parked past the valve. Returns how many
 * domain rows it actually landed.
 *
 * The claim is ONE guarded UPDATE ... RETURNING, so a worker claiming the same
 * job concurrently loses the race in Postgres rather than in JS: whichever
 * statement takes the row lock first wins, and the loser re-evaluates its own
 * WHERE against the committed row. `claim`'s SELECT ... FOR UPDATE SKIP LOCKED
 * skips a row this transaction holds; this UPDATE's `status = 'queued'` stops
 * matching once `claim` has set it to `running`.
 *
 * Claim and landing share one transaction, so the row lock is held across both
 * and a crash between them rolls back to a still-parked job the next tick
 * re-claims — rather than leaving a failed job whose domain row nothing will
 * ever end.
 */
export async function failOverparkedWork(db: Db): Promise<number> {
  const cutoff = new Date(Date.now() - MAX_BUDGET_PARK_MS);
  return db.transaction(async (tx) => {
    const claimed = await (tx as Db)
      .update(jobs)
      .set({
        status: "failed",
        errorClass: "permanent",
        lastError: PARK_VALVE_JOB_ERROR,
        updatedAt: new Date(),
      })
      .where(
        and(
          inArray(
            jobs.type,
            PARK_VALVE_TYPES.map((t) => t.type),
          ),
          eq(jobs.status, "queued"),
          eq(jobs.errorClass, "budget"),
          lt(jobs.createdAt, cutoff),
        ),
      )
      .returning({ id: jobs.id, type: jobs.type, payload: jobs.payload, state: jobs.state });

    let ended = 0;
    for (const job of claimed) {
      const entry = PARK_VALVE_TYPES.find((t) => t.type === job.type)!;
      const rowId = entry.rowId(job as ParkedJob);
      // No id on the job means no row to end — a hand-made job, or an
      // analyze_demo parked before it checkpointed. The job is still ended:
      // leaving it queued would only park it again forever.
      if (!rowId) continue;
      if (await entry.land(tx as Db, rowId, WORK_PARK_EXPIRED_MESSAGE)) ended++;
    }
    return ended;
  });
}

/**
 * The net under a worker crash/OOM. A singleton job (see ensureReaperJob)
 * rescheduling itself every ~60s, so a customer stuck this way waits a minute,
 * not until tomorrow's janitor. Writes the same fixed Hebrew string as the
 * last-attempt path — the dead job's raw lastError never reaches the customer.
 */
export async function handleReapDeadRenders(_job: Job, ctx: JobContext): Promise<JobResult> {
  const { db, log } = ctx;
  // Swallow sweep errors: the singleton's attempts never reset, so letting a
  // transient DB blip consume one would eventually kill the reaper silently.
  try {
    let repaired = 0;
    for (const { videoRenderId } of await findDeadStuckRenders(db)) {
      if (await failRenderAndRefund(db, videoRenderId, RENDER_RETRIES_EXHAUSTED_MESSAGE)) {
        repaired++;
      }
    }
    // Zero in normal operation — anything else means a job died with no code running.
    if (repaired > 0) log.warn({ repaired }, "reaper: repaired renders stuck behind dead jobs");

    let unparked = 0;
    for (const { videoRenderId } of await findOverparkedRenders(db)) {
      if (await failRenderAndRefund(db, videoRenderId, RENDER_PARK_EXPIRED_MESSAGE)) {
        unparked++;
      }
    }
    if (unparked > 0) {
      log.warn({ unparked }, "reaper: refunded renders parked past the max park age");
    }

    const ended = await failOverparkedWork(db);
    if (ended > 0) {
      log.warn({ ended }, "reaper: failed non-render work parked past the max park age");
    }
  } catch (err) {
    log.warn({ err }, "reaper: sweep failed — retrying next tick");
  }
  return { kind: "reschedule", delayMs: REAPER_INTERVAL_MS };
}

/**
 * Daily retention sweep (Supabase Storage has no native lifecycle rules, so
 * retention is enforced here from DB timestamps) per app_config.retention_days.
 * Files are removed and path columns nulled; rows are kept. Dead-render repair
 * lives in handleReapDeadRenders, not here.
 */
export async function handleJanitor(_job: Job, ctx: JobContext): Promise<JobResult> {
  const { db, log } = ctx;
  const counts = { rawDeleted: 0, rendersDeleted: 0, audioDeleted: 0 };

  // Retention.
  const retention = await getConfigValue(db, "retention_days", retentionDaysSchema);
  const storage = getStorage();
  const cutoff = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rawExpired = await db
    .select()
    .from(demos)
    .where(
      and(
        eq(demos.status, "ready"),
        isNotNull(demos.rawPath),
        lt(demos.updatedAt, cutoff(retention.raw_after_normalize)),
      ),
    );
  for (const demo of rawExpired) {
    try {
      await storage.remove(demo.rawPath!);
      await db.update(demos).set({ rawPath: null }).where(eq(demos.id, demo.id));
      counts.rawDeleted++;
    } catch (err) {
      log.warn({ err, demoId: demo.id }, "janitor: raw delete failed");
    }
  }

  const releasedExpired = await db
    .select()
    .from(videoRenders)
    .where(
      and(
        eq(videoRenders.status, "released"),
        isNotNull(videoRenders.filePath),
        lt(videoRenders.releasedAt, cutoff(retention.released_renders)),
        eq(videoRenders.watermarked, false),
      ),
    );
  const samplesExpired = await db
    .select()
    .from(videoRenders)
    .where(
      and(
        eq(videoRenders.status, "released"),
        isNotNull(videoRenders.filePath),
        lt(videoRenders.releasedAt, cutoff(retention.watermarked_samples)),
        eq(videoRenders.watermarked, true),
      ),
    );
  for (const render of [...releasedExpired, ...samplesExpired]) {
    try {
      await storage.remove(render.filePath!);
      await db
        .update(videoRenders)
        .set({ filePath: null, updatedAt: new Date() })
        .where(eq(videoRenders.id, render.id));
      counts.rendersDeleted++;
    } catch (err) {
      log.warn({ err, renderId: render.id }, "janitor: render delete failed");
    }
  }

  // Unapproved audio previews (approved audio is referenced by renders — kept).
  const audioExpired = await db
    .select()
    .from(audioRenders)
    .where(
      and(
        isNull(audioRenders.approvedAt),
        isNotNull(audioRenders.filePath),
        lt(audioRenders.createdAt, cutoff(retention.audio_previews)),
      ),
    );
  for (const audio of audioExpired) {
    try {
      await storage.remove(audio.filePath!);
      await db.update(audioRenders).set({ filePath: null }).where(eq(audioRenders.id, audio.id));
      counts.audioDeleted++;
    } catch (err) {
      log.warn({ err, audioRenderId: audio.id }, "janitor: audio delete failed");
    }
  }

  log.info(counts, "janitor digest");
  return { kind: "done" };
}
