import { z } from "zod";
import type { FrameSignature, StateCluster } from "../media/ffmpeg";

/**
 * Where the screen really changes (decisions 0077-0080). The footage decides
 * WHEN: footageEvents finds every instant the picture changes, on every native
 * frame, with no model. A vision call decides WHAT each instant is — a new
 * screen, the same screen with its content replaced, or the same screen — and
 * anything it leaves unanswered or unsure is a change. Nothing here is read by
 * the plan rule yet (0072 stays live); this module only records.
 */

/** Bumped whenever a constant below, or the signature in media/ffmpeg.ts,
 *  changes — stored results are only copied between analyses of one detector. */
export const SCREENS_DETECTOR = "screens@1";

/** The normalized demo's own rate (normalizeVideo): every frame is looked at. */
export const SIGNATURE_FPS = 30;

// "Stable – change – stable", in frames at SIGNATURE_FPS. An instant at frame
// i compares the picture GAP frames before with GAP frames after, and takes
// off whatever each side was already moving by over the HOLD frames beyond —
// so a steady scroll or camera pan, which differs as much across the gap as
// across each hold, scores nothing. Frozen at the values the 2026-10-02
// measurement was taken with (facts/footage-screen-changes-2026-10-02).
const GAP_FRAMES = 5;
const HOLD_FRAMES = 6;
/** One instant per transition: the strongest within this many frames each way. */
const PEAK_RADIUS_FRAMES = 9;
/** Score at which each band alone makes an instant. */
const EDGE_THRESHOLD = 0.12;
const LUMA_THRESHOLD = 0.08;

export interface FootageEvent {
  atMs: number;
  /** Multiples of the threshold, one decimal: 1 is the weakest instant kept. */
  strength: number;
}

function edgeDistance(a: FrameSignature, b: FrameSignature): number {
  let d = 0;
  for (let k = 0; k < a.edges.length; k++) d += Math.abs(a.edges[k]! - b.edges[k]!);
  return d;
}

function lumaDistance(a: FrameSignature, b: FrameSignature): number {
  let d = 0;
  for (let k = 0; k < a.luma.length; k++) d += Math.abs(a.luma[k]! - b.luma[k]!);
  return d / a.luma.length;
}

/**
 * Every instant the picture changes and then holds, over the whole recording.
 * Pure: the same signatures give the same instants.
 */
export function footageEvents(signatures: FrameSignature[], fps = SIGNATURE_FPS): FootageEvent[] {
  const n = signatures.length;
  const reach = GAP_FRAMES + HOLD_FRAMES;
  const score = new Float64Array(n);
  for (let i = reach; i < n - reach; i++) {
    const before = signatures[i - GAP_FRAMES]!;
    const after = signatures[i + GAP_FRAMES]!;
    const holdBefore = signatures[i - reach]!;
    const holdAfter = signatures[i + reach]!;
    const edge = Math.fround(
      edgeDistance(before, after) -
        Math.max(edgeDistance(holdBefore, before), edgeDistance(after, holdAfter)),
    );
    const luma = Math.fround(
      lumaDistance(before, after) -
        Math.max(lumaDistance(holdBefore, before), lumaDistance(after, holdAfter)),
    );
    score[i] = Math.max(edge / EDGE_THRESHOLD, luma / LUMA_THRESHOLD);
  }
  const events: FootageEvent[] = [];
  for (let i = reach; i < n - reach; i++) {
    const s = score[i]!;
    if (s < 1) continue;
    let peak = true;
    for (let k = i - PEAK_RADIUS_FRAMES; k <= i + PEAK_RADIUS_FRAMES; k++) {
      if (k >= 0 && k < n && score[k]! > s) {
        peak = false;
        break;
      }
    }
    if (peak) {
      events.push({ atMs: Math.round((i * 1000) / fps), strength: Math.round(s * 10) / 10 });
    }
  }
  return events;
}

export const SCREEN_LABELS = ["new", "swap", "same"] as const;
export type ScreenLabel = (typeof SCREEN_LABELS)[number];

/** One instant as stored: where the footage put it, and what the model called
 *  it. `label: null` = the model never answered for it. */
export interface JudgedEvent extends FootageEvent {
  label: ScreenLabel | null;
  sure: boolean;
}

export interface ScreenChange {
  atMs: number;
  /** `swap` = the same page with its content replaced. Stored marked, counted
   *  as nothing yet: whether a swap ends a screen is the next task's call. */
  kind: "change" | "swap";
  why: "model" | "unsure" | "unjudged";
}

/**
 * The changes a set of judged instants amounts to. Decision 0079: when unsure,
 * it is a change — an instant with no label, or one the model was not sure of,
 * is a change whatever it leaned towards; a swap keeps its mark either way.
 */
export function screenChanges(events: JudgedEvent[]): ScreenChange[] {
  const changes: ScreenChange[] = [];
  for (const event of events) {
    if (event.label === null) {
      changes.push({ atMs: event.atMs, kind: "change", why: "unjudged" });
    } else if (event.label === "swap") {
      changes.push({ atMs: event.atMs, kind: "swap", why: event.sure ? "model" : "unsure" });
    } else if (event.label === "new") {
      changes.push({ atMs: event.atMs, kind: "change", why: event.sure ? "model" : "unsure" });
    } else if (!event.sure) {
      changes.push({ atMs: event.atMs, kind: "change", why: "unsure" });
    }
  }
  return changes;
}

/** One kept moment as recorded: the cluster's representative and the first and
 *  last sample its picture was held on (inclusive, on the analysis fps grid —
 *  decision 0077), and whether its vision read came back (0080). */
export interface AnalysisMoment {
  t: number;
  startMs: number;
  endMs: number;
  read: boolean;
}

/** Every kept cluster, read or not, in order. */
export function analysisMoments(kept: StateCluster[], read: boolean[]): AnalysisMoment[] {
  if (kept.length !== read.length) {
    throw new Error(`${kept.length} kept clusters but ${read.length} read flags`);
  }
  return kept.map((cluster, i) => ({
    t: cluster.representativeMs,
    startMs: cluster.startMs,
    endMs: cluster.endMs,
    read: read[i]!,
  }));
}

/**
 * Where a moment's picture really holds: its cluster span, cut back to the
 * stretch between the changes on either side of `t`. A cluster can run
 * straight across a real change — 12 of the 57 measured ones move the hash
 * less than the clustering's own same-state threshold — so the raw span alone
 * is not the hold.
 */
export function momentHold(
  moment: AnalysisMoment,
  changes: { atMs: number }[],
): { startMs: number; endMs: number } {
  let startMs = moment.startMs;
  let endMs = moment.endMs;
  for (const change of changes) {
    if (change.atMs <= moment.t) startMs = Math.max(startMs, change.atMs);
    else endMs = Math.min(endMs, change.atMs);
  }
  return { startMs, endMs };
}

/** What the model returns for one instant. Validated per element, like a
 *  vision batch frame: a bad entry leaves that instant unjudged, never the call. */
export const labelEntrySchema = z.object({
  index: z.number(),
  label: z.enum(SCREEN_LABELS),
  sure: z.boolean(),
});
export const labelOutputSchema = z.object({ instants: z.array(labelEntrySchema) });
