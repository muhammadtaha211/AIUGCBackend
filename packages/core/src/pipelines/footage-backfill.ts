import { asc, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getConfigValueOr } from "../appConfig";
import { getEnv } from "../config";
import type { Db } from "../db";
import { demoAnalyses, demoAnalysisFootage, demos, jobs } from "../db/schema";
import { clusterStates, frameHashes, frameSignatures } from "../media/ffmpeg";
import { WORK_DIR } from "../paths";
import { demoFrame } from "../plan-format";
import { getStorage } from "../storage";
import { parseResumeKey } from "./analysis-audit";
import {
  analysisMoments,
  footageEvents,
  SCREENS_DETECTOR,
  SIGNATURE_FPS,
} from "./analysis-screens";
import {
  analysisTimelineSchema,
  MAX_HAMMING,
  MIN_CLUSTER_FRAMES,
  subsampleClusters,
} from "./demo-analysis";
import { analysisSampleMs, recordingEndMs } from "./demo-step-plans";

/**
 * The footage row for analyses from before one was written (migration 0050,
 * decision 0081): `aiugc demo footage-backfill`. No model call — what the
 * analysis paid for is in its job's checkpoint; this only decodes the stored
 * file again.
 *
 * It must run on the WORKER BOX: the spans come from re-running the
 * clustering, and only the box reproduces the box's clustering (the same
 * ffmpeg scales the same frames). So nothing is trusted that cannot be
 * verified against what the analysis itself recorded:
 *
 * - the re-clustered kept moments must equal the job's stored list
 *   (resumeKey) — this certifies each moment's representative; the span
 *   around it is the same clustering's, and cannot be checked further;
 * - the moments whose read came back (the job's batchResults) must be exactly
 *   the timeline's timestamps, in order.
 *
 * Either check failing writes nothing for that analysis and says why. A row
 * is only ever inserted where none exists, or its instants filled where the
 * analysis-time decode had failed; an existing row's content is never
 * overwritten.
 */
export interface FootageBackfillReport {
  analysisId: string;
  demoId: string;
  /** written: a row was inserted. filled: an existing row got its missing
   *  instants. would_*: the same, not written (no --write). has_row: nothing
   *  to do. skipped: not verifiable — `reason` says why. */
  outcome: "written" | "filled" | "would_write" | "would_fill" | "has_row" | "skipped";
  reason?: string;
  moments?: number;
  unread?: number;
  instants?: number;
  /** Decoded frames of the normalized file, against the frame the plan code
   *  takes for the recording's end (recordingEndMs, from the raw upload's
   *  length). A step placed at the very end is cut short by the difference
   *  when the second is larger. */
  frames?: number;
  recordingEndFrame?: number;
  /** Other analyses of the same file whose stored instants differ from the
   *  ones computed now. Empty on a machine that repeats itself. */
  sameFileDiffers?: string[];
}

/** Every ready analysis, oldest first. */
export async function listFootageBackfillCandidates(db: Db): Promise<string[]> {
  const rows = await db
    .select({ id: demoAnalyses.id })
    .from(demoAnalyses)
    .where(eq(demoAnalyses.status, "ready"))
    .orderBy(asc(demoAnalyses.createdAt));
  return rows.map((row) => row.id);
}

const instantTimesSchema = z.array(z.object({ atMs: z.number() }));

