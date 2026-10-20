import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { CaptionChunk } from "../captions";
import {
  CUTAWAY_EDGE_MS,
  CUTAWAY_FRAME_SLACK_MS,
  DEFAULT_CUTAWAY_STRUCTURE,
  cutawayLayout,
  cutawayLayoutError,
  cutawayWindowsError,
  type CutawayWindow,
} from "../cutaway-structure";
import type { Db } from "../db";
import {
  audioRenders,
  cutawayPlans,
  demoAnalyses,
  demoAnalysisFootage,
  demos,
  scripts,
} from "../db/schema";
import { hookTextError } from "../hook-text";
import { isInventoryState, PLAN_SKIP_SCREEN_KINDS } from "../plan-format";
import { serviceBTimeline } from "../service-b-timeline";
import { analysisTimelineSchema, type AnalysisState } from "./demo-analysis";
import { analysisSampleMs, recordingEndMs } from "./demo-step-plans";
import { lipsyncLeadInMs } from "./renders";

/**
 * Service B demo cutaways (vault 0121): the draft, the customer's edit, and the
 * copy enqueue takes. The layout itself is cutaway-structure.ts; this module
 * places each slot's window in the customer's demo.
 *
 * A window starts on a MOMENT of the analysed demo (vault 0120 §4: "a stretch
 * of the demo from a picked moment"): the first frame its picture was held
 * (demo_analysis_footage.moments[k].startMs, the k-th read moment being the
 * k-th timeline state), else the state's timestamp when the footage row is
 * missing or does not line up.
 *
 * The draft is the demo in order: the slots spread evenly through the usable
 * recording, clean of login, system and unreadable screens where it can be. A
 * text-only Claude match of each slot's words against the analysed screens was
 * built and tested on the founder's own demos first (vault 0082's rule) and did
 * not clear the bar fixed before the run — 63% against demo order's 43%, 80%
 * run-to-run (vault 0121, facts/cutaway-matcher-hit-rate-2026-10-20) — so the
 * draft costs nothing and the customer corrects it in the window picker. The
 * row is still keyed per (audio, analysis, structure, hook text), so a
 * customer's edits survive going back and forth.
 */

/** One stored slot (cutaway_plans.slots), VO time. */
export const cutawaySlotSchema = z.object({
  fromMs: z.number(),
  toMs: z.number(),
  wordFrom: z.number().int().nonnegative(),
  wordTo: z.number().int().nonnegative(),
  demoStartMs: z.number(),
  stateIndex: z.number().int().nonnegative().nullable(),
  draftDemoStartMs: z.number(),
  draftStateIndex: z.number().int().nonnegative().nullable(),
});
export type CutawaySlot = z.infer<typeof cutawaySlotSchema>;
export const cutawaySlotsSchema = z.array(cutawaySlotSchema);

/**
 * What enqueue copies onto video_renders.params — never a pointer (vault
 * 0017's rule): an edit after the confirm cannot change a paid render, and QC
 * regeneration replays it with the rest of params.
 */
export interface BCutaways {
  structure: string;
  planId: string;
  demoId: string;
  analysisId: string;
  slots: CutawayWindow[];
}

export type CutawayPlanErrorCode =
  | "not_found"
  | "audio_not_approved"
  | "demo_not_ready"
  | "analysis_pending"
  | "analysis_failed"
  | "vo_too_short"
  | "demo_too_short"
  | "no_layout"
  | "invalid_windows"
  | "invalid_hook_text"
  | "stale";

export class CutawayPlanError extends Error {
  constructor(
    readonly code: CutawayPlanErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = "CutawayPlanError";
  }
}

/** A place a window may start, and the state it shows first. */
export interface CutawayAnchor {
  startMs: number;
  stateIndex: number;
}

/** What the wizard gets: the words to highlight, never their times. */
export interface CutawayPlanView {
  planId: string;
  audioId: string;
  demoId: string;
  structure: string;
  hookText: string;
  /** The caption words, in order — what the slots' wordFrom/wordTo index. */
  words: string[];
  slots: (CutawaySlot & { lengthMs: number })[];
  anchors: CutawayAnchor[];
  /** A window's start is ≥ minStartMs and its start + length + frame slack ≤ maxEndMs. */
  minStartMs: number;
  maxEndMs: number;
}

