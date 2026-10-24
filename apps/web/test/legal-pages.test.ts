import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TIKTOK_SCOPES } from "@aiugc/core";
import PrivacyPage from "../src/app/(legal)/privacy/page";
import TermsPage from "../src/app/(legal)/terms/page";
import { OPERATOR_ADDRESS, UPDATED } from "../src/app/(legal)/legal";
import {
  OAUTH_COOKIE,
  OAUTH_COOKIE_MAX_AGE_SECONDS,
  OAUTH_WINDOW_MS,
  TIKTOK_OAUTH_COOKIE,
} from "../src/lib/social-oauth";

/**
 * The legal pass on connected accounts (vault 0117): /privacy and /terms say
 * what the code does. The text is prose, but its names and numbers are tied to
 * the constants that decide them, so a change in the code that the text no
 * longer matches fails here ("change the code, change the text").
 */

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const source = (file: string) => readFileSync(path.join(repo, file), "utf8");

/** Markup to the text a reader sees: tags out, entities back, bidi marks out, spaces folded. */
function plain(markup: string): string {
  return markup
    .replace(/<\/?(span|a|strong|em|bdi)\b[^>]*>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[‎‏⁦-⁩]/g, "")
    .replace(/\s+/g, " ");
}

const privacyMarkup = renderToStaticMarkup(createElement(PrivacyPage));
const privacy = plain(privacyMarkup);
const terms = plain(renderToStaticMarkup(createElement(TermsPage)));

/** The numbered headings as rendered: <h2>13. title</h2>. */
function headings(markup: string): Map<number, string> {
  const found = new Map<number, string>();
  for (const match of markup.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)) {
    const text = plain(match[1]!).trim();
    const numbered = /^(\d{1,2})\. (.+)$/.exec(text);
    if (numbered) found.set(Number(numbered[1]), numbered[2]!);
  }
  return found;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (name === "node_modules" || name === ".next") continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|md)$/.test(name)) out.push(full);
  }
  return out;
}

describe("the operator's address", () => {
  it("is the registration's P.O. box, in /privacy §1 and /terms §1 and §16, and no Tel Aviv street is left on the site", () => {
    expect(OPERATOR_ADDRESS).toBe('ת"ד 929, כאבול 2496300, ישראל');
    // /privacy: §1 twice (the operator line, the postal line). /terms: §1 and §16.
    expect(privacy.split(OPERATOR_ADDRESS)).toHaveLength(3);
    expect(terms.split(OPERATOR_ADDRESS)).toHaveLength(3);
    expect(terms).toContain(`כתובת למשלוח דואר: ${OPERATOR_ADDRESS}`);
    const stale = walk(path.join(repo, "apps/web/src")).filter((file) =>
      readFileSync(file, "utf8").includes("ברזיל 14"),
    );
    expect(stale).toEqual([]);
  });

  it("the operator's name line is as it was (a different order from the Meta record's is reported, not changed)", () => {
    expect(privacy).toContain("מוחמד טאהא (Mohammad Taha), עוסק פטור");
    expect(terms).toContain("מוחמד טאהא (Mohammad Taha), עוסק פטור");
  });

  it("the date at the head of both pages is today's pass", () => {
    expect(UPDATED).toBe("17.10.2026");
    expect(privacy).toContain(`עודכן לאחרונה: ${UPDATED}`);
    expect(terms).toContain(`עודכן לאחרונה: ${UPDATED}`);
  });
});

