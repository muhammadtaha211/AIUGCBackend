import type { Metadata } from "next";
import Link from "next/link";
import { Bullets, CONTACT_EMAIL, Lawyer, LegalTitle, Ltr, Section, UPDATED } from "../legal";

export const metadata: Metadata = {
  title: "תנאי שימוש | תבנית",
  description:
    "תנאי השימוש בשירות תבנית: החשבון, התוכן שלכם, הבעלות על המודעות, דמויות AI, קרדיטים ותשלום, זמינות ואחריות.",
};

/**
 * Every factual statement here was checked against the repo on 2026-09-02
 * (fact sheet in the session that wrote it). Change the code, change the text.
 * `[LAWYER: …]` markers are review notes for counsel and are removed by them.
 */
export default function TermsPage() {
  return (
    <>
      <LegalTitle title="תנאי שימוש" updated={UPDATED} />

      <p className="mt-6 text-[15px] leading-relaxed text-ink/80">
        ברוכים הבאים לתבנית. התנאים האלה הם הסכם ביניכם לבין מפעיל השירות, וחלים על השימוש באתר{" "}
        <Ltr>tavnit.ai</Ltr> ובשירות. קראו אותם: יצירת חשבון או שימוש בשירות מהווים הסכמה להם.{" "}
        <Lawyer>
          acceptance by use, no clickwrap: signup and login each show a one-line notice with links
          above the Google/email buttons, no checkbox and no acceptance record; confirm this forms
          the contract or require a checkbox
        </Lawyer>{" "}
        <Link
          href="/privacy"
          className="underline decoration-ink/30 underline-offset-4 hover:text-ink"
        >
          מדיניות הפרטיות
        </Link>{" "}
        היא חלק מהתנאים.
      </p>

      <Section n={1} title="הצדדים וקבלת התנאים">
        <p>
          השירות מופעל על ידי מוחמד טאהא (<Ltr>Mohammad Taha</Ltr>), יחיד, מספר זהות{" "}
          <Ltr>211924196</Ltr>, כאבול, ישראל, תחת המותג ״תבנית״ (<Ltr>Tavnit</Ltr>; להלן: ״אנחנו״).{" "}
          <Lawyer>
            operator is an individual; confirm whether dealer status (osek murshe / osek patur) and
            a fuller postal address must be stated
          </Lawyer>
        </p>
        <p>
          התנאים חלים על כל מי שמשתמש בשירות, כולל מי שנכנס באמצעות <Ltr>Google</Ltr>. בהרשמה אתם
          מאשרים שאתם בני 18 לפחות, שאתם פועלים בשם עסק או כמפרסמים, ושיש לכם סמכות לחייב את העסק
          שבשמו אתם פועלים. השירות מיועד לעסקים בלבד.{" "}
          <Lawyer>
            Israeli consumer-protection rules on continuing transactions (iska mitmashechet) may
            reach small businesses and sole traders; confirm the B2B-only framing
          </Lawyer>
        </p>
      </Section>

      <Section n={2} title="מהו השירות">
        <p>
          תבנית הופכת סרטון הדגמה של המוצר (בין 8 שניות ל־3 דקות) שצילמתם בטלפון, יחד עם תשובות
          לשאלון, למודעות וידאו אנכיות בעברית (<Ltr>9:16</Ltr>, <Ltr>1080×1920</Ltr>, <Ltr>MP4</Ltr>
          ). השירות כולל:
        </p>
        <Bullets>
          <li>
            מודעות מסרטון ההדגמה: קליפ פתיחה של דמות <Ltr>AI</Ltr> מהמאגר שלנו עם משפט פתיחה, ואחריו
            קטעים קצרים מסרטון ההדגמה שלכם, כל אחד עם כיתוב קצר בעברית. מודעות אלה מופקות כיום ללא
            קריינות וללא פסקול. גרסה עם קריינות בעברית שנוצרת בבינה מלאכותית אינה זמינה כיום בשירות
            העצמי.
          </li>
          <li>
            מודעות עם דמות <Ltr>AI</Ltr>: דמות קבועה שנוצרה בבינה מלאכותית, מתמונת ייחוס וקול
            מסונתז, שמציגה את המוצר שלכם. למוצר פיזי ניתן ליצור תמונה משולבת של המוצר ביד הדמות.
          </li>
        </Bullets>
        <p>
          הטקסטים, הקריינות, התמונות והסרטונים נוצרים בעזרת ספקי בינה מלאכותית חיצוניים (המפורטים
          במדיניות הפרטיות). הפלט הוא הצעה. לפני ההפקה: במודעות מסרטון ההדגמה אתם בוחרים או עורכים
          את משפט הפתיחה ומאשרים את תוכנית הצעדים; במודעות עם דמות אתם עורכים את התסריט לפי הצורך,
          מאשרים את הקריינות, ואם יצרתם תמונה משולבת של המוצר, מאשרים גם אותה. אתם אחראים למה
          שתפרסמו.
        </p>
      </Section>

      <Section n={3} title="החשבון">
        <Bullets>
          <li>
            החשבון מזוהה לפי כתובת האימייל שנרשמתם איתה. שמרו על הסיסמה; אתם אחראים לכל פעולה שנעשית
            בחשבון.
          </li>
          <li>
            ניתן לנהל בחשבון אחד יותר מעסק אחד. הקרדיטים שייכים לחשבון ומשותפים לכל העסקים שבו.
          </li>
          <li>אנחנו רשאים לסרב לפתוח חשבון, ולהשעות או לסגור חשבון לפי סעיף 11.</li>
        </Bullets>
      </Section>

      <Section n={4} title="התוכן שלכם והתחייבויותיכם">
        <p>
          הסרטונים, התמונות והטקסטים שאתם מעלים או מזינים (״התוכן שלכם״) נשארים שלכם. אתם מעניקים
          לנו רישיון לאחסן, לעבד, לשנות ולשלב את התוכן שלכם ככל שנדרש כדי לספק לכם את השירות, כולל
          העברתו לספקים שלנו.
        </p>
        <p>אתם מצהירים ומתחייבים כי:</p>
        <Bullets>
          <li>
            כל הזכויות בסרטונים ובתמונות שאתם מעלים, כולל בפסקול המוקלט בהם (מוזיקה, דיבור, קולות
            רקע), הן שלכם. שימו לב: הקול המקורי של סרטון ההדגמה אינו נכלל במודעות שאנחנו מפיקים
            כיום, אך הסרטון נשמר אצלנו כולל ערוץ הקול המקורי שלו (ראו מדיניות הפרטיות, סעיף 3).
          </li>
          <li>כל אדם שמופיע או נשמע בתוכן שלכם נתן את הסכמתו לשימוש בו בפרסום.</li>
          <li>
            הטענות על המוצר שלכם, בשאלון, בטקסטים שאתם עורכים ובמודעה, נכונות, ניתנות להוכחה ומותרות
            לפי הדין החל על תחום העיסוק שלכם.
          </li>
          <li>
            התוכן שלכם אינו מפר זכויות יוצרים, סימני מסחר, פרטיות או כל זכות אחרת של צד שלישי.
          </li>
          <li>
            אתם אחראים לעמידה בכללי הפלטפורמות שבהן תפרסמו (למשל <Ltr>Meta</Ltr>, <Ltr>TikTok</Ltr>,{" "}
            <Ltr>Google</Ltr>), כולל כל חובת גילוי לגבי תוכן שנוצר בבינה מלאכותית שהפלטפורמות או
            הדין דורשים.{" "}
            <Lawyer>verify current AI-disclosure requirements for advertising in Israel</Lawyer>
          </li>
          <li>
            מוזיקה או צליל שתוסיפו למודעה לאחר ההורדה (למשל מספריית הפלטפורמה) הם באחריותכם. המודעות
            מסופקות ללא מוזיקה.
          </li>
          <li>
            תימנעו ככל האפשר מצילום מסכים שמופיעים בהם פרטים אישיים של אנשים אחרים; אם הם מופיעים,
            אתם אחראים לכך שמותר לכם להשתמש בהם בפרסום.
          </li>
        </Bullets>
      </Section>

      <Section n={5} title="בעלות ורישיונות">
        <Bullets>
          <li>
            המודעות המוגמרות שנוצרו עבור העסק שלכם שייכות לכם, ואתם רשאים לפרסם אותן בכל ערוץ לצורכי
            העסק.{" "}
            <Lawyer>
              the finished ads are AI-generated output; confirm whether &quot;belong to you&quot;
              should read as assignment of whatever rights exist under Israeli law
            </Lawyer>
          </li>
          <li>
            קליפי הפתיחה, דמויות ה־<Ltr>AI</Ltr>, הקולות, התבניות, מבני התסריטים והתוכנה שמפעילה את
            השירות הם שלנו (או של מי שהעניק לנו רישיון). אתם מקבלים רישיון להשתמש בהם רק כפי שהם
            משולבים במודעות שנוצרו עבורכם. אסור לחלץ אותם מהמודעה, להשתמש בהם בנפרד, לשכפל דמות או
            קול, או להשתמש בהם לאימון מודלים.{" "}
            <Lawyer>
              everything listed as ours is AI-generated on third-party services: hook clips on
              Seedance (offline), persona images and product composites via fal.ai, voices are
              ElevenLabs voices (library or custom is not recorded; founder to state), and the
              Service B script structures are founder-written skeletons whose provenance is not
              recorded. Confirm what &quot;ours / licensed to us&quot; can honestly assert for each,
              given the open copyrightability of AI output under Israeli law
            </Lawyer>
          </li>
          <li>
            אנחנו לא מאמנים מודלים על התוכן שלכם ולא מציגים אותו כדוגמה בלי הסכמה מפורשת ונפרדת
            שלכם. אנחנו רשאים להשתמש בנתונים מצטברים ואנונימיים כדי לשפר את השירות.
          </li>
        </Bullets>
      </Section>

      <Section
        n={6}
        title={
          <>
            דמויות <Ltr>AI</Ltr> ותוכן סינתטי
          </>
        }
      >
        <Bullets>
          <li>
            הדמויות בקליפי הפתיחה ובמודעות עם דמות <Ltr>AI</Ltr> הן דמויות סינתטיות שנוצרו בבינה
            מלאכותית. הן אינן אנשים אמיתיים ואינן לקוחות שלכם.{" "}
            <Lawyer>
              AI-generated faces can resemble real people; confirm the &quot;not real people&quot;
              representation and any likeness / right-of-publicity exposure for the persona bank
            </Lawyer>
          </li>
          <li>
            אסור להציג דמות כזאת כלקוח אמיתי, כעדות אמיתית, כאדם ספציפי או כמי שהשתמש במוצר בפועל.
            תסריט שנכתב בגוף ראשון הוא טקסט שיווקי, לא עדות.
          </li>
          <li>אתם אחראים לכל גילוי או סימון שהדין או הפלטפורמה דורשים לתוכן כזה (סעיף 4).</li>
        </Bullets>
      </Section>

      <Section n={7} title="שימוש אסור">
        <p>אסור להשתמש בשירות כדי ליצור או להפיץ תוכן:</p>
        <Bullets>
          <li>
            בלתי חוקי, או שמקדם מוצר או שירות שאסור לפרסם או שדורש רישיון שאין לכם (למשל תרופות,
            הימורים, כלי נשק).
          </li>
          <li>
            מטעה, כולל טענות רפואיות, בריאותיות או פיננסיות שאינן מבוססות, הבטחות לתוצאות, והמלצות
            או עדויות מומצאות.
          </li>
          <li>שמפר קניין רוחני, פרטיות או זכויות של אחרים, או שמתחזה לאדם, לעסק או למותג אחר.</li>
          <li>מיני או פוגעני, או שמכיל שנאה, הטרדה או אפליה.</li>
          <li>שמהווה תעמולה פוליטית.</li>
        </Bullets>
        <p>
          <Lawyer>confirm and adjust the prohibited categories for Israeli advertising law</Lawyer>
        </p>
        <p>
          אנחנו לא בודקים תוכן לפני ההפקה, לא את מה שאתם מזינים ולא את מה שנוצר, ואין לנו חובה לעשות
          זאת. הבדיקות היחידות שמתבצעות אוטומטית הן טכניות: סוג הקובץ, גודלו, אורכו וכיוונו, אורך
          הטקסטים, ובדיקה אוטומטית של איכות הצילום (האם המסך המצולם יציב וקריא) שעלולה לדחות סרטון
          ולבקש מכם לצלם אותו מחדש. אף אחת מהן אינה בודקת את התוכן עצמו. עם זאת, אנחנו רשאים לסרב
          להפיק, להסיר או לחסום תוכן שמפר תנאים אלה, ולהשעות חשבון בגינו, בכל עת ולפי שיקול דעתנו.{" "}
          <Lawyer>
            &quot;no duty to pre-screen&quot; is a legal position, not a fact: the service generates
            the ad copy itself (Claude writes hook lines, captions and scripts), so confirm exposure
            as author/publisher rather than host under defamation, consumer-protection and IP law,
            and whether the sentence should stay
          </Lawyer>
        </p>
      </Section>

      <Section n={8} title="קרדיטים, מחירים ותשלום">
        <Bullets>
          <li>
            יצירת סרטון מחייבת קרדיטים. המחיר בקרדיטים של כל סרטון מוצג לפני האישור, ומנוכה מיתרת
            החשבון עם האישור.
          </li>
          <li>
            כיום הקרדיטים נטענים לחשבון בתיאום איתנו (בכתובת שבסעיף 16); ללא יתרת קרדיטים לא ניתן
            להתחיל יצירה. קרדיטים שנטענו לחשבון ידנית אינם פוקעים בסוף תקופת חיוב ונשארים בחשבון כל
            עוד הוא פתוח (ראו סעיף 11).
          </li>
          <li>
            בנוסף לקרדיטים, על כל חשבון חלות מכסות שימוש יומיות (בחלון מתגלגל של 24 שעות) שנועדו
            למנוע שימוש לרעה: על מספר השמעות הקריינות לבדיקה ועל היקף הקריינות המופקת, על ניתוח
            הסרטון ויצירת תוכנית הצעדים, ועל היקף הסרטונים המופקים עם דמות. השמעות לבדיקה, משפטי
            פתיחה, תסריטים, ניתוח הסרטון ותמונות משולבות אינם מחויבים בקרדיטים. כשמגיעים למכסה,
            הפעולה נדחית עם הודעה מתאימה עד שיחלוף החלון; אם הפקת סרטון נדחתה בשל המכסה לאחר האישור,
            הקרדיטים מוחזרים כמו בכל הפקה שנכשלה. אנחנו רשאים לשנות את המכסות.
          </li>
          <li>
            אנחנו רשאים לשנות את המחיר בקרדיטים של סרטון בכל עת. המחיר שינוכה הוא המחיר התקף במועד
            האישור.
          </li>
          <li>
            כשתתאפשר רכישה מקוונת, יחולו התנאים הבאים:
            <Bullets>
              <li>
                מנוי חודשי שכולל מכסת קרדיטים. המחירים יוצגו באתר לפני הרכישה, ושם יצוין אם הם
                כוללים מע״מ. <Lawyer>VAT presentation of prices</Lawyer>
              </li>
              <li>קרדיטים של המנוי אינם נצברים: מה שלא נוצל עד סוף תקופת החיוב פוקע.</li>
              <li>
                המנוי מתחדש אוטומטית מדי חודש עד לביטולו. ביטול נכנס לתוקף בסוף תקופת החיוב השוטפת;
                עד אז ניתן להמשיך להשתמש בקרדיטים.
              </li>
              <li>
                שינוי במחיר המנוי או במכסת הקרדיטים שלו יחול מתקופת החיוב הבאה, לאחר הודעה.{" "}
                <Lawyer>
                  unilateral price/quota change: Standard Contracts Law s.4(4) presumption (reaches
                  business customers too); set a minimum notice length and form, and state the right
                  to cancel without penalty before the change applies
                </Lawyer>
              </li>
              <li>אם חיוב נכשל, נשוב וננסה לחייב, ואם התשלום לא יוסדר, המנוי יושעה.</li>
              <li>
                התשלום נעשה דרך ספק סליקה ישראלי. פרטי כרטיס האשראי נמסרים לספק הסליקה ואינם נשמרים
                אצלנו. חשבונית או קבלה, כנדרש לפי דין, תופק ותישלח לכתובת האימייל של החשבון.{" "}
                <Lawyer>
                  this sub-list describes the planned hosted-page design (docs/05-billing.md); no
                  gateway or invoicing integration is built and the vendor is unconfirmed. Confirm
                  &quot;card details are not held by us&quot; may be promised before the vendor is
                  chosen, and align the document type (tax invoice / receipt) with the dealer-status
                  answer in section 1
                </Lawyer>
              </li>
            </Bullets>
          </li>
          <li>
            החזרים: אם הפקת סרטון נכשלה, הקרדיטים שחויבו מוחזרים לחשבון אוטומטית. הקרדיטים אינם
            ניתנים להמרה לכסף, ואנחנו לא מחזירים תשלומים אלא כנדרש לפי דין.{" "}
            <Lawyer>
              money refunds, refund of unused credits on termination, and auto-renewal/cancellation
              rules under the Consumer Protection Law
            </Lawyer>
          </li>
          <li>
            הסרטונים המוגמרים זמינים להורדה עד 90 ימים ממועד השחרור, כלומר מהרגע שהסרטון הפך זמין
            לכם (ראו מדיניות הפרטיות). שמרו אצלכם עותק.
          </li>
        </Bullets>
      </Section>

      <Section n={9} title="הפקה מותאמת אישית">
        <p>
          שירותי הפקה מותאמים אישית (״עשו את זה בשבילי״, <Ltr>DFY</Ltr>) מסופקים לפי הסכם נפרד ואינם
          כלולים בתנאים אלה, אלא אם נאמר אחרת באותו הסכם.
        </p>
      </Section>

      <Section n={10} title="זמינות, איכות ואחריות לתוצאות">
        <Bullets>
          <li>
            השירות ניתן כפי שהוא (<Ltr>As Is</Ltr>), במאמץ סביר וללא התחייבות לזמינות רציפה, לזמני
            הפקה או לרמת שירות מוגדרת. ייתכנו תקלות, תחזוקה והפסקות.
          </li>
          <li>
            הפקה עשויה להתעכב או להיכשל, בין השאר אם ספק חיצוני מסרב לבצע אותה או אם השירות הגיע
            לתקרת הקיבולת שלו. אם ההפקה נכשלה, הקרדיטים מוחזרים (סעיף 8), וזה הסעד היחיד.{" "}
            <Lawyer>
              As-Is / no-SLA and credits-as-sole-remedy are exemption and remedy-limiting terms
              presumed unduly disadvantageous under the Standard Contracts Law 1982 s.4(1) and
              s.4(6), which reaches business customers too; the savings clause in section 12 does
              not textually cover this section
            </Lawyer>
          </li>
          <li>תוכן שנוצר בבינה מלאכותית עלול להיות לא מדויק או לא מתאים. בדקו אותו לפני פרסום.</li>
          <li>
            אנחנו לא מבטיחים תוצאות עסקיות, ביצועים של מודעות, או שהפלטפורמות יאשרו את המודעות שלכם.
          </li>
          <li>אנחנו רשאים לשנות, להוסיף או להפסיק תכונות בשירות.</li>
        </Bullets>
      </Section>

      <Section n={11} title="השעיה וסיום">
        <Bullets>
          <li>
            אנחנו רשאים להשעות או לסגור חשבון אם הופרו התנאים, אם הדבר נדרש לפי דין, או אם השימוש
            מסכן את השירות או את משתמשיו. ככל שאפשר, נודיע לכם.{" "}
            <Lawyer>
              suspension/closure at our discretion with best-effort notice (also section 3 refusal
              and section 7 discretionary removal): Standard Contracts Law s.4(2) presumption
              reaches B2B uniform contracts; confirm wording and whether a notice/cure period is
              required
            </Lawyer>
          </li>
          <li>
            אתם רשאים להפסיק להשתמש בשירות בכל עת ולבקש למחוק את החשבון (ראו מדיניות הפרטיות).
          </li>
          <li>
            עם סגירת החשבון, התוכן והמודעות שלא הורדתם יימחקו לפי מדיניות הפרטיות, וכל הקרדיטים שלא
            נוצלו, כולל קרדיטים שנטענו ידנית, יפקעו. הקרדיטים אינם ניתנים להמרה לכסף (סעיף 8).{" "}
            <Lawyer>
              expiry of unused credits on closure, including manually loaded or prepaid ones; same
              question as the section 8 refund marker
            </Lawyer>
          </li>
        </Bullets>
      </Section>

      <Section n={12} title="הגבלת אחריות ושיפוי">
        <Bullets>
          <li>
            במידה המרבית המותרת לפי דין, לא נהיה אחראים לנזק עקיף, תוצאתי או מיוחד, לאובדן רווחים,
            נתונים או מוניטין, או לתוצאות של פרסום המודעות.
          </li>
          <li>
            האחריות הכוללת שלנו כלפיכם לא תעלה על הסכום ששילמתם לנו בשלושת החודשים שקדמו לאירוע.{" "}
            <Lawyer>
              cap amount; most accounts have paid nothing to date, so this cap may be zero
            </Lawyer>
          </li>
          <li>
            אתם תשפו אותנו על כל תביעה, נזק או הוצאה שינבעו מהתוכן שלכם, מהמודעות שפרסמתם או מהפרת
            התנאים על ידכם.{" "}
            <Lawyer>
              indemnity is uncapped and one-sided; confirm scope (legal costs? claims caused by our
              own generated copy?), whether it should be capped like the clause above, and Standard
              Contracts Law s.4 exposure
            </Lawyer>
          </li>
          <li>אין באמור כדי לגרוע מזכויות שאינן ניתנות להתניה לפי דין.</li>
        </Bullets>
      </Section>

      <Section n={13} title="דין וסמכות שיפוט">
        <p>
          על התנאים יחול הדין הישראלי. סמכות השיפוט הבלעדית נתונה לבתי המשפט המוסמכים בתל אביב-יפו.{" "}
          <Lawyer>
            exclusive Tel Aviv venue: Standard Contracts Law s.4(9) presumes a term displacing
            statutory venue rules to be unduly disadvantageous, and the law reaches business
            customers too; confirm, or soften to non-exclusive
          </Lawyer>
        </p>
      </Section>

      <Section n={14} title="שינויים בתנאים">
        <p>
          אנחנו רשאים לעדכן את התנאים. על שינוי מהותי נודיע באימייל לחשבון לפני כניסתו לתוקף,
          והתאריך בראש העמוד יתעדכן. המשך שימוש לאחר מועד העדכון מהווה הסכמה לתנאים המעודכנים.{" "}
          <Lawyer>notice period and enforceability of continued-use acceptance</Lawyer>
        </p>
      </Section>

      <Section n={15} title="שונות">
        <p>
          אם ייקבע שסעיף מהתנאים אינו תקף, יתר הסעיפים יעמדו בתוקפם. התנאים ומדיניות הפרטיות הם
          ההסכם המלא ביניכם לבינינו לגבי השירות.
        </p>
      </Section>

      <Section n={16} title="יצירת קשר">
        <p>
          <Ltr>{CONTACT_EMAIL}</Ltr>
        </p>
      </Section>
    </>
  );
}
