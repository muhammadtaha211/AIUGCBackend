/**
 * Every customer-facing line of the social-posting connect flow (decision
 * 0101, PR 2): the Integrations section in /home/settings, the Instagram
 * pre-screen, the callback's outcome lines and Meta's deletion status page.
 * Pure — no `@/` imports — so the string tests reach it directly.
 *
 * The lines come from the approved plan's Appendix A. Those marked DRAFT are
 * new in PR 2 (the singular forms Appendix A left implicit) or in the 0105
 * task (the outcome lines, the pre-screen by connect mode) and wait for the
 * founder's approval at PR review with the rest. 0061's rules: no reach or
 * results claim, the app's own vocabulary (חשבון, פרסום).
 */

import type { InstagramConnectMode } from "@aiugc/core";

export const SOCIAL_SECTION_TITLE = "חיבורים";
export const SOCIAL_SECTION_LEAD = "החשבונות שתבנית מפרסמת אליהם.";
export const INSTAGRAM_LABEL = "אינסטגרם";
export const SOCIAL_CONNECTED = "מחובר";
export const SOCIAL_EXPIRED = "פג תוקף — התחברו מחדש";
export const SOCIAL_CONNECT = "חיבור חשבון";
export const SOCIAL_ADD_ANOTHER = "הוספת חשבון";
export const SOCIAL_DISCONNECT = "ניתוק";
export const SOCIAL_CANCEL = "ביטול";
export const SOCIAL_CONTINUE = "המשך";
export const SOCIAL_EMPTY = "עוד אין חשבון מחובר.";

/**
 * A name inside a Hebrew sentence, bidi-isolated (FSI … PDI): an English
 * account name like "Yoga & Co." would otherwise lose its trailing period to
 * the sentence's direction. In strings only — markup uses <bdi>.
 */
export function isolated(name: string): string {
  return `⁨${name}⁩`;
}

/** What a row calls the account: its name, else its handle, else a plain noun. */
export function accountName(account: { displayName: string | null; username: string | null }) {
  return account.displayName ?? account.username ?? "החשבון";
}

/**
 * The disconnect confirm, as the dialog's title and body: Appendix A's one
 * line "לנתק את {name}? {n} פרסומים מתוזמנים לחשבון הזה יבוטלו." split at the
 * question mark, and no body when nothing is scheduled.
 */
export function disconnectConfirm(
  name: string,
  pending: number,
): { title: string; body: string | null } {
  const title = `לנתק את ${isolated(name)}?`;
  if (pending <= 0) return { title, body: null };
  // DRAFT: the singular.
  if (pending === 1) return { title, body: "פרסום מתוזמן אחד לחשבון הזה יבוטל." };
  return { title, body: `${pending} פרסומים מתוזמנים לחשבון הזה יבוטלו.` };
}

/** After a disconnect: the count is what the server actually cancelled. */
export function disconnectDoneLine(cancelled: number): string {
  // DRAFT: the zero and singular forms.
  if (cancelled <= 0) return "החשבון נותק.";
  if (cancelled === 1) return "החשבון נותק. פרסום מתוזמן אחד בוטל.";
  return `החשבון נותק. ${cancelled} פרסומים מתוזמנים בוטלו.`;
}

// The Facebook round trip's outcome, carried back to /home/settings as `?social=`.
// Each line says what happened and what to do (decision 0105) — never a bare "try again".

export function connectedLine(count: number, name: string | null): string {
  if (count === 1 && name) return `החשבון ${isolated(name)} חובר.`;
  return `${count} חשבונות חוברו.`;
}

/**
 * Where a customer links (or creates) the Page, in Meta's own Hebrew labels for
 * the Instagram app (Meta help 898752960195806, read 2026-10-12: "הקישו על דף
 * ולאחר מכן הקישו על חיבור או יצירה."). Meta documents no instagram.com path.
 * Meta's labels call a Page "דף"; Tavnit's own sentences keep "עמוד".
 */
const PAGE_LINK_PATH = "עריכת פרופיל ← דף ← חיבור או יצירה";

/** DRAFT (0105, 0106): the "what to do" half follows the Facebook window the mode opens. */
export function connectNoAccountLine(mode: InstagramConnectMode): string {
  return mode === "onboarding"
    ? "לא נמצא חשבון אינסטגרם מקצועי המקושר לעמוד פייסבוק. התחילו שוב, ובחלון של פייסבוק השלימו את המעבר לחשבון מקצועי, את יצירת העמוד ואת הקישור ביניהם לפני האישור."
    : `לא נמצא חשבון אינסטגרם מקצועי המקושר לעמוד פייסבוק. לכל חשבון צריך עמוד משלו: באפליקציית אינסטגרם, ${PAGE_LINK_PATH}. אחרי שקישרתם, התחילו שוב.`;
}

// DRAFT (0105): the refusals and failures, one line each.
export const CONNECT_EXPIRED =
  "עברה יותר מחצי שעה מאז שנפתח החלון של פייסבוק, ולכן החיבור לא נשמר. התחילו את החיבור שוב מכאן.";
export const CONNECT_MISMATCH =
  "החזרה מפייסבוק לא תאמה את החיבור שהתחיל כאן — אולי נפתח חיבור נוסף בחלון אחר, או שהחשבון בתבנית התחלף בינתיים. התחילו את החיבור שוב מכאן, בחלון אחד.";
export const CONNECT_CANCELLED =
  "החלון של פייסבוק נסגר בלי אישור, ולא חובר שום חשבון. אפשר להתחיל שוב בכל זמן.";
export const CONNECT_FAILED =
  "פייסבוק לא השלימה את החיבור, ולא חובר שום חשבון. נסו שוב בעוד כמה דקות.";

