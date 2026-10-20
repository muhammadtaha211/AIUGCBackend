import { z } from "zod";
import type { CaptionChunk } from "./captions";

/**
 * Service B demo cutaways (vault 0120 §4, 0121): the ad opens on the character,
 * cuts to stretches of the customer's own analysed demo and back, and ends on
 * the character, while the voice and the captions run straight through.
 *
 * A STRUCTURE is the named rule that lays those cuts out — data, like the hook
 * effects (hook-effect.ts): the name travels on the plan row and the render
 * params, the numbers live here and never in the DB, so a retune is a deploy.
 * Not to be confused with the `structures` TABLE (b_script skeletons,
 * schema.ts), which shares only the word. v1 has one structure plus "none",
 * and no chooser until a second exists (founder, 2026-10-20).
 *
 * Every time here is VO time — ms into the approved mp3, the axis the caption
 * chunks are stored on — except where a name says composition. The render adds
 * timeline.captionOffsetMs, so a lead-in retune between the draft and the
 * render moves nothing (pipelines/renders.ts).
 */

export const CUTAWAY_STRUCTURES = ["none", "alternate"] as const;
export type CutawayStructure = (typeof CUTAWAY_STRUCTURES)[number];
export const cutawayStructureSchema = z.enum(CUTAWAY_STRUCTURES);
/** What a customer who ticks the option gets — the only structure in v1. */
export const DEFAULT_CUTAWAY_STRUCTURE = "alternate" satisfies CutawayStructure;

/**
 * "alternate": head → demo → head → … → head. CHOSEN within the founder's rule 4
 * (2026-10-20: the first cut lands a few seconds in, after the hook text
 * leaves; no head run after it past ~5 s; a cutaway is 4–6 s), none measured:
 *
 * - firstCutMinMs: the founder's own number (2026-10-20 amendment) — the first
 *   cut is the first chunk start at least 3000 ms into the AD (composition
 *   time) and at or after the hook text leaves.
 * - cut: the founder's "4–6 seconds each".
 * - head min 1000: one chunk — a shorter return reads as a flash, and with
 *   1500 one of his real audios had no layout on chunk starts at all.
 * - head softMax 5500: "about 5 s" — used only when no layout fits under 5000.
 */
export const CUTAWAY_ALTERNATE = {
  firstCutMinMs: 3000,
  cut: { minMs: 4000, targetMs: 5000, maxMs: 6000 },
  head: { minMs: 1000, targetMs: 2500, maxMs: 5000, softMaxMs: 5500 },
} as const;

/**
 * A window never starts in the first, or ends in the last, 367 ms of the
 * recording: the stretch the footage detector never examines
 * (DETECTOR_REACH_FRAMES = 11 at 30 fps, analysis-screens.ts — a test pins the
 * two together), which also covers the measured 0–5 frame drift between the
 * raw upload's length and the normalized file's.
 */
export const CUTAWAY_EDGE_MS = 367;
/** One frame and a bit: a cutaway's frames are quantised up (ceil), so its
 *  footprint in the demo can be one frame longer than its length. */
export const CUTAWAY_FRAME_SLACK_MS = 34;

/** One laid-out slot: when the demo covers the head, and the words it covers. */
export interface CutawayLayoutSlot {
  fromMs: number;
  toMs: number;
  /** Index into captions.flatMap(c => c.words), inclusive. */
  wordFrom: number;
  /** Exclusive. */
  wordTo: number;
}

/**
 * Which rule produced the layout, best first: chunk starts with heads ≤ 5000,
 * then ≤ 5500; then the same two allowing a cut on a WORD start inside a
 * caption line (the first cut always stays on the founder's chunk rule) —
 * 3 of the founder's 15 distinct audios (2026-10-20) had a 2.5–2.8 s caption
 * line exactly where a cut had to land, so chunk starts alone gave them no
 * cutaways at all; then the capacity tier.
 */
export type CutawayLayoutTier = "strict" | "soft" | "words" | "words_soft" | "capacity";

export type CutawayLayout =
  | { slots: CutawayLayoutSlot[]; tier: CutawayLayoutTier; firstCutMs: number }
  | { slots: []; reason: "vo_too_short" | "demo_too_short" | "no_layout" };

