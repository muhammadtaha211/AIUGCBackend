import { and, desc, eq, isNull, like } from "drizzle-orm";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getConfigValueOr } from "../appConfig";
import { AccountBudgetError, assertAccountBudget, assertBudget, recordUsage } from "../budget";
import { getEnv } from "../config";
import type { Db } from "../db";
import { demoAnalyses, demoAnalysisFootage, demos, jobs } from "../db/schema";
import { BudgetError, PermanentError } from "../jobs/errors";
import { enqueue, isLastAttempt, type Job } from "../jobs/queue";
import type { JobContext, JobResult } from "../jobs/worker";
import {
  clusterStates,
  extractFrames,
  frameHashes,
  frameSignatures,
  hamming,
  type StateCluster,
} from "../media/ffmpeg";
import { WORK_DIR } from "../paths";
import { isInventoryState } from "../plan-format";
import { llmCostAgorot } from "../pricing";
import {
  generateObject,
  generateRawWithImages,
  strictOutputFormat,
  type RawResult,
  type WireOutputFormat,
} from "../providers/anthropic";
import { renderPrompt } from "../prompts";
import { getStorage, storageKey } from "../storage";
import {
  analysisMoments,
  footageEvents,
  SCREENS_DETECTOR,
  SIGNATURE_FPS,
  type FootageEvent,
} from "./analysis-screens";
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

export const ANALYSIS_SCREEN_KINDS = [
  "product",
  "login",
  "loading",
  "onboarding",
  "error",
  "tour",
  "system",
  "other",
] as const;

export const analysisStateSchema = z.object({
  timestampMs: z.number(),
  screenName: z.string(),
  // VERBATIM screen text — never translated, corrected or completed.
  visibleText: z.array(z.string()),
  action: z.string(),
  actionType: z.enum(ANALYSIS_ACTION_TYPES),
  // Absent on v2-era analyses (added with analyze_demo@v3) — consumers treat
  // missing as "no information", never as "product".
  screenKind: z.enum(ANALYSIS_SCREEN_KINDS).optional(),
  sameStateAsPrevious: z.boolean(),
  legibility: z.enum(["high", "low", "unreadable"]),
  salienceNote: z.string().nullable(),
  thumbPath: z.string(),
});
export type AnalysisState = z.infer<typeof analysisStateSchema>;

export const analysisTimelineSchema = z.array(analysisStateSchema);

/**
 * Task-level Hebrew groupings of the timeline for the wizard's inventory —
 * demo_analyses.sections (0030). Written once by group_analysis_states after
 * the analysis lands ready; NULL means "not grouped" and the UI falls back to
 * time-range pages, so nothing anywhere may treat a missing grouping as an error.
 */
export const analysisSectionsSchema = z.array(
  z.object({
    title: z.string().min(1),
    stateIndexes: z.array(z.number().int().nonnegative()),
  }),
);
export type AnalysisSection = z.infer<typeof analysisSectionsSchema>[number];

/** Sections the grouping model may not return, as model-facing English —
 *  the same deterministic-check-plus-one-corrective-call shape as
 *  findPlanViolations, scaled down. */
export function findSectionViolations(
  sections: AnalysisSection[],
  timelineLength: number,
): string[] {
  const violations: string[] = [];
  if (sections.length === 0) violations.push("zero sections");
  if (sections.length > 6) violations.push(`${sections.length} sections — the maximum is 6`);
  const seen = new Set<number>();
  sections.forEach((section, i) => {
    if (!/[֐-׿]/.test(section.title)) {
      violations.push(`section ${i}: title "${section.title}" is not Hebrew`);
    }
    if (section.stateIndexes.length === 0) violations.push(`section ${i}: has no states`);
    for (const index of section.stateIndexes) {
      if (index >= timelineLength) {
        violations.push(`section ${i}: state ${index} is not in the timeline`);
      } else if (seen.has(index)) {
        violations.push(`section ${i}: state ${index} appears in two sections`);
      }
      seen.add(index);
    }
  });
  return violations;
}

export const ANALYSIS_LEGIBILITY = ["high", "low", "unreadable"] as const;

/**
 * One frame as the model returns it — timestamps and thumb paths are attached
 * in code. Validated PER ELEMENT (validateBatchFrames): a frame the model got
 * wrong drops that frame into the salvage path, never its whole batch.
 */
export const batchFrameSchema = z.object({
  index: z.number(),
  screenName: z.string(),
  visibleText: z.array(z.string()),
  action: z.string(),
  actionType: z.enum(ANALYSIS_ACTION_TYPES),
  screenKind: z.enum(ANALYSIS_SCREEN_KINDS),
  sameStateAsPrevious: z.boolean(),
  legibility: z.enum(ANALYSIS_LEGIBILITY),
  salienceNote: z.string().nullable(),
});
export type BatchFrame = z.infer<typeof batchFrameSchema>;

/** What the model returns per batch. The wire format derives from this object
 *  and is pinned byte for byte by analysis-batch-salvage.test.ts. */
export const batchOutputSchema = z.object({ frames: z.array(batchFrameSchema) });

/** The wire format of every vision batch call — the strict wire, so the three
 *  enums are rules of the decoding grammar and not prose the model may ignore
 *  (job 85d9ec0b's actionType was outside the enum on the folded wire). Built
 *  per call rather than at import, so tests that mock the provider module
 *  still load this one. */
export function batchWireFormat(): WireOutputFormat {
  return strictOutputFormat(batchOutputSchema);
}

/** The enum-valued frame fields with their declared values. With the enums in
 *  the grammar the residual hole is the documented one — structured outputs
 *  do not guarantee the CASING of enum values — closed per element against
 *  these lists, never by blind lowercasing. */
const FRAME_ENUM_FIELDS = {
  actionType: ANALYSIS_ACTION_TYPES,
  screenKind: ANALYSIS_SCREEN_KINDS,
  legibility: ANALYSIS_LEGIBILITY,
} as const;
type FrameEnumField = keyof typeof FRAME_ENUM_FIELDS;

