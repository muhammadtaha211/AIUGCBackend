import type { CaptionChunk } from "./schema";

/**
 * Founder preview fixture: a realistic Hebrew VO script shaped exactly like
 * `chunkWords` output from @aiugc/core (2–4 word chunks, per-word timings).
 * Includes a numeral so the bidi isolation of LTR islands is visible in the
 * preview and not just in theory.
 */

const SCRIPT = [
  "היי",
  "אני",
  "מיכל",
  "שלוש",
  "שנים",
  "סבלתי",
  "מכאבי",
  "גב",
  "קשים",
  "עד",
  "שגיליתי",
  "את",
  "הכרית",
  "הזאת",
  "תוך",
  "7",
  "ימים",
  "הכאב",
  "פשוט",
  "נעלם",
  "לגמרי",
];

const GAP_MS = 40;

/** 3 words per chunk — the base case `chunkWords` produces. */
export const sampleCaptions: CaptionChunk[] = (() => {
  const chunks: CaptionChunk[] = [];
  let cursor = 250;
  for (let i = 0; i < SCRIPT.length; i += 3) {
    const words = SCRIPT.slice(i, i + 3).map((word) => {
      const startMs = cursor;
      const endMs = startMs + 180 + word.length * 45;
      cursor = endMs + GAP_MS;
      return { word, startMs, endMs };
    });
    chunks.push({
      text: words.map((w) => w.word).join(" "),
      startMs: words[0]!.startMs,
      endMs: words[words.length - 1]!.endMs,
      words,
    });
  }
  return chunks;
})();
