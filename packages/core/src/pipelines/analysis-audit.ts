import { and, asc, eq, sql } from "drizzle-orm";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getConfigValueOr } from "../appConfig";
import type { Db } from "../db";
import { demoAnalyses, demos, jobs } from "../db/schema";
import { clusterStates, frameHashes, hamming } from "../media/ffmpeg";
import { WORK_DIR } from "../paths";
import { PLAN_SKIP_SCREEN_KINDS } from "../plan-format";
import { getStorage } from "../storage";
import {
  analysisTimelineSchema,
  MAX_HAMMING,
  MIN_CLUSTER_FRAMES,
  subsampleClusters,
  type AnalysisState,
} from "./demo-analysis";

/**
 * `aiugc demo audit` — READ-ONLY accounting of where screen-recording moments
 * are lost before they reach a demo's inventory. Re-runs the deterministic
 * half of analyze_demo (frameHashes → clusterStates → subsampleClusters) and
 * attributes every sampled run to the stage that dropped it:
 *
 *   S1 noise          a run shorter than MIN_CLUSTER_FRAMES
 *   S2 cap            thinned by subsampleClusters to a_analysis_max_states
 *   S3 transcription  kept, but absent from the stored timeline (droppedMs)
 *   S4 unreadable     in the timeline, no picker tile, refused by updatePlanSteps
 *
 * plus S5, the picker's collapsed "פחות מתאימים" tier, counted for the record.
 * No model call, no enqueue, no DB or storage write: the DB reads run in a
 * READ ONLY transaction, and the only thing written is the downloaded video,
 * in a temp dir under WORK_DIR that is removed afterwards.
 *
 * The analyze_demo job's checkpoint (its resumeKey) holds the analysis-time
 * kept set, so S3 is exact from it alone, and it says whether the recompute
 * reproduced the analysis. Measured 2026-09-28: ffmpeg 8.1.2 on the founder's
 * machine reproduced none of ten analyses the box ran — representatives moved
 * by a frame, both ways. Which part of ffmpeg differs (version, fps frame
 * selection, swscale rounding on another CPU path) is not isolated.
 */

export type LossStage = "S1" | "S2" | "S3" | "S4";

type AuditState = Pick<
  AnalysisState,
  "timestampMs" | "legibility" | "sameStateAsPrevious" | "actionType" | "screenKind"
>;

/** One run of the clustering before S1 (minFrames 1), and where it ended up. */
export interface AuditRun {
  startMs: number;
  endMs: number;
  representativeMs: number;
  /** Sampled frames × the frame period: how long the state held, to the
   *  sampling's resolution (a one-frame run at 5 fps is 200ms). */
  durationMs: number;
  /** dHash distance from this run's first frame to the previous run's first
   *  frame — the anchor clusterStates compared it against. Null for the first. */
  hammingFromPrev: number | null;
  /** The stage that lost it; null when it reached the timeline with a tile. */
  lostAt: LossStage | null;
  /** The timeline state this run holds (see attributeLosses). */
  timelineIndex: number | null;
}

export interface LongHold {
  startMs: number;
  endMs: number;
  durationMs: number;
  /** First vs last frame of the hold. At most MAX_HAMMING by construction —
   *  clusterStates splits the moment a frame is further than that from the
   *  first — and 10–14 is also where handheld drift alone lands on an
   *  unchanged screen (MAX_HAMMING's own docblock), so this cannot tell a
   *  toggle from camera movement; only the frames themselves can. */
  firstLastHamming: number;
  /** The representative (median) frame vs the last — how far the frame the
   *  model saw is from the state the hold ended on. */
  repLastHamming: number;
  lostAt: LossStage | null;
  timelineIndex: number | null;
}

export interface ClusterAttribution {
  runs: AuditRun[];
  clustersBeforeS1: number;
  clustersAfterS1: number;
  s1: number;
  s2: number;
  s3: number;
  /** representativeMs of every cluster the recompute keeps after S2. */
  keptMs: number[];
  /** Timeline states no run holds — the recompute merged states the analysis
   *  kept apart. Always empty when the recompute reproduces the analysis. */
  unmatchedTimelineMs: number[];
  durations: { atLeast2s: number; atLeast3s: number; atLeast5s: number; maxMs: number };
  longHolds: LongHold[];
}

/** The two frame-index conversions handleAnalyzeDemo uses, verbatim. */
const msAt = (i: number, fps: number) => Math.round((i * 1000) / fps);
const frameAt = (ms: number, fps: number) => Math.round((ms * fps) / 1000);