/**
 * 768px is what lets the model read Hebrew UI text off a filmed screen — do
 * not shrink below it; the whole design depends on that legibility.
 */
const ANALYSIS_FRAME_WIDTH = 768;
/**
 * dHash distance under which two sampled frames are the same UI state.
 * 14 is the ceiling: a flat-to-flat cut registers ~15 luma-band bits and must
 * stay a split (media-steps.test.ts pins this). Raised from 10 after the first
 * real-footage run — handheld drift split one unchanged Google account chooser
 * into 11 states; at 14 the same recording keeps every genuine screen
 * transition (measured margin: the first real merge appears at 24) while the
 * chooser run drops to ~9 clusters. Only sub-screen deltas (a validation line
 * appearing, an in-app tour tooltip swapping) merge below that, and pass 2
 * skips those states anyway.
 */
export const MAX_HAMMING = 14;
/** A state must persist >=2 sampled frames — a single glare/shake frame is noise. */
export const MIN_CLUSTER_FRAMES = 2;

/** The rate the recording is sampled at, clamped to >=1 (ffmpeg fails on 0).
 *  Every stored timestampMs sits on its grid, round(i*1000/fps). The step plan
 *  reads the same knob: a step's screen ends one sample after the last state
 *  still on it (decision 0072). */
export async function analysisFps(db: Db): Promise<number> {
  return Math.max(1, await getConfigValueOr(db, "a_analysis_fps", z.number(), 5));
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

/** Fraction of states the model could not read at all; an empty timeline is 1. */
export function unreadableFraction(states: { legibility: string }[]): number {
  if (states.length === 0) return 1;
  return states.filter((s) => s.legibility === "unreadable").length / states.length;
}

export type LegibilityVerdict = { ok: true } | { ok: false; fraction: number; threshold: number };

/**
 * The footage gate as a pure decision: only "unreadable" states count —
 * "low" is usable everywhere downstream and never a reason to refilm
 * (decision 0069). The threshold is a parameter (pricing.ts precedent — the
 * caller loads config and passes it in). An empty timeline inherits the
 * fraction's empty-is-1 convention and always fails.
 */
export function legibilityVerdict(
  states: { legibility: string }[],
  thresholds: { unreadableMax: number },
): LegibilityVerdict {
  const unreadable = unreadableFraction(states);
  if (unreadable > thresholds.unreadableMax) {
    return { ok: false, fraction: unreadable, threshold: thresholds.unreadableMax };
  }
  return { ok: true };
}

/**
 * Positional salvage of a model batch response: the entry claiming index i
 * lands at position i; out-of-range and duplicate claims are dropped; a
 * position no entry claims stays null. Complete iff no nulls — the caller
 * retries once on an incomplete result, then drops the null positions from
 * the timeline rather than failing the whole analysis.
 */
export function salvageBatchFrames<T extends { index: number }>(
  frames: T[],
  batchLength: number,
): (T | null)[] {
  const out: (T | null)[] = Array.from({ length: batchLength }, () => null);
  for (const f of frames) {
    if (Number.isInteger(f.index) && f.index >= 0 && f.index < batchLength && !out[f.index]) {
      out[f.index] = f;
    }
  }
  return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The wire does not constrain an enum slot, so what the model wrote there can
 *  be anything — screen text included. It is reported only when it has the
 *  shape of a token (letters, digits, `_`, `-`, at most 32 of them); anything
 *  else is described by its length and never quoted in a log or a prompt. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{1,32}$/;
const describeReceived = (value: string): string =>
  TOKEN_SHAPE.test(value) ? value : `(${value.length} chars, not a token)`;

export interface FrameCanonicalization {
  position: number;
  claimedIndex: number | null;
  field: FrameEnumField;
  received: string;
  canonical: string;
}

export interface FrameRejection {
  /** Array position in the response — always known. */
  position: number;
  /** The entry's own `index` when it is an integer, else null — the salvage key. */
  claimedIndex: number | null;
  issues: { path: string; message: string }[];
  /** Enum fields that failed, with what the model wrote when it is a token —
   *  otherwise its length alone. Never screen text. */
  received: Partial<Record<FrameEnumField, string>>;
}

/**
 * Per-element validation of a batch response. Each entry is canonicalized on
 * its enum fields first — a case-only mismatch against a declared value is
 * replaced by the declared value, at zero API calls where the corrective
 * retry costs a full vision call — then checked against the strict frame
 * schema. A failing entry is REMOVED, so the index it claimed stays null in
 * salvageBatchFrames and rides the existing corrective-retry / dropped-state
 * path. Nothing here throws on a bad element; the envelope is the caller's.
 */
export function validateBatchFrames(entries: unknown[]): {
  frames: BatchFrame[];
  rejected: FrameRejection[];
  canonicalized: FrameCanonicalization[];
} {
  const frames: BatchFrame[] = [];
  const rejected: FrameRejection[] = [];
  const canonicalized: FrameCanonicalization[] = [];
  entries.forEach((entry, position) => {
    const claimedIndex =
      isRecord(entry) && Number.isInteger(entry.index) ? (entry.index as number) : null;
    let candidate = entry;
    if (isRecord(entry)) {
      const copy = { ...entry };
      for (const field of Object.keys(FRAME_ENUM_FIELDS) as FrameEnumField[]) {
        const allowed: readonly string[] = FRAME_ENUM_FIELDS[field];
        const value = copy[field];
        if (typeof value !== "string" || allowed.includes(value)) continue;
        const match = allowed.find((a) => a.toLowerCase() === value.toLowerCase());
        if (match === undefined) continue;
        copy[field] = match;
        canonicalized.push({ position, claimedIndex, field, received: value, canonical: match });
      }
      candidate = copy;
    }
    const result = batchFrameSchema.safeParse(candidate);
    if (result.success) {
      frames.push(result.data);
      return;
    }
    const received: Partial<Record<FrameEnumField, string>> = {};
    for (const issue of result.error.issues) {
      const field = issue.path[0];
      if (typeof field === "string" && field in FRAME_ENUM_FIELDS && isRecord(candidate)) {
        const value = candidate[field];
        if (typeof value === "string") received[field as FrameEnumField] = describeReceived(value);
      }
    }
    rejected.push({
      position,
      claimedIndex,
      issues: result.error.issues.map((i) => ({
        path: i.path.map(String).join("."),
        message: i.message,
      })),
      received,
    });
  });
  return { frames, rejected, canonicalized };
}

/**
 * The batch envelope, strictly: an object carrying a `frames` array. Anything
 * else — no text block, JSON cut off by max_tokens, a refusal's prose, some
 * other shape — throws with the stop_reason and NO response content:
 * jobs.last_error reaches Sentry, and the text may hold customer screen text.
 */
export function parseBatchEnvelope(raw: {
  text: string | null;
  stopReason: string | null;
}): unknown[] {
  const reason = `stop_reason: ${raw.stopReason}`;
  if (raw.text === null)
    throw new Error(`analysis: batch response carried no text block (${reason})`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.text);
  } catch {
    throw new Error(`analysis: batch response is not JSON (${reason})`);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.frames)) {
    throw new Error(`analysis: batch response is not a frames envelope (${reason})`);
  }
  return parsed.frames;
}

