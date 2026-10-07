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

/** The fixture VO's length in ms — what the timelines below are built on. */
const sampleVoMs = (sampleDurationInFrames / FPS) * 1000;

/**
 * Service B layouts for the previews. These MIRROR @aiugc/core's
 * serviceBTimeline as literals — core depends on this package, never the
 * other way round — and core's service-b-timeline.test.ts asserts the
 * function reproduces them, so a drift here fails a test there.
 */

/** No opener, no lead-in: everything at 0 and the VO from frame 0 — the
 *  pre-opener preview, unchanged. */
export const sampleTimeline = {
  hookTextMs: 0,
  revealAbsMs: 0,
  lipsyncStartFromMs: 0,
  captionOffsetMs: 0,
  totalMs: sampleVoMs,
};

/**
 * With the 2.4s synthetic opener (fixtures/opener.mp4, reveal at 1.6s) and an
 * 800ms lead-in: the clip plays from 0 and the cut lands at 1600ms; the 4-word
 * hook text reads in 2000ms (400 + 4/2.5 s), so it outlives the cut by 400ms;
 * the clip starts 550ms in and the VO begins 250ms after the cut. The
 * placeholder talking head carries no lead-in of its own, so the VO tail sets
 * the end.
 */
export const sampleOpenerTimeline = {
  hookTextMs: 2000,
  revealAbsMs: 1600,
  lipsyncStartFromMs: 550,
  captionOffsetMs: 1850,
  totalMs: 1850 + sampleVoMs,
};

export const sampleHookText = "ככה מזמינים בלי לחכות";

/**
 * Service C preview text: a Latin brand name, a number and a question mark in
 * one Hebrew block, so the RTL check on the cropped frames (0059's lesson) has
 * every island it needs. ~28 words, inside the 25–40 aim.
 */
export const sampleTextBlock =
  "עשרים הודעות מלקוחות ב-8 בערב ואף אחד לא עונה? יש כלים כמו Sederly שעונים בשבילכם, ואתם רק מאשרים. אין לי מושג איך עשיתם את זה ידנית עד עכשיו, אבל שאפו.";

/** The quiz skeleton's shape: line breaks and numbered lines (mirrors core's example). */
export const sampleTextBlockQuiz =
  "רוב הישראלים לא עונים נכון אפילו על אחת מאלה\n\n1. איזו עיר בארץ הכי גבוהה מעל פני הים?\n2. מי היה ראש הממשלה השני של ישראל?\n3. מאיפה מגיע השם תל אביב?\n\n(עוד שאלות כאלה ב-Eretzy)";

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