/**
 * S1–S3 (and S4 for the runs that matched) from one demo's frame hashes and
 * its stored timeline. The clustering is the handler's own call, twice: the
 * run boundaries do not depend on minFrames (it only filters), so the runs
 * of the minFrames-1 pass that the MIN_CLUSTER_FRAMES pass lacks are exactly
 * S1. A run holds the timeline state at its representativeMs — the handler
 * writes the one into the other — or, failing that, the first one inside its
 * span: when this machine's ffmpeg does not reproduce the analysis, a
 * representative lands a frame off its stored state, and exact matching alone
 * would call every such run S3. When the recompute does reproduce, the two
 * rules agree: each timestamp is exactly one run's representative.
 */
export function attributeLosses(opts: {
  hashes: bigint[];
  fps: number;
  maxStates: number;
  timeline: AuditState[];
}): ClusterAttribution {
  const { hashes, fps, maxStates, timeline } = opts;
  const timestamps = hashes.map((_, i) => msAt(i, fps));
  const all = clusterStates(hashes, timestamps, { maxHamming: MAX_HAMMING, minFrames: 1 });
  const survivors = clusterStates(hashes, timestamps, {
    maxHamming: MAX_HAMMING,
    minFrames: MIN_CLUSTER_FRAMES,
  });
  const kept = subsampleClusters(survivors, maxStates);

  const survived = new Set(survivors.map((c) => c.startMs));
  const keptStarts = new Set(kept.map((c) => c.startMs));
  const timelineAt = new Map(timeline.map((s, i) => [s.timestampMs, i]));
  const hashAt = (ms: number) => hashes[frameAt(ms, fps)]!;
  const heldBy = (c: { startMs: number; endMs: number; representativeMs: number }) => {
    const exact = timelineAt.get(c.representativeMs);
    if (exact !== undefined) return exact;
    const inside = timeline.findIndex(
      (s) => c.startMs <= s.timestampMs && s.timestampMs <= c.endMs,
    );
    return inside === -1 ? null : inside;
  };

  const runs: AuditRun[] = all.map((c, k) => {
    const frames = frameAt(c.endMs, fps) - frameAt(c.startMs, fps) + 1;
    const timelineIndex = heldBy(c);
    let lostAt: LossStage | null = null;
    if (timelineIndex !== null) {
      if (timeline[timelineIndex]!.legibility === "unreadable") lostAt = "S4";
    } else if (!survived.has(c.startMs)) lostAt = "S1";
    else if (!keptStarts.has(c.startMs)) lostAt = "S2";
    else lostAt = "S3";
    return {
      ...c,
      durationMs: Math.round((frames * 1000) / fps),
      hammingFromPrev: k === 0 ? null : hamming(hashAt(all[k - 1]!.startMs), hashAt(c.startMs)),
      lostAt,
      timelineIndex,
    };
  });

  const count = (stage: LossStage) => runs.filter((r) => r.lostAt === stage).length;
  const held = new Set(runs.map((r) => r.timelineIndex));
  const atLeast = (ms: number) => runs.filter((r) => r.durationMs >= ms).length;
  return {
    runs,
    clustersBeforeS1: all.length,
    clustersAfterS1: survivors.length,
    s1: count("S1"),
    s2: count("S2"),
    s3: count("S3"),
    keptMs: kept.map((c) => c.representativeMs),
    unmatchedTimelineMs: timeline.filter((_, i) => !held.has(i)).map((s) => s.timestampMs),
    durations: {
      atLeast2s: atLeast(2000),
      atLeast3s: atLeast(3000),
      atLeast5s: atLeast(5000),
      maxMs: Math.max(0, ...runs.map((r) => r.durationMs)),
    },
    longHolds: runs
      .filter((r) => r.durationMs >= 3000)
      .map((r) => ({
        startMs: r.startMs,
        endMs: r.endMs,
        durationMs: r.durationMs,
        firstLastHamming: hamming(hashAt(r.startMs), hashAt(r.endMs)),
        repLastHamming: hamming(hashAt(r.representativeMs), hashAt(r.endMs)),
        lostAt: r.lostAt,
        timelineIndex: r.timelineIndex,
      })),
  };
}

export type TierReason = "low" | "repeat" | "idle" | "skip-kind";

/**
 * Why a timeline state sits in the picker's collapsed tier, every reason that
 * applies — pickerPools (apps/web/src/lib/service-a-ui.ts) inverted. [] for a
 * main-grid state, and for an unreadable one: that has no tile at all (S4).
 */
export function tierReasons(state: AuditState): TierReason[] {
  if (state.legibility === "unreadable") return [];
  const reasons: TierReason[] = [];
  if (state.legibility !== "high") reasons.push("low");
  if (state.sameStateAsPrevious) reasons.push("repeat");
  if (state.actionType === "idle") reasons.push("idle");
  if (state.screenKind !== undefined && PLAN_SKIP_SCREEN_KINDS.has(state.screenKind)) {
    reasons.push("skip-kind");
  }
  return reasons;
}

