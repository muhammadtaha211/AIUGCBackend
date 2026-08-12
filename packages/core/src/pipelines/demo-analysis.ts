import { desc, eq, like } from "drizzle-orm";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getConfigValueOr } from "../appConfig";
import { assertBudget, recordUsage } from "../budget";
import { getEnv } from "../config";
import type { Db } from "../db";
import { demoAnalyses, demos, jobs } from "../db/schema";
import { BudgetError, PermanentError } from "../jobs/errors";
import { enqueue, isLastAttempt, type Job } from "../jobs/queue";
import type { JobContext, JobResult } from "../jobs/worker";
import {
  clusterStates,
  extractFrames,
  frameHashes,
  hamming,
  type StateCluster,
} from "../media/ffmpeg";
import { WORK_DIR } from "../paths";
import { generateObjectWithImages } from "../providers/anthropic";
import { renderPrompt } from "../prompts";
import { getStorage, storageKey } from "../storage";
import { requireQuestionnaire } from "./businesses";

/**
 * Pass 1 of the step-plan format: the INVENTORY. One screen recording is mined
 * once into ~40-60 distinct UI states (pHash clustering -> representative
 * frames -> batched vision transcription), stored on demo_analyses.timeline.
 * Expensive, computed once, never edited — the plan pass (pipelines/
 * demo-step-plans.ts) and the wizard's picker both select from it.
 */

export const ANALYSIS_ACTION_TYPES = [
  "navigate",
  "tap",
  "type",
  "select",
  "scroll",
  "result",
  "idle",
] as const;

export const analysisStateSchema = z.object({
  timestampMs: z.number(),
  screenName: z.string(),
  // VERBATIM screen text — never translated, corrected or completed.
  visibleText: z.array(z.string()),
  action: z.string(),
  actionType: z.enum(ANALYSIS_ACTION_TYPES),
  sameStateAsPrevious: z.boolean(),
  legibility: z.enum(["high", "low", "unreadable"]),
  salienceNote: z.string().nullable(),
  thumbPath: z.string(),
});
export type AnalysisState = z.infer<typeof analysisStateSchema>;

export const analysisTimelineSchema = z.array(analysisStateSchema);

/** What the model returns per batch — timestamps and thumb paths are attached in code. */
const batchOutputSchema = z.object({
  frames: z.array(
    z.object({
      index: z.number(),
      screenName: z.string(),
      visibleText: z.array(z.string()),
      action: z.string(),
      actionType: z.enum(ANALYSIS_ACTION_TYPES),
      sameStateAsPrevious: z.boolean(),
      legibility: z.enum(["high", "low", "unreadable"]),
      salienceNote: z.string().nullable(),
    }),
  ),
});
type BatchFrame = z.infer<typeof batchOutputSchema>["frames"][number];

/**
 * 768px is what lets the model read Hebrew UI text off a filmed screen — do
 * not shrink below it; the whole design depends on that legibility.
 */
const ANALYSIS_FRAME_WIDTH = 768;
/** dHash distance under which two sampled frames are the same UI state. */
const MAX_HAMMING = 10;
/** A state must persist >=2 sampled frames — a single glare/shake frame is noise. */
const MIN_CLUSTER_FRAMES = 2;

/** Rough cost bookkeeping — same math as pipelines/copy.ts (2nd use; extract at the 3rd). */
function llmCostAgorot(inputTokens: number, outputTokens: number): number {
  return Math.ceil(((inputTokens * 3 + outputTokens * 15) / 1_000_000) * 370);
}

/**
 * Evenly thin clusters to the cap, always keeping the last one — the recording
 * ends on the success state and the plan pass must be able to end there too.
 * This is the hard cap on vision spend per analysis: batches never exceed
 * ceil(max / batchSize). Thinning beats rejecting — a busy but legitimate
 * recording still analyses, at bounded cost.
 */
