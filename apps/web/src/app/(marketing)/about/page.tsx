import type { Metadata } from "next";
import Link from "next/link";
import { OPERATOR_ADDRESS } from "@/app/(legal)/legal";

export const metadata: Metadata = {
  title: "אודות | תבנית",
  description:
    "תבנית כותבת הוקים ותסריטים בעברית מדוברת מהשאלון של העסק שלכם, ומרכיבה סרטונים אנכיים מוכנים להעלאה: הוק + דמו מהסרטון שצילמתם, או סרטון עם דמות AI.",
};

const LINK = "underline decoration-ink/30 underline-offset-4 transition-colors hover:text-ink";

/**
 * The public "about" page. Brand-first by the founder's ruling (vault 0051):
 * it describes תבנית and who it is for, and names the operator only where the
 * law wants an operator named — no founder story, no photo, no byline.
 *
 * Its substance is the landing page's own copy, re-told; the operator line and
 * the address come from `(legal)/legal.tsx`, the one place the address lives,
 * so this page cannot drift from /terms and /privacy.
 *
 * "מה תבנית עושה" is one paragraph per service, under the app's own names, and
 * carries the same constraints the landing does: no results claim, no length
 * for the talking head, כיתובים (not כתוביות) for hook + demo's per-step text,
 * and the music line said once. The landing was stale on the retired Service A
 * "קריינות" format when this page was written; it is not any more.
 */
export default function AboutPage() {
  return (
    <>
      <section className="mx-auto max-w-3xl px-5 pb-10 pt-14 sm:px-8 sm:pt-20">
        <h1 className="rise font-display text-[36px] leading-tight text-ink sm:text-[52px]">
          מודעות וידאו בעברית, בלי לדעת לשווק ובלי לדעת לערוך
        </h1>
        <p
          className="rise mt-5 max-w-2xl text-lg leading-relaxed text-ink/65"
          style={{ animationDelay: "80ms" }}
        >
          תבנית היא פלטפורמה ישראלית שכותבת הוקים ותסריטים בעברית מדוברת מהשאלון של העסק שלכם,
          ומרכיבה מהם סרטונים אנכיים מוכנים להעלאה.
        </p>
      </section>

      <section className="mx-auto max-w-3xl space-y-10 px-5 pb-24 text-[15px] leading-relaxed text-ink/75 sm:px-8">
        <div>
          <h2 className="font-display text-2xl leading-tight text-ink">מה תבנית עושה</h2>
          <p className="mt-3">
            בהוק + דמו מעלים סרטון קצר של המוצר שצילמתם בטלפון, בוחרים דמות וקליפ פתיחה מהמאגר ומשפט
            פתיחה שנכתב לעסק שלכם, ותבנית מחלקת את הדמו לשלבים ומכתבת כל שלב בעברית. אותו דמו,
            פתיחים שונים, מסרים שונים — כך שאפשר לבדוק מה עובד בלי לצלם מחדש. הסרטון יוצא שקט: את
            המוזיקה מוסיפים בפלטפורמה עצמה.
          </p>
          <p className="mt-3">
            בסרטון עם דמות AI בוחרים דמות מהמאגר, תבנית כותבת לה תסריט בעברית מדוברת על בסיס השאלון
            וכמה נקודות שאתם נותנים לה, אתם שומעים ומאשרים את ההקלטה, ומקבלים סרטון שבו הדמות מדברת
            למצלמה עם כתוביות בעברית — בלי צלם, בלי אולפן ובלי יום צילום.
          </p>
        </div>

        <div>
          <h2 className="font-display text-2xl leading-tight text-ink">למי זה מיועד</h2>
          <p className="mt-3">
            לעסקים ולמפרסמים בישראל — חנויות ומותגים, אפליקציות ומוצרים דיגיטליים, ונותני שירות
            מקומיים — שצריכים זרם קבוע של מודעות וידאו בעברית ואין להם צוות הפקה. השירות מיועד
            לשימוש עסקי בלבד, ולא לשימוש פרטי.
          </p>
        </div>

        <div>
          <h2 className="font-display text-2xl leading-tight text-ink">איך זה עובד</h2>
          <p className="mt-3">
            אתם מצלמים בטלפון סרטון קצר שמראה את המוצר עובד, ועונים על שאלון על העסק, על היתרונות
            ועל קהל היעד. המערכת מנתחת את הסרטון, כותבת מתוך התשובות שלכם את משפטי הפתיחה ואת
            הכיתובים, ומרכיבה מהם מודעות. אתם מאשרים לפני ההפקה — את הטקסט, ובמודעות עם דמות גם את
            הקריינות — ומקבלים קבצים מוכנים להורדה ולהעלאה לקמפיין. אין תוכנת עריכה להתקין ואין
            טיימליין לגרור: אתם מצלמים ומאשרים, והמערכת עושה את השאר.
          </p>
        </div>

        <div>
          <h2 className="font-display text-2xl leading-tight text-ink">מי מפעיל את השירות</h2>
          <p className="mt-3">
            השירות מופעל על ידי עוסק פטור, {OPERATOR_ADDRESS}. מספר העוסק מופיע על הקבלות שאנחנו
            מפיקים ויימסר לפי בקשה.
          </p>
          <p className="mt-3">
            תנאי השימוש המלאים, מה נשמר אצלנו ולמי הוא מועבר, ודרכי יצירת הקשר —{" "}
            <Link href="/terms" className={LINK}>
              תנאי שימוש
            </Link>
            ,{" "}
            <Link href="/privacy" className={LINK}>
              מדיניות פרטיות
            </Link>{" "}
            ו־
            <Link href="/contact" className={LINK}>
              צור קשר
            </Link>
            .
          </p>
        </div>
      </section>
    </>
  );
}
