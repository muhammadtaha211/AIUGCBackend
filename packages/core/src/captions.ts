/**
 * Caption timing logic — pure functions, no I/O.
 *
 * Voiced variant: word timings (from ElevenLabs character alignment or WhisperX
 * forced alignment) are grouped into 2–4 word karaoke-style chunks.
 * Silent variant: benefit captions are spaced evenly across the demo duration.
 */

export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
}

export interface CaptionChunk {
  text: string;
  startMs: number;
  endMs: number;
  words: WordTiming[];
}

/** Character-level alignment, normalized to milliseconds (ElevenLabs returns seconds). */
export interface CharAlignment {
  characters: string[];
  startTimesMs: number[];
  endTimesMs: number[];
}

export function wordsFromCharAlignment(alignment: CharAlignment): WordTiming[] {
  const words: WordTiming[] = [];
  let current = "";
  let startMs = 0;
  let endMs = 0;

  for (let i = 0; i < alignment.characters.length; i++) {
    const ch = alignment.characters[i]!;
    if (/\s/.test(ch)) {
      if (current) words.push({ word: current, startMs, endMs });
      current = "";
    } else {
      if (!current) startMs = alignment.startTimesMs[i]!;
      current += ch;
      endMs = alignment.endTimesMs[i]!;
    }
  }
  if (current) words.push({ word: current, startMs, endMs });
  return words;
}

/**
 * Drop ElevenLabs v3 audio tags ("[sighs]") from word timings before chunking:
 * alignment is computed over the SENT text, but tags are not spoken words and
 * must never reach a caption. `wordsFromCharAlignment` splits on whitespace, so
 * a multi-word tag arrives as "[short" + "pause]" — whole SPANS are dropped,
 * from the token opening the bracket through the token closing it, ignoring
 * punctuation stuck to either end ("…[sighs]", "[excited]!").
 * An unclosed "[" is not a tag: those words are kept.
 */
export function stripTagWords(words: WordTiming[]): WordTiming[] {
  const kept: WordTiming[] = [];
  let open: WordTiming[] | undefined;

  for (const w of words) {
    const token = w.word.replace(/^[^\p{L}\p{N}[\]]+|[^\p{L}\p{N}[\]]+$/gu, "");
    if (open) {
      open.push(w);
      if (token.endsWith("]")) open = undefined; // span closed -> whole span dropped
    } else if (token.startsWith("[")) {
      if (!token.endsWith("]")) open = [w];
    } else {
      kept.push(w);
    }
  }
  if (open) kept.push(...open);
  return kept;
}

/**
 * Group words into karaoke chunks of 2–4 words (spec: locked decision).
 * Base size 3; the remainder is absorbed so no chunk has a single orphan word
 * (a 1-word input is the only case that yields a 1-word chunk).
 */
export function chunkWords(words: WordTiming[]): CaptionChunk[] {
  const sizes: number[] = [];
  let remaining = words.length;
  while (remaining > 0) {
    if (remaining === 4 || remaining === 2) {
      sizes.push(remaining === 4 ? 4 : 2);
      remaining = 0;
    } else if (remaining === 1) {
      // absorb the orphan into the previous chunk (or emit alone if it's all we have)
      if (sizes.length > 0 && sizes[sizes.length - 1]! < 4) sizes[sizes.length - 1]!++;
      else sizes.push(1);
      remaining = 0;
    } else {
      sizes.push(3);
      remaining -= 3;
    }
  }

  const chunks: CaptionChunk[] = [];
  let idx = 0;
  for (const size of sizes) {
    const slice = words.slice(idx, idx + size);
    idx += size;
    chunks.push({
      text: slice.map((w) => w.word).join(" "),
      startMs: slice[0]!.startMs,
      endMs: slice[slice.length - 1]!.endMs,
      words: slice,
    });
  }
  return chunks;
}

/** Silent variant: captions spaced evenly across the demo duration. */
export function evenlySpacedCaptions(texts: string[], durationMs: number): CaptionChunk[] {
  const slot = durationMs / texts.length;
  return texts.map((text, i) => ({
    text,
    startMs: Math.round(i * slot),
    endMs: Math.round((i + 1) * slot),
    words: [],
  }));
}
