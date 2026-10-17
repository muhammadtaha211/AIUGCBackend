/**
 * Every customer-facing line of social posting's PR 3 (decisions 0101, 0102,
 * 0107): the player's button and the tile's tag, the schedule flow and its
 * sound picker, the calendar and the post page, the /home notice, and the
 * Hebrew a scheduling refusal answers with. Pure — no `@/` imports and no
 * runtime import of @aiugc/core beyond the pure `@aiugc/core/social-copy` —
 * so client components and the string tests reach it directly.
 *
 * The lines are the approved plan's Appendix A (2026-10-10). Those marked
 * DRAFT are new in PR 3 — the singular and zero forms Appendix A left implicit,
 * the AI tick (0102 §1, 0107 §1), the גוש טקסט mix line (0102 §2), the refusals
 * Appendix A did not word — or a line of Appendix A with its TikTok half taken
 * out (no TikTok card until PR 4, 0102 §4). PR 4 (decision 0115) added TikTok's
 * lines; the founder merged PR #107 on 2026-10-17 and they read FINAL (PR 4,
 * approved by merge), except the ones PR 4.1 rewrites, which are DRAFT again.
 * None names a Drafts folder — what the owner gets is TikTok's inbox
 * notification (the founder's approval change 1). The other DRAFTs wait for the
 * founder's approval at PR review. 0061's rules: no reach or results claim,
 * the app's own vocabulary (סרטון, פרסום, חשבון).
 */

import { TIKTOK_FINISH_LINE } from "@aiugc/core/social-copy";
import type { SocialErrorCode } from "@aiugc/core";
import { isolated } from "./social-ui";

// ---------------------------------------------------------------------------
// The player and the tiles
// ---------------------------------------------------------------------------

export const SCHEDULE_BUTTON = "תזמון פרסום";
export const TILE_TAG = "מתוזמן";
/** FINAL (decision 0108 §1, the founder's word). */
export const TILE_TAG_POSTED = "פורסם";
/** FINAL (decision 0115 §3, the founder's word): TikTok's terminal word on inbox delivery. */
export const TILE_TAG_DELIVERED = "נשלח לטיקטוק";

export type SocialPlatformKey = "instagram" | "tiktok";
export type PostTag = "scheduled" | "delivered" | "posted";
export type PlatformTag = { platform: SocialPlatformKey; tag: PostTag };
export type PlatformCounts = { waiting: number; delivered: number; posted: number };

/**
 * One platform's tag (decision 0108 §1, per platform since 0115 §3): "מתוזמן"
 * while any of its posts waits (scheduled, or publishing — a quota or cap wait
 * included); else TikTok's "נשלח לטיקטוק" while any draft sits delivered in the
 * owner's TikTok (an unfinished draft outranks a posted one — it is the thing
 * to act on), else "פורסם" once any went out. Instagram never has a delivered
 * post, so its rule is unchanged. A failed or cancelled post alone tags nothing.
 */
export function postTag(counts: PlatformCounts): PostTag | null {
  if (counts.waiting > 0) return "scheduled";
  if (counts.delivered > 0) return "delivered";
  if (counts.posted > 0) return "posted";
  return null;
}

/** The tile's tags: at most one per platform, Instagram first. */
export function postTags(
  byPlatform: Partial<Record<SocialPlatformKey, PlatformCounts>>,
): PlatformTag[] {
  return (["instagram", "tiktok"] as const).flatMap((platform) => {
    const counts = byPlatform[platform];
    const tag = counts ? postTag(counts) : null;
    return tag ? [{ platform, tag }] : [];
  });
}

/** Under the player while posts of this video wait. */
export function pendingPostsLine(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "מתוזמן לפרסום" : `מתוזמן ל־${count} פרסומים`;
}

// ---------------------------------------------------------------------------
// The schedule flow
// ---------------------------------------------------------------------------

export const SCHEDULE_TITLE = "תזמון פרסום";

