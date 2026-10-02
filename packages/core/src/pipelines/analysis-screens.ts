import type { FrameSignature, StateCluster } from "../media/ffmpeg";

/**
 * What the footage itself says about a recording (decisions 0077, 0078, 0080,
 * 0083), stored per analysis in demo_analysis_footage:
 * - footageEvents: every instant the picture changes and then holds, on every
 *   native frame, with no model. Measured 2026-10-02, it has an instant within
 *   0.4 s of 56 of 57 real screen changes — and 6-7 instants for every real
 *   one, because a popup, a content load or a camera move is an instant too.
 *   WHAT an instant is, the footage cannot tell, and the vision call tested to
 *   tell it was not adopted (0083). So these are instants, not screen changes.
 * - analysisMoments: every kept moment with the span its picture held for,
 *   the ones whose vision read failed included.
 */

/** Bumped whenever a constant below, or the signature in media/ffmpeg.ts,
 *  changes — every stored row names the detector that found its instants. */
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
/** How far from either end of the recording an instant can be placed at all:
 *  the detector needs this many frames on both sides, so the first and last
 *  DETECTOR_REACH_FRAMES of every recording are never looked at. */
export const DETECTOR_REACH_FRAMES = GAP_FRAMES + HOLD_FRAMES;
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
   *  whole gap, is ~0.1. */
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
  const reach = DETECTOR_REACH_FRAMES;
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