export function subsampleClusters<T>(clusters: T[], max: number): T[] {
  if (clusters.length <= max) return clusters;
  const kept: T[] = [];
  for (let i = 0; i < max; i++) {
    kept.push(clusters[Math.floor((i * clusters.length) / max)]!);
  }
  kept[kept.length - 1] = clusters[clusters.length - 1]!;
  return kept;
}

/** Fraction of states the model could not read comfortably (low + unreadable). */
export function illegibleFraction(states: { legibility: string }[]): number {
  if (states.length === 0) return 1;
  return states.filter((s) => s.legibility !== "high").length / states.length;
}

const REFILM_MESSAGE =
  "חלק גדול מדי מהצילום לא קריא — צלמו שוב בתאורה בלי ברק על המסך וביד יציבה יותר";

/**
 * The fixed DRY_RUN timeline: a coherent 12-state journey (login -> create ->
 * result) inside the stubbed 20s demo, with one low-legibility state, one
 * unreadable state and one duplicate so downstream rules (picker dimming, the
 * plan pass's never-select-unreadable rule) run for real.
 */
function dryRunTimeline(thumbPathAt: (ms: number) => string): AnalysisState[] {
  const states: Omit<AnalysisState, "thumbPath">[] = [
    { timestampMs: 0, screenName: "מסך פתיחה", visibleText: ["ברוכים הבאים"], action: "האפליקציה נפתחת", actionType: "idle", sameStateAsPrevious: false, legibility: "high", salienceNote: null },
    { timestampMs: 1500, screenName: "התחברות", visibleText: ["התחברות", "אימייל", "סיסמה"], action: "מסך ההתחברות מוצג", actionType: "navigate", sameStateAsPrevious: false, legibility: "high", salienceNote: null },
    { timestampMs: 3000, screenName: "התחברות", visibleText: ["התחברות", "אימייל"], action: "הקלדת אימייל", actionType: "type", sameStateAsPrevious: false, legibility: "high", salienceNote: null },
    { timestampMs: 4500, screenName: "מסך הבית", visibleText: ["הפרויקטים שלי", "פרויקט חדש"], action: "מעבר למסך הבית", actionType: "navigate", sameStateAsPrevious: false, legibility: "high", salienceNote: null },
    { timestampMs: 6000, screenName: "מסך הבית", visibleText: ["הפרויקטים שלי"], action: "אותו מסך, כמעט ללא שינוי", actionType: "idle", sameStateAsPrevious: true, legibility: "high", salienceNote: null },
    { timestampMs: 8000, screenName: "פרויקט חדש", visibleText: ["פרויקט חדש", "שם הפרויקט"], action: "לחיצה על פרויקט חדש", actionType: "tap", sameStateAsPrevious: false, legibility: "high", salienceNote: null },
    { timestampMs: 9500, screenName: "פרויקט חדש", visibleText: ["שם הפרויקט", "קמפיין קיץ"], action: "הקלדת שם הפרויקט", actionType: "type", sameStateAsPrevious: false, legibility: "high", salienceNote: null },
    { timestampMs: 11000, screenName: "בחירת תבנית", visibleText: ["בחרו תבנית", "מודעה", "פוסט"], action: "בחירת תבנית מהרשימה", actionType: "select", sameStateAsPrevious: false, legibility: "high", salienceNote: "בחירת תבניות מוכנות — לא מוזכר בשאלון" },
    { timestampMs: 12500, screenName: "עורך", visibleText: [], action: "גלילה בעורך — ברק על המסך", actionType: "scroll", sameStateAsPrevious: false, legibility: "low", salienceNote: null },
    { timestampMs: 14000, screenName: "לא ברור", visibleText: [], action: "המסך לא קריא בפריים הזה", actionType: "idle", sameStateAsPrevious: false, legibility: "unreadable", salienceNote: null },
    { timestampMs: 16000, screenName: "עורך", visibleText: ["שמירה", "תצוגה מקדימה"], action: "לחיצה על שמירה", actionType: "tap", sameStateAsPrevious: false, legibility: "high", salienceNote: null },
    { timestampMs: 18500, screenName: "הצלחה", visibleText: ["הקמפיין נוצר!", "שיתוף"], action: "מסך ההצלחה — הפרויקט מוכן", actionType: "result", sameStateAsPrevious: false, legibility: "high", salienceNote: null },
  ];
  return states.map((s) => ({ ...s, thumbPath: thumbPathAt(s.timestampMs) }));
}