// ---------------------------------------------------------------------------
// The inventory a window is placed in
// ---------------------------------------------------------------------------

interface Inventory {
  demo: typeof demos.$inferSelect;
  analysisId: string;
  timeline: AnalysisState[];
  anchors: CutawayAnchor[];
  minStartMs: number;
  maxEndMs: number;
}

/** The demo, its one ready analysis and where windows may start — or the refusal why not. */
async function loadInventory(db: Db, businessId: string, demoId: string): Promise<Inventory> {
  const demo = (await db.select().from(demos).where(eq(demos.id, demoId)).limit(1))[0];
  if (!demo || demo.businessId !== businessId) throw new CutawayPlanError("not_found");
  if (demo.status !== "ready" || !demo.normalizedPath) throw new CutawayPlanError("demo_not_ready");

  const analysis = (
    await db
      .select()
      .from(demoAnalyses)
      .where(eq(demoAnalyses.demoId, demoId))
      .orderBy(desc(demoAnalyses.createdAt))
  ).find((a) => a.status === "ready");
  if (!analysis) {
    const latest = (
      await db
        .select({ status: demoAnalyses.status })
        .from(demoAnalyses)
        .where(eq(demoAnalyses.demoId, demoId))
        .orderBy(desc(demoAnalyses.createdAt))
        .limit(1)
    )[0];
    throw new CutawayPlanError(
      latest && (latest.status === "failed" || latest.status === "rejected")
        ? "analysis_failed"
        : "analysis_pending",
    );
  }
  const timeline = analysisTimelineSchema.parse(analysis.timeline);

  const footage = (
    await db
      .select()
      .from(demoAnalysisFootage)
      .where(eq(demoAnalysisFootage.analysisId, analysis.id))
      .limit(1)
  )[0];
  const sampleMs =
    footage && footage.fps > 0
      ? Math.max(1, Math.floor(1000 / footage.fps))
      : await analysisSampleMs(db);
  const placement = cutawayPlacement({
    timeline,
    moments: footage?.moments,
    durationMs: demo.durationMs,
    sampleMs,
  });
  return { ...placement, demo, analysisId: analysis.id };
}

/**
 * Where windows may start in one analysed recording, pure: the k-th read
 * moment's first held frame is the k-th state's anchor (decision 0080), else
 * the state's own timestamp when the spans do not line up (or there is no
 * footage row); the recording's end is the demo's length floored to the
 * analysis grid (recordingEndMs), less the unexamined edge.
 */
function cutawayPlacement(opts: {
  timeline: AnalysisState[];
  moments: unknown;
  durationMs: number | null;
  sampleMs: number;
}): Placement {
  const parsed = z
    .array(z.object({ startMs: z.number(), read: z.boolean() }))
    .safeParse(opts.moments);
  const read = parsed.success ? parsed.data.filter((m) => m.read) : [];
  const spansLineUp = read.length === opts.timeline.length && opts.timeline.length > 0;
  const recordingEnd = recordingEndMs(opts.durationMs, opts.timeline, opts.sampleMs);
  const minStartMs = CUTAWAY_EDGE_MS;
  const maxEndMs = recordingEnd - CUTAWAY_EDGE_MS;
  const anchors = opts.timeline
    .map((state, stateIndex) => ({
      startMs: spansLineUp ? read[stateIndex]!.startMs : state.timestampMs,
      stateIndex,
    }))
    .filter((a) => a.startMs >= minStartMs && a.startMs < maxEndMs);
  return { anchors, timeline: opts.timeline, minStartMs, maxEndMs };
}

/**
 * Where the approved audio puts the hook text and the captions — the SAME
 * function the render lays out with (serviceBTimeline), at today's lead-in.
 * The render recomputes it at the lead-in HeyGen actually got and drops any
 * window that would then sit under the hook text (clampCutawaysForRender).
 */
