import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { CaptionChunk } from "../captions";
import {
  CUTAWAY_EDGE_MS,
  CUTAWAY_FRAME_SLACK_MS,
  CUTAWAY_MAX_SLOTS,
  DEFAULT_CUTAWAY_STRUCTURE,
  clearHookText,
  cutawayEditError,
  cutawayLayout,
  cutawayWindowsError,
  cutawayWordSpan,
  hookLeaveVoMs,
  productMention,
  type CutawayWindow,
  type ProductMention,
} from "../cutaway-structure";
import type { Db } from "../db";
import {
  audioRenders,
  businesses,
  cutawayPlans,
  demoAnalyses,
  demoAnalysisFootage,
  demos,
  scripts,
} from "../db/schema";
import { logger } from "../logger";
import { isInventoryState, PLAN_SKIP_SCREEN_KINDS } from "../plan-format";
import { serviceBTimeline } from "../service-b-timeline";
import { analysisTimelineSchema, type AnalysisState } from "./demo-analysis";
import { analysisSampleMs, recordingEndMs } from "./demo-step-plans";
import { lipsyncLeadInMs } from "./renders";

/**
 * Service B demo cutaways (vault 0121, 0122): the draft, the customer's edits,
 * and the copy enqueue takes. The layout and every placement rule are
 * cutaway-structure.ts (pure, shared with the wizard); this module reads and
 * writes the plan row and places the draft's windows in the customer's demo.
 *
 * A window starts on a MOMENT of the analysed demo (vault 0120 §4: "a stretch
 * of the demo from a picked moment"): the first frame its picture was held
 * (demo_analysis_footage.moments[k].startMs, the k-th read moment being the
 * k-th timeline state), else the state's timestamp when the footage row is
 * missing or does not line up.
 *
 * The draft is the demo in order, laid out from the phrase where the script
 * first names the product (0122): the slots spread evenly through the usable
 * recording, clean of login, system and unreadable screens where it can be. A
 * text-only Claude match of each slot's words against the analysed screens was
 * built and tested on the founder's own demos first (vault 0082's rule) and did
 * not clear the bar fixed before the run — 63% against demo order's 43%, 80%
 * run-to-run (vault 0121, facts/cutaway-matcher-hit-rate-2026-10-20) — so the
 * draft costs nothing. The customer then moves, adds and removes clips freely
 * (0122); the row is keyed per (audio, analysis, structure, the SCRIPT's hook
 * text), so the edits survive going back and forth.
 */

/** One stored slot (cutaway_plans.slots), VO time. */
export const cutawaySlotSchema = z.object({
  /** The clip's identity — its letter and colour in the wizard (0122). Absent on 0121 rows. */
  id: z.number().int().min(1).max(CUTAWAY_MAX_SLOTS).optional(),
  fromMs: z.number(),
  toMs: z.number(),
  wordFrom: z.number().int().nonnegative(),
  wordTo: z.number().int().nonnegative(),
  demoStartMs: z.number(),
  stateIndex: z.number().int().nonnegative().nullable(),
  /** The draft's pick, kept beside the customer's on a drafted clip; a clip the customer added has none. */
  draftDemoStartMs: z.number().optional(),
  draftStateIndex: z.number().int().nonnegative().nullable().optional(),
});
export type CutawaySlot = z.infer<typeof cutawaySlotSchema>;
export const cutawaySlotsSchema = z.array(cutawaySlotSchema);

/** A slot as the wizard and the render read it: always with its id. */
export type PlacedCutawaySlot = CutawaySlot & { id: number };

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
  | "invalid_windows"
  | "edit_conflict"
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

/**
 * What the wizard gets: the audio's caption timings (it places clips on
 * phrases and works out when an edited hook text leaves with the same
 * functions the server checks with), where the script names the product,
 * the slots and where windows may start.
 */