export interface CutawayLayoutInput {
  /** The approved VO's stored caption chunks (audio_renders.word_timestamps). */
  captions: CaptionChunk[];
  /** audio_renders.duration_ms — the clamped file length (the 80 ms residue stays inside the final head). */
  voDurationMs: number;
  /** Composition time of the VO's first sample (serviceBTimeline.captionOffsetMs). */
  captionOffsetMs: number;
  /** Composition time the hook text leaves (serviceBTimeline.hookTextMs); 0 = no hook text. */
  hookTextMs: number;
  /** Demo time available for cutaways (Infinity = unbounded). */
  capacityMs: number;
}

/**
 * The cut points: caption-chunk starts only, so every cut lands on a phrase
 * and the caption change and the picture change share a frame (the founder's
 * done-criterion, 2026-10-20). A memoised search over them for the layout
 * nearest the targets, in tiers: heads ≤ 5000, then ≤ 5500; then — only when
 * the demo is the reason — the longest fitting prefix ending on a head of any
 * length ("a demo too short for the slots gets fewer slots, never repeated
 * footage"). Nothing fits: no slots, and the reason why.
 */
export function cutawayLayout(input: CutawayLayoutInput): CutawayLayout {
  const S = CUTAWAY_ALTERNATE;
  const end = input.voDurationMs;
  const firstFromVo = Math.max(S.firstCutMinMs, input.hookTextMs) - input.captionOffsetMs;
  const chunkStarts = [...new Set(input.captions.map((c) => c.startMs))]
    .filter((p) => p > 0 && p < end)
    .sort((a, b) => a - b);
  const firstCut = chunkStarts.find((p) => p >= firstFromVo);
  if (firstCut === undefined || end - firstCut < S.cut.minMs + S.head.minMs) {
    return { slots: [], reason: "vo_too_short" };
  }
  if (input.capacityMs < S.cut.minMs + CUTAWAY_FRAME_SLACK_MS) {
    return { slots: [], reason: "demo_too_short" };
  }

  const sq = (ms: number, target: number) => ((ms - target) / 1000) ** 2;

  type Best = { cost: number; cuts: number[][]; cutMs: number } | null;
  const better = (a: Best, b: Best): Best => {
    if (!a) return b;
    if (!b) return a;
    if (b.cost !== a.cost) return b.cost < a.cost ? b : a;
    return b.cuts.length > a.cuts.length ? b : a;
  };

  /**
   * Best continuation from a cutaway starting at points[i], with `used` demo
   * ms already spent. `openEnd`: the capacity tier, where the ad may end on a
   * head of any length after any cutaway.
   */
  const wordStarts = [
    ...new Set([
      ...chunkStarts,
      ...input.captions.flatMap((c) => (c.words ?? []).map((w) => w.startMs)),
    ]),
  ]
    .filter((p) => p >= firstCut && p < end)
    .sort((a, b) => a - b);
  const chunkPoints = chunkStarts.filter((p) => p >= firstCut);

  const search = (points: number[], headMax: number, openEnd: boolean): Best => {
    const memo = new Map<string, Best>();
    const fromCut = (i: number, used: number): Best => {
      // Unbounded capacity: the continuation cannot depend on what was spent.
      const key = Number.isFinite(input.capacityMs) ? `${i}:${used}` : `${i}`;
      if (memo.has(key)) return memo.get(key)!;
      let best: Best = null;
      const s = points[i]!;
      for (let j = i + 1; j < points.length; j++) {
        const len = points[j]! - s;
        if (len < S.cut.minMs) continue;
        if (len > S.cut.maxMs) break;
        const spent = used + len + CUTAWAY_FRAME_SLACK_MS;
        if (spent > input.capacityMs) break;
        const cutCost = sq(len, S.cut.targetMs);
        const e = points[j]!;
        const tail = end - e;
        // Finish here: the ad ends on a head.
        if (tail >= S.head.minMs && (openEnd || tail <= headMax)) {
          best = better(best, {
            cost: cutCost + (openEnd ? 0 : sq(tail, S.head.targetMs)),
            cuts: [[s, e]],
            cutMs: len,
          });
        }
        // Or a head, then the next cutaway.
        for (let k = j + 1; k < points.length; k++) {
          const head = points[k]! - e;
          if (head < S.head.minMs) continue;
          if (head > headMax) break;
          const rest = fromCut(k, spent);
          if (rest) {
            best = better(best, {
              cost: cutCost + sq(head, S.head.targetMs) + rest.cost,
              cuts: [[s, e], ...rest.cuts],
              cutMs: len + rest.cutMs,
            });
          }
        }
      }
      memo.set(key, best);
      return best;
    };
    return fromCut(0, 0);
  };

  let found: Best = null;
  let tier: CutawayLayoutTier = "strict";
  for (const [points, headMax, name] of [
    [chunkPoints, S.head.maxMs, "strict"],
    [chunkPoints, S.head.softMaxMs, "soft"],
    [wordStarts, S.head.maxMs, "words"],
    [wordStarts, S.head.softMaxMs, "words_soft"],
  ] as const) {
    found = search(points, headMax, false);
    if (found) {
      tier = name;
      break;
    }
  }
  if (!found && Number.isFinite(input.capacityMs)) {
    // Is the demo the reason? Only then may a head run long at the end.
    const unbounded = cutawayLayout({ ...input, capacityMs: Number.POSITIVE_INFINITY });
    if (unbounded.slots.length > 0) {
      const prefixes = searchLongestPrefix(wordStarts, end, input.capacityMs);
      if (prefixes) {
        found = prefixes;
        tier = "capacity";
      }
    }
  }
  if (!found) return { slots: [], reason: "no_layout" };

  const words = input.captions.flatMap((c) => c.words ?? []);
  const wordAt = (ms: number) => {
    const i = words.findIndex((w) => w.startMs >= ms);
    return i === -1 ? words.length : i;
  };
  return {
    tier,
    firstCutMs: found.cuts[0]![0]!,
    slots: found.cuts.map(([fromMs, toMs]) => ({
      fromMs: fromMs!,
      toMs: toMs!,
      wordFrom: wordAt(fromMs!),
      wordTo: wordAt(toMs!),
    })),
  };
}