describe("/privacy §13, connected accounts", () => {
  const sections = headings(privacyMarkup);

  it("sections run 1 to 16 once each, and §13 is the connected accounts", () => {
    expect([...sections.keys()].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 16 }, (_, i) => i + 1),
    );
    expect(sections.get(13)).toContain("חשבונות רשתות חברתיות מחוברים");
    expect(sections.get(14)).toBe("קטינים");
    expect(sections.get(15)).toBe("שינויים במדיניות");
    expect(sections.get(16)).toBe("יצירת קשר");
  });

  it("every 'סעיף N' reference resolves, and the ones that point at a named section point at the right one", () => {
    for (const match of privacy.matchAll(/סעיף (\d{1,2})/g)) {
      expect(sections.has(Number(match[1])), `סעיף ${match[1]}`).toBe(true);
    }
    // The renumbering moved "changes to the policy" from 14 to 15: both pointers to it follow.
    expect(privacy).toMatch(/שינוי מהותי במדיניות או בתנאים \(סעיף 15\)/);
    expect(privacy).toContain("על שינוי מהותי נודיע באימייל לחשבון");
    expect(privacy).toMatch(/\(סעיף 13\)/);
    // Terms point at §13 for disconnect.
    expect(terms).toContain("מדיניות הפרטיות, סעיף 13");
  });

  it("names Meta and TikTok as sources, recipients and transfer destinations, and says what each receives", () => {
    for (const platform of ["Meta", "TikTok"]) {
      expect(privacy).toContain(platform);
    }
    expect(privacy).toContain("מ־Meta (פייסבוק ואינסטגרם) ומ־TikTok, אם חיברתם חשבון");
    expect(privacy).toContain("פלטפורמות הרשתות החברתיות");
    expect(privacy).toContain("המידע שנמסר ל־Meta ול־TikTok (סעיף 13) נמסר מחוץ לישראל");
    expect(privacy).toContain("אנחנו לא שולחים לטיקטוק כיתוב, סאונד או סימונים");
  });

  it("the TikTok permissions it names are the ones the code asks for", () => {
    expect(TIKTOK_SCOPES).toEqual(["user.info.basic", "video.upload"]);
    for (const scope of TIKTOK_SCOPES) expect(privacy).toContain(scope);
  });

  it("the signed-link lifetimes, the cipher and the token columns are as the code has them", () => {
    const social = source("packages/core/src/pipelines/social.ts");
    expect(social).toMatch(/const POST_SIGNED_URL_TTL_SECONDS = 3600;/);
    expect(social).toMatch(/const TIKTOK_PULL_URL_TTL_SECONDS = 7200;/);
    expect(privacy).toContain("קישור חתום שתקף שעה אחת");
    expect(privacy).toContain("קישור חתום שתקף שעתיים");
    expect(source("packages/core/src/secret-box.ts")).toContain('createCipheriv("aes-256-gcm"');
    expect(privacy).toContain("AES-256-GCM");
    // Nothing in the browser-facing view carries a token column.
    const view = social.slice(
      social.indexOf("function toView"),
      social.indexOf("function toView") + 900,
    );
    // (canSearchSounds is derived from a token's presence; no token column is a property of the view.)
    expect(view).not.toMatch(/^\s+(accessTokenEnc|userTokenEnc|refreshTokenEnc):/m);
  });

  it("says what disconnect does to the row the way the code does it, and that nothing is revoked", () => {
    const social = source("packages/core/src/pipelines/social.ts");
    const disconnect = social.slice(
      social.indexOf("export async function disconnectSocialAccount"),
    );
    const body = disconnect.slice(0, 1800);
    for (const column of ["accessTokenEnc: null", "userTokenEnc: null", "refreshTokenEnc: null"]) {
      expect(body).toContain(column);
    }
    expect(body).toContain('status: "disconnected"');
    // It keeps the name, the picture and the ids: the text says so.
    expect(body).not.toMatch(/displayName: null|username: null|pictureUrl: null/);
    expect(privacy).toContain("אנחנו מוחקים את האסימונים השמורים ומבטלים פרסומים שעוד לא התחילו");
    expect(privacy).toContain("ניתוק בתבנית אינו מבטל את ההרשאה אצל הפלטפורמה");
    expect(privacy).toContain("נשארים גם אחרי ניתוק");
  });

  it("says what Meta's data-deletion request erases and keeps, as processMetaDataDeletion does", () => {
    const social = source("packages/core/src/pipelines/social.ts");
    const start = social.indexOf("export async function processMetaDataDeletion");
    const body = social.slice(start, start + 2600);
    for (const erased of [
      "username: null",
      "displayName: null",
      "pictureUrl: null",
      "pageName: null",
    ]) {
      expect(body).toContain(erased);
    }
    // Not cleared: the technical ids and the post rows, which the text says stay.
    expect(body).not.toMatch(/externalId: null|pageId: null|fbUserId: null/);
    expect(privacy).toContain(
      "מזהי החשבונות, מזהה הדף, מזהה המשתמש שלכם בפייסבוק והיסטוריית הפרסומים אינם נמחקים בדרך הזאת",
    );
    // What is kept after a disconnect names the Facebook user id too (fb_user_id is never cleared).
    expect(privacy).toContain("ומזהה המשתמש שלכם בפייסבוק");
    // The deletion request is only as automatic as Meta makes it, and the page says what to do if it is not.
    expect(privacy).toContain("אם האפשרות הזאת לא מופיעה אצלכם בפייסבוק");
    expect(privacy).not.toContain("פייסבוק שולחת לנו את הבקשה אוטומטית");
    expect(privacy).toContain("קוד אישור");
  });

  it("there is no automatic deletion of the connected-account tables, so the text promises none", () => {
    const janitor = source("packages/core/src/pipelines/janitor.ts");
    expect(janitor).not.toMatch(/socialAccounts|scheduledPosts|social_accounts|scheduled_posts/);
    expect(privacy).toContain("אין להם מחיקה אוטומטית");
  });
});