export interface BatchShortfall {
  batchLength: number;
  /** Entries in the response, valid or not. */
  returned: number;
  /** Positions with no entry after salvage that no named rejection accounts for. */
  unexplained: number[];
  /** Rejections whose claimed index is a frame of this batch and whose position
   *  is still empty — the ones a corrective message can name, one line per issue. */
  invalid: { index: number; violations: string[] }[];
}

/** Which holes the corrective retry has to explain: a rejection is named only
 *  when its claimed index is a frame of this batch and no valid entry filled
 *  that position; every other hole falls under the coverage wording. */
export function describeShortfall(
  salvaged: (unknown | null)[],
  returned: number,
  rejected: FrameRejection[],
): BatchShortfall {
  const batchLength = salvaged.length;
  const invalid: BatchShortfall["invalid"] = [];
  const named = new Set<number>();
  for (const r of rejected) {
    const i = r.claimedIndex;
    if (i === null || i < 0 || i >= batchLength || salvaged[i] || named.has(i)) continue;
    named.add(i);
    invalid.push({
      index: i,
      violations: r.issues.map((issue) => {
        const field = issue.path as FrameEnumField;
        const value = field in FRAME_ENUM_FIELDS ? r.received[field] : undefined;
        if (value === undefined) return `${issue.path}: ${issue.message}`;
        const allowed = `use one of ${FRAME_ENUM_FIELDS[field].join(", ")}`;
        return TOKEN_SHAPE.test(value)
          ? `${field} "${value}" is not an allowed value — ${allowed}`
          : `${field} is not an allowed value — ${allowed}`;
      }),
    });
  }
  const unexplained = salvaged.flatMap((f, i) => (!f && !named.has(i) ? [i] : []));
  return { batchLength, returned, unexplained, invalid };
}

/** The corrective message — findPlanViolations' deterministic-check-plus-one-
 *  corrective-call shape — naming what the check found: uncovered frames in
 *  the coverage wording, schema violations by frame, field, received value and
 *  allowed values. One message names both when a batch has both. */
export function correctivePrompt(basePrompt: string, s: BatchShortfall): string {
  const lines: string[] = [];
  if (s.unexplained.length > 0) {
    lines.push(
      `- It covered only ${s.batchLength - s.unexplained.length} of these ${s.batchLength} frames (${s.returned} entries returned). Every frame gets exactly one entry, even when consecutive frames look identical or near-identical — report each repeat as its own entry with sameStateAsPrevious: true. Never merge frames into one entry.`,
    );
  }
  for (const { index, violations } of s.invalid) {
    for (const v of violations) lines.push(`- Frame ${index}: ${v}.`);
  }
  return `${basePrompt}\n\nYour previous response was not accepted:\n${lines.join("\n")}\nReturn exactly ${s.batchLength} entries, with index 0 through ${s.batchLength - 1} matching the frame labels.`;
}

export interface BatchIo {
  /** One vision call for this batch, budget check included — its throws are
   *  the caller's error classes and pass through untouched. */
  call: (prompt: string) => Promise<RawResult>;
  /** One vision call for the frame at `position` ALONE: a batch of exactly one
   *  image through the same builder as `call` (same system prompt, same wire,
   *  labeled Frame 0), budget check included. */
  callAlone: (position: number) => Promise<RawResult>;
  /** The ledger write — runs before any parse, so every returned call is recorded. */
  recordUsage: (usage: RawResult["usage"]) => Promise<void>;
  log: { warn: (fields: Record<string, unknown>, msg: string) => void };
}

/**
 * A frame as transcribeBatch returns it and the checkpoint stores it.
 * `filledAlone` marks one the fill round bought as a one-image batch: the
 * model saw no neighbour, so its sameStateAsPrevious carries nothing and
 * assembleTimeline decides it by dHash. Absent means transcribed beside its
 * neighbours — true of every frame in a checkpoint written before the fill
 * round existed. Never written as false, so a batch that needed no fill
 * checkpoints exactly as before.
 */
export type TranscribedFrame = BatchFrame & { filledAlone?: true };

/**
 * One batch, start to finish: the first call, per-element validation, ONE
 * corrective retry when the salvage left holes (missing or invalid, both
 * named in the message), the merge, then ONE one-image call per position the
 * retry still left empty (the fill round), and whatever is still null is
 * dropped — "degrade, don't die". I/O is injected so the contract is testable
 * without ffmpeg or the network. The checkpoint stays the caller's: a batch
 * is checkpointed only after this returns, so a checkpointed batch with nulls
 * is final by construction.
 */