/**
 * The capacity tier: the most cutaway time that fits the demo, every head
 * between cutaways inside the soft max, the last head any length ≥ the
 * minimum. Ties go to the layout nearest the targets.
 */
function searchLongestPrefix(
  points: number[],
  end: number,
  capacityMs: number,
): { cost: number; cuts: number[][]; cutMs: number } | null {
  const S = CUTAWAY_ALTERNATE;
  type Best = { cost: number; cuts: number[][]; cutMs: number } | null;
  const better = (a: Best, b: Best): Best =>
    !a ? b : !b ? a : b.cutMs !== a.cutMs ? (b.cutMs > a.cutMs ? b : a) : b.cost < a.cost ? b : a;
  const memo = new Map<string, Best>();
  const fromCut = (i: number, used: number): Best => {
    const key = `${i}:${used}`;
    if (memo.has(key)) return memo.get(key)!;
    let best: Best = null;
    const s = points[i]!;
    for (let j = i + 1; j < points.length; j++) {
      const len = points[j]! - s;
      if (len < S.cut.minMs) continue;
      if (len > S.cut.maxMs) break;
      const spent = used + len + CUTAWAY_FRAME_SLACK_MS;
      if (spent > capacityMs) break;
      const e = points[j]!;
      const cutCost = ((len - S.cut.targetMs) / 1000) ** 2;
      if (end - e >= S.head.minMs)
        best = better(best, { cost: cutCost, cuts: [[s, e]], cutMs: len });
      for (let k = j + 1; k < points.length; k++) {
        const head = points[k]! - e;
        if (head < S.head.minMs) continue;
        if (head > S.head.softMaxMs) break;
        const rest = fromCut(k, spent);
        if (rest) {
          best = better(best, {
            cost: cutCost + ((head - S.head.targetMs) / 1000) ** 2 + rest.cost,
            cuts: [[s, e], ...rest.cuts],
            cutMs: len + rest.cutMs,
          });
        }
      }
    }
    memo.set(key, best);
    return best;
  };
  return fromCut(0, 0);
}

/** A slot's demo window as stored: the VO span it covers and where in the demo it starts. */
export interface CutawayWindow {
  fromMs: number;
  toMs: number;
  demoStartMs: number;
}

/**
 * The invariants every stored window keeps, checked where a window is written
 * (draft, the customer's edit) and again at enqueue: inside the recording's
 * examined span, and no two overlapping — so no footage ever repeats. Lengths
 * and order are the layout's and are checked by `cutawayLayoutError`. Null = valid.
 */