async function audioTimeline(
  db: Db,
  audio: { wordTimestamps: unknown; durationMs: number | null },
  hookText: string,
) {
  const captions = (audio.wordTimestamps ?? []) as CaptionChunk[];
  const t = serviceBTimeline({
    hasOpener: false,
    hookText: hookText === "" ? undefined : hookText,
    captions,
    leadInMs: await lipsyncLeadInMs(db),
    lipsyncDurationMs: 0,
    voDurationMs: audio.durationMs ?? 0,
  });
  return { captions, captionOffsetMs: t.captionOffsetMs, hookTextMs: t.hookTextMs };
}

/** The approved audio, refused unless it belongs to this business. */
async function loadAudio(db: Db, businessId: string, audioRenderId: string) {
  const row = (
    await db
      .select({ audio: audioRenders, scriptBusinessId: scripts.businessId })
      .from(audioRenders)
      .innerJoin(scripts, eq(scripts.id, audioRenders.scriptId))
      .where(eq(audioRenders.id, audioRenderId))
      .limit(1)
  )[0];
  if (!row || row.scriptBusinessId !== businessId) throw new CutawayPlanError("not_found");
  const audio = row.audio;
  if (!audio.approvedAt || !audio.wordTimestamps || !audio.durationMs) {
    throw new CutawayPlanError("audio_not_approved");
  }
  return audio;
}

function normalizeHookText(hookText: string | undefined): string {
  const trimmed = (hookText ?? "").trim();
  if (trimmed === "") return "";
  const problem = hookTextError(trimmed);
  if (problem) throw new CutawayPlanError("invalid_hook_text", problem);
  return trimmed;
}

// ---------------------------------------------------------------------------
// Placing windows
// ---------------------------------------------------------------------------

/** A state the draft should not open on: unreadable, or a screen kind the steps planner never picks (login, system, …). */
function isSkipState(state: AnalysisState): boolean {
  return (
    !isInventoryState(state) ||
    (state.screenKind !== undefined && PLAN_SKIP_SCREEN_KINDS.has(state.screenKind))
  );
}

interface Placement {
  anchors: CutawayAnchor[];
  timeline: AnalysisState[];
  minStartMs: number;
  maxEndMs: number;
}

const footprint = (startMs: number, lengthMs: number) => ({
  start: startMs,
  end: startMs + lengthMs + CUTAWAY_FRAME_SLACK_MS,
});

/** Whether a window from `anchor` runs over no skip state (the states whose
 *  pictures it would show, by anchor order). */
function isClean(p: Placement, anchor: CutawayAnchor, lengthMs: number): boolean {
  const end = anchor.startMs + lengthMs;
  return p.anchors
    .filter((a) => a.startMs >= anchor.startMs && a.startMs < end)
    .every((a) => !isSkipState(p.timeline[a.stateIndex]!));
}

/** The anchor nearest `targetMs` whose window fits and overlaps nothing taken —
 *  a clean one when one is within reach. */
function nearestFree(
  p: Placement,
  targetMs: number,
  lengthMs: number,
  taken: { start: number; end: number }[],
): CutawayAnchor | undefined {
  let best: { anchor: CutawayAnchor; score: number } | undefined;
  for (const anchor of p.anchors) {
    const span = footprint(anchor.startMs, lengthMs);
    if (span.start < p.minStartMs || span.end > p.maxEndMs) continue;
    if (taken.some((t) => span.start < t.end && t.start < span.end)) continue;
    const score = Math.abs(anchor.startMs - targetMs) + (isClean(p, anchor, lengthMs) ? 0 : 3000);
    if (!best || score < best.score) best = { anchor, score };
  }
  return best?.anchor;
}

/**
 * The demo in order: the slots spread evenly through the usable recording,
 * each snapped to the nearest free anchor (clean first). Fewer windows than
 * slots only when the demo cannot hold them — never repeated footage.
 */
function demoOrderPicks(p: Placement, lengths: number[]): (CutawayAnchor | undefined)[] {
  const total = lengths.reduce((sum, len) => sum + len + CUTAWAY_FRAME_SLACK_MS, 0);
  const free = Math.max(0, p.maxEndMs - p.minStartMs - total);
  const gap = free / (lengths.length + 1);
  const taken: { start: number; end: number }[] = [];
  let cursor = p.minStartMs;
  return lengths.map((len) => {
    cursor += gap;
    const pick = nearestFree(p, cursor, len, taken);
    if (pick) taken.push(footprint(pick.startMs, len));
    cursor += len + CUTAWAY_FRAME_SLACK_MS;
    return pick;
  });
}