export const STEP_ACCOUNTS_TITLE = "לאן מפרסמים?";
export const STEP_ACCOUNTS_LEAD = "בוחרים חשבון אחד או יותר.";
export const NO_ACCOUNT_TITLE = "עוד אין חשבון מחובר";
// DRAFT: Appendix A's line without "או טיקטוק" (no TikTok card yet, 0102 §4) and
// without "בהגדרות" (the button opens the Instagram pre-screen, not settings).
export const NO_ACCOUNT_BODY = "מחברים חשבון אינסטגרם, וחוזרים לכאן לתזמן את הסרטון.";
// FINAL (PR 4, approved by merge 2026-10-17): TikTok alone opens TikTok's connect; both open the חיבורים section.
export const NO_ACCOUNT_BODY_TIKTOK = "מחברים חשבון טיקטוק, וחוזרים לכאן לתזמן את הסרטון.";
// FINAL (PR 4, approved by merge 2026-10-17)
export const NO_ACCOUNT_BODY_BOTH =
  "מחברים חשבון אינסטגרם או טיקטוק בהגדרות, וחוזרים לכאן לתזמן את הסרטון.";

/** The no-account card's body, by the platforms the account's switches open. */
export function noAccountBody(platforms: readonly SocialPlatformKey[]): string {
  if (platforms.includes("instagram") && platforms.includes("tiktok")) return NO_ACCOUNT_BODY_BOTH;
  return platforms.includes("tiktok") ? NO_ACCOUNT_BODY_TIKTOK : NO_ACCOUNT_BODY;
}
export const NO_ACCOUNT_CTA = "לחיבור חשבון";
// DRAFT: an expired account in the list, which cannot be picked.
export const ACCOUNT_EXPIRED_HINT = "החיבור פג. מתחברים מחדש בהגדרות.";

export const STEP_WHEN_TITLE = "מתי?";
export const DATE_LABEL = "תאריך";
export const TIME_LABEL = "שעה";
export const NOW_BUTTON = "עכשיו";
export const PAST_LINE = "השעה שנבחרה כבר עברה.";

export function horizonLine(days: number): string {
  return `אפשר לתזמן עד ${days} יום קדימה.`;
}

/** The dated form, shown before the request when the page knows the date. */
export function retentionLine(date: string): string {
  return `הסרטון נשמר אצלנו עד ${date}, ואפשר לתזמן רק עד אז.`;
}

export const STEP_CAPTION_TITLE = "כיתוב וסאונד";
export const CAPTION_LABEL = "כיתוב";
// FINAL (PR 4, approved by merge 2026-10-17): beside a TikTok account the caption is Instagram's alone.
export const CAPTION_LABEL_INSTAGRAM = "כיתוב (אינסטגרם)";
export const CAPTION_PLACEHOLDER = "מה כותבים ליד הסרטון? אפשר גם להשאיר ריק.";

export function captionCounter(length: number, max: number): string {
  return `${length}/${max}`;
}

export const SOUND_LABEL = "סאונד (אינסטגרם)";
export const SOUND_TAB_TRENDING = "פופולריים";
export const SOUND_TAB_SEARCH = "חיפוש";
export const SOUND_GROUP_REELS = "סאונדים מרילס";
export const SOUND_GROUP_MUSIC = "מוזיקה";
export const SOUND_SEARCH_PLACEHOLDER = "שם שיר, אמן או יוצר";
export const NO_SOUND = "בלי סאונד";
export const SOUND_MORE = "עוד תוצאות";
export const SOUND_NONE_FOUND = "לא נמצאו סאונדים.";
export const SOUND_PREVIEW_ARIA = "השמעת תצוגה מקדימה";
export const SOUND_NO_PREVIEW = "אין תצוגה מקדימה";
/** FINAL (decision 0108 §5, the founder's word): the row Meta gave no file for. */
export const SOUND_ON_INSTAGRAM = "האזנה באינסטגרם";
export const SOUND_RECONNECT =
  "כדי לחפש סאונדים צריך להתחבר מחדש לחשבון בהגדרות. אפשר להמשיך בלי סאונד.";