export function cutawayWindowsError(
  windows: CutawayWindow[],
  recordingEndMs: number,
): string | null {
  const spans = windows.map((w) => ({
    start: w.demoStartMs,
    end: w.demoStartMs + (w.toMs - w.fromMs) + CUTAWAY_FRAME_SLACK_MS,
  }));
  for (const [i, span] of spans.entries()) {
    if (!Number.isFinite(span.start) || span.start < CUTAWAY_EDGE_MS) {
      return `cutaway ${i + 1} starts before the recording's first ${CUTAWAY_EDGE_MS} ms`;
    }
    if (span.end > recordingEndMs - CUTAWAY_EDGE_MS) {
      return `cutaway ${i + 1} runs past the recording's end`;
    }
  }
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.start < sorted[i - 1]!.end) return "two cutaways show the same footage";
  }
  return null;
}

/**
 * The layout's own invariants, for a slot list read back from storage (a row
 * written by an older build, or edited by hand): lengths inside the structure,
 * in order, after the first-cut floor, ending on a head. Null = valid.
 */
export function cutawayLayoutError(
  slots: { fromMs: number; toMs: number }[],
  opts: { voDurationMs: number; captionOffsetMs: number; hookTextMs: number },
): string | null {
  const S = CUTAWAY_ALTERNATE;
  if (slots.length === 0) return "no cutaways";
  const firstFloor = Math.max(S.firstCutMinMs, opts.hookTextMs) - opts.captionOffsetMs;
  if (slots[0]!.fromMs < firstFloor) return "the first cutaway starts before the hook text leaves";
  let prevEnd = -Infinity;
  for (const [i, slot] of slots.entries()) {
    const len = slot.toMs - slot.fromMs;
    if (len < S.cut.minMs || len > S.cut.maxMs) return `cutaway ${i + 1} is ${len} ms long`;
    if (slot.fromMs - prevEnd < S.head.minMs && i > 0) {
      return `the head between cutaways ${i} and ${i + 1} is too short`;
    }
    prevEnd = slot.toMs;
  }
  if (opts.voDurationMs - prevEnd < S.head.minMs) return "the ad must end on the character";
  return null;
}

/**
 * What the render can still play, never throwing — this runs after HeyGen has
 * been paid. A window running past the probed video stream shifts earlier,
 * keeping its length (the slot's length is fixed by the voice); one that cannot
 * fit, or that would now overlap another, or that starts before the hook text
 * leaves (a lead-in retune between the draft and the render), is dropped.
 * Returns the kept windows and what was dropped, for the log.
 */
export function clampCutawaysForRender(
  windows: CutawayWindow[],
  opts: { videoEndMs: number; captionOffsetMs: number; hookTextMs: number },
): { kept: CutawayWindow[]; dropped: { index: number; why: string }[]; shifted: number[] } {
  const kept: CutawayWindow[] = [];
  const dropped: { index: number; why: string }[] = [];
  const shifted: number[] = [];
  const footprintEnd = (w: CutawayWindow) =>
    w.demoStartMs + (w.toMs - w.fromMs) + CUTAWAY_FRAME_SLACK_MS;
  for (const [index, w] of windows.entries()) {
    if (![w.fromMs, w.toMs, w.demoStartMs].every(Number.isFinite) || w.toMs <= w.fromMs) {
      dropped.push({ index, why: "malformed" });
      continue;
    }
    if (w.fromMs + opts.captionOffsetMs < opts.hookTextMs) {
      dropped.push({ index, why: "starts before the hook text leaves" });
      continue;
    }
    const len = w.toMs - w.fromMs;
    const latestStart = opts.videoEndMs - len - CUTAWAY_FRAME_SLACK_MS;
    let demoStartMs = Math.max(0, w.demoStartMs);
    if (demoStartMs > latestStart) {
      if (latestStart < 0) {
        dropped.push({ index, why: "the demo is shorter than the cutaway" });
        continue;
      }
      demoStartMs = latestStart;
      shifted.push(index);
    }
    const candidate = { ...w, demoStartMs };
    if (
      kept.some((k) => demoStartMs < footprintEnd(k) && k.demoStartMs < footprintEnd(candidate))
    ) {
      dropped.push({ index, why: "overlaps another cutaway after clamping" });
      continue;
    }
    kept.push(candidate);
  }
  return { kept, dropped, shifted };
}
