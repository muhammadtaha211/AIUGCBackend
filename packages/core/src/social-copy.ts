/**
 * Social posting's customer-facing Hebrew that BOTH sides need: the web (the
 * calendar, the /home notice) and the worker (the failure email, decision 0107).
 * Pure — no db, no env — so a client component can import it through
 * `@aiugc/core/social-copy` without pulling the server graph in.
 *
 * The failure lines are docs/09's table. Every string marked DRAFT is new in
 * PR 3, or in PR 4.1 (the TikTok inbox path and the delivery email, decision
 * 0116) and waits for the founder's approval at PR review. PR 4's TikTok
 * lines are marked FINAL: approved by the merge of #107, 2026-10-17.
 */

export type SocialFailureKindKey =
  | "connection_expired"
  | "sound_unavailable"
  | "platform_refused"
  | "platform_timeout"
  | "quota_exhausted"
  | "removed_on_platform"
  | "file_missing"
  | "internal_error";

export const PLATFORM_LABELS: Record<"instagram" | "tiktok", string> = {
  instagram: "אינסטגרם",
  tiktok: "טיקטוק",
};

/** The services as the app names them — the same three as the web's `SERVICE_LABELS` (lib/service-b-ui.ts). */
export const VIDEO_SERVICE_LABELS: Record<"a" | "b" | "c", string> = {
  a: "הוק + דמו",
  b: "דמות AI",
  c: "גוש טקסט",
};

/** What the customer reads for a failed post: why, and what to do (docs/09). */
export function failureLine(kind: string, platform: "instagram" | "tiktok"): string {
  const name = PLATFORM_LABELS[platform];
  switch (kind as SocialFailureKindKey) {
    case "connection_expired":
      return "החיבור לחשבון פג. התחברו מחדש בהגדרות ותזמנו שוב.";
    case "sound_unavailable":
      return "הסאונד שנבחר כבר לא זמין באינסטגרם. תזמנו שוב עם סאונד אחר.";
    case "platform_refused":
      return `${name} לא קיבלה את הסרטון. אפשר להוריד אותו ולפרסם ידנית.`;
    case "platform_timeout":
      return `${name} לא סיימה לעבד את הסרטון בזמן. נסו לתזמן שוב.`;
    case "quota_exhausted":
      return platform === "tiktok"
        ? // FINAL (PR 4, approved by merge 2026-10-17): TikTok's cap counts the videos still waiting for the owner.
          "טיקטוק לא קיבלה את הסרטון במשך יממה, כי סרטונים קודמים שנשלחו עוד מחכים שתסיימו אותם. מסיימים אותם בטיקטוק ומתזמנים שוב."
        : "החשבון עבר את מכסת הפרסומים היומית של אינסטגרם במשך יממה. תזמנו שוב.";
    case "removed_on_platform":
      return "הסרטון הוסר בטיקטוק לפני שפורסם.";
    case "file_missing":
      return "קובץ הסרטון כבר לא שמור אצלנו.";
    default:
      // internal_error, and any kind a newer build wrote that this one does not know.
      return "תקלה אצלנו מנעה את הפרסום. נסו לתזמן שוב.";
  }
}

/**
 * The calendar's address, absolute in the email and relative in the nav —
 * outside /home on purpose (apps/web/src/app/(posting)/layout.tsx).
 */
export const SOCIAL_CALENDAR_PATH = "/calendar";
export const TAVNIT_ORIGIN = "https://tavnit.ai";

// ---------------------------------------------------------------------------
// The failure email (decision 0107) — every line DRAFT
// ---------------------------------------------------------------------------

/** One post as the email names it. */
export interface FailureEmailPost {
  /** Not shown: they decide whether the reason speaks of one video or account, or several. */
  renderId: string;
  accountId: string;
  service: "a" | "b" | "c";
  businessName: string;
  /** `@username`, or the display name when Meta gave no username. */
  accountName: string;
  platform: "instagram" | "tiktok";
  /** The planned time, already formatted in the post's own time zone. */
  when: string;
}

/** At most this many posts are listed; the rest are counted. */
export const FAILURE_EMAIL_MAX_LISTED = 10;