// DRAFT: the search failed for a reason that is not the token.
export const SOUND_SEARCH_FAILED = "החיפוש לא הצליח. אפשר לנסות שוב או להמשיך בלי סאונד.";
export const SOUND_NOTE =
  "הסאונד שחיפשתם לא כאן? אפשר להוריד את הסרטון ולפרסם אותו באפליקציה של אינסטגרם או טיקטוק, שם הבחירה רחבה יותר.";
export const SOUND_NOTE_DOWNLOAD = "הורדת הסרטון";

/** Catalogue titles are mostly Latin with brackets: isolated, or "(Sped Up)" flips. */
export function chosenSoundLine(title: string): string {
  return `נבחר: ${isolated(title)}`;
}

/**
 * How the picked sound meets the video's own audio — one line per mix
 * (0102 §2, `SOUND_VOLUMES`): הוק + דמו is silent (100/0); דמות AI's voice
 * stays on top (15/100), and a retired full-format A render, which carries a
 * voiceover, takes the same mix; גוש טקסט's sound leads over the clip's own
 * (100/40).
 */
export function mixLine(service: "a" | "b" | "c", voiced: boolean): string {
  if (service === "c") {
    // DRAFT (0102 §2: Appendix A's "own soundtrack" line is wrong for C).
    return "לסרטון יש סאונד משלו. הסאונד שנבחר יוביל, והסאונד של הסרטון יישמע מתחתיו, חלש יותר.";
  }
  if (service === "b" || voiced) {
    return "לסרטון יש פסקול משלו, והוא יישמע במלואו. הסאונד שנבחר יתנגן ברקע, חלש יותר.";
  }
  return "הסרטון שקט, והסאונד יתנגן בעוצמה מלאה.";
}

// DRAFT (0102 §1, 0107 §1): the customer's own tick, small, muted, unticked,
// last on the step. The hint is Meta's rule as its Community Standards word it
// (transparency.meta.com, read 2026-10-12) — one muted line, nothing more.
export const AI_TICK_LABEL = "לסמן באינסטגרם שהסרטון נוצר ב־AI";
export const AI_TICK_HINT = "אינסטגרם דורשת לסמן סרטון מציאותי שנוצר או שונה ב־AI.";

export const DAILY_CAP_LINE = "הגעתם למכסת הפרסומים היומית של אינסטגרם לחשבון הזה.";
// FINAL (PR 4, approved by merge 2026-10-17, decision 0115): TikTok takes at most 5 videos a day that the owner has not finished.
export const TIKTOK_PENDING_CAP_LINE =
  "לחשבון הטיקטוק הזה כבר מתוזמנים 5 סרטונים ביממה שסביב המועד הזה, וטיקטוק לא מקבלת יותר. בחרו מועד אחר.";

// DRAFT (PR 4.1, decision 0116): above the submit whenever a TikTok account is
// picked — TikTok takes only the file, and the owner finishes it in TikTok by
// the path the live run showed (the same words as the card, the post page and
// the delivery email).
export const TIKTOK_INBOX_NOTE = `לטיקטוק נשלח רק הסרטון. ${TIKTOK_FINISH_LINE}`;

// DRAFT (PR 4.1, decision 0116): the TikTok-only time step says what the time
// is for. Scheduling stays; `עכשיו` is the way to send right away. Shown only
// when TikTok is picked and no Instagram account is (a mixed schedule goes on to
// the caption step, and its draft lands when the Reel goes live).
export const TIKTOK_WHEN_NOTE =
  "במועד שבחרתם הסרטון מגיע לטיקטוק, ואליכם מגיע מייל תזכורת. הסאונד, הכיתוב והפרסום נעשים בטיקטוק. ״עכשיו״ שולח את הסרטון מיד.";

export const CONTINUE_BUTTON = "המשך";
export const BACK_BUTTON = "חזרה";
export const SUBMIT_BUTTON = "תזמון";

