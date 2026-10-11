/**
 * Every customer-facing line of the social-posting connect flow (decision
 * 0101, PR 2): the Integrations section in /home/settings, the Instagram
 * pre-screen, the callback's outcome lines and Meta's deletion status page.
 * Pure — no `@/` imports — so the string tests reach it directly.
 *
 * The lines come from the approved plan's Appendix A. Those marked DRAFT are
 * new in PR 2 (the singular forms Appendix A left implicit) and wait for the
 * founder's approval at PR review with the rest. 0061's rules: no reach or
 * results claim, the app's own vocabulary (חשבון, פרסום).
 */

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
export const CONNECT_FAILED = "החיבור לאינסטגרם לא הושלם. נסו שוב.";
export const CONNECT_NO_ACCOUNT = "לא נמצא חשבון אינסטגרם מקצועי המקושר לעמוד פייסבוק בחשבון הזה.";

export function connectedLine(count: number, name: string | null): string {
  if (count === 1 && name) return `החשבון ${isolated(name)} חובר.`;
  return `${count} חשבונות חוברו.`;
}

export type SocialOutcome = "connected" | "none" | "error";

/** `?social=` as the callback writes it; anything else is no outcome at all. */
export function parseSocialOutcome(value: string | string[] | undefined): SocialOutcome | null {
  return value === "connected" || value === "none" || value === "error" ? value : null;
}

// The Instagram pre-screen, before Facebook's window opens.
export const PRESCREEN_TITLE = "חיבור אינסטגרם";
export const PRESCREEN_LINES = [
  "נדרש חשבון אינסטגרם מקצועי (עסקי או יוצר).",
  "החשבון צריך להיות מקושר לעמוד פייסבוק — עמוד אחד לכל חשבון אינסטגרם.",
  "המעבר לחשבון מקצועי חינמי ומיידי, בהגדרות אינסטגרם.",
  "בלחיצה על המשך ייפתח חלון של פייסבוק לאישור. תבנית מקבלת הרשאה לראות את העמודים והחשבונות המקושרים ולפרסם אליהם.",
] as const;

// Meta's data-deletion status page (public; Meta links the user to it).
export const DELETION_TITLE = "בקשת מחיקה";
export const DELETION_NOT_FOUND = "לא נמצאה בקשה עם הקוד הזה.";
/** Split around the code so the page can isolate it as an LTR island. */
export const DELETION_DONE = {
  before: "הבקשה",
  after: "טופלה: החיבור לתבנית הוסר והפרסומים שעוד לא יצאו בוטלו.",
} as const;
