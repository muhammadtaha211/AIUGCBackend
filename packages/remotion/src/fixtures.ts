import { FPS, type CaptionChunk } from "./schema";
import { msToFrame } from "./timing";

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

/**
 * Length of the placeholder talking head AND of the fixture voiceover — the
 * fixtures stand in for a lip-sync clip and the approved mp3 it was driven by,
 * so they have to be the same length. Half a second of tail after the last
 * caption, as a real VO has.
 */
export const sampleDurationInFrames =
  msToFrame(sampleCaptions[sampleCaptions.length - 1]!.endMs) + FPS / 2;

/**
 * Preview steps for the lavfi clock demo (fixtures/steps-demo.mp4, 24s): six
 * windows in the 12–17s target shape. The demo's on-screen clock jumps at
 * every cut, so a wrong trim is visible by eye, and the last step's window
 * overruns the demo (21s + 3.5s > 24s) so the end-clamp genuinely binds —
 * the sample ends exactly on the demo's final frame.
 */
export const sampleSteps = [
  { startMs: 1000, durationMs: 1800, label: "נכנסים לאפליקציה" },
  { startMs: 5000, durationMs: 1600, label: "בוחרים מוצר" },
  { startMs: 9000, durationMs: 2200, label: "מוסיפים לסל" },
  { startMs: 13_000, durationMs: 2200, label: "ממלאים פרטים" },
  { startMs: 17_000, durationMs: 1600, label: "מאשרים הזמנה" },
  { startMs: 21_000, durationMs: 3500, label: "וזהו, ההזמנה בדרך" },
];