// ---------------------------------------------------------------------------
// The plan row
// ---------------------------------------------------------------------------

/**
 * The draft for (audio, demo, structure, hook text): the stored one if it
 * exists — free — else a new one. `hookText` is the FINAL on-screen line from
 * the effect step ('' or absent with no hook text): the slots are laid out
 * from when it leaves (founder, 2026-10-20), so a new line is a new draft.
 */
export async function draftCutawayPlan(
  db: Db,
  opts: { businessId: string; audioRenderId: string; demoId: string; hookText?: string },
): Promise<CutawayPlanView> {
  const structure = DEFAULT_CUTAWAY_STRUCTURE;
  const hookText = normalizeHookText(opts.hookText);
  const audio = await loadAudio(db, opts.businessId, opts.audioRenderId);
  const inventory = await loadInventory(db, opts.businessId, opts.demoId);
  const { captions, captionOffsetMs, hookTextMs } = await audioTimeline(db, audio, hookText);
  const words = captions.flatMap((c) => (c.words ?? []).map((w) => w.word));

  const key = and(
    eq(cutawayPlans.audioRenderId, opts.audioRenderId),
    eq(cutawayPlans.analysisId, inventory.analysisId),
    eq(cutawayPlans.structure, structure),
    eq(cutawayPlans.hookText, hookText),
  );
  const existing = (await db.select().from(cutawayPlans).where(key).limit(1))[0];
  if (existing) return planView(existing, words, inventory);

  const layout = cutawayLayout({
    captions,
    voDurationMs: audio.durationMs!,
    captionOffsetMs,
    hookTextMs,
    capacityMs: inventory.maxEndMs - inventory.minStartMs,
  });
  if (!("tier" in layout)) throw new CutawayPlanError(layout.reason);
  const lengths = layout.slots.map((s) => s.toMs - s.fromMs);

  const picks = demoOrderPicks(inventory, lengths);
  // A slot the demo has no free room for is dropped with its layout neighbour
  // left as a longer head — fewer cutaways, never repeated footage.
  const slots: CutawaySlot[] = [];
  for (const [i, slot] of layout.slots.entries()) {
    const anchor = picks[i];
    if (!anchor) continue;
    slots.push({
      ...slot,
      demoStartMs: anchor.startMs,
      stateIndex: anchor.stateIndex,
      draftDemoStartMs: anchor.startMs,
      draftStateIndex: anchor.stateIndex,
    });
  }
  if (slots.length === 0) throw new CutawayPlanError("demo_too_short");

  await db
    .insert(cutawayPlans)
    .values({
      businessId: opts.businessId,
      audioRenderId: opts.audioRenderId,
      demoId: opts.demoId,
      analysisId: inventory.analysisId,
      structure,
      hookText,
      slots,
    })
    .onConflictDoNothing();
  const row = (await db.select().from(cutawayPlans).where(key).limit(1))[0]!;
  return planView(row, words, inventory);
}

function planView(
  row: typeof cutawayPlans.$inferSelect,
  words: string[],
  inventory: Inventory,
): CutawayPlanView {
  const slots = cutawaySlotsSchema.parse(row.slots);
  return {
    planId: row.id,
    audioId: row.audioRenderId,
    demoId: row.demoId,
    structure: row.structure,
    hookText: row.hookText,
    words,
    slots: slots.map((s) => ({ ...s, lengthMs: s.toMs - s.fromMs })),
    anchors: inventory.anchors,
    minStartMs: inventory.minStartMs,
    maxEndMs: inventory.maxEndMs,
  };
}

async function loadPlan(db: Db, businessId: string, planId: string) {
  const row = (await db.select().from(cutawayPlans).where(eq(cutawayPlans.id, planId)).limit(1))[0];
  if (!row || row.businessId !== businessId) throw new CutawayPlanError("not_found");
  return row;
}

