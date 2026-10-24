/**
 * The Instagram autopilot's Hebrew on the web (decision 0127): the setup page,
 * the calendar's mark and its skipped slots. Pure — no `@/` imports — so
 * client components and the string tests reach it directly; the pause lines are
 * core's `@aiugc/core/social-copy`, because the worker's email prints them too.
 *
 * Every line is a DRAFT for the founder's approval at PR review, in the app's
 * own words (סרטון, פרסום, חשבון — 0061).
 */
import { AUTOPILOT_NAME } from "@aiugc/core/social-copy";

export { AUTOPILOT_NAME };

export const AUTOPILOT_TITLE = AUTOPILOT_NAME;
export const AUTOPILOT_LEAD =
  "כל לילה תבנית מכינה את הסרטונים של היום ומתזמנת אותם לחשבונות שהפעלתם. מגדירים פעם אחת, ומשם זה רץ לבד.";
/** The calendar's link to the setup. */
export const AUTOPILOT_CALENDAR_LINK = "הגדרות האוטופיילוט";
/** The calendar's mark on an autopilot post. */
export const AUTOPILOT_MARK = "אוטו";
export const AUTOPILOT_MARK_TITLE = "פורסם על ידי האוטופיילוט";

export const SECTION_BUSINESS = "העסק";
export const SECTION_BUSINESS_HINT = "הסרטונים נעשים מסרטוני המוצר ומהשאלון של העסק הזה.";
export const SECTION_SOUNDS = "סאונדים";
export const SECTION_SOUNDS_HINT =
  "כל סרטון יוצא עם סאונד מהרשימה, לפי הסדר: קודם מה ששימש הכי מעט בחשבון. סאונד שאינסטגרם תסרב לו יוחלף בבא בתור.";
export const SOUND_ADD = "הוספה לרשימה";
export const SOUND_REMOVE = "הסרה";
export const SOUND_REFUSED = "אינסטגרם סירבה לסאונד הזה";
export const SOUNDS_EMPTY = "עוד אין סאונדים ברשימה.";
export const SOUNDS_NO_ACCOUNT =
  "כדי לחפש סאונדים צריך חשבון אינסטגרם מחובר. מתחברים מחדש בהגדרות.";

export const SECTION_ACCOUNTS = "החשבונות";
export const ACCOUNT_ON = "פועל";
export const ACCOUNT_OFF = "כבוי";
export const ACCOUNT_DISCONNECTED = "החיבור לחשבון פג. מתחברים מחדש בהגדרות.";
export const ACCOUNT_STARTS_NEXT_NIGHT = "מתחיל מהלילה הבא.";
export const FIELD_CHARACTERS = "דמויות";
export const FIELD_CHARACTERS_HINT = "רק הדמויות שנבחרו יופיעו בחשבון הזה. דמות יכולה להיות בחשבון אחד בלבד.";
export const FIELD_PER_DAY = "סרטונים ביום";
export const FIELD_DEMOS = "סרטוני מוצר";
export const FIELD_DEMOS_HINT = "הסרטונים עוברים ביניהם לפי הסדר.";
export const FIELD_TIMES = "שעות פרסום";
export const FIELD_TIMES_HINT = "שעון ישראל, בין 08:00 ל־23:55. כל סרטון ביום יוצא בשעה אחרת, מהמוקדמת.";
export const TIME_ADD = "הוספת שעה";
export const TIME_REMOVE = "הסרת השעה";
export const SAVE = "שמירה";
export const SAVED = "ההגדרות נשמרו.";
export const RESUME = "החזרה לפעולה";
export const PAUSED_LABEL = "האוטופיילוט עצר בחשבון הזה";
export const IN_USE_ELSEWHERE = "כבר בחשבון אחר";

export function clipsLine(n: number): string {
  return n === 1 ? "קטע הוק פעיל אחד" : `${n} קטעי הוק פעילים`;
}

export function perDayMaxLine(max: number): string {
  return max === 0
    ? "אין עדיין קטעי הוק לדמויות שנבחרו, אז החשבון לא יכול לפעול."
    : `עד ${max} ביום: אותו קטע הוק לא חוזר פעמיים באותו יום.`;
}

export type DemoNotReadyReason = "ingesting" | "rejected" | "no_approved_plan";

export const DEMO_NOT_READY: Record<DemoNotReadyReason, string> = {
  ingesting: "עדיין בעיבוד",
  rejected: "נפסל בבדיקה",
  no_approved_plan: "אין לו עדיין תוכנית מאושרת",
};

export const DEMO_UNNAMED = "סרטון בלי שם";

/** The calendar's skipped slot: why it did not go out. */
export const SKIPPED_LABEL = "דולג";

export function skipReasonLine(reason: string | null): string {
  switch (reason) {
    case "late":
      return "הסרטון לא היה מוכן בזמן.";
    case "render_failed":
      return "יצירת הסרטון נכשלה, גם בניסיון נוסף ובגרסה אחרת.";
    case "no_line":
      return "לא היה משפט פתיחה חדש לסרטון.";
    case "no_demo":
      return "אף סרטון מוצר של החשבון לא היה מוכן.";
    case "error":
      return "תקלה אצלנו מנעה את הסרטון.";
    default:
      return "הסרטון לא נוצר.";
  }
}

/** The save's refusals, by code (core's AutopilotSetupError). */
export function autopilotErrorLine(code: string, detail: { max?: number } = {}): string {
  switch (code) {
    case "business_not_owned":
    case "account_not_owned":
    case "demo_not_owned":
    case "not_found":
      return "לא נמצא.";
    case "bad_time":
      return "שעת פרסום צריכה להיות בין 08:00 ל־23:55, בקפיצות של 5 דקות, ובלי כפילויות.";
    case "too_many":
      return "אפשר עד 12 סרטונים ביום בחשבון.";
    case "count_over_times":
      return `יש פחות שעות פרסום מסרטונים ביום. אפשר עד ${detail.max ?? 0} לפי השעות.`;
    case "count_over_clips":
      return `לדמויות שנבחרו יש ${detail.max ?? 0} קטעי הוק פעילים, אז זה המספר הכי גדול ביום.`;
    case "character_on_two_accounts":
      return "דמות יכולה להיות בחשבון אחד בלבד.";
    case "character_unusable":
      return "אחת הדמויות שנבחרו לא זמינה.";
    case "nothing_to_post":
      return "כדי להפעיל חשבון צריך לפחות דמות אחת, סרטון מוצר אחד וסרטון אחד ביום.";
    case "no_usable_sound":
      return "כדי להפעיל חשבון צריך לפחות סאונד אחד ברשימה.";
    case "stale_pause":
      return "המצב של החשבון השתנה בינתיים. טוענים את הדף מחדש ומנסים שוב.";
    default:
      return "משהו השתבש. נסו שוב בעוד רגע.";
  }
}