// U+2068 FIRST STRONG ISOLATE … U+2069 POP DIRECTIONAL ISOLATE: a Latin
// username or business name inside a Hebrew line keeps its own direction.
function isolate(text: string): string {
  return `\u2068${text}\u2069`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** DRAFT. The app's own words: פרסום, not פוסט (0061). */
export function failureEmailSubject(count: number): string {
  return count === 1 ? "פרסום שתוזמן בתבנית נכשל" : `${count} פרסומים שתוזמנו בתבנית נכשלו`;
}

/**
 * The email's reason line: docs/09's failure line when the cause touched one
 * video on one account, else its plural (DRAFT) — one email gathers every post
 * of a cause, so "the video" may be three videos and "the account" two.
 */
export function failureEmailReason(
  kind: string,
  platform: "instagram" | "tiktok",
  counts: { videos: number; accounts: number },
): string {
  const name = PLATFORM_LABELS[platform];
  const manyVideos = counts.videos > 1;
  const manyAccounts = counts.accounts > 1;
  switch (kind as SocialFailureKindKey) {
    case "connection_expired":
      return manyAccounts
        ? "החיבור לחשבונות פג. התחברו מחדש בהגדרות ותזמנו שוב."
        : failureLine(kind, platform);
    case "quota_exhausted":
      if (!manyAccounts) return failureLine(kind, platform);
      return platform === "tiktok"
        ? // FINAL (PR 4, approved by merge 2026-10-17).
          "טיקטוק לא קיבלה סרטונים לחשבונות במשך יממה, כי סרטונים קודמים שנשלחו עוד מחכים שתסיימו אותם. מסיימים אותם בטיקטוק ומתזמנים שוב."
        : "החשבונות עברו את מכסת הפרסומים היומית של אינסטגרם במשך יממה. תזמנו שוב.";
    case "platform_refused":
      return manyVideos
        ? `${name} לא קיבלה את הסרטונים. אפשר להוריד אותם ולפרסם ידנית.`
        : failureLine(kind, platform);
    case "platform_timeout":
      return manyVideos
        ? `${name} לא סיימה לעבד את הסרטונים בזמן. נסו לתזמן שוב.`
        : failureLine(kind, platform);
    case "file_missing":
      return manyVideos ? "קבצי הסרטונים כבר לא שמורים אצלנו." : failureLine(kind, platform);
    default:
      // sound_unavailable names the post's own sound, removed_on_platform and
      // internal_error the post itself: one line reads right for one or many.
      return failureLine(kind, platform);
  }
}

function postLine(post: FailureEmailPost): string {
  // DRAFT: "סרטון הוק + דמו של <business> · @<account> באינסטגרם · <when>"
  return `סרטון ${VIDEO_SERVICE_LABELS[post.service]} של ${isolate(post.businessName)} · ${isolate(post.accountName)} ב${PLATFORM_LABELS[post.platform]} · ${post.when}`;
}

/**
 * The whole email, as text and as HTML. One cause per email (decision 0107),
 * so one reason line: the failure line says why and what to do; the calendar
 * link is where to do it.
 */
export function failureEmail(input: { kind: string; posts: FailureEmailPost[] }): {
  subject: string;
  text: string;
  html: string;
} {
  const { posts } = input;
  const platform = posts[0]?.platform ?? "instagram";
  const reason = failureEmailReason(input.kind, platform, {
    videos: new Set(posts.map((p) => p.renderId)).size,
    accounts: new Set(posts.map((p) => p.accountId)).size,
  });
  const listed = posts.slice(0, FAILURE_EMAIL_MAX_LISTED);
  const more = posts.length - listed.length;
  const calendarUrl = `${TAVNIT_ORIGIN}${SOCIAL_CALENDAR_PATH}`;

  // DRAFT, every line below. The calendar is the app's "לוח הפרסומים", and a
  // missing file has nothing to schedule again.
  const opening = posts.length === 1 ? "הפרסום הזה נכשל:" : `${posts.length} הפרסומים האלה נכשלו:`;
  const moreLine = more > 0 ? `ועוד ${more}.` : null;
  const calendarLead =
    input.kind === "file_missing"
      ? "כל הפרטים בלוח הפרסומים:"
      : "כל הפרטים, ואפשרות לתזמן שוב, בלוח הפרסומים:";
  const calendarCta = "ללוח הפרסומים";
  // The calendar opens for a signed-in account only (a 404 for anyone else).
  const signInLine = "הלוח נפתח אחרי כניסה לחשבון בתבנית.";
  const quietLine =
    "אם עוד פרסומים ייכשלו מאותה סיבה ב־24 השעות הקרובות, לא נשלח מייל נוסף. הם יופיעו בלוח.";
  const signature = "תבנית";

  const text = [
    opening,
    ...listed.map((p) => `• ${postLine(p)}`),
    ...(moreLine ? [moreLine] : []),
    "",
    reason,
    "",
    calendarLead,
    calendarUrl,
    signInLine,
    "",
    quietLine,
    "",
    signature,
  ].join("\n");

  const html = [
    `<div dir="rtl" lang="he" style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#111;text-align:right">`,
    `<p style="margin:0 0 8px">${escapeHtml(opening)}</p>`,
    `<ul style="margin:0 0 16px;padding-inline-start:20px">`,
    ...listed.map((p) => `<li>${escapeHtml(postLine(p))}</li>`),
    `</ul>`,
    ...(moreLine ? [`<p style="margin:0 0 16px">${escapeHtml(moreLine)}</p>`] : []),
    `<p style="margin:0 0 16px"><strong>${escapeHtml(reason)}</strong></p>`,
    `<p style="margin:0 0 8px">${escapeHtml(calendarLead)}</p>`,
    `<p style="margin:0 0 8px"><a href="${calendarUrl}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;text-decoration:none;border-radius:8px">${escapeHtml(calendarCta)}</a></p>`,
    `<p style="margin:0 0 24px;font-size:13px;color:#666">${escapeHtml(signInLine)}</p>`,
    `<p style="margin:0 0 16px;font-size:13px;color:#666">${escapeHtml(quietLine)}</p>`,
    `<p style="margin:0;color:#666">${escapeHtml(signature)}</p>`,
    `</div>`,
  ].join("");

  return { subject: failureEmailSubject(posts.length), text, html };
}

// ---------------------------------------------------------------------------
// The TikTok inbox path and the delivery email (decision 0116) — every line DRAFT
// ---------------------------------------------------------------------------

/*
 * Where a delivered video waits inside TikTok, as the live run of 2026-10-17
 * showed it (FOUNDER-REPORTED): the Inbox tab, then System Notifications, then
 * the notification "Your content from Tavnit is ready", which opens TikTok's
 * editor. The notification's Hebrew wording was not observed, so its English
 * title is quoted; the tabs carry their English name beside the Hebrew one,
 * because owners run TikTok in either language. One source: the TikTok card,
 * the schedule note, the post page and the email all print these.
 */
export const TIKTOK_PATH_INBOX = `תיבת דואר נכנס (${isolate("Inbox")})`;
export const TIKTOK_PATH_SYSTEM = `התראות מערכת (${isolate("System Notifications")})`;
export const TIKTOK_PATH_NOTIFICATION = `ההתראה ${isolate("“Your content from Tavnit is ready”")}`;
/** The three steps on one line, for the screens. */
export const TIKTOK_INBOX_PATH = [
  TIKTOK_PATH_INBOX,
  TIKTOK_PATH_SYSTEM,
  TIKTOK_PATH_NOTIFICATION,
].join(" ← ");
/** What every screen says after its own first sentence: the path, then what the owner does there. */
export const TIKTOK_FINISH_LINE = `כדי להשלים אותו, בטיקטוק פותחים: ${TIKTOK_INBOX_PATH}. מוסיפים סאונד וכיתוב ומפרסמים.`;

/** One delivered post as the email names it: the failure email's line, plus the id its link needs. */
export interface DeliveryEmailPost extends FailureEmailPost {
  postId: string;
}

/** DRAFT. */
export function deliveryEmailSubject(count: number): string {
  return count === 1 ? "הסרטון שלכם מחכה לכם בטיקטוק" : `${count} סרטונים מחכים לכם בטיקטוק`;
}

/**
 * The delivery email: a TikTok video reached the owner's inbox. One email per
 * Tavnit account per sweep, so it may name several videos. A single video links
 * to its own page (`/calendar/<id>`); several link to the calendar.
 */
export function deliveryEmail(input: { posts: DeliveryEmailPost[] }): {
  subject: string;
  text: string;
  html: string;
} {
  const { posts } = input;
  const many = posts.length > 1;
  const listed = posts.slice(0, FAILURE_EMAIL_MAX_LISTED);
  const more = posts.length - listed.length;

  // DRAFT, every line below.
  const opening = many
    ? `${posts.length} הסרטונים האלה הגיעו לטיקטוק:`
    : "הסרטון הזה הגיע לטיקטוק:";
  const moreLine = more > 0 ? `ועוד ${more}.` : null;
  const stepsLead = many ? "כדי להשלים אותם, בטיקטוק פותחים:" : "כדי להשלים אותו, בטיקטוק פותחים:";
  const steps = [
    TIKTOK_PATH_INBOX,
    TIKTOK_PATH_SYSTEM,
    `${TIKTOK_PATH_NOTIFICATION}. לוחצים עליה ונפתח העורך של טיקטוק.`,
  ];
  const stepsTail = "שם מוסיפים סאונד וכיתוב ומפרסמים.";
  const blockLine = many
    ? "סרטונים שלא הושלמו בטיקטוק חוסמים שליחה של סרטונים חדשים לאותו חשבון, ולכן כדאי להשלים אותם."
    : "סרטון שלא הושלם בטיקטוק חוסם שליחה של סרטונים חדשים לאותו חשבון, ולכן כדאי להשלים אותו.";
  const url = many
    ? `${TAVNIT_ORIGIN}${SOCIAL_CALENDAR_PATH}`
    : `${TAVNIT_ORIGIN}${SOCIAL_CALENDAR_PATH}/${posts[0]!.postId}`;
  const linkLead = many ? "כל הפרסומים בלוח הפרסומים:" : "הפרסום בתבנית:";
  const cta = many ? "ללוח הפרסומים" : "לפרסום";
  // The page opens for the signed-in owner only (a 404 for anyone else).
  const signInLine = "הדף נפתח אחרי כניסה לחשבון בתבנית.";
  const signature = "תבנית";

  const text = [
    opening,
    ...listed.map((p) => `• ${postLine(p)}`),
    ...(moreLine ? [moreLine] : []),
    "",
    stepsLead,
    ...steps.map((step, i) => `${i + 1}. ${step}`),
    stepsTail,
    "",
    blockLine,
    "",
    linkLead,
    url,
    signInLine,
    "",
    signature,
  ].join("\n");

  const html = [
    `<div dir="rtl" lang="he" style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#111;text-align:right">`,
    `<p style="margin:0 0 8px">${escapeHtml(opening)}</p>`,
    `<ul style="margin:0 0 16px;padding-inline-start:20px">`,
    ...listed.map((p) => `<li>${escapeHtml(postLine(p))}</li>`),
    `</ul>`,
    ...(moreLine ? [`<p style="margin:0 0 16px">${escapeHtml(moreLine)}</p>`] : []),
    `<p style="margin:0 0 8px"><strong>${escapeHtml(stepsLead)}</strong></p>`,
    `<ol style="margin:0 0 8px;padding-inline-start:24px">`,
    ...steps.map((step) => `<li>${escapeHtml(step)}</li>`),
    `</ol>`,
    `<p style="margin:0 0 16px">${escapeHtml(stepsTail)}</p>`,
    `<p style="margin:0 0 16px">${escapeHtml(blockLine)}</p>`,
    `<p style="margin:0 0 8px">${escapeHtml(linkLead)}</p>`,
    `<p style="margin:0 0 8px"><a href="${url}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;text-decoration:none;border-radius:8px">${escapeHtml(cta)}</a></p>`,
    `<p style="margin:0 0 24px;font-size:13px;color:#666">${escapeHtml(signInLine)}</p>`,
    `<p style="margin:0;color:#666">${escapeHtml(signature)}</p>`,
    `</div>`,
  ].join("");

  return { subject: deliveryEmailSubject(posts.length), text, html };
}