describe("/privacy §9, the connect cookies", () => {
  it("names them as the code does, with the lifetimes the code sets", () => {
    expect(OAUTH_COOKIE).toBe("aiugc.social_oauth");
    expect(TIKTOK_OAUTH_COOKIE).toBe("aiugc.tiktok_oauth");
    expect(privacy).toContain(OAUTH_COOKIE);
    expect(privacy).toContain(TIKTOK_OAUTH_COOKIE);
    expect(OAUTH_COOKIE_MAX_AGE_SECONDS).toBe(24 * 60 * 60);
    expect(OAUTH_WINDOW_MS).toBe(30 * 60_000);
    expect(privacy).toContain("עד 24 שעות");
    expect(privacy).toContain("עד חצי שעה מההתחלה");
    expect(privacy).toContain("HttpOnly");
  });

  it("the cookie's contents are the four fields the code writes, and no token", () => {
    const oauth = source("apps/web/src/lib/social-oauth.ts");
    const schema = oauth.slice(
      oauth.indexOf("const cookieSchema"),
      oauth.indexOf("export type OAuthCookie"),
    );
    expect(schema).toMatch(/state:[\s\S]*userId:[\s\S]*returnTo:[\s\S]*issuedAt:/);
    expect(schema).not.toMatch(/token|code|secret/i);
    expect(privacy).toContain("ולא אסימונים ולא פרטים על החשבון שמחברים");
  });
});