export async function transcribeBatch(opts: {
  demoId: string;
  batch: number;
  batchLength: number;
  basePrompt: string;
  io: BatchIo;
}): Promise<(TranscribedFrame | null)[]> {
  const { demoId, batch, batchLength, basePrompt, io } = opts;
  const round = async (
    call: () => Promise<RawResult>,
    length: number,
    context: Record<string, unknown> = {},
  ) => {
    const raw = await call();
    // Usage FIRST: the call was billed whatever its body holds — parse
    // failures inside the SDK hid three billed calls on job 85d9ec0b.
    await io.recordUsage(raw.usage);
    const entries = parseBatchEnvelope(raw);
    const { frames, rejected, canonicalized } = validateBatchFrames(entries);
    for (const c of canonicalized) {
      io.log.warn(
        { demoId, batch, ...context, ...c },
        "analysis: frame enum canonicalized by case",
      );
    }
    for (const r of rejected) {
      // Never the frame and never visibleText — that is customer screen content.
      io.log.warn(
        { demoId, batch, ...context, ...r },
        "analysis: frame rejected by the schema — dropped from its batch",
      );
    }
    return {
      salvaged: salvageBatchFrames(frames, length),
      returned: entries.length,
      rejected,
    };
  };

  const first = await round(() => io.call(basePrompt), batchLength);
  let salvaged: (TranscribedFrame | null)[] = first.salvaged;
  if (salvaged.some((f) => !f)) {
    // Corrective retry, once (same pattern as demo-step-plans): seen live when
    // near-identical frames get merged into one entry instead of repeated
    // with sameStateAsPrevious, and when one frame carries a value outside
    // the schema. Name the failure and re-request this batch only.
    const shortfall = describeShortfall(salvaged, first.returned, first.rejected);
    io.log.warn(
      {
        demoId,
        batch,
        sent: batchLength,
        returned: first.returned,
        unexplained: shortfall.unexplained,
        invalid: shortfall.invalid.map((v) => v.index),
      },
      "analysis: batch response incomplete or invalid — corrective retry",
    );
    const retry = await round(() => io.call(correctivePrompt(basePrompt, shortfall)), batchLength);
    // Fill what the retry still misses from the first response — both
    // transcribe the same images, so coverage only ever improves.
    salvaged = retry.salvaged.map((f, i) => f ?? salvaged[i] ?? null);

    // The fill round. The model has now seen these same images twice and still
    // left positions empty — in production a batch of 10 came back as frame
    // 0's entry alone, and after the retry the other nine were still empty. A
    // third look at the same images is the same bet, so each position still
    // empty is re-sent ALONE, with no neighbour to fold it into.
    // Spend bound: this runs only when a batch is still short after its
    // corrective retry, and buys at most ONE call per missing position — a
    // fill is never retried — so a batch makes at most 2 + batchLength calls.
    // Best effort: a fill that fails or returns no valid frame leaves its
    // position null, dropped exactly as before; only a BudgetError escapes,
    // and only once every fill has settled — the batch then goes
    // uncheckpointed and a resume re-buys it, as after a BudgetError on its
    // corrective call. Fill logs carry the batch position as `fillPosition`.
    const missing = salvaged.flatMap((f, i) => (f ? [] : [i]));
    if (missing.length > 0) {
      const fills = await Promise.allSettled(
        missing.map((position) =>
          round(() => io.callAlone(position), 1, { fillPosition: position }),
        ),
      );
      let budget: BudgetError | undefined;
      let recovered = 0;
      fills.forEach((fill, k) => {
        const position = missing[k]!;
        if (fill.status === "rejected") {
          if (fill.reason instanceof BudgetError) {
            budget ??= fill.reason;
            return;
          }
          // Never re-buy the finished batch over a best-effort fill: logged
          // with its position (never frame content) and left empty.
          io.log.warn(
            {
              demoId,
              batch,
              fillPosition: position,
              err: fill.reason instanceof Error ? fill.reason.message : String(fill.reason),
            },
            "analysis: fill call failed — position stays empty",
          );
          return;
        }
        const frame = fill.value.salvaged[0];
        if (!frame) return;
        // The model labelled it Frame 0 of a one-image batch; it lands at its
        // batch position, where every other frame's index equals its position.
        salvaged[position] = { ...frame, index: position, filledAlone: true };
        recovered++;
      });
      if (budget) throw budget;
      io.log.warn(
        { demoId, batch, sent: batchLength, missing: missing.length, recovered },
        "analysis: fill round — re-sent each missing frame alone",
      );
    }
  }
  return salvaged;
}

/**
 * Timeline assembly, lifted verbatim out of handleAnalyzeDemo so the index
 * mapping and the seam bridging can be pinned without ffmpeg: position i of
 * batch bi is kept-index g = bi * batchSize + i, a null at a position drops
 * that cluster, and sameStateAsPrevious is recomputed by dHash wherever the
 * model could not have judged it — a frame filled alone included.
 */
export function assembleTimeline(opts: {
  batches: StateCluster[][];
  batchResults: Record<string, (TranscribedFrame | null)[]>;
  batchSize: number;
  keptHashes: bigint[];
  thumbPathAt: (ms: number) => string;
}): { assembled: AnalysisState[]; droppedMs: number[] } {
  const { batches, batchResults, batchSize, keptHashes, thumbPathAt } = opts;
  const assembled: AnalysisState[] = [];
  const droppedMs: number[] = [];
  let prevG = -1; // kept-index of the last assembled state
  batches.forEach((batch, bi) => {
    batch.forEach((cluster, i) => {
      const frame = batchResults[bi]![i];
      const g = bi * batchSize + i;
      if (!frame) {
        droppedMs.push(cluster.representativeMs);
        return;
      }
      // The model judges duplicates within its batch only — at a batch
      // boundary it cannot see the prior frame and reports false by
      // instruction. Bridge the seam with the same dHash the clustering
      // used, so a duplicate straddling batches still reads as one. When a
      // dropped cluster broke adjacency, the model's flag refers to a state
      // that no longer exists — recompute against the last assembled one. A
      // frame filled alone had no neighbour at all, so its flag says nothing
      // either way: dHash alone decides it, flag not ORed in.
      const sameStateAsPrevious =
        prevG < 0
          ? false
          : prevG === g - 1 && !frame.filledAlone
            ? frame.sameStateAsPrevious ||
              (i === 0 && hamming(keptHashes[g]!, keptHashes[prevG]!) <= MAX_HAMMING)
            : hamming(keptHashes[g]!, keptHashes[prevG]!) <= MAX_HAMMING;
      assembled.push({
        timestampMs: cluster.representativeMs,
        screenName: frame.screenName,
        visibleText: frame.visibleText,
        action: frame.action,
        actionType: frame.actionType,
        screenKind: frame.screenKind,
        sameStateAsPrevious,
        legibility: frame.legibility,
        salienceNote: frame.salienceNote,
        thumbPath: thumbPathAt(cluster.representativeMs),
      });
      prevG = g;
    });
  });
  return { assembled, droppedMs };
}