/** The plan as the wizard shows it, for a business that owns it. */
export async function getCutawayPlan(
  db: Db,
  opts: { businessId: string; planId: string },
): Promise<CutawayPlanView> {
  const row = await loadPlan(db, opts.businessId, opts.planId);
  const audio = await loadAudio(db, opts.businessId, row.audioRenderId);
  const inventory = await loadInventory(db, opts.businessId, row.demoId);
  const captions = (audio.wordTimestamps ?? []) as CaptionChunk[];
  return planView(
    row,
    captions.flatMap((c) => (c.words ?? []).map((w) => w.word)),
    inventory,
  );
}

/**
 * The customer's window picker: every slot's start at once. Each must be an
 * anchor of the plan's analysis, inside the recording, and no two windows may
 * overlap. The slots' times are the layout's and never move; the draft's
 * picks are kept beside the new ones.
 */
export async function updateCutawayPlan(
  db: Db,
  opts: { businessId: string; planId: string; starts: number[] },
): Promise<CutawayPlanView> {
  const row = await loadPlan(db, opts.businessId, opts.planId);
  const slots = cutawaySlotsSchema.parse(row.slots);
  if (opts.starts.length !== slots.length) {
    throw new CutawayPlanError("invalid_windows", "one start per cutaway");
  }
  const audio = await loadAudio(db, opts.businessId, row.audioRenderId);
  const inventory = await loadInventory(db, opts.businessId, row.demoId);
  if (inventory.analysisId !== row.analysisId) throw new CutawayPlanError("stale");
  const byStart = new Map(inventory.anchors.map((a) => [a.startMs, a]));
  const next = slots.map((slot, i) => {
    const anchor = byStart.get(opts.starts[i]!);
    if (!anchor)
      throw new CutawayPlanError("invalid_windows", "a start is not a moment of the demo");
    return { ...slot, demoStartMs: anchor.startMs, stateIndex: anchor.stateIndex };
  });
  const problem = cutawayWindowsError(next, inventory.maxEndMs + CUTAWAY_EDGE_MS);
  if (problem) throw new CutawayPlanError("invalid_windows", problem);
  const [updated] = await db
    .update(cutawayPlans)
    .set({ slots: next, editedAt: new Date(), updatedAt: new Date() })
    .where(eq(cutawayPlans.id, row.id))
    .returning();
  const captions = (audio.wordTimestamps ?? []) as CaptionChunk[];
  return planView(
    updated!,
    captions.flatMap((c) => (c.words ?? []).map((w) => w.word)),
    inventory,
  );
}

/**
 * What createBRender copies onto params: the plan re-checked against the
 * render it is about to join — the same business, the same approved audio,
 * the same hook text it was laid out from, a demo and analysis still ready,
 * and the layout and windows still valid. Cheap reads only: it runs before
 * the paid content-policy call.
 */
export async function resolveCutawaysForRender(
  db: Db,
  opts: { businessId: string; planId: string; audioRenderId: string; hookText?: string },
): Promise<BCutaways> {
  const row = await loadPlan(db, opts.businessId, opts.planId);
  const hookText = (opts.hookText ?? "").trim();
  if (row.audioRenderId !== opts.audioRenderId || row.hookText !== hookText) {
    throw new CutawayPlanError("stale");
  }
  const audio = await loadAudio(db, opts.businessId, row.audioRenderId);
  const inventory = await loadInventory(db, opts.businessId, row.demoId);
  if (inventory.analysisId !== row.analysisId) throw new CutawayPlanError("stale");
  const slots = cutawaySlotsSchema.parse(row.slots);
  const { captionOffsetMs, hookTextMs } = await audioTimeline(db, audio, hookText);
  const problem =
    cutawayLayoutError(slots, { voDurationMs: audio.durationMs!, captionOffsetMs, hookTextMs }) ??
    cutawayWindowsError(slots, inventory.maxEndMs + CUTAWAY_EDGE_MS);
  if (problem) throw new CutawayPlanError("invalid_windows", problem);
  return {
    structure: row.structure,
    planId: row.id,
    demoId: row.demoId,
    analysisId: row.analysisId,
    slots: slots.map(({ fromMs, toMs, demoStartMs }) => ({ fromMs, toMs, demoStartMs })),
  };
}