export interface TimelineLosses {
  timelineLength: number;
  s4: number;
  /** Per reason, overlapping; `total` counts each state once. */
  s5: Record<TierReason, number> & { total: number };
}

export function timelineLosses(timeline: AuditState[]): TimelineLosses {
  const s5 = { low: 0, repeat: 0, idle: 0, "skip-kind": 0, total: 0 };
  for (const state of timeline) {
    const reasons = tierReasons(state);
    for (const reason of reasons) s5[reason]++;
    if (reasons.length > 0) s5.total++;
  }
  return {
    timelineLength: timeline.length,
    s4: timeline.filter((s) => s.legibility === "unreadable").length,
    s5,
  };
}

/** Every stored timestamp is a frame time at this fps. A timeline analysed at
 *  another fps fails it — unless the old grid is a subset of this one (1 fps
 *  under 5 fps), which is why the job checkpoint is checked as well. */
export function onFpsGrid(timeline: AuditState[], fps: number): boolean {
  return timeline.every((s) => msAt(frameAt(s.timestampMs, fps), fps) === s.timestampMs);
}

/** The analysis-time sampling, out of the analyze_demo job's checkpoint:
 *  handleAnalyzeDemo's resumeKey, `${promptVersion}/${fps}/${batchSize}/${keptMs,…}`. */
export function parseResumeKey(key: string): { fps: number; keptMs: number[] } | null {
  const parts = key.split("/");
  if (parts.length !== 4 || !/^\d+(,\d+)*$/.test(parts[3]!)) return null;
  const fps = Number(parts[1]);
  if (!Number.isFinite(fps) || fps <= 0) return null;
  return { fps, keptMs: parts[3]!.split(",").map(Number) };
}

/** S3 exactly, with no recompute: the analysis's own kept representatives
 *  that never reached the timeline — handleAnalyzeDemo's droppedMs. */
export function droppedFromTimeline(keptMs: number[], timeline: AuditState[]): number[] {
  const inTimeline = new Set(timeline.map((s) => s.timestampMs));
  return keptMs.filter((ms) => !inTimeline.has(ms));
}

/** The recompute's kept set against the analysis-time one. Both empty pins
 *  S2 and S3 to the analysis; nothing stored pins S1 or the run spans, which
 *  match only where this ffmpeg is the build that ran the analysis. Anything
 *  non-empty: S1, S2 and the per-run lines are approximate. */
export function diffKept(
  thenMs: number[],
  nowMs: number[],
): { missingMs: number[]; extraMs: number[] } {
  const then = new Set(thenMs);
  const now = new Set(nowMs);
  return {
    missingMs: thenMs.filter((ms) => !now.has(ms)),
    extraMs: nowMs.filter((ms) => !then.has(ms)),
  };
}

export interface MomentLocation {
  atMs: number;
  /** The sampled frame nearest the moment, as a timestamp. */
  frameMs: number;
  run: AuditRun;
  /** The moment's frame vs the run's representative — how far what was on
   *  screen then is from the frame the model transcribed. */
  hammingToRepresentative: number;
  /** For a lost run: the nearest timeline states on either side. */
  timelineBefore: number | null;
  timelineAfter: number | null;
}

/** The founder slot: which run a moment fell in, and what became of it. */
export function locateMoment(opts: {
  attribution: ClusterAttribution;
  hashes: bigint[];
  fps: number;
  atMs: number;
}): MomentLocation {
  const { attribution, hashes, fps, atMs } = opts;
  const frame = Math.min(hashes.length - 1, Math.max(0, frameAt(atMs, fps)));
  const frameMs = msAt(frame, fps);
  const run = attribution.runs.find((r) => r.startMs <= frameMs && frameMs <= r.endMs)!;
  const held = attribution.runs.filter((r) => r.timelineIndex !== null);
  return {
    atMs,
    frameMs,
    run,
    hammingToRepresentative: hamming(hashes[frame]!, hashes[frameAt(run.representativeMs, fps)]!),
    timelineBefore: held.filter((r) => r.startMs <= frameMs).at(-1)?.timelineIndex ?? null,
    timelineAfter: held.find((r) => r.startMs > frameMs)?.timelineIndex ?? null,
  };
}

// ---------------------------------------------------------------------------
// I/O: one demo, read-only
// ---------------------------------------------------------------------------