const REFILM_MESSAGE =
  "חלק גדול מדי מהצילום לא קריא — צלמו שוב בתאורה בלי ברק על המסך וביד יציבה יותר";

/**
 * The fixed DRY_RUN timeline: a coherent 12-state journey (login -> create ->
 * result) inside the stubbed 20s demo, with one low-legibility state, one
 * unreadable state, one duplicate and two login states so downstream rules
 * (the inventory's unreadable exclusion, the plan pass's
 * never-select-unreadable and never-select-skip-kind rules) run for real.
 * Each of the five product screens is held by a second state after its first
 * (a duplicate, a typing, a scroll, an unreadable frame), the way real
 * clustering splits a screen, and the screens sit far enough apart that their
 * 2 s clips share no footage — so the canned plan, the happy path, reaches
 * the minimum of five.
 */
function dryRunTimeline(thumbPathAt: (ms: number) => string): AnalysisState[] {
  const states: Omit<AnalysisState, "thumbPath">[] = [
    {
      timestampMs: 0,
      screenName: "מסך פתיחה",
      visibleText: ["ברוכים הבאים"],
      action: "האפליקציה נפתחת",
      actionType: "idle",
      screenKind: "loading",
      sameStateAsPrevious: false,
      legibility: "high",
      salienceNote: null,
    },
    {
      timestampMs: 1000,
      screenName: "התחברות",
      visibleText: ["התחברות", "אימייל", "סיסמה"],
      action: "מסך ההתחברות מוצג",
      actionType: "navigate",
      screenKind: "login",
      sameStateAsPrevious: false,
      legibility: "high",
      salienceNote: null,
    },
    {
      timestampMs: 2000,
      screenName: "התחברות",
      visibleText: ["התחברות", "אימייל"],
      action: "הקלדת אימייל",
      actionType: "type",
      screenKind: "login",
      sameStateAsPrevious: false,
      legibility: "high",
      salienceNote: null,
    },
    {
      timestampMs: 3000,
      screenName: "מסך הבית",
      visibleText: ["הפרויקטים שלי", "פרויקט חדש"],
      action: "מעבר למסך הבית",
      actionType: "navigate",
      screenKind: "product",
      sameStateAsPrevious: false,
      legibility: "high",
      salienceNote: null,
    },
    {
      timestampMs: 4800,
      screenName: "מסך הבית",
      visibleText: ["הפרויקטים שלי"],
      action: "אותו מסך, כמעט ללא שינוי",
      actionType: "idle",
      screenKind: "product",
      sameStateAsPrevious: true,
      legibility: "high",
      salienceNote: null,
    },
    {
      timestampMs: 6000,
      screenName: "פרויקט חדש",
      visibleText: ["פרויקט חדש", "שם הפרויקט"],
      action: "לחיצה על פרויקט חדש",
      actionType: "tap",
      screenKind: "product",
      sameStateAsPrevious: false,
      legibility: "high",
      salienceNote: null,
    },
    {
      timestampMs: 8600,
      screenName: "פרויקט חדש",
      visibleText: ["שם הפרויקט", "קמפיין קיץ"],
      action: "הקלדת שם הפרויקט",
      actionType: "type",
      screenKind: "product",
      sameStateAsPrevious: false,
      legibility: "high",
      salienceNote: null,
    },
    {
      timestampMs: 9800,
      screenName: "בחירת תבנית",
      visibleText: ["בחרו תבנית", "מודעה", "פוסט"],
      action: "בחירת תבנית מהרשימה",
      actionType: "select",
      screenKind: "product",
      sameStateAsPrevious: false,
      legibility: "high",
      salienceNote: "בחירת תבניות מוכנות — לא מוזכר בשאלון",
    },
    {
      timestampMs: 11600,
      screenName: "בחירת תבנית",
      visibleText: ["מודעה", "פוסט", "סטורי"],
      action: "גלילה ברשימת התבניות — ברק על המסך",
      actionType: "scroll",
      screenKind: "product",
      sameStateAsPrevious: false,
      legibility: "low",
      salienceNote: null,
    },
    {
      timestampMs: 12800,
      screenName: "עורך",
      visibleText: ["שמירה", "תצוגה מקדימה"],
      action: "לחיצה על שמירה",
      actionType: "tap",
      screenKind: "product",
      sameStateAsPrevious: false,
      legibility: "high",
      salienceNote: null,
    },
    {
      timestampMs: 14400,
      screenName: "עורך",
      visibleText: [],
      action: "המסך לא קריא בפריים הזה",
      actionType: "idle",
      screenKind: "other",
      sameStateAsPrevious: false,
      legibility: "unreadable",
      salienceNote: null,
    },
    {
      timestampMs: 16000,
      screenName: "הצלחה",
      visibleText: ["הקמפיין נוצר!", "שיתוף"],
      action: "מסך ההצלחה — הפרויקט מוכן",
      actionType: "result",
      screenKind: "product",
      sameStateAsPrevious: false,
      legibility: "high",
      salienceNote: null,
    },
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
 * demo_analyses.timeline, with what the footage itself says (every moment's
 * span, every instant the picture changes) beside it in
 * demo_analysis_footage. Resumable: the analysis row id and every completed
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
  const readyRows = await ctx.db.select().from(demoAnalyses).where(eq(demoAnalyses.demoId, demoId));
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

  // The footage decode (started below) runs beside the vision calls. Whatever
  // becomes of the analysis, it is waited out before the handler returns, so a
  // retry never rewrites demo.mp4 under a running ffmpeg. It never rejects.
  let instants: Promise<FootageEvent[] | null> = Promise.resolve(null);

  try {
    if (getEnv().DRY_RUN) {
      // Placeholder thumbs go through the real storage layer (same pattern as
      // composites) so the picker and the e2e test see real paths.
      const timeline = dryRunTimeline((ms) => `assets/${thumbKey(ms)}`);
      for (const state of timeline) {
        await storage.put(
          "assets",
          thumbKey(state.timestampMs),
          Buffer.from("DRY_RUN state thumb"),
        );
      }
      await setAnalysis({
        status: "ready",
        timeline,
        stateCount: timeline.length,
        promptVersion: "analyze_demo@dry-run",
      });
      await enqueueSections(ctx.db, analysisId);
      return { kind: "done" };
    }

    // The per-account abuse ceiling (0027). Analysis is the account's biggest
    // LLM spend and auto-enqueues on every registered demo, so without this
    // an upload loop runs uncapped to the platform ceiling — which parks LLM
    // jobs for every account. Converted to PermanentError: an
    // AccountBudgetError must fail fast, never park (renders.ts precedent).
    await assertAccountBudget(ctx.db, "llm_tokens", demo.businessId).catch((err) => {
      if (err instanceof AccountBudgetError) {
        throw new PermanentError(err.message, {
          customerMessage: "הגעתם למכסת יצירת התוכן היומית של החשבון — נסו שוב מחר.",
        });
      }
      throw err;
    });

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
    const fps = await analysisFps(ctx.db);
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

    // Decision 0078: every instant the picture changes, from the footage
    // alone, on every frame. One more decode pass, run while the vision calls
    // are in flight so a fresh analysis should wait no longer for it; a retry
    // whose batches are all checkpointed waits the whole decode. A failure
    // costs the instants (stored as not computed), never the analysis.
    instants = frameSignatures(localDemo, { fps: SIGNATURE_FPS })
      .then((signatures) => footageEvents(signatures))
      .catch((err: unknown) => {
        ctx.log.warn(
          { demoId, err: err instanceof Error ? err.message : String(err) },
          "analysis: footage instants failed — stored as not computed",
        );
        return null;
      });

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
    // null = a cluster the model never returned an entry for, even after the
    // corrective retry and the fill round — dropped from the timeline at
    // assembly. (v2-era checkpoints hold plain arrays, a compatible subset; a
    // checkpoint from before the fill round has no `filledAlone` anywhere and
    // resumes as "transcribed in its batch", which it was.)
    const priorState = job.state as {
      analysisId?: string;
      resumeKey?: string;
      batchResults?: Record<string, (TranscribedFrame | null)[]>;
    } | null;
    const batchResults: Record<string, (TranscribedFrame | null)[]> =
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

    const basePrompt = (n: number) =>
      `Analyse the ${n} frames above, in order. Return exactly one entry per frame, with the index from its label.`;
    const callBatch = async (batch: StateCluster[], prompt: string): Promise<RawResult> => {
      // Parallel batches — and within a batch, parallel fills — each pass this
      // check before any usage lands, so one analysis can overshoot the cap by
      // the calls in flight: one per unfinished batch, or one per missing
      // position during its fill round — acceptable for a backstop. The real
      // per-analysis bound is max_states: at most 2 calls per batch plus one
      // per kept state.
      await assertBudget(ctx.db, "llm_tokens");
      return generateRawWithImages({
        system,
        prompt,
        frames: batch.map((cluster, i) => ({
          label: `Frame ${i} — t=${(cluster.representativeMs / 1000).toFixed(1)}s`,
          jpeg: readFileSync(localFrameOf(cluster)),
        })),
        format: batchWireFormat(),
      });
    };
    const recordBatchUsage = (usage: RawResult["usage"]) =>
      recordUsage(ctx.db, {
        provider: "anthropic",
        kind: "llm_tokens",
        quantity: usage.inputTokens + usage.outputTokens,
        costEstimateAgorot: llmCostAgorot(usage.inputTokens, usage.outputTokens),
        jobId: job.id,
        businessId: demo.businessId,
      });

    const settled = await Promise.allSettled(
      batches.map(async (batch, bi) => {
        if (batchResults[bi]) return;
        try {
          const salvaged = await transcribeBatch({
            demoId,
            batch: bi,
            batchLength: batch.length,
            basePrompt: basePrompt(batch.length),
            io: {
              call: (prompt) => callBatch(batch, prompt),
              // A one-image batch through the same builder — no new prompt text.
              callAlone: (position) => callBatch([batch[position]!], basePrompt(1)),
              recordUsage: recordBatchUsage,
              log: ctx.log,
            },
          });
          const droppedMs = batch.filter((_, i) => !salvaged[i]).map((c) => c.representativeMs);
          if (droppedMs.length > 0) {
            // Degrade, don't die: losing a few states out of eighty is nothing;
            // losing the whole analysis is expensive. The fraction gate below
            // fails the analysis when too many batches end up here.
            ctx.log.warn(
              { demoId, batch: bi, sent: batch.length, droppedMs },
              "analysis: batch still short after corrective retry — dropping unreturned states",
            );
          }
          batchResults[bi] = salvaged;
          await saveCheckpoint();
        } catch (err) {
          // Every rejection is logged here with its batch — the rethrow below
          // surfaces only one, and the others used to leave no trace at all.
          ctx.log.warn(
            { demoId, batch: bi, err: err instanceof Error ? err.message : String(err) },
            "analysis: batch failed",
          );
          throw err;
        }
      }),
    );
    const rejections = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (rejections.length > 0) {
      // Prefer parking over failing when both occurred in one parallel round.
      const budget = rejections.find((r) => r.reason instanceof BudgetError);
      throw (budget ?? rejections[0]!).reason;
    }

    // Decisions 0077 and 0080: every kept moment with the span its picture
    // held for — the ones whose read never came back included, which the
    // timeline below drops. Server-only and read by nothing yet, so a failed
    // write (the table not pushed yet, a dropped connection) is logged and the
    // analysis lands exactly as it did before this row existed.
    const recordFootage = async (events: FootageEvent[] | null) => {
      try {
        const read = batches.flatMap((batch, bi) =>
          batch.map((_, i) => Boolean(batchResults[bi]![i])),
        );
        const row = {
          fps,
          fileSha: createHash("sha256").update(readFileSync(localDemo)).digest("hex"),
          moments: analysisMoments(kept, read),
          updatedAt: new Date(),
        };
        const found = { detector: events ? SCREENS_DETECTOR : null, instants: events };
        await ctx.db
          .insert(demoAnalysisFootage)
          .values({ analysisId: analysisId!, ...row, ...found })
          // A retry with no instants of its own keeps the ones an earlier
          // attempt stored: same analysis, same file.
          .onConflictDoUpdate({
            target: demoAnalysisFootage.analysisId,
            set: events ? { ...row, ...found } : row,
          });
      } catch (err) {
        ctx.log.warn(
          { demoId, err: err instanceof Error ? err.message : String(err) },
          "analysis: footage row not written — the analysis lands without it",
        );
      }
    };

    // A batch still short after its own corrective retry is model behaviour on
    // this footage, not a transient fault — re-running the job will not help.
    // Losing a few states out of eighty is absorbed; past the fraction gate
    // the timeline is too holey to trust, and the failure is permanent.
    // Measured in STATES, not batches: a batch that lost 1 frame of 10 is not
    // a batch that lost all 10, and a short demo is often a single batch —
    // one dropped frame must not condemn it.
    const droppedCount = batches.reduce(
      (n, _, bi) => n + batchResults[bi]!.filter((f) => !f).length,
      0,
    );
    const maxDegradedFraction = await getConfigValueOr(
      ctx.db,
      "a_analysis_max_degraded_fraction",
      z.number(),
      0.25,
    );
    if (droppedCount / kept.length > maxDegradedFraction) {
      // The gate is unchanged; the moments it failed over are still recorded.
      await recordFootage(null);
      throw new PermanentError(
        `analysis degraded: ${droppedCount} of ${kept.length} states unreturned after corrective retries`,
        { customerMessage: "חלק גדול מדי מהצילום לא נותח — צלמו את ההדגמה שוב ונסו מחדש" },
      );
    }

    // representativeMs = round(i*1000/fps), so the frame index inverts exactly.
    const keptHashes = kept.map((c) => hashes[Math.round((c.representativeMs * fps) / 1000)]!);

    const { assembled, droppedMs } = assembleTimeline({
      batches,
      batchResults,
      batchSize,
      keptHashes,
      thumbPathAt: (ms) => `assets/${thumbKey(ms)}`,
    });
    if (droppedMs.length > 0) {
      // Fires on resumed runs too (the per-batch warn does not) — the durable
      // record of exactly which timestamps this timeline is missing.
      ctx.log.warn(
        { demoId, dropped: droppedMs.length, droppedMs, stateCount: assembled.length },
        "analysis: timeline assembled without the states the model never returned",
      );
    }

    // Footage gate: the fraction of "unreadable" states alone (decision 0069).
    // "low" is the model's ordinary verdict on a filmed screen, not a refilm
    // signal — the first five real analyses (2026-08-18) ran 0.25-0.54 low +
    // unreadable, and the 0.75 cap 0028 put on that sum rejected analysis
    // e4be3bce (job 174c1063, 2026-10-01: 55 low, 10 high, 0 unreadable,
    // every low frame transcribed).
    // Unreadable on those five was 0.000-0.019 — ~1 state per analysis — so
    // 0.25 leaves ~13x headroom.
    const unreadableThreshold = await getConfigValueOr(
      ctx.db,
      "a_analysis_unreadable_threshold",
      z.number(),
      0.25,
    );
    const verdict = legibilityVerdict(assembled, { unreadableMax: unreadableThreshold });
    if (!verdict.ok) {
      // The job did its work — the verdict on the FOOTAGE lives on the domain
      // row, customer-readable, with the timeline kept for founder debugging.
      // Pinned at the seam by analysis-seam.test.ts (stubbed vision provider).
      await recordFootage(null);
      await setAnalysis({
        status: "rejected",
        timeline: assembled,
        stateCount: assembled.length,
        promptVersion,
        failReason: REFILM_MESSAGE,
      });
      return { kind: "done" };
    }

    // Before the row turns ready, so a ready analysis never lacks its footage
    // row for a reader to trip over. waitedMs is how long the analysis was
    // held for the decode after everything else was done — 0 when it finished
    // under the vision calls, as intended.
    const waitStart = Date.now();
    const events = await instants;
    ctx.log.info(
      { demoId, instants: events?.length ?? null, waitedMs: Date.now() - waitStart },
      "analysis: footage instants",
    );
    await recordFootage(events);
    await setAnalysis({
      status: "ready",
      timeline: assembled,
      stateCount: assembled.length,
      promptVersion,
      failReason: null,
    });
    await enqueueSections(ctx.db, analysisId);
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
  } finally {
    await instants;
  }
}

// ---------------------------------------------------------------------------
// Sections: task-level Hebrew groupings of a ready timeline (0030)
// ---------------------------------------------------------------------------

/** One grouping per analysis, enqueued the moment it lands ready. Light lane
 *  (not in HEAVY_JOB_TYPES); also the CLI backfill's enqueue (`aiugc demo
 *  sections`) — the shared idempotency key is what makes both safe. */
export async function enqueueSections(db: Db, analysisId: string): Promise<void> {
  await enqueue(db, {
    type: "group_analysis_states",
    idempotencyKey: `sections:${analysisId}`,
    payload: { analysisId },
  });
}

/** Backfill (`aiugc demo sections`): enqueue a grouping for every ready
 *  analysis that has none. Key sequencing follows requestDemoAnalysis's rN
 *  pattern — a grouping that gave up gracefully leaves a SUCCEEDED job on the
 *  bare key with sections still NULL, and a bare re-enqueue would collapse
 *  onto it forever; a live job is left alone. */
export async function enqueueMissingSections(db: Db): Promise<number> {
  const rows = await db
    .select({ id: demoAnalyses.id })
    .from(demoAnalyses)
    .where(and(eq(demoAnalyses.status, "ready"), isNull(demoAnalyses.sections)));
  let queued = 0;
  for (const row of rows) {
    const priorJobs = await db
      .select({ id: jobs.id, status: jobs.status })
      .from(jobs)
      .where(like(jobs.idempotencyKey, `sections:${row.id}%`));
    if (priorJobs.some((j) => j.status === "queued" || j.status === "running")) continue;
    const key =
      priorJobs.length === 0 ? `sections:${row.id}` : `sections:${row.id}:r${priorJobs.length}`;
    const { created } = await enqueue(db, {
      type: "group_analysis_states",
      idempotencyKey: key,
      payload: { analysisId: row.id },
    });
    if (created) queued++;
  }
  return queued;
}

/** What the grouping model sees: every state the wizard shows
 *  (isInventoryState, decision 0064), with its absolute timeline index, so a
 *  section can hold any moment the customer sees and none the customer does
 *  not. `screenKind` rides along so login/loading/tour screens can be read
 *  for the task they sit inside. */
export function groupingInput(timeline: AnalysisState[]) {
  return timeline
    .map((state, index) => ({ state, index }))
    .filter(({ state }) => isInventoryState(state))
    .map(({ state, index }) => ({
      index,
      screenName: state.screenName,
      action: state.action,
      actionType: state.actionType,
      screenKind: state.screenKind,
      visibleText: state.visibleText,
    }));
}

/**
 * Group a ready analysis's inventory states into 2-5 Hebrew task sections
 * ("פרסום פוסט"-style noun phrases — founder tone ruling 2026-08-25). Text
 * only, one cheap call plus at most one corrective, and every failure mode —
 * budget refusal, invalid output after the retry — ends as `done` with
 * sections left NULL: the grouping is a UI nicety and time-range pages are
 * its fallback, so it must never park the lane or surface as a customer-facing
 * failure. Transient API errors still ride the queue's ordinary retries.
 */
export async function handleGroupAnalysisSections(job: Job, ctx: JobContext): Promise<JobResult> {
  const { analysisId } = job.payload as { analysisId: string };
  const rows = await ctx.db
    .select()
    .from(demoAnalyses)
    .where(eq(demoAnalyses.id, analysisId))
    .limit(1);
  const analysis = rows[0];
  if (!analysis) throw new PermanentError(`analysis ${analysisId} not found`);
  if (analysis.status !== "ready" || !analysis.timeline) {
    throw new PermanentError(`analysis ${analysisId} is "${analysis.status}" — nothing to group`);
  }
  // Computed once, ever — a retry (or the CLI backfill racing the auto
  // enqueue) after a finished grouping is a success no-op, not a new spend.
  if (analysis.sections !== null) return { kind: "done" };

  const timeline = analysisTimelineSchema.parse(analysis.timeline);
  const pool = groupingInput(timeline);
  if (pool.length === 0) return { kind: "done" };

  const write = async (sections: AnalysisSection[], promptVersion: string) => {
    await ctx.db
      .update(demoAnalyses)
      .set({ sections, sectionsPromptVersion: promptVersion, updatedAt: new Date() })
      .where(eq(demoAnalyses.id, analysisId));
  };

  if (getEnv().DRY_RUN) {
    // Two fixed-title halves, so the keyless e2e exercises the sectioned UI.
    const mid = Math.ceil(pool.length / 2);
    const sections: AnalysisSection[] = [
      { title: "תחילת השימוש", stateIndexes: pool.slice(0, mid).map((q) => q.index) },
    ];
    if (pool.length > mid) {
      sections.push({ title: "התוצאה", stateIndexes: pool.slice(mid).map((q) => q.index) });
    }
    await write(sections, "group_analysis_states@dry-run");
    return { kind: "done" };
  }

  const demoRows = await ctx.db.select().from(demos).where(eq(demos.id, analysis.demoId)).limit(1);
  const businessId = demoRows[0]?.businessId;
  try {
    await assertBudget(ctx.db, "llm_tokens");
    if (businessId) await assertAccountBudget(ctx.db, "llm_tokens", businessId);
  } catch (err) {
    ctx.log.warn(
      { analysisId, err: err instanceof Error ? err.message : String(err) },
      "sections: budget refused — inventory stays flat",
    );
    return { kind: "done" };
  }

  const { text, promptVersion } = renderPrompt("group_analysis_states", {
    states: JSON.stringify(pool, null, 2),
    count: pool.length,
  });

  const outputSchema = z.object({ sections: analysisSectionsSchema });
  const callOnce = async (prompt: string) => {
    const { object, usage } = await generateObject({ prompt, schema: outputSchema });
    await recordUsage(ctx.db, {
      provider: "anthropic",
      kind: "llm_tokens",
      quantity: usage.inputTokens + usage.outputTokens,
      costEstimateAgorot: llmCostAgorot(usage.inputTokens, usage.outputTokens),
      jobId: job.id,
      businessId,
    });
    return object;
  };

  let output = await callOnce(text);
  let violations = findSectionViolations(output.sections, timeline.length);
  if (violations.length > 0) {
    output = await callOnce(
      `${text}\n\nYour previous answer was:\n${JSON.stringify(output, null, 2)}\n\nIt violated these rules:\n${violations
        .map((v) => `- ${v}`)
        .join(
          "\n",
        )}\n\nReturn the same grouping with the minimal edits that fix every violation named above.`,
    );
    violations = findSectionViolations(output.sections, timeline.length);
  }
  if (violations.length > 0) {
    ctx.log.warn(
      { analysisId, violations },
      "sections: model output invalid after retry — inventory stays flat",
    );
    return { kind: "done" };
  }

  await write(output.sections, promptVersion);
  return { kind: "done" };
}