type DemoAnalysis = typeof demoAnalyses.$inferSelect;

/** The newest analysis attempt for a demo (ready, in flight, or terminal). */
export async function getLatestDemoAnalysis(
  db: Db,
  demoId: string,
): Promise<DemoAnalysis | undefined> {
  const rows = await db
    .select()
    .from(demoAnalyses)
    .where(eq(demoAnalyses.demoId, demoId))
    .orderBy(desc(demoAnalyses.createdAt))
    .limit(1);
  return rows[0];
}

/**
 * Enqueue (or re-enqueue) the analysis of a ready demo. Ingest auto-enqueues
 * with key `analyze:{demoId}`; because enqueue keys are a permanent no-op, a
 * re-run after a failed/rejected attempt needs a fresh key — derived from the
 * count of prior attempt rows, so a double press still collapses to one job.
 * The in-flight check gates on live JOBS, not row status: a queued/running job
 * means a re-run would buy the same vision pass twice, while a row stuck at
 * "analysing" after a worker death (no live job) must not lock re-runs out.
 */
export async function requestDemoAnalysis(
  db: Db,
  demoId: string,
): Promise<
  | { kind: "already_ready" }
  | { kind: "in_flight"; jobId: string }
  | { kind: "queued"; jobId: string }
> {
  const demoRows = await db.select().from(demos).where(eq(demos.id, demoId)).limit(1);
  const demo = demoRows[0];
  if (!demo) throw new Error(`demo ${demoId} not found`);
  if (demo.status !== "ready") {
    throw new Error(`demo ${demoId} is "${demo.status}" — only ready demos can be analyzed`);
  }

  const attempts = await db
    .select({ id: demoAnalyses.id, status: demoAnalyses.status })
    .from(demoAnalyses)
    .where(eq(demoAnalyses.demoId, demoId));
  if (attempts.some((a) => a.status === "ready")) return { kind: "already_ready" };

  // Key sequencing counts JOB rows, not analysis rows: a job row exists for
  // every attempt by construction, while a job can die before inserting its
  // analysis row — an analysis-row count would then re-derive the dead job's
  // key forever and wedge the demo out of analysis. (UUIDs are fixed-length,
  // so one demo's key prefix can never match another demo's.)
  const priorJobs = await db
    .select({ id: jobs.id, status: jobs.status })
    .from(jobs)
    .where(like(jobs.idempotencyKey, `analyze:${demoId}%`));
  const live = priorJobs.find((j) => j.status === "queued" || j.status === "running");
  if (live) return { kind: "in_flight", jobId: live.id };

  const key =
    priorJobs.length === 0 ? `analyze:${demoId}` : `analyze:${demoId}:r${priorJobs.length}`;
  const { job, created } = await enqueue(db, {
    type: "analyze_demo",
    idempotencyKey: key,
    payload: { demoId },
  });
  if (!created && job.status !== "queued" && job.status !== "running") {
    // Only reachable if intervening job rows were pruned — surface, never loop.
    throw new Error(`analysis re-run key ${key} collides with a ${job.status} job — retry`);
  }
  return { kind: "queued", jobId: job.id };
}

/**
 * Job handler (heavy lane): normalized demo -> frame hashes -> state clusters
 * -> representative JPEGs to storage -> batched vision transcription ->
 * demo_analyses.timeline. Resumable: the analysis row id and every completed
 * batch are checkpointed on the job, so a retry re-runs ffmpeg (cheap, local)
 * but never re-buys a finished vision batch.
 */
