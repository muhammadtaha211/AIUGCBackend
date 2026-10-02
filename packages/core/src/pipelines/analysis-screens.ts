import { z } from "zod";
import type { FrameSignature, StateCluster } from "../media/ffmpeg";

/**
 * Where the screen really changes (decisions 0077-0082). The footage decides
 * WHEN: footageEvents finds every instant the picture changes, on every native
 * frame, with no model — measured 2026-10-02, it has an instant at 56 of 57
 * real changes. WHAT each instant is — a new screen, the same screen with its
 * content replaced, or the same screen — the footage cannot tell, and the
 * label call that was to tell it did not pass its test
 * (facts/label-call-test-2026-10-02). So the label vocabulary and
 * screenChanges below are the last variant TESTED, not a shipped rule, and
 * nothing in the pipeline calls this module yet.
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
  /** How much of the change across the instant happened between two adjacent
   *  frames, 0-1. A cut is ~1; a scroll or a camera move, spread over the
   *  whole gap, is ~0.1. Two stills cannot show this, so the label call is
   *  told: without it the model reads a navigation as "scrolled to another
   *  section" (measured 2026-10-02). */
  abrupt: number;
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
  const byEdges = new Uint8Array(n);
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
    byEdges[i] = edge / EDGE_THRESHOLD >= luma / LUMA_THRESHOLD ? 1 : 0;
  }
  // In the band that made the instant: the largest single-frame step inside
  // the gap, as a share of the whole change across it.
  const abruptAt = (i: number): number => {
    const distance = byEdges[i] ? edgeDistance : lumaDistance;
    const across = distance(signatures[i - GAP_FRAMES]!, signatures[i + GAP_FRAMES]!);
    let step = 0;
    for (let j = i - GAP_FRAMES + 1; j <= i + GAP_FRAMES; j++) {
      step = Math.max(step, distance(signatures[j - 1]!, signatures[j]!));
    }
    return across > 0 ? Math.min(1, Math.round((step / across) * 100) / 100) : 0;
  };
  const events: FootageEvent[] = [];
  for (let i = reach; i < n - reach; i++) {
    const s = score[i]!;
    if (s < 1) continue;
    let peak = true;
    for (let k = i - PEAK_RADIUS_FRAMES; k <= i + PEAK_RADIUS_FRAMES; k++) {
      // A tie with an earlier frame is that frame's plateau, not a new peak.
      if (k >= 0 && k < n && (score[k]! > s || (k < i && score[k] === s))) {
        peak = false;
        break;
      }
    }
    if (!peak) continue;
    // On a perfectly still picture (a clean screen recording) every frame
    // whose gap straddles a cut scores the same: one instant, at the middle.
    let end = i;
    while (end + 1 < n - reach && score[end + 1] === s) end++;
    const at = Math.floor((i + end) / 2);
    events.push({
      atMs: Math.round((at * 1000) / fps),
      strength: Math.round(s * 10) / 10,
      abrupt: abruptAt(at),
    });
  }
  return events;
}

/** `moved`, `overlay` and `content` are the three ways of staying on the same
 *  screen. They are kept apart because the footage can check one of them:
 *  the camera or a scroll cannot change the picture in a single frame. */
export const SCREEN_LABELS = ["new", "swap", "overlay", "content", "moved"] as const;
export type ScreenLabel = (typeof SCREEN_LABELS)[number];

/** `abrupt` at or above which an instant is a cut. Where the model calls a cut
 *  `moved`, the two witnesses contradict each other — and unsure is a change. */
export const CUT_ABRUPT = 0.9;

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
 * it is a change — an instant with no label, one the model was not sure of,
 * or a cut the model explained as the camera or a scroll, is a change
 * whatever the model leaned towards; a swap keeps its mark either way.
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
    } else if (!event.sure || (event.label === "moved" && event.abrupt >= CUT_ABRUPT)) {
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
  // Written before the label on purpose: naming what differs ("camera zoomed
  // in") is what stops a zoom being called a new screen. Never stored.
  what: z.string(),
  label: z.enum(SCREEN_LABELS),
  sure: z.boolean(),
});
export const labelOutputSchema = z.object({ instants: z.array(labelEntrySchema) });