export type SocialOutcome = "connected" | "none" | "expired" | "mismatch" | "cancelled" | "error";
const OUTCOMES: readonly SocialOutcome[] = [
  "connected",
  "none",
  "expired",
  "mismatch",
  "cancelled",
  "error",
];

/** `?social=` as the callback writes it; anything else is no outcome at all. */
export function parseSocialOutcome(value: string | string[] | undefined): SocialOutcome | null {
  return OUTCOMES.find((outcome) => outcome === value) ?? null;
}

/** The line a failed or refused round trip lands on; `connected` has its own. */
export function connectOutcomeLine(
  outcome: Exclude<SocialOutcome, "connected">,
  mode: InstagramConnectMode,
): string {
  if (outcome === "none") return connectNoAccountLine(mode);
  if (outcome === "expired") return CONNECT_EXPIRED;
  if (outcome === "mismatch") return CONNECT_MISMATCH;
  if (outcome === "cancelled") return CONNECT_CANCELLED;
  return CONNECT_FAILED;
}

// The Instagram pre-screen, before Facebook's window opens.
export const PRESCREEN_TITLE = "חיבור אינסטגרם";
const PRESCREEN_PROFESSIONAL = "נדרש חשבון אינסטגרם מקצועי (עסקי או יוצר).";
const PRESCREEN_PAGE = "החשבון צריך להיות מקושר לעמוד פייסבוק — עמוד אחד לכל חשבון אינסטגרם.";
const PRESCREEN_FREE = "המעבר לחשבון מקצועי חינמי ומיידי, בהגדרות אינסטגרם.";
const PRESCREEN_WINDOW =
  "בלחיצה על המשך ייפתח חלון של פייסבוק לאישור. תבנית מקבלת הרשאה לראות את העמודים והחשבונות המקושרים ולפרסם אליהם.";
/**
 * DRAFT (0106), from the founder's runs of 2026-10-12. In the morning
 * "Continue" brought back only the account already connected, because the new
 * one had no Page; in the afternoon, with a Page linked by hand, confirm alone
 * added it. So the Page comes first, Continue is the default, and "Edit
 * settings" is only the way back for an account that did not return (a grant
 * that left its Page unticked). Facebook's button labels, in English as he saw
 * them, each kept on one line (a no-break space).
 */
const PRESCREEN_ADD_PAGE_FIRST =
  "לחשבון האינסטגרם החדש צריך עמוד פייסבוק משלו, מקושר אליו. בלי עמוד, פייסבוק מחזירה רק את החשבונות שכבר חוברו.";
const PRESCREEN_PAGE_HOW = `אין לחשבון עמוד? באפליקציית אינסטגרם בטלפון: ${PAGE_LINK_PATH}. אפשר לבחור עמוד קיים או ליצור עמוד חדש.`;
const PRESCREEN_ADD_CONTINUE = `אם פייסבוק מציעה להמשיך עם ההגדרות הקודמות, לחצו על ${isolated("Continue")}. אם החשבון החדש לא חזר, התחילו שוב, לחצו על ${isolated("Edit\u00a0settings")} וסמנו את העמוד והחשבון שלו.`;
/** DRAFT (0105): Facebook's review screen, as the founder saw it on 2026-10-12. */
const PRESCREEN_REVIEW =
  "במסך הסיכום פייסבוק כותבת שתבנית תוכל לנהל את כל מה שבתיק העסקי. תבנית משתמשת בהרשאה רק כדי למצוא את חשבונות האינסטגרם ולפרסם אליהם.";
/**
 * DRAFT (0105), from Meta's business-login-for-instagram page. Unused while
 * the one-window switch is off (0106); rewrite from the 2026-10-12 run if it
 * is ever switched on for customers.
 */
const PRESCREEN_ONBOARDING = [
  "בלחיצה על המשך ייפתח חלון של פייסבוק. אם חשבון האינסטגרם עוד לא מקצועי, או שאין לו עמוד פייסבוק, משלימים את זה באותו חלון: מעבר לחשבון מקצועי, יצירת עמוד וקישור ביניהם.",
  "המעבר לחשבון מקצועי ויצירת העמוד חינמיים.",
  "בסוף מאשרים, ותבנית מקבלת הרשאה לראות את העמודים והחשבונות המקושרים ולפרסם אליהם.",
] as const;

/** What the pre-screen says, by the window the mode opens and whether an account is already connected. */
export function preScreenLines(mode: InstagramConnectMode, add: boolean): readonly string[] {
  if (mode === "onboarding") return PRESCREEN_ONBOARDING;
  if (add) {
    return [
      PRESCREEN_ADD_PAGE_FIRST,
      PRESCREEN_PAGE_HOW,
      PRESCREEN_WINDOW,
      PRESCREEN_ADD_CONTINUE,
      PRESCREEN_REVIEW,
    ];
  }
  return [
    PRESCREEN_PROFESSIONAL,
    PRESCREEN_FREE,
    PRESCREEN_PAGE,
    PRESCREEN_PAGE_HOW,
    PRESCREEN_WINDOW,
    PRESCREEN_REVIEW,
  ];
}

// Meta's data-deletion status page (public; Meta links the user to it).
export const DELETION_TITLE = "בקשת מחיקה";
export const DELETION_NOT_FOUND = "לא נמצאה בקשה עם הקוד הזה.";
/** Split around the code so the page can isolate it as an LTR island. */
export const DELETION_DONE = {
  before: "הבקשה",
  after: "טופלה: החיבור לתבנית הוסר והפרסומים שעוד לא יצאו בוטלו.",
} as const;