export const DONE_TITLE = "תבנית ממשיכה מכאן";

export function doneLine(date: string, time: string): string {
  return `הסרטון יפורסם ב־${date} בשעה ${time}. אפשר לשנות או לבטל בלוח הפרסומים עד שהפרסום מתחיל.`;
}

/** Which platforms the picked accounts are on. */
export type PlatformMix = { instagram: boolean; tiktok: boolean };

/** The done line by what was picked: Instagram's posts, TikTok's sends, or both. */
export function doneLineFor(mix: PlatformMix, date: string, time: string): string {
  if (!mix.tiktok) return doneLine(date, time);
  if (!mix.instagram) {
    // FINAL (PR 4, approved by merge 2026-10-17)
    return `הסרטון יישלח לטיקטוק ב־${date} בשעה ${time}. אפשר לשנות או לבטל בלוח הפרסומים עד שהשליחה מתחילה.`;
  }
  // FINAL (PR 4, approved by merge 2026-10-17)
  return `הסרטון יפורסם באינסטגרם ויישלח לטיקטוק ב־${date} בשעה ${time}. אפשר לשנות או לבטל בלוח הפרסומים עד שהפרסום מתחיל.`;
}

export const TO_CALENDAR = "ללוח הפרסומים";
export const BACK_TO_VIDEO = "חזרה לסרטון";

// ---------------------------------------------------------------------------
// The calendar and the post page
// ---------------------------------------------------------------------------

export const CALENDAR_TITLE = "לוח פרסומים";
export const PREV_MONTH = "החודש הקודם";
export const NEXT_MONTH = "החודש הבא";
export const TODAY_BUTTON = "היום";
export const EMPTY_MONTH = "אין פרסומים בחודש הזה.";

export type PostDisplayStatus =
  "scheduled" | "publishing" | "deferred" | "delivered" | "posted" | "failed" | "cancelled";

/**
 * A post's chip, from its row: a quota (or TikTok cap) wait is `publishing`
 * with `deferredUntil` set; `delivered` is TikTok's file in the owner's TikTok,
 * not yet posted (decision 0115) — never "פורסם".
 */
export function postDisplayStatus(post: {
  status: string;
  deferredUntil: string | Date | null;
}): PostDisplayStatus {
  if (post.status === "publishing" && post.deferredUntil) return "deferred";
  if (
    post.status === "scheduled" ||
    post.status === "publishing" ||
    post.status === "delivered" ||
    post.status === "posted" ||
    post.status === "failed" ||
    post.status === "cancelled"
  ) {
    return post.status;
  }
  return "scheduled";
}

export const POST_STATUS_LABELS: Record<PostDisplayStatus, string> = {
  scheduled: "מתוזמן",
  publishing: "מתפרסם…",
  deferred: "ממתין למכסת הפרסומים של אינסטגרם",
  delivered: TILE_TAG_DELIVERED,
  posted: "פורסם",
  failed: "נכשל",
  cancelled: "בוטל",
};

// FINAL (PR 4, approved by merge 2026-10-17): a TikTok post waiting out TikTok's cap on unfinished videos.
export const DEFERRED_LABEL_TIKTOK = "ממתין שטיקטוק תקבל עוד סרטונים לחשבון";

/** The status's word for a post on this platform: the wait is worded per platform. */
// FINAL (PR 4, approved by merge 2026-10-17): TikTok while the file is on its way — Tavnit sends to TikTok, it never publishes there.
export const PUBLISHING_LABEL_TIKTOK = "בשליחה לטיקטוק…";

export function postStatusLabel(status: PostDisplayStatus, platform: SocialPlatformKey): string {
  if (platform === "tiktok" && status === "deferred") return DEFERRED_LABEL_TIKTOK;
  if (platform === "tiktok" && status === "publishing") return PUBLISHING_LABEL_TIKTOK;
  return POST_STATUS_LABELS[status];
}

