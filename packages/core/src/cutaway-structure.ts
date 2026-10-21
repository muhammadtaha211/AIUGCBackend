import { z } from "zod";
import type { CaptionChunk } from "./captions";
import { tokenizeWords } from "./plan-format";
import { hookHandoffMs } from "./service-b-timeline";

/**
 * Service B demo cutaways (vault 0120 §4, 0121, 0122): the ad opens on the
 * character, cuts to stretches of the customer's own analysed demo and back,
 * and ends on the character, while the voice and the captions run straight
 * through.
 *
 * Pure and client-safe (the "@aiugc/core/cutaway-structure" subpath): the
 * wizard places, moves and checks clips with the same functions the server
 * validates and enqueues with.
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
 * "alternate": head → demo → head → … → head. The DRAFT's rule; a customer's
 * own edits answer only to cutawayEditError (founder, 2026-10-21: "inform,
 * never restrict"). CHOSEN within his rules, none measured:
 *
 * - The first cut: never before the script first names the product
 *   (productMention), nor before the hook text leaves; then the earliest
 *   chunk start within head.maxMs of that floor that lays out (vault 0122,
 *   replacing 0121's "first cut ≥ 3000 ms"). Before it the character talks
 *   alone, however long the intro runs.
 * - cut: the founder's "4–6 seconds each".
 * - head min 1000: one chunk — a shorter return reads as a flash, and with
 *   1500 one of his real audios had no layout on chunk starts at all.
 * - head max 5000, softMax 5500: "about 5 s" after the mention — the soft max
 *   only when no layout fits under 5000. It is also where the wizard's
 *   long-run note starts, so a draft never trips its own note.
 */
export const CUTAWAY_ALTERNATE = {
  cut: { minMs: 4000, targetMs: 5000, maxMs: 6000 },
  head: { minMs: 1000, targetMs: 2500, maxMs: 5000, softMaxMs: 5500 },
} as const;

/** At most this many clips on one plan — one letter and one colour each (0122). */
export const CUTAWAY_MAX_SLOTS = 8;

/**
 * No name heard: the mention is taken at this share of the voice — the rate
 * the founder observed (PLANNING DEFAULT, 2026-10-21).
 */
export const MENTION_FALLBACK_SHARE = 0.4;

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
 * caption line (the first cut always stays on a chunk start) — 3 of the
 * founder's 15 distinct audios (2026-10-20) had a 2.5–2.8 s caption line
 * exactly where a cut had to land, so chunk starts alone gave them no
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
  /** VO time of the phrase where the script first names the product (productMention). */
  mentionMs: number;
  /** Demo time available for cutaways (Infinity = unbounded). */
  capacityMs: number;
}

/** Where a cut may land: caption-chunk starts, and every word start (a superset). */
export function cutawayCutPoints(captions: CaptionChunk[]): { chunks: number[]; words: number[] } {
  const sorted = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);
  const chunks = sorted(captions.map((c) => c.startMs));
  return {
    chunks,
    words: sorted([...chunks, ...captions.flatMap((c) => (c.words ?? []).map((w) => w.startMs))]),
  };
}

/**
 * The cut points: caption-chunk starts first, so every cut lands on a phrase
 * and the caption change and the picture change share a frame (the founder's
 * done-criterion, 2026-10-20). The first cut is a chunk start at or after the
 * floor — the product mention, or the hook text leaving if that is later — and
 * within head.maxMs of it; the earliest that lays out wins. A memoised search
 * from there for the layout nearest the targets, in tiers: heads ≤ 5000, then
 * ≤ 5500; then — only when the demo is the reason — the longest fitting prefix
 * ending on a head of any length ("a demo too short for the slots gets fewer
 * slots, never repeated footage"). Nothing fits: no slots, and the reason why.
 */