export async function handleAnalyzeDemo(job: Job, ctx: JobContext): Promise<JobResult> {
  const { demoId } = job.payload as { demoId: string };
  const demoRows = await ctx.db.select().from(demos).where(eq(demos.id, demoId)).limit(1);
  const demo = demoRows[0];
  if (!demo) throw new PermanentError(`demo ${demoId} not found`);
  if (demo.status !== "ready" || !demo.normalizedPath) {
    throw new PermanentError(`demo ${demoId} is "${demo.status}" — nothing to analyze`);
  }

  // Computed once, ever: a retry (or a duplicate job) after a finished
  // analysis is a success no-op, not a second spend.
  const readyRows = await ctx.db
    .select()
    .from(demoAnalyses)
    .where(eq(demoAnalyses.demoId, demoId));
  if (readyRows.some((r) => r.status === "ready")) return { kind: "done" };

  // One analysis row per job: reuse the row this job checkpointed, so retries
  // resume it and a manual re-run (a new job) gets a fresh row.
  let analysisId = (job.state as { analysisId?: string } | null)?.analysisId;
  if (!analysisId) {
    const inserted = await ctx.db
      .insert(demoAnalyses)
      .values({ demoId, status: "pending" })
      .returning();
    analysisId = inserted[0]!.id;
    await ctx.checkpoint({ analysisId });
  }

  const setAnalysis = async (fields: Partial<typeof demoAnalyses.$inferInsert>) => {
    await ctx.db
      .update(demoAnalyses)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(demoAnalyses.id, analysisId!));
  };

  const storage = getStorage();
  const thumbKey = (ms: number) =>
    storageKey({
      businessId: demo.businessId,
      entity: "demo",
      id: demoId,
      filename: `states/${ms}.jpg`,
    });

  try {
    if (getEnv().DRY_RUN) {
      // Placeholder thumbs go through the real storage layer (same pattern as
      // composites) so the picker and the e2e test see real paths.
      const timeline = dryRunTimeline((ms) => `assets/${thumbKey(ms)}`);
      for (const state of timeline) {
        await storage.put("assets", thumbKey(state.timestampMs), Buffer.from("DRY_RUN state thumb"));
      }
      await setAnalysis({
        status: "ready",
        timeline,
        stateCount: timeline.length,
        promptVersion: "analyze_demo@dry-run",
      });
      return { kind: "done" };
    }

    await setAnalysis({ status: "analysing" });

    const questionnaire = await requireQuestionnaire(ctx.db, demo.businessId).catch((err) => {
      // The raw message is English and carries the business UUID — diagnostic
      // only; the customer-facing row gets the Hebrew instruction instead.
      throw new PermanentError(err instanceof Error ? err.message : String(err), {
        customerMessage: "מלאו את שאלון העסק לפני ניתוח הסרטון",
      });
    });

    const localDir = path.join(WORK_DIR, "analysis", demoId);
    const localDemo = path.join(localDir, "demo.mp4");
    await storage.download(demo.normalizedPath, localDemo);

    // Knobs clamped to >=1: zero/negative values would loop forever (batch
    // slicing), reject good footage (empty subsample) or fail ffmpeg (fps).
    const fps = Math.max(1, await getConfigValueOr(ctx.db, "a_analysis_fps", z.number(), 5));
    const hashes = await frameHashes(localDemo, { fps });
    const timestamps = hashes.map((_, i) => Math.round((i * 1000) / fps));
    const clusters = clusterStates(hashes, timestamps, {
      maxHamming: MAX_HAMMING,
      minFrames: MIN_CLUSTER_FRAMES,
    });
    if (clusters.length === 0) {
      // No UI state ever held still for two samples: a footage verdict, not a
      // system failure — same terminal state as the legibility gate below.
      await setAnalysis({ status: "rejected", failReason: REFILM_MESSAGE });
      return { kind: "done" };
    }

    const maxStates = Math.max(
      1,
      Math.floor(await getConfigValueOr(ctx.db, "a_analysis_max_states", z.number(), 80)),
    );
    const kept = subsampleClusters(clusters, maxStates);
    if (kept.length < clusters.length) {
      ctx.log.warn(
        { demoId, clusters: clusters.length, kept: kept.length },
        "analysis: thinned clusters to the max_states spend cap",
      );
    }

    // One decode pass at the SAME fps the hashes used, so representative
    // timestamps match extracted frames exactly (both are index/fps-derived).
    const frames = await extractFrames(localDemo, path.join(localDir, "frames"), {
      fps,
      width: ANALYSIS_FRAME_WIDTH,
    });
    const frameByMs = new Map(frames.map((f) => [f.timestampMs, f.path]));
    const localFrameOf = (cluster: StateCluster): string => {
      const file = frameByMs.get(cluster.representativeMs);
      if (!file) {
        throw new Error(`no extracted frame at ${cluster.representativeMs}ms (fps=${fps})`);
      }
      return file;
    };
    for (const cluster of kept) localFrameOf(cluster); // fail before any spend

    await Promise.all(
      kept.map((cluster) =>
        storage.put(
          "assets",
          thumbKey(cluster.representativeMs),
          readFileSync(localFrameOf(cluster)),
        ),
      ),
    );

    const batchSize = Math.max(
      1,
      Math.floor(await getConfigValueOr(ctx.db, "a_analysis_batch_size", z.number(), 10)),
    );
    const batches: StateCluster[][] = [];
    for (let i = 0; i < kept.length; i += batchSize) batches.push(kept.slice(i, i + batchSize));

    const { text: system, promptVersion } = renderPrompt("analyze_demo", {
      questionnaire: JSON.stringify(questionnaire, null, 2),
    });

    // Resume checkpointed batches — but only if they came from this EXACT
    // sampling AND prompt version. The sampling part stops a config change
    // that preserved the batch count from reattaching paid transcriptions to
    // other frames; the version part stops a prompt bump mid-retry from
    // producing a half-v1/half-v2 timeline labeled entirely v2 (a version
    // bump deliberately re-buys the finished batches — provenance over pennies).
    const resumeKey = `${promptVersion}/${fps}/${batchSize}/${kept
      .map((c) => c.representativeMs)
      .join(",")}`;
    const priorState = job.state as {
      analysisId?: string;
      resumeKey?: string;
      batchResults?: Record<string, BatchFrame[]>;
    } | null;
    const batchResults: Record<string, BatchFrame[]> =
      priorState?.resumeKey === resumeKey ? { ...(priorState.batchResults ?? {}) } : {};

    // batchResults only grows, so every later snapshot is a superset of every
    // earlier one — chaining the writes makes DB order match snapshot order,
    // so a smaller snapshot can never land last (pooled UPDATEs can otherwise
    // commit out of order) and silently re-buy a finished batch on retry.
    let checkpointChain: Promise<void> = Promise.resolve();
    const saveCheckpoint = (): Promise<void> => {
      const snapshot = { analysisId, resumeKey, batchResults: { ...batchResults } };
      checkpointChain = checkpointChain.then(() => ctx.checkpoint(snapshot));
      return checkpointChain;
    };

    const settled = await Promise.allSettled(
      batches.map(async (batch, bi) => {
        if (batchResults[bi]) return;
        // Parallel batches each pass this check before any usage lands, so one
        // analysis can overshoot the cap by at most the batch cap — acceptable
        // for a backstop; the real per-analysis bound is max_states.
        await assertBudget(ctx.db, "llm_tokens");
        const { object, usage } = await generateObjectWithImages({
          system,
          prompt: `Analyse the ${batch.length} frames above, in order. Return exactly one entry per frame, with the index from its label.`,
          frames: batch.map((cluster, i) => ({
            label: `Frame ${i} — t=${(cluster.representativeMs / 1000).toFixed(1)}s`,
            jpeg: readFileSync(localFrameOf(cluster)),
          })),
          schema: batchOutputSchema,
        });
        await recordUsage(ctx.db, {
          provider: "anthropic",
          kind: "llm_tokens",
          quantity: usage.inputTokens + usage.outputTokens,
          costEstimateAgorot: llmCostAgorot(usage.inputTokens, usage.outputTokens),
          jobId: job.id,
          businessId: demo.businessId,
        });
        const byIndex = new Map(object.frames.map((f) => [f.index, f]));
        if (object.frames.length !== batch.length || byIndex.size !== batch.length) {
          throw new Error(
            `batch ${bi}: model returned ${object.frames.length} frames for ${batch.length}`,
          );
        }
        batchResults[bi] = batch.map((_, i) => {
          const frame = byIndex.get(i);
          if (!frame) throw new Error(`batch ${bi}: model response missing frame index ${i}`);
          return frame;
        });
        await saveCheckpoint();
      }),
    );
    const rejections = settled.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    if (rejections.length > 0) {
      // Prefer parking over failing when both occurred in one parallel round.
      const budget = rejections.find((r) => r.reason instanceof BudgetError);
      throw (budget ?? rejections[0]!).reason;
    }

    // representativeMs = round(i*1000/fps), so the frame index inverts exactly.
    const keptHashes = kept.map((c) => hashes[Math.round((c.representativeMs * fps) / 1000)]!);

    const assembled: AnalysisState[] = [];
    batches.forEach((batch, bi) => {
      batch.forEach((cluster, i) => {
        const frame = batchResults[bi]![i]!;
        const g = assembled.length;
        // The model judges duplicates within its batch only — at a batch
        // boundary it cannot see the prior frame and reports false by
        // instruction. Bridge the seam with the same dHash the clustering
        // used, so a duplicate straddling batches still reads as one.
        const sameStateAsPrevious =
          frame.sameStateAsPrevious ||
          (i === 0 && g > 0 && hamming(keptHashes[g]!, keptHashes[g - 1]!) <= MAX_HAMMING);
        assembled.push({
          timestampMs: cluster.representativeMs,
          screenName: frame.screenName,
          visibleText: frame.visibleText,
          action: frame.action,
          actionType: frame.actionType,
          sameStateAsPrevious,
          legibility: frame.legibility,
          salienceNote: frame.salienceNote,
          thumbPath: `assets/${thumbKey(cluster.representativeMs)}`,
        });
      });
    });

    const threshold = await getConfigValueOr(
      ctx.db,
      "a_analysis_legibility_threshold",
      z.number(),
      0.4,
    );
    if (illegibleFraction(assembled) > threshold) {
      // The job did its work — the verdict on the FOOTAGE lives on the domain
      // row, customer-readable, with the timeline kept for founder debugging.
      await setAnalysis({
        status: "rejected",
        timeline: assembled,
        stateCount: assembled.length,
        promptVersion,
        failReason: REFILM_MESSAGE,
      });
      return { kind: "done" };
    }

    await setAnalysis({
      status: "ready",
      timeline: assembled,
      stateCount: assembled.length,
      promptVersion,
      failReason: null,
    });
    return { kind: "done" };
  } catch (err) {
    // Mirror terminal failures onto the domain row (docs/02); a parked budget
    // job is not terminal and resumes on its own.
    if (err instanceof PermanentError) {
      // failReason is customer-facing Hebrew by contract; the raw diagnostic
      // stays on jobs.last_error.
      await setAnalysis({ status: "failed", failReason: err.customerMessage ?? err.message });
    } else if (!(err instanceof BudgetError) && isLastAttempt(job)) {
      await setAnalysis({ status: "failed", failReason: "ניתוח הסרטון נכשל — נסו שוב" });
    }
    throw err;
  }
}