describe("the emails", () => {
  it("§5 and §6 name the failure email and the TikTok delivery email, and Resend for every email", () => {
    expect(privacy).toContain("הודעה על פרסום שנכשל");
    expect(privacy).toContain("הגיע לתיבת הדואר של טיקטוק");
    expect(privacy).toContain("ואין כרגע הגדרה שמפסיקה אותן");
    expect(privacy).toContain("כל המיילים שהשירות שולח לכם");
    expect(privacy).toContain("נשלחים דרך שירות Resend");
    expect(privacy).toContain("בהודעות הפרסום שם העסק, שם המשתמש או שם התצוגה של החשבון המחובר");
  });

  it("the code sends exactly those kinds from the worker, with no marketing sender and no caption in the body", () => {
    const failure = source("packages/core/src/pipelines/social-failure-email.ts");
    const delivery = source("packages/core/src/pipelines/social-delivery-email.ts");
    expect(failure).toContain("post_failure_email");
    expect(delivery).toContain("post_delivery_email");
    // The Resend provider is reached through one gate (the failure file's), and the only code that
    // sends through it is sendPostEmail, called by exactly the three sweeps.
    const files = walk(path.join(repo, "packages/core/src"))
      .concat(walk(path.join(repo, "apps")))
      .map((file) => ({
        name: path.relative(repo, file).replace(/\\/g, "/"),
        text: readFileSync(file, "utf8"),
      }))
      .filter(
        (file) => !file.name.includes("/test/") && !file.name.endsWith("providers/resend.ts"),
      );
    expect(files.filter((f) => /getEmailProvider\(\)/.test(f.text)).map((f) => f.name)).toEqual([
      "packages/core/src/pipelines/social-failure-email.ts",
    ]);
    expect(files.filter((f) => /provider\.send\(/.test(f.text)).map((f) => f.name)).toEqual([
      "packages/core/src/pipelines/social-failure-email.ts",
    ]);
    expect(
      files
        .filter((f) => /await sendPostEmail\(/.test(f.text))
        .map((f) => f.name)
        .sort(),
    ).toEqual([
      // The Instagram autopilot's pause and low-sound emails (decision 0127): admin-only
      // today, so no customer receives them and /privacy is unchanged. When the autopilot
      // opens to customers, §5 must name them first (vault 0127, owed).
      "packages/core/src/pipelines/autopilot-email.ts",
      "packages/core/src/pipelines/social-delivery-email.ts",
      "packages/core/src/pipelines/social-failure-email.ts",
    ]);
    const copy = source("packages/core/src/social-copy.ts");
    expect(copy.slice(copy.indexOf("export function deliveryEmail"))).not.toMatch(/caption/i);
  });
});

describe("/terms §4, connected accounts", () => {
  it("has the subsection, with the authorisation, the responsibility and the no-guarantee", () => {
    expect(terms).toContain("חשבונות רשתות חברתיות מחוברים");
    expect(terms).toContain("אתם מאשרים לנו לפרסם בו, או לשלוח אליו, את הסרטונים שתזמנתם");
    expect(terms).toContain("ורק אותם");
    expect(terms).toContain("מה שמפורסם או נשלח לחשבון שלכם באחריותכם");
    expect(terms).toContain("אנחנו לא מבטיחים שפרסום או שליחה יתקבלו בפלטפורמה");
  });

  it("only schedulePosts creates a post, which is what 'only the videos you scheduled' rests on", () => {
    const hits = walk(path.join(repo, "packages/core/src"))
      .concat(walk(path.join(repo, "apps")))
      .filter((file) =>
        /insert\(scheduledPosts\)|insert\(schema\.scheduledPosts\)/.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map((file) => path.relative(repo, file).replace(/\\/g, "/"))
      .filter((file) => !file.includes("/test/"));
    expect(hits).toEqual(["packages/core/src/pipelines/social.ts"]);
  });
});

describe("what the review of 2026-10-17 corrected", () => {
  it("transfers to the platforms are described as they happen, not only 'if you scheduled'", () => {
    // The sound-search text and the daily check reach the platforms with nothing scheduled.
    expect(privacy).toContain("הטקסט שהקלדתם בחיפוש סאונד באינסטגרם נשלח ל־Meta כבר בזמן החיפוש");
    expect(privacy).toContain(
      "ובבדיקה היומית של כל חיבור פעיל נשלח לפלטפורמה אסימון הגישה של החיבור",
    );
    expect(privacy).not.toContain("ההעברה נעשית רק אם חיברתם חשבון ותזמנתם פרסום");
    expect(privacy).toContain(
      "לחפש סאונד כשאתם בוחרים סאונד באינסטגרם, ולבדוק פעם ביום שהחיבור עדיין תקף",
    );
  });

  it("the signed-link lifetime sentence of §11 no longer contradicts §13's two hours for TikTok", () => {
    expect(privacy).toContain("ובטיקטוק שעתיים (סעיפים 6 ו־13)");
    expect(privacy).not.toContain(
      "וכל צפייה או הורדה שלהם נעשית דרך קישורים חתומים שתוקפם שעה אחת",
    );
  });

  it("Facebook removal is described as detected, not announced; and the Page list is not understated", () => {
    expect(privacy).toContain("פייסבוק אינה מודיעה לנו על הסרה רגילה");
    expect(privacy).toContain("עד אז הוא עשוי להופיע אצלנו כמחובר");
    expect(privacy).toContain("עד 100 הדפים הראשונים שפייסבוק מחזירה");
    expect(privacy).toContain("אנחנו שומרים רק דפים שמחובר אליהם חשבון אינסטגרם מקצועי");
  });

  it("promises no more than the code: a start from the scheduled time, usually an email, TikTok's reports", () => {
    expect(privacy).toContain("החל מהמועד שבחרתם");
    expect(privacy).toContain("הפרסום עשוי להתעכב אחרי המועד");
    expect(privacy).toContain("באפליקציה ובדרך כלל גם באימייל");
    expect(privacy).toContain("ומה שטיקטוק מדווחת לנו על הסרטון הזה");
    expect(privacy).toContain("הקבלה על תשלום אינה נשלחת דרך שירות זה");
    expect(privacy).toContain("אנחנו לא שולחים לבעלי חשבון דיוור שיווקי");
    expect(privacy).toContain(
      "מתחילים חיבור של חשבון אינסטגרם או טיקטוק (בהגדרות, או במסך תזמון הפרסום",
    );
  });
});