export interface CutawayPlanView {
  planId: string;
  audioId: string;
  demoId: string;
  structure: string;
  /** The script's hook text the plan is laid out from ('' = none). */
  hookText: string;
  /** The row's version: an edit names it, and a stale one is refused. */
  updatedAt: string;
  captions: CaptionChunk[];
  voDurationMs: number;
  captionOffsetMs: number;
  /** VO start of the phrase where the script first names the product. */
  mentionMs: number;
  /** How it was found — "share": no name heard, 40% of the voice. */
  mentionMethod: ProductMention["method"];
  slots: (PlacedCutawaySlot & { lengthMs: number })[];
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
 * analysis grid (recordingEndMs), less the unexamined edge. A moment that
 * began inside the opening edge (the first screen, from 0 ms) starts its
 * window AT the edge rather than being lost; when several land there, the
 * last — the one on screen at the edge — keeps the start.
 */
export function cutawayPlacement(opts: {
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
  const raw = opts.timeline.map((state, stateIndex) => ({
    startMs: Math.max(minStartMs, spansLineUp ? read[stateIndex]!.startMs : state.timestampMs),
    stateIndex,
  }));
  const anchors = raw.filter((a, i) => a.startMs < maxEndMs && raw[i + 1]?.startMs !== a.startMs);
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

/**
 * The approved audio, refused unless it belongs to this business, with the
 * hook text the script call drafted for it — the line the clips are laid out
 * from (founder, 2026-10-21: "the hook text as the script step extracted
 * it"), read here rather than taken from the client.
 */
async function loadAudio(db: Db, businessId: string, audioRenderId: string) {
  const row = (
    await db
      .select({
        audio: audioRenders,
        scriptBusinessId: scripts.businessId,
        scriptParams: scripts.params,
      })
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
  const drafted = (row.scriptParams as { hookText?: unknown } | null)?.hookText;
  return { audio, scriptHookText: typeof drafted === "string" ? drafted.trim() : "" };
}

/** The names productMention listens for: the questionnaire's product_name and the business's own. */
async function mentionNames(db: Db, businessId: string) {
  const row = (
    await db
      .select({ name: businesses.name, questionnaire: businesses.questionnaire })
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1)
  )[0];
  const productName = (row?.questionnaire as { product_name?: unknown } | null)?.product_name;
  return {
    businessName: row?.name ?? null,
    productName: typeof productName === "string" ? productName : null,
  };
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

export interface Placement {
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

/** The earliest anchor at or after `fromMs` whose window of `lengthMs` fits the recording. */
function earliestFit(p: Placement, fromMs: number, lengthMs: number): CutawayAnchor | undefined {
  return p.anchors.find(
    (a) => a.startMs >= fromMs && footprint(a.startMs, lengthMs).end <= p.maxEndMs,
  );
}

/** Whether `lengths` still fit after `fromMs`, in order, each at the earliest anchor that fits. */
function canPack(p: Placement, fromMs: number, lengths: number[]): boolean {
  let end = fromMs;
  for (const length of lengths) {
    const next = earliestFit(p, end, length);
    if (!next) return false;
    end = footprint(next.startMs, length).end;
  }
  return true;
}

/**
 * The demo in order: the windows follow the recording, spread evenly through
 * it, each snapped to the anchor nearest its share (a clean one when one is
 * within reach) among those that start after the previous window ends and
 * still leave room for every later slot. When the demo cannot hold them all,
 * the run stops — a leading run of slots, so the only head that grows is the
 * last one, never one between cutaways (the capacity tier's rule) — and never
 * repeated footage.
 */
export function demoOrderPicks(p: Placement, lengths: number[]): CutawayAnchor[] {
  const total = lengths.reduce((sum, len) => sum + len + CUTAWAY_FRAME_SLACK_MS, 0);
  const gap = Math.max(0, p.maxEndMs - p.minStartMs - total) / (lengths.length + 1);
  const picks: CutawayAnchor[] = [];
  let end = p.minStartMs;
  let target = p.minStartMs;
  for (const [i, length] of lengths.entries()) {
    target += gap;
    const fits = p.anchors.filter(
      (a) => a.startMs >= end && footprint(a.startMs, length).end <= p.maxEndMs,
    );
    const rest = lengths.slice(i + 1);
    const roomy = fits.filter((a) => canPack(p, footprint(a.startMs, length).end, rest));
    const pool = roomy.length > 0 ? roomy : fits;
    let best: { anchor: CutawayAnchor; score: number } | undefined;
    for (const anchor of pool) {
      const score = Math.abs(anchor.startMs - target) + (isClean(p, anchor, length) ? 0 : 3000);
      if (!best || score < best.score) best = { anchor, score };
    }
    if (!best) break;
    picks.push(best.anchor);
    end = footprint(best.anchor.startMs, length).end;
    target = Math.max(target + length + CUTAWAY_FRAME_SLACK_MS, end);
  }
  return picks;
}

// ---------------------------------------------------------------------------
// The plan row
// ---------------------------------------------------------------------------

const byFrom = (a: { fromMs: number }, b: { fromMs: number }) => a.fromMs - b.fromMs;

/**
 * The row, only as it was read: the version an edit or a redraft is made on.
 * updated_at is microseconds in Postgres and milliseconds in a JS Date, so the
 * stored value is compared at the precision the reader saw.
 */
function atVersion(row: typeof cutawayPlans.$inferSelect) {
  return and(
    eq(cutawayPlans.id, row.id),
    sql`date_trunc('milliseconds', ${cutawayPlans.updatedAt}) = ${row.updatedAt.toISOString()}::timestamptz`,
  );
}

/** The stored slots in script order, each with its id — a 0121 row's by position. */
function placedSlots(raw: unknown): PlacedCutawaySlot[] {
  return cutawaySlotsSchema
    .parse(raw)
    .sort(byFrom)
    .map((slot, i) => ({ ...slot, id: slot.id ?? i + 1 }));
}

/** What a draft or an edit compares on — jsonb reorders keys, so never JSON of the row. */
function slotsSignature(slots: CutawaySlot[]): string {
  return JSON.stringify(
    slots.map((s) => [
      s.id ?? null,
      s.fromMs,
      s.toMs,
      s.wordFrom,
      s.wordTo,
      s.demoStartMs,
      s.stateIndex,
      s.draftDemoStartMs ?? null,
      s.draftStateIndex ?? null,
    ]),
  );
}

/**
 * The free draft for an audio, a demo and the script's hook text: laid out
 * from where the script first names the product (vault 0122), each window
 * placed in demo order. A leading run: slots the demo has no room for drop
 * off the END, so only the last head grows — fewer cutaways, never repeated
 * footage. None at all is a valid draft: the customer can still add one.
 */
function draftSlots(
  inventory: Inventory,
  timeline: { captions: CaptionChunk[]; captionOffsetMs: number; hookTextMs: number },
  voDurationMs: number,
  mentionMs: number,
): PlacedCutawaySlot[] {
  const layout = cutawayLayout({
    captions: timeline.captions,
    voDurationMs,
    captionOffsetMs: timeline.captionOffsetMs,
    hookTextMs: timeline.hookTextMs,
    mentionMs,
    capacityMs: inventory.maxEndMs - inventory.minStartMs,
  });
  if (!("tier" in layout)) return [];
  const picks = demoOrderPicks(
    inventory,
    layout.slots.map((s) => s.toMs - s.fromMs),
  );
  return picks.map((anchor, i) => ({
    id: i + 1,
    ...layout.slots[i]!,
    demoStartMs: anchor.startMs,
    stateIndex: anchor.stateIndex,
    draftDemoStartMs: anchor.startMs,
    draftStateIndex: anchor.stateIndex,
  }));
}

/**
 * A 0121 row's window picks, carried onto the new draft by position where
 * they still fit: under 0121 a customer could only move windows — the slot
 * times were the layout's — so the times are redrafted under 0122's rule and
 * nothing the customer actually chose is lost.
 */
function carryWindowPicks(
  legacy: PlacedCutawaySlot[],
  draft: PlacedCutawaySlot[],
  inventory: Inventory,
): { slots: PlacedCutawaySlot[]; carried: number } {
  const byStart = new Map(inventory.anchors.map((a) => [a.startMs, a]));
  let slots = draft;
  let carried = 0;
  for (const [k, old] of legacy.entries()) {
    if (k >= slots.length || old.draftDemoStartMs === old.demoStartMs) continue;
    const anchor = byStart.get(old.demoStartMs);
    if (!anchor) continue;
    const next = slots.map((s, i) =>
      i === k ? { ...s, demoStartMs: anchor.startMs, stateIndex: anchor.stateIndex } : s,
    );
    if (cutawayWindowsError(next, inventory.maxEndMs + CUTAWAY_EDGE_MS) === null) {
      slots = next;
      carried++;
    }
  }
  return { slots, carried };
}

/**
 * The plan for (audio, demo, structure, the script's hook text). A row the
 * customer edited is returned as it is — never redrafted; one nobody has
 * touched is the free draft, recomputed on every visit and written only when
 * it changed (a questionnaire edit moves the product mention); a 0121 row is
 * redrafted with its window picks carried over.
 */
export async function draftCutawayPlan(
  db: Db,
  opts: { businessId: string; audioRenderId: string; demoId: string },
): Promise<CutawayPlanView> {
  const structure = DEFAULT_CUTAWAY_STRUCTURE;
  const { audio, scriptHookText: hookText } = await loadAudio(
    db,
    opts.businessId,
    opts.audioRenderId,
  );
  const inventory = await loadInventory(db, opts.businessId, opts.demoId);
  const timeline = await audioTimeline(db, audio, hookText);
  const mention = productMention(
    timeline.captions,
    await mentionNames(db, opts.businessId),
    audio.durationMs!,
  );
  const view = (row: typeof cutawayPlans.$inferSelect) =>
    planView(row, timeline, audio.durationMs!, mention, inventory);

  const key = and(
    eq(cutawayPlans.audioRenderId, opts.audioRenderId),
    eq(cutawayPlans.analysisId, inventory.analysisId),
    eq(cutawayPlans.structure, structure),
    eq(cutawayPlans.hookText, hookText),
  );
  const existing = (await db.select().from(cutawayPlans).where(key).limit(1))[0];
  const legacy =
    existing !== undefined &&
    cutawaySlotsSchema.parse(existing.slots).some((slot) => slot.id === undefined);
  if (existing && existing.editedAt && !legacy) return view(existing);

  const draft = draftSlots(inventory, timeline, audio.durationMs!, mention.ms);
  if (existing) {
    const carry =
      legacy && existing.editedAt
        ? carryWindowPicks(placedSlots(existing.slots), draft, inventory)
        : { slots: draft, carried: 0 };
    if (!legacy && slotsSignature(placedSlots(existing.slots)) === slotsSignature(carry.slots)) {
      return view(existing);
    }
    // Only over the row as read: an edit that landed meanwhile is never wiped.
    const [redrafted] = await db
      .update(cutawayPlans)
      .set({
        slots: carry.slots,
        editedAt: carry.carried > 0 ? existing.editedAt : null,
        updatedAt: new Date(),
      })
      .where(atVersion(existing))
      .returning();
    return view(redrafted ?? (await db.select().from(cutawayPlans).where(key).limit(1))[0]!);
  }
  // A 0121 plan for this audio and demo was keyed on the effect step's line
  // ('' for "none", or the customer's edit) — find it under any line, and keep
  // the windows its customer picked.
  const legacyRow = (
    await db
      .select()
      .from(cutawayPlans)
      .where(
        and(
          eq(cutawayPlans.audioRenderId, opts.audioRenderId),
          eq(cutawayPlans.analysisId, inventory.analysisId),
          eq(cutawayPlans.structure, structure),
        ),
      )
      .orderBy(desc(cutawayPlans.updatedAt))
  ).find(
    (row) =>
      row.editedAt !== null &&
      cutawaySlotsSchema.parse(row.slots).some((slot) => slot.id === undefined),
  );
  const carry = legacyRow
    ? carryWindowPicks(placedSlots(legacyRow.slots), draft, inventory)
    : { slots: draft, carried: 0 };
  await db
    .insert(cutawayPlans)
    .values({
      businessId: opts.businessId,
      audioRenderId: opts.audioRenderId,
      demoId: opts.demoId,
      analysisId: inventory.analysisId,
      structure,
      hookText,
      slots: carry.slots,
      editedAt: carry.carried > 0 ? legacyRow!.editedAt : null,
    })
    .onConflictDoNothing();
  return view((await db.select().from(cutawayPlans).where(key).limit(1))[0]!);
}

function planView(
  row: typeof cutawayPlans.$inferSelect,
  timeline: { captions: CaptionChunk[]; captionOffsetMs: number },
  voDurationMs: number,
  mention: ProductMention,
  inventory: Inventory,
): CutawayPlanView {
  return {
    planId: row.id,
    audioId: row.audioRenderId,
    demoId: row.demoId,
    structure: row.structure,
    hookText: row.hookText,
    updatedAt: row.updatedAt.toISOString(),
    captions: timeline.captions,
    voDurationMs,
    captionOffsetMs: timeline.captionOffsetMs,
    mentionMs: mention.ms,
    mentionMethod: mention.method,
    slots: placedSlots(row.slots).map((s) => ({ ...s, lengthMs: s.toMs - s.fromMs })),
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

/** One clip as the wizard sends it: where it sits in the script and where its window starts. */
export interface CutawayEdit {
  id: number;
  fromMs: number;
  toMs: number;
  demoStartMs: number;
}

/**
 * The customer's whole slot list, after one move, add, remove or window change
 * (vault 0122). Refused only for what cutawayEditError and cutawayWindowsError
 * guard — never for a long head run, which the wizard only notes. An id the row
 * holds is that clip (its draft pick carries over); one it does not is a clip
 * just added. `expectedUpdatedAt` is the version the wizard edited: anything
 * else means it is acting on a stale view, so nothing is written.
 */
export async function updateCutawayPlan(
  db: Db,
  opts: { businessId: string; planId: string; expectedUpdatedAt: string; slots: CutawayEdit[] },
): Promise<CutawayPlanView> {
  const row = await loadPlan(db, opts.businessId, opts.planId);
  if (row.updatedAt.toISOString() !== opts.expectedUpdatedAt) {
    throw new CutawayPlanError("edit_conflict");
  }
  const { audio } = await loadAudio(db, opts.businessId, row.audioRenderId);
  const inventory = await loadInventory(db, opts.businessId, row.demoId);
  if (inventory.analysisId !== row.analysisId) throw new CutawayPlanError("stale");
  const timeline = await audioTimeline(db, audio, row.hookText);

  const ids = opts.slots.map((s) => s.id);
  if (new Set(ids).size !== ids.length || ids.some((id) => id < 1 || id > CUTAWAY_MAX_SLOTS)) {
    throw new CutawayPlanError("invalid_windows", "each cutaway needs its own id");
  }
  const edits = [...opts.slots].sort(byFrom);
  const problem = cutawayEditError(edits, {
    captions: timeline.captions,
    voDurationMs: audio.durationMs!,
    hookLeaveVoMs: hookLeaveVoMs(row.hookText, timeline.captions, timeline.captionOffsetMs),
  });
  if (problem) throw new CutawayPlanError("invalid_windows", problem);

  const stored = new Map(placedSlots(row.slots).map((s) => [s.id, s]));
  const byStart = new Map(inventory.anchors.map((a) => [a.startMs, a]));
  const next: PlacedCutawaySlot[] = edits.map((edit) => {
    const before = stored.get(edit.id);
    let stateIndex: number | null;
    if (before && before.demoStartMs === edit.demoStartMs) {
      // Untouched: the stored pick stands, even if a footage row landed since and moved the anchors.
      stateIndex = before.stateIndex;
    } else {
      const anchor = byStart.get(edit.demoStartMs);
      if (!anchor) {
        throw new CutawayPlanError("invalid_windows", "a start is not a moment of the demo");
      }
      stateIndex = anchor.stateIndex;
    }
    return {
      id: edit.id,
      fromMs: edit.fromMs,
      toMs: edit.toMs,
      ...cutawayWordSpan(timeline.captions, edit.fromMs, edit.toMs),
      demoStartMs: edit.demoStartMs,
      stateIndex,
      ...(before?.draftDemoStartMs !== undefined
        ? {
            draftDemoStartMs: before.draftDemoStartMs,
            draftStateIndex: before.draftStateIndex ?? null,
          }
        : {}),
    };
  });
  const windows = cutawayWindowsError(next, inventory.maxEndMs + CUTAWAY_EDGE_MS);
  if (windows) throw new CutawayPlanError("invalid_windows", windows);

  // Only over the version the wizard edited: a second tab, or a tap racing a
  // save, that wrote first wins, and this one is told so.
  const [updated] = await db
    .update(cutawayPlans)
    .set({ slots: next, editedAt: new Date(), updatedAt: new Date() })
    .where(atVersion(row))
    .returning();
  if (!updated) throw new CutawayPlanError("edit_conflict");
  const mention = productMention(
    timeline.captions,
    await mentionNames(db, opts.businessId),
    audio.durationMs!,
  );
  return planView(updated, timeline, audio.durationMs!, mention, inventory);
}

/**
 * What createBRender copies onto params, or null for a head-only ad: the plan
 * re-checked against the render it is about to join — the same business and
 * approved audio, a demo and analysis still ready — with the FINAL hook text's
 * collisions resolved (clearHookText: a clip under a longer hook text moves to
 * the next phrase, or drops) and the result held to the customer's rules once
 * more, the last guard. No clips left is today's ad: no `cutaways` key at all.
 * Cheap reads only: it runs before the paid content-policy call.
 */
export async function resolveCutawaysForRender(
  db: Db,
  opts: { businessId: string; planId: string; audioRenderId: string; hookText?: string },
): Promise<BCutaways | null> {
  const row = await loadPlan(db, opts.businessId, opts.planId);
  if (row.audioRenderId !== opts.audioRenderId) throw new CutawayPlanError("stale");
  const { audio } = await loadAudio(db, opts.businessId, row.audioRenderId);
  const slots = placedSlots(row.slots);
  if (slots.length === 0) return null;
  const inventory = await loadInventory(db, opts.businessId, row.demoId);
  if (inventory.analysisId !== row.analysisId) throw new CutawayPlanError("stale");
  const timeline = await audioTimeline(db, audio, row.hookText);
  const leaves = hookLeaveVoMs(opts.hookText ?? "", timeline.captions, timeline.captionOffsetMs);
  const cleared = clearHookText(slots, {
    captions: timeline.captions,
    voDurationMs: audio.durationMs!,
    hookLeaveVoMs: leaves,
    footage: inventory,
  });
  if (cleared.moved.length > 0 || cleared.dropped.length > 0) {
    logger.info(
      { planId: row.id, moved: cleared.moved, dropped: cleared.dropped },
      "cutaways: the hook text reached a clip",
    );
  }
  if (cleared.slots.length === 0) return null;
  const problem =
    cutawayEditError(cleared.slots, {
      captions: timeline.captions,
      voDurationMs: audio.durationMs!,
      hookLeaveVoMs: leaves,
    }) ?? cutawayWindowsError(cleared.slots, inventory.maxEndMs + CUTAWAY_EDGE_MS);
  if (problem) throw new CutawayPlanError("invalid_windows", problem);
  return {
    structure: row.structure,
    planId: row.id,
    demoId: row.demoId,
    analysisId: row.analysisId,
    slots: cleared.slots.map(({ fromMs, toMs, demoStartMs }) => ({ fromMs, toMs, demoStartMs })),
  };
}
