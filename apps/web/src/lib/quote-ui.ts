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

const formatSeconds = (seconds: number): string => `${Math.round(seconds * 10) / 10}`;

/** THE price sentence. One phrasing for both services — do not fork it. */
export function quoteLine(quote: NonNullable<QuoteView>): string {
  return `היצירה תעלה ${quote.credits} קרדיטים. היתרה שלכם: ${quote.balance}.`;
}

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
 * Hook studio: shown only when the chosen line is not among the five currently
 * on screen (after a reroll), so the pick stays visible and stays selected.
 * `אפשרויות אחרות` = "the other ones", not `אפשרויות נוספות` ("additional") —
 * the five below are alternatives to the pick, not extras on top of it.
 */
export const HOOK_LINE_CHOSEN_LABEL = "המשפט שבחרתם";
export const HOOK_LINE_OTHERS_LABEL = "אפשרויות אחרות";

/** The wizard-entry gate: an empty balance, before any work is done. */
export const NO_CREDITS_TITLE = "אין קרדיטים בחשבון";
export const NO_CREDITS_BODY =
  "כדי ליצור סרטון צריך קרדיטים בחשבון. פנו אלינו ונטעין לכם — ואז אפשר להתחיל.";