export interface DemoAuditReport extends TimelineLosses {
  demoId: string;
  analysisId: string;
  promptVersion: string | null;
  analysedAt: string;
  durationMs: number | null;
  /** Current config, read the way handleAnalyzeDemo reads it. */
  fps: number;
  maxStates: number;
  /** The analysis-time truth from the analyze_demo job's checkpoint — its fps,
   *  how many clusters it kept, and S3 exactly (droppedFromTimeline). Null
   *  when the job left none; S3 then comes from the recompute alone. */
  checkpoint: { fps: number; kept: number; s3Ms: number[] } | null;
  /** The recompute's kept set vs the checkpoint's (diffKept); null without
   *  both. Anything non-empty: S1, S2 and the per-cluster lines are approximate. */
  reproduction: { missingMs: number[]; extraMs: number[] } | null;
  /** Why S1–S3 were not measured, when they were not. */
  skipped: string | null;
  clusters: ClusterAttribution | null;
  moment: MomentLocation | null;
}

/** Demo ids with a ready analysis, oldest analysis first. */
export async function listAuditableDemos(db: Db): Promise<string[]> {
  const rows = await db
    .select({ demoId: demoAnalyses.demoId })
    .from(demoAnalyses)
    .where(eq(demoAnalyses.status, "ready"))
    .orderBy(asc(demoAnalyses.createdAt));
  return rows.map((r) => r.demoId);
}

export async function auditDemo(
  db: Db,
  demoId: string,
  opts: { atMs?: number } = {},
): Promise<DemoAuditReport> {
  // Every read in one READ ONLY transaction — Postgres itself refuses a write
  // — and closed before the download, so no transaction spans ffmpeg.
  const reads = await db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    const demo = (await tx.select().from(demos).where(eq(demos.id, demoId)).limit(1))[0];
    if (!demo) throw new Error(`demo ${demoId} not found`);
    const analysis = (
      await tx
        .select()
        .from(demoAnalyses)
        .where(and(eq(demoAnalyses.demoId, demoId), eq(demoAnalyses.status, "ready")))
        .limit(1)
    )[0];
    if (!analysis) throw new Error(`demo ${demoId} has no ready analysis`);
    // Clamped exactly as handleAnalyzeDemo clamps them.
    const fps = Math.max(1, await getConfigValueOr(tx as Db, "a_analysis_fps", z.number(), 5));
    const maxStates = Math.max(
      1,
      Math.floor(await getConfigValueOr(tx as Db, "a_analysis_max_states", z.number(), 80)),
    );
    const jobRows = await tx
      .select({ state: jobs.state })
      .from(jobs)
      .where(
        and(eq(jobs.type, "analyze_demo"), sql`${jobs.state}->>'analysisId' = ${analysis.id}`),
      );
    const resumeKey = jobRows
      .map((j) => (j.state as { resumeKey?: unknown } | null)?.resumeKey)
      .find((k): k is string => typeof k === "string");
    return { demo, analysis, fps, maxStates, resumeKey };
  });
  const { demo, analysis, fps, maxStates, resumeKey } = reads;

  const timeline = analysisTimelineSchema.parse(analysis.timeline ?? []);
  const analysisTime = resumeKey ? parseResumeKey(resumeKey) : null;
  const report: DemoAuditReport = {
    demoId,
    analysisId: analysis.id,
    promptVersion: analysis.promptVersion,
    analysedAt: analysis.createdAt.toISOString(),
    durationMs: demo.durationMs,
    fps,
    maxStates,
    ...timelineLosses(timeline),
    checkpoint: analysisTime && {
      fps: analysisTime.fps,
      kept: analysisTime.keptMs.length,
      s3Ms: droppedFromTimeline(analysisTime.keptMs, timeline),
    },
    reproduction: null,
    skipped: null,
    clusters: null,
    moment: null,
  };

  if (analysis.promptVersion?.endsWith("@dry-run")) {
    report.skipped = "dry-run analysis — a placeholder timeline, nothing to recompute";
  } else if (!onFpsGrid(timeline, fps)) {
    report.skipped = "fps changed since analysis — S1-S3 unreliable";
  } else if (analysisTime && analysisTime.fps !== fps) {
    report.skipped = `fps changed since analysis — S1-S3 unreliable (analysed at ${analysisTime.fps}, now ${fps})`;
  } else if (!demo.normalizedPath) {
    report.skipped = "demo has no normalized video";
  }
  if (report.skipped) return report;

  mkdirSync(WORK_DIR, { recursive: true });
  const dir = mkdtempSync(path.join(WORK_DIR, "audit-"));
  let hashes: bigint[];
  try {
    const local = path.join(dir, "demo.mp4");
    await getStorage().download(demo.normalizedPath!, local);
    hashes = await frameHashes(local, { fps });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  report.clusters = attributeLosses({ hashes, fps, maxStates, timeline });
  if (analysisTime) report.reproduction = diffKept(analysisTime.keptMs, report.clusters.keptMs);
  if (opts.atMs !== undefined) {
    report.moment = locateMoment({ attribution: report.clusters, hashes, fps, atMs: opts.atMs });
  }
  return report;
}
