/**
 * Every new customer-facing Hebrew string this build adds, in one file, so the
 * founder can rewrite the copy in one place instead of hunting through
 * components. Pure and client-safe — no imports from @aiugc/core's main entry.
 *
 * ⚠️ COPY PENDING FOUNDER REVIEW. The numbers are correct and come from
 * @aiugc/core/pricing; the wording is a first draft.
 */

/**
 * The advisory quote as the API returns it. `null` = the admin bypass: nothing
 * is charged, so no credit line is rendered at all.
 */
export type QuoteView = { credits: number; balance: number; shortfall: number } | null;

/**
 * The steps quote, which carries its own breakdown: `credits` is what the
 * confirm costs, `render` the per-render flat, and `analysis` the demo
 * analysis — charged ONCE per demo, on the first render of it that is paid
 * for, so it is 0 on every recording the customer has already made an ad from.
 */
export type StepsQuoteView =
  | (NonNullable<QuoteView> & {
      render: number;
      analysis: number;
    })
  | null;

const formatSeconds = (seconds: number): string => `${Math.round(seconds * 10) / 10}`;

/** THE price sentence for B and voiced A. The steps format deliberately does
 *  NOT use it (founder ruling, 8e walkthrough): its price rides on the confirm
 *  button itself (stepsConfirmLabel) with a balance-only supporting line. */
export function quoteLine(quote: NonNullable<QuoteView>): string {
  return `היצירה תעלה ${quote.credits} קרדיטים. היתרה שלכם: ${quote.balance}.`;
}

/**
 * What the ending adds, as a clause Service A's shapeSummary appends so the
 * ending and its price read as one consequence instead of two facts on two
 * lines. Takes the DELTA the server already differenced (quoteASet), never an
 * outro component — components are ceiled as a sum, so a component is not a
 * price. `null` = admin bypass: no credits appear anywhere.
 */
export function endingCostClause(outroCredits: number | null): string {
  if (outroCredits === null) return "";
  if (outroCredits === 0) return " — כלול במחיר, בלי תוספת";
  return ` — תוספת של ${outroCredits} קרדיטים`;
}

/**
 * A narration that ends before the footage does. Names the consequence — the
 * tail of the video plays with no audio at all, because the demo is muted under
 * the voiceover — rather than judging the script, then names the one thing that
 * closes the gap. This is the only Service A outcome with nothing downstream to
 * fix it, which is why it, and not an overrun, is the state that gets attention.
 *
 * Two phrasings because the two steps know different things: the script step is
 * projecting from a word count, the audio step has measured the recording. Both
 * end on the same remedy.
 */
export const VO_SHORT_ESTIMATE_NOTICE =
  "לפי האורך הנוכחי, הקריינות תסתיים לפני סרטון המוצר, והחלק האחרון שלו יתנגן בלי קול. תסריט ארוך יותר ימלא אותו.";

export const VO_SHORT_MEASURED_NOTICE =
  "ההקלטה מסתיימת לפני סרטון המוצר, והחלק האחרון שלו יתנגן בלי קול. תסריט ארוך יותר ימלא אותו.";

/**
 * Shown INSTEAD of the price sentence when the balance doesn't cover it, with
 * confirm disabled. Quote-local — the balance page belongs to payments.
 */
export function shortfallLine(quote: NonNullable<QuoteView>): string {
  return `אין מספיק קרדיטים ליצירה הזאת — צריך ${quote.credits}, יש ${quote.balance}. חסרים ${quote.shortfall}.`;
}

/** Service B's one-line shape summary (A has its own, richer, in service-a-ui). */
export function bShapeSummary(voSeconds: number): string {
  return `סרטון דמות באורך ${formatSeconds(voSeconds)} שנ׳, לפי ההקלטה שאישרתם.`;
}

export function hasShortfall(quote: QuoteView): boolean {
  return quote !== null && quote.shortfall > 0;
}

/**
 * Why the confirm button says 5 and not 3: the first ad off a new recording
 * also pays for analysing it. `null` = nothing to explain — either the admin
 * bypass, or a recording that has already been paid for once, where the price
 * IS the plain number on the button and a breakdown would only add noise.
 *
 * The second sentence is the format's whole pitch, said at the one moment the
 * customer is looking at the number: the analysis is bought once, the variants
 * after it are not.
 */
export function stepsPriceBreakdown(quote: StepsQuoteView): string | null {
  if (quote === null || quote.analysis <= 0) return null;
  return `${quote.credits} קרדיטים: ${quote.render} לסרטון + ${quote.analysis} על ניתוח ההקלטה. כל מודעה נוספת מאותה הקלטה תעלה ${quote.render}.`;
}

/**
 * The demo step's reuse nudge. The number is the analysis part of a quote for
 * a demo that does not exist yet (the quote route with no `demoId`) — never a
 * literal here, because the price is config and moves without a deploy.
 * `null` = the admin bypass, or a row that quotes no analysis at all: then the
 * sentence is the original one, about time only.
 *
 * `במודעה הראשונה שתיצרו ממנו` is load-bearing and was not in the first draft.
 * The exemption is keyed on a PAID render, but the list this sentence points at
 * shows every READY demo — analysed, not necessarily rendered from. Without the
 * clause, "pick it from the list" reads as a promise to save the credits, which
 * for an uploaded-but-never-rendered demo is false, and the render step would
 * then contradict it with a quote of 3 + 2.
 */
export function newDemoNudge(analysisCredits: number | null): string {
  if (analysisCredits === null || analysisCredits <= 0) {
    return "כל סרטון חדש עובר ניתוח מלא שלוקח כמה דקות — אם כבר העליתם את הסרטון, בחרו אותו מהרשימה למעלה.";
  }
  return `כל סרטון חדש עובר ניתוח מלא שלוקח כמה דקות, ועולה ${analysisCredits} קרדיטים נוספים במודעה הראשונה שתיצרו ממנו — אם כבר העליתם את הסרטון, בחרו אותו מהרשימה למעלה.`;
}

/**
 * Hook studio: shown only when the chosen line is not among the five currently
 * on screen (after a reroll), so the pick stays visible and stays selected.
 * `אפשרויות אחרות` = "the other ones", not `אפשרויות נוספות` ("additional") —
 * the five below are alternatives to the pick, not extras on top of it.
 */
export const HOOK_LINE_CHOSEN_LABEL = "המשפט שבחרתם";
export const HOOK_LINE_OTHERS_LABEL = "אפשרויות אחרות";

/**
 * The audio gate shows what is being approved: the exact text in the recording,
 * read-only. Editing it means new audio, which is the script step's job.
 */
export const AUDIO_SCRIPT_LABEL = "הטקסט שבהקלטה";

/**
 * Shown above that text only when the server's script differs from the one the
 * wizard carried in — the customer read one thing on the script step and is
 * about to approve another. Names the swap instead of quietly displaying it.
 */
export const AUDIO_SCRIPT_CHANGED_NOTICE =
  "שימו לב: התסריט התעדכן מאז שכתבתם אותו. זה הטקסט שנמצא בהקלטה — קראו אותו לפני שמאשרים.";

/** The wizard-entry gate: an empty balance, before any work is done. */
export const NO_CREDITS_TITLE = "אין קרדיטים בחשבון";
export const NO_CREDITS_BODY =
  "כדי ליצור סרטון צריך קרדיטים בחשבון. פנו אלינו ונטעין לכם — ואז אפשר להתחיל.";