// DRAFT (PR 4.1, decision 0116): the post page of a TikTok post that reached the owner's TikTok.
export const TIKTOK_DELIVERED_LINE = `הסרטון נשלח לטיקטוק. ${TIKTOK_FINISH_LINE}`;

export const POST_TITLE = "פרסום";
export const FIELD_ACCOUNT = "חשבון";
export const FIELD_WHEN = "מועד";
export const FIELD_CAPTION = "כיתוב";
export const FIELD_SOUND = "סאונד";
export const FIELD_VIDEO = "סרטון";
export const SAVE_BUTTON = "שמירה";
export const CANCEL_POST_BUTTON = "ביטול הפרסום";
export const RESCHEDULE_BUTTON = "תזמון מחדש";
export const VIEW_POST_BUTTON = "צפייה בפוסט";
export const DOWNLOAD_BUTTON = "הורדה";
export const CANCEL_CONFIRM = "לבטל את הפרסום? הסרטון לא יפורסם.";
export const CANCEL_DONE = "הפרסום בוטל.";
export const NOT_PENDING_LINE = "הפרסום כבר התחיל ואי אפשר לשנות אותו.";
// DRAFT: the edit form's confirmation, and an empty caption on the page.
export const SAVED_LINE = "השינויים נשמרו.";
export const NO_CAPTION = "בלי כיתוב";
// DRAFT: the confirm's two buttons.
export const CONFIRM_YES = "כן, לבטל";
export const CONFIRM_NO = "לא";

// ---------------------------------------------------------------------------
// The /home notice and the nav
// ---------------------------------------------------------------------------

export const CALENDAR_NAV = "לוח פרסומים";
export const NOTICE_ACK = "הבנתי";
// DRAFT: the expired notice's link to the reconnect.
export const EXPIRED_NOTICE_LINK = "להגדרות";

export function failedNoticeLine(count: number): string {
  return count === 1 ? "פרסום אחד נכשל" : `${count} פרסומים נכשלו`;
}

/** `name` arrives bidi-isolated (social-ui `isolated`). */
export function expiredNoticeLine(name: string, pending: number): string {
  // DRAFT: the singular.
  if (pending === 1) {
    return `החיבור לחשבון ${name} פג ויש לו פרסום מתוזמן אחד. התחברו מחדש בהגדרות.`;
  }
  return `החיבור לחשבון ${name} פג ויש לו ${pending} פרסומים מתוזמנים. התחברו מחדש בהגדרות.`;
}

// ---------------------------------------------------------------------------
// What a refusal answers with (api-errors.ts maps the codes; statuses there)
// ---------------------------------------------------------------------------

export function socialErrorLine(code: SocialErrorCode, horizonDays: number): string {
  switch (code) {
    case "not_found":
      return "לא נמצא.";
    case "not_pending":
      return NOT_PENDING_LINE;
    case "render_not_released":
      return "הסרטון עוד לא מוכן לפרסום."; // DRAFT
    case "file_missing":
      return "קובץ הסרטון כבר לא שמור אצלנו.";
    case "no_accounts":
      return STEP_ACCOUNTS_LEAD;
    case "account_not_connected":
      return "החיבור לאחד החשבונות פג. התחברו מחדש בהגדרות."; // DRAFT
    case "in_the_past":
      return PAST_LINE;
    case "beyond_horizon":
      return horizonLine(horizonDays);
    case "beyond_retention":
      return "הסרטון לא יישמר אצלנו עד המועד הזה. בחרו מועד מוקדם יותר."; // DRAFT
    case "bad_timezone":
      return "אזור הזמן של הדפדפן לא מוכר. רעננו את הדף ונסו שוב."; // DRAFT
    case "caption_too_long":
      return "הכיתוב ארוך מ־2,200 תווים."; // DRAFT
    case "sound_without_instagram":
      return "סאונד אפשר לבחור רק לחשבון אינסטגרם."; // DRAFT
    case "instagram_daily_cap":
      return DAILY_CAP_LINE;
    case "tiktok_pending_cap":
      return TIKTOK_PENDING_CAP_LINE;
  }
}