export async function backfillAnalysisFootage(
  db: Db,
  analysisId: string,
  opts: { write: boolean },
): Promise<FootageBackfillReport> {
  if (getEnv().DRY_RUN) {
    throw new Error(
      "footage backfill refuses to run under DRY_RUN — it reads and decodes real files",
    );
  }
  const analysis = (
    await db.select().from(demoAnalyses).where(eq(demoAnalyses.id, analysisId)).limit(1)
  )[0];
  if (!analysis) throw new Error(`analysis ${analysisId} not found`);
  const demo = (await db.select().from(demos).where(eq(demos.id, analysis.demoId)).limit(1))[0];
  if (!demo) throw new Error(`demo ${analysis.demoId} not found`);
  const report: FootageBackfillReport = {
    analysisId,
    demoId: demo.id,
    outcome: "skipped",
  };
  const skip = (reason: string): FootageBackfillReport => ({ ...report, reason });

  if (analysis.status !== "ready" || !analysis.timeline) return skip("analysis is not ready");
  if (analysis.promptVersion?.endsWith("@dry-run")) {
    return skip("dry-run analysis — a placeholder timeline over no real file");
  }
  if (!demo.normalizedPath) return skip("demo has no normalized video");
  const timeline = analysisTimelineSchema.parse(analysis.timeline);

  const existing = (
    await db
      .select()
      .from(demoAnalysisFootage)
      .where(eq(demoAnalysisFootage.analysisId, analysisId))
      .limit(1)
  )[0];

  const jobRows = await db
    .select({ state: jobs.state })
    .from(jobs)
    .where(sql`${jobs.type} = 'analyze_demo' and ${jobs.state}->>'analysisId' = ${analysisId}`);
  const checkpoint = jobRows
    .map((job) => job.state as { resumeKey?: unknown; batchResults?: unknown } | null)
    .find((state) => typeof state?.resumeKey === "string");
  const resumeKey = checkpoint?.resumeKey as string | undefined;
  const sampling = resumeKey ? parseResumeKey(resumeKey) : null;
  const batchSize = resumeKey ? Number(resumeKey.split("/")[2]) : Number.NaN;
  if (!sampling || !Number.isInteger(batchSize) || batchSize < 1) {
    return skip(
      "the analyze job's checkpoint was not found, so the kept moments cannot be verified",
    );
  }

  mkdirSync(WORK_DIR, { recursive: true });
  const dir = mkdtempSync(path.join(WORK_DIR, "footage-backfill-"));
  try {
    const local = path.join(dir, "demo.mp4");
    await getStorage().download(demo.normalizedPath, local);

    // The analysis's own sampling, not today's knob.
    const { fps } = sampling;
    const hashes = await frameHashes(local, { fps });
    const timestamps = hashes.map((_, i) => Math.round((i * 1000) / fps));
    const clusters = clusterStates(hashes, timestamps, {
      maxHamming: MAX_HAMMING,
      minFrames: MIN_CLUSTER_FRAMES,
    });
    const maxStates = Math.max(
      1,
      Math.floor(await getConfigValueOr(db, "a_analysis_max_states", z.number(), 80)),
    );
    const kept = subsampleClusters(clusters, maxStates);
    const sameKept =
      kept.length === sampling.keptMs.length &&
      kept.every((cluster, i) => cluster.representativeMs === sampling.keptMs[i]);
    if (!sameKept) {
      return skip(
        `re-clustering gives ${kept.length} moments that are not the ${sampling.keptMs.length} the analysis kept — not the machine or the settings it ran with`,
      );
    }

    const batchResults = (checkpoint?.batchResults ?? {}) as Record<string, unknown[] | undefined>;
    const read = kept.map((_, i) => {
      const batch = batchResults[String(Math.floor(i / batchSize))];
      return Boolean(batch?.[i % batchSize]);
    });
    const readMs = kept.filter((_, i) => read[i]).map((cluster) => cluster.representativeMs);
    const sameRead =
      readMs.length === timeline.length && readMs.every((ms, i) => ms === timeline[i]!.timestampMs);
    if (!sameRead) {
      return skip(
        "the moments the checkpoint says were read are not the timeline's — the checkpoint is not this analysis's last run",
      );
    }

    const signatures = await frameSignatures(local, { fps: SIGNATURE_FPS });
    const events = footageEvents(signatures);
    const fileSha = createHash("sha256").update(readFileSync(local)).digest("hex");
    const moments = analysisMoments(kept, read);

    const siblings = await db
      .select({
        analysisId: demoAnalysisFootage.analysisId,
        instants: demoAnalysisFootage.instants,
      })
      .from(demoAnalysisFootage)
      .where(eq(demoAnalysisFootage.fileSha, fileSha));
    const times = JSON.stringify(events.map((event) => event.atMs));
    const sameFileDiffers = siblings
      .filter((row) => row.analysisId !== analysisId && row.instants !== null)
      .filter((row) => {
        const stored = instantTimesSchema.safeParse(row.instants);
        return !stored.success || JSON.stringify(stored.data.map((e) => e.atMs)) !== times;
      })
      .map((row) => row.analysisId);

    const measured = {
      moments: moments.length,
      unread: read.filter((ok) => !ok).length,
      instants: events.length,
      frames: signatures.length,
      recordingEndFrame: demoFrame(
        recordingEndMs(demo.durationMs, timeline, await analysisSampleMs(db)),
      ),
      sameFileDiffers,
    };

    if (existing && existing.instants !== null)
      return { ...report, ...measured, outcome: "has_row" };
    if (existing) {
      if (!opts.write) return { ...report, ...measured, outcome: "would_fill" };
      await db
        .update(demoAnalysisFootage)
        .set({ detector: SCREENS_DETECTOR, instants: events, updatedAt: new Date() })
        .where(
          sql`${demoAnalysisFootage.analysisId} = ${analysisId} and ${demoAnalysisFootage.instants} is null`,
        );
      return { ...report, ...measured, outcome: "filled" };
    }
    if (!opts.write) return { ...report, ...measured, outcome: "would_write" };
    await db
      .insert(demoAnalysisFootage)
      .values({ analysisId, fps, fileSha, moments, detector: SCREENS_DETECTOR, instants: events })
      .onConflictDoNothing();
    return { ...report, ...measured, outcome: "written" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