export function cutawayLayout(input: CutawayLayoutInput): CutawayLayout {
  const S = CUTAWAY_ALTERNATE;
  const end = input.voDurationMs;
  const floor = Math.max(input.mentionMs, input.hookTextMs - input.captionOffsetMs);
  const points = cutawayCutPoints(input.captions);
  const chunkStarts = points.chunks.filter((p) => p > 0 && p < end);
  const firstCuts = chunkStarts.filter((p) => p >= floor && p <= floor + S.head.maxMs);
  const firstCut = firstCuts[0];
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

  const wordStarts = points.words.filter((p) => p >= firstCut && p < end);
  const chunkPoints = chunkStarts.filter((p) => p >= firstCut);

  /**
   * The best layout from the earliest first cut that has one. `fromCut(i,
   * used, left)` is the best continuation from a cutaway starting at points[i],
   * with `used` demo ms already spent and at most `left` cutaways to go — a
   * plan holds CUTAWAY_MAX_SLOTS, one letter and colour each. `openEnd`: the
   * capacity tier, where the ad may end on a head of any length after any cutaway.
   */
  const search = (pts: number[], headMax: number, openEnd: boolean): Best => {
    const memo = new Map<string, Best>();
    const fromCut = (i: number, used: number, left: number): Best => {
      // Unbounded capacity: the continuation cannot depend on what was spent.
      const key = Number.isFinite(input.capacityMs) ? `${i}:${used}:${left}` : `${i}:${left}`;
      if (memo.has(key)) return memo.get(key)!;
      let best: Best = null;
      const s = pts[i]!;
      for (let j = i + 1; j < pts.length; j++) {
        const len = pts[j]! - s;
        if (len < S.cut.minMs) continue;
        if (len > S.cut.maxMs) break;
        const spent = used + len + CUTAWAY_FRAME_SLACK_MS;
        if (spent > input.capacityMs) break;
        const cutCost = sq(len, S.cut.targetMs);
        const e = pts[j]!;
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
        for (let k = j + 1; left > 1 && k < pts.length; k++) {
          const head = pts[k]! - e;
          if (head < S.head.minMs) continue;
          if (head > headMax) break;
          const rest = fromCut(k, spent, left - 1);
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
    for (const first of firstCuts) {
      const found = fromCut(pts.indexOf(first), 0, CUTAWAY_MAX_SLOTS);
      if (found) return found;
    }
    return null;
  };

  let found: Best = null;
  let tier: CutawayLayoutTier = "strict";
  for (const [pts, headMax, name] of [
    [chunkPoints, S.head.maxMs, "strict"],
    [chunkPoints, S.head.softMaxMs, "soft"],
    [wordStarts, S.head.maxMs, "words"],
    [wordStarts, S.head.softMaxMs, "words_soft"],
  ] as const) {
    found = search(pts, headMax, false);
    if (found) {
      tier = name;
      break;
    }
  }
  if (!found && Number.isFinite(input.capacityMs)) {
    // Is the demo the reason? Only then may a head run long at the end.
    const unbounded = cutawayLayout({ ...input, capacityMs: Number.POSITIVE_INFINITY });
    if (unbounded.slots.length > 0) {
      // Chunk starts first here too: a word start only when no chunk-start prefix fits.
      const prefixes =
        searchLongestPrefix(chunkPoints, firstCuts, end, input.capacityMs) ??
        searchLongestPrefix(wordStarts, firstCuts, end, input.capacityMs);
      if (prefixes) {
        found = prefixes;
        tier = "capacity";
      }
    }
  }
  if (!found) return { slots: [], reason: "no_layout" };

  return {
    tier,
    firstCutMs: found.cuts[0]![0]!,
    slots: found.cuts.map(([fromMs, toMs]) => ({
      fromMs: fromMs!,
      toMs: toMs!,
      ...cutawayWordSpan(input.captions, fromMs!, toMs!),
    })),
  };
}

/** The words a VO span covers: [wordFrom, wordTo) into captions.flatMap(c => c.words). */
export function cutawayWordSpan(
  captions: CaptionChunk[],
  fromMs: number,
  toMs: number,
): { wordFrom: number; wordTo: number } {
  const words = captions.flatMap((c) => c.words ?? []);
  const wordAt = (ms: number) => {
    const i = words.findIndex((w) => w.startMs >= ms);
    return i === -1 ? words.length : i;
  };
  return { wordFrom: wordAt(fromMs), wordTo: wordAt(toMs) };
}

/**
 * The capacity tier: the most cutaway time that fits the demo, every head
 * between cutaways inside the soft max, the last head any length ≥ the
 * minimum. Ties go to the layout nearest the targets. From the earliest first
 * cut that has one.
 */
function searchLongestPrefix(
  points: number[],
  firstCuts: number[],
  end: number,
  capacityMs: number,
): { cost: number; cuts: number[][]; cutMs: number } | null {
  const S = CUTAWAY_ALTERNATE;
  type Best = { cost: number; cuts: number[][]; cutMs: number } | null;
  const better = (a: Best, b: Best): Best =>
    !a ? b : !b ? a : b.cutMs !== a.cutMs ? (b.cutMs > a.cutMs ? b : a) : b.cost < a.cost ? b : a;
  const memo = new Map<string, Best>();
  const fromCut = (i: number, used: number, left: number): Best => {
    const key = `${i}:${used}:${left}`;
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
      for (let k = j + 1; left > 1 && k < points.length; k++) {
        const head = points[k]! - e;
        if (head < S.head.minMs) continue;
        if (head > S.head.softMaxMs) break;
        const rest = fromCut(k, spent, left - 1);
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
  for (const first of firstCuts) {
    const found = fromCut(points.indexOf(first), 0, CUTAWAY_MAX_SLOTS);
    if (found) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The product mention (vault 0122)
// ---------------------------------------------------------------------------

export type MentionMethod = "product_name" | "business_name" | "share";

export interface ProductMention {
  /** VO start of the caption phrase where the name is first spoken — the draft's floor. */
  ms: number;
  /** The word the name starts on (the share fallback: its phrase's first word). */
  wordIndex: number;
  method: MentionMethod;
  /** How many times the chosen name is spoken; 0 for the share fallback. */
  count: number;
}

/** Single-letter prefixes Hebrew glues onto a word (ו/ה/ב/ל/מ/ש/כ). */
const HEBREW_PREFIXES = new Set(["ו", "ה", "ב", "ל", "מ", "ש", "כ"]);

/** A SPOKEN token and its forms with up to two prefix letters stripped. */
function spokenForms(token: string): string[] {
  const forms = [token];
  let current = token;
  for (let i = 0; i < 2 && current.length > 2 && HEBREW_PREFIXES.has(current[0]!); i++) {
    current = current.slice(1);
    forms.push(current);
  }
  return forms;
}

/**
 * Where the script first talks about the product, read off the words the
 * customer approved — no model call (PLANNING DEFAULT, 2026-10-21): the first
 * caption phrase holding the questionnaire's product_name or the business's
 * name, whichever is spoken first; else the first phrase at 40% of the voice.
 *
 * b_script (v17) says the product_name "exactly as written, once, and late",
 * in its reveal beat, so the name match finds that beat on the audio itself —
 * edits included, which a field written at script time would not survive.
 *
 * Names match as token sequences (`Tavnit.ai` = `tavnit ai`). A spoken token
 * may carry up to two Hebrew prefix letters (`לעולא` holds `עולא`); the name is
 * never stripped, so a common word cannot shrink into a match (`ממש` is not
 * `שמש`). A business-name match, and a one-token name of three letters or
 * fewer, must be exact: b_script never asks for the business name, so a hit
 * there is the likelier coincidence.
 */
export function productMention(
  captions: CaptionChunk[],
  names: { productName?: string | null; businessName?: string | null },
  voDurationMs: number,
): ProductMention {
  const spoken: { token: string; word: number; chunk: number }[] = [];
  let word = 0;
  for (const [chunk, c] of captions.entries()) {
    for (const w of c.words ?? []) {
      for (const token of tokenizeWords(w.word)) spoken.push({ token, word, chunk });
      word++;
    }
  }
  const hits = (name: string | null | undefined, exact: boolean) => {
    const parts = tokenizeWords(name ?? "");
    if (parts.length === 0) return [];
    const strict = exact || (parts.length === 1 && parts[0]!.length <= 3);
    const found: (typeof spoken)[number][] = [];
    for (let i = 0; i + parts.length <= spoken.length; i++) {
      const head = strict ? [spoken[i]!.token] : spokenForms(spoken[i]!.token);
      if (!head.includes(parts[0]!)) continue;
      if (parts.slice(1).every((part, k) => spoken[i + 1 + k]!.token === part)) {
        found.push(spoken[i]!);
      }
    }
    return found;
  };
  const product = hits(names.productName, false);
  const business = hits(names.businessName, true);
  const useBusiness =
    business.length > 0 && (product.length === 0 || business[0]!.word < product[0]!.word);
  const chosen = useBusiness ? business : product;
  if (chosen.length > 0) {
    const first = chosen[0]!;
    return {
      ms: captions[first.chunk]!.startMs,
      wordIndex: first.word,
      method: useBusiness ? "business_name" : "product_name",
      count: chosen.length,
    };
  }
  const at = captions.findIndex((c) => c.startMs >= MENTION_FALLBACK_SHARE * voDurationMs);
  return {
    ms: at === -1 ? voDurationMs : captions[at]!.startMs,
    wordIndex: captions.slice(0, at === -1 ? captions.length : at).flatMap((c) => c.words ?? [])
      .length,
    method: "share",
    count: 0,
  };
}

/**
 * When the hook text leaves, in VO time: the floor every clip starts at or
 * after. '' (the "none" effect, or no line) is 0 — serviceBTimeline burns no
 * line then, which hookHandoffMs("") would not know.
 */
export function hookLeaveVoMs(
  hookText: string,
  captions: CaptionChunk[],
  captionOffsetMs: number,
): number {
  const text = hookText.trim();
  if (text === "") return 0;
  const leaves = hookHandoffMs(text, captions, captionOffsetMs);
  return leaves === undefined ? 0 : Math.max(0, leaves - captionOffsetMs);
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
 * examined span, and no two overlapping — so no footage ever repeats. Where
 * the windows sit in the SCRIPT is cutawayEditError's. Null = valid.
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
 * Where a clip that starts at `fromMs` ends: a cut point 4–6 s later and no
 * later than `limitMs` (the next clip's start, or the end of the voice) —
 * a chunk start when one is in reach, else a word start — the one nearest
 * fromMs + preferMs. A moved clip prefers its own length, so its footage can
 * stay; an added one the structure's target. Null: the phrase cannot hold a
 * clip. The length is never the customer's to set (founder, 2026-10-21).
 */
export function fitCutawayAt(
  captions: CaptionChunk[],
  fromMs: number,
  opts: { limitMs: number; preferMs: number },
): number | null {
  const S = CUTAWAY_ALTERNATE;
  const lo = fromMs + S.cut.minMs;
  const hi = Math.min(fromMs + S.cut.maxMs, opts.limitMs);
  const target = fromMs + opts.preferMs;
  const nearest = (points: number[]) => {
    let best: number | undefined;
    for (const p of points) {
      if (p < lo || p > hi) continue;
      if (best === undefined || Math.abs(p - target) < Math.abs(best - target)) best = p;
    }
    return best;
  };
  const points = cutawayCutPoints(captions);
  return nearest(points.chunks) ?? nearest(points.words) ?? null;
}

/**
 * What a customer's slot list must keep, and nothing more (founder,
 * 2026-10-21: "inform, never restrict" — the head rules are the draft's
 * alone): each clip starts and ends on a spoken word, is 4–6 s long, starts at
 * or after the hook text leaves and ends inside the voice, and no two overlap
 * in the script (touching is allowed). Slots in script order; none is fine —
 * that is today's head-only ad. The footage side is cutawayWindowsError's.
 * Null = valid.
 */
export function cutawayEditError(
  slots: { fromMs: number; toMs: number }[],
  opts: { captions: CaptionChunk[]; voDurationMs: number; hookLeaveVoMs: number },
): string | null {
  const S = CUTAWAY_ALTERNATE;
  if (slots.length > CUTAWAY_MAX_SLOTS) return `more than ${CUTAWAY_MAX_SLOTS} cutaways`;
  const points = new Set(cutawayCutPoints(opts.captions).words);
  let prevEnd = -Infinity;
  for (const [i, slot] of slots.entries()) {
    const n = i + 1;
    if (!points.has(slot.fromMs) || !points.has(slot.toMs)) {
      return `cutaway ${n} does not start and end on a spoken word`;
    }
    const len = slot.toMs - slot.fromMs;
    if (len < S.cut.minMs || len > S.cut.maxMs) return `cutaway ${n} is ${len} ms long`;
    if (slot.fromMs < opts.hookLeaveVoMs) return `cutaway ${n} starts before the hook text leaves`;
    if (slot.toMs >= opts.voDurationMs) return `cutaway ${n} runs past the voice`;
    if (slot.fromMs < prevEnd) return `cutaways ${n - 1} and ${n} overlap`;
    prevEnd = slot.toMs;
  }
  return null;
}

/** Where a window may start: the analysed demo's moments, and the span they must stay inside. */
export interface CutawayFootage {
  anchors: { startMs: number; stateIndex: number }[];
  /** A window starts at or after this, and ends (with the frame slack) by maxEndMs. */
  minStartMs: number;
  maxEndMs: number;
}

/**
 * Where a window of `lengthMs` may start, sorted: a moment whose window stays
 * inside the recording and shows none of the footage the `others` show. The
 * window picker snaps to these and nothing else, so what the customer can drag
 * to is exactly what the server accepts.
 */
export function cutawayWindowStarts(
  footage: CutawayFootage,
  lengthMs: number,
  others: { demoStartMs: number; lengthMs: number }[],
): number[] {
  const endOf = (start: number, length: number) => start + length + CUTAWAY_FRAME_SLACK_MS;
  const valid = new Set<number>();
  for (const { startMs } of footage.anchors) {
    if (startMs < footage.minStartMs || endOf(startMs, lengthMs) > footage.maxEndMs) continue;
    const clear = others.every(
      (o) =>
        endOf(startMs, lengthMs) <= o.demoStartMs || endOf(o.demoStartMs, o.lengthMs) <= startMs,
    );
    if (clear) valid.add(startMs);
  }
  return [...valid].sort((a, b) => a - b);
}

/** The valid start nearest `targetMs` (the earlier on a tie). */
export function snapCutawayStart(valid: number[], targetMs: number): number | undefined {
  let best: number | undefined;
  for (const start of valid) {
    if (best === undefined || Math.abs(start - targetMs) < Math.abs(best - targetMs)) best = start;
  }
  return best;
}

/**
 * The founder's rule for a hook text that grows into a clip (2026-10-21): the
 * clip moves to the next phrase after the hook text, keeping its footage where
 * it can; "nothing the customer placed is deleted" — so this is DERIVED, never
 * written: the stored slots stay where the customer put them, and a shorter
 * hook text brings the clip back. Each clip starting before `hookLeaveVoMs`
 * goes, in script order, to the first phrase at or after it that holds it
 * without overlapping a clip already placed, at the length nearest its own,
 * on its own window if that still fits, else the nearest one that does. A
 * clip no phrase can hold — script or footage — is dropped: the one case the
 * rule yields (PLANNING DEFAULT), and the wizard says so. Runs in the effect
 * step for its line and in resolveCutawaysForRender before the copy. Sorted.
 */
export function clearHookText<
  T extends {
    id: number;
    fromMs: number;
    toMs: number;
    demoStartMs: number;
    stateIndex: number | null;
  },
>(
  slots: T[],
  opts: {
    captions: CaptionChunk[];
    voDurationMs: number;
    hookLeaveVoMs: number;
    footage: CutawayFootage;
  },
): { slots: T[]; moved: number[]; dropped: number[] } {
  const byStart = (a: { fromMs: number }, b: { fromMs: number }) => a.fromMs - b.fromMs;
  const sorted = [...slots].sort(byStart);
  const placed = sorted.filter((s) => s.fromMs >= opts.hookLeaveVoMs);
  const late = sorted.filter((s) => s.fromMs < opts.hookLeaveVoMs);
  const moved: number[] = [];
  const dropped: number[] = [];
  const phrases = cutawayCutPoints(opts.captions).chunks.filter((p) => p >= opts.hookLeaveVoMs);
  for (const slot of late) {
    let next: T | undefined;
    for (const fromMs of phrases) {
      if (placed.some((o) => fromMs >= o.fromMs && fromMs < o.toMs)) continue;
      const limitMs = Math.min(
        opts.voDurationMs,
        ...placed.filter((o) => o.fromMs > fromMs).map((o) => o.fromMs),
      );
      const toMs = fitCutawayAt(opts.captions, fromMs, {
        limitMs,
        preferMs: slot.toMs - slot.fromMs,
      });
      if (toMs === null) continue;
      const valid = cutawayWindowStarts(
        opts.footage,
        toMs - fromMs,
        placed.map((o) => ({ demoStartMs: o.demoStartMs, lengthMs: o.toMs - o.fromMs })),
      );
      const demoStartMs = valid.includes(slot.demoStartMs)
        ? slot.demoStartMs
        : snapCutawayStart(valid, slot.demoStartMs);
      if (demoStartMs === undefined) continue;
      const stateIndex =
        demoStartMs === slot.demoStartMs
          ? slot.stateIndex
          : (opts.footage.anchors.find((a) => a.startMs === demoStartMs)?.stateIndex ?? null);
      next = { ...slot, fromMs, toMs, demoStartMs, stateIndex };
      break;
    }
    if (next) {
      placed.push(next);
      placed.sort(byStart);
      moved.push(slot.id);
    } else {
      dropped.push(slot.id);
    }
  }
  return { slots: placed, moved, dropped };
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
