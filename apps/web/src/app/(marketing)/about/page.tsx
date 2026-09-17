import type { Metadata } from "next";
import Link from "next/link";
import { OPERATOR_ADDRESS } from "@/app/(legal)/legal";

export const metadata: Metadata = {
  title: "אודות | תבנית",
  description:
    "תבנית היא שירות ישראלי ליצירת מודעות וידאו בעברית לעסקים: מסרטון אחד מהטלפון לחבילת מודעות מוכנה לפרסום.",
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
 * Deliberately NOT repeated from the landing: its Service A "קריינות" promise.
 * That format was retired 2026-09-05 (CLAUDE.md) and the landing copy is stale
 * on it; this page says what the product does today.
 */
export default function AboutPage() {
  return (
    <>
      <section className="mx-auto max-w-3xl px-5 pb-10 pt-14 sm:px-8 sm:pt-20">
        <h1 className="rise font-display text-[40px] leading-tight text-ink sm:text-[56px]">
          מודעות וידאו בעברית, מסרטון אחד
        </h1>
        <p
          className="rise mt-5 max-w-2xl text-lg leading-relaxed text-ink/65"
          style={{ animationDelay: "80ms" }}
        >
          תבנית היא פלטפורמה ישראלית שהופכת סרטון קצר שצילמתם בטלפון לחבילת מודעות וידאו אנכיות
          בעברית, מוכנות לפרסום.
        </p>
      </section>

      <section className="mx-auto max-w-3xl space-y-10 px-5 pb-24 text-[15px] leading-relaxed text-ink/75 sm:px-8">
        <div>
          <h2 className="font-display text-2xl leading-tight text-ink">מה תבנית עושה</h2>
          <p className="mt-3">
            מעלים סרטון קצר של המוצר או של העסק, עונים על שאלון קצר, ומקבלים כמה גרסאות של אותה
            מודעה. כל מודעה נבנית מהחומר שלכם: אותו דמו, פתיחים שונים ומסרים שונים, כך שאפשר לבדוק
            מה עובד בלי לצלם מחדש. כל המודעות יוצאות אנכיות, בפורמט שהפיד מצפה לו, עם כתוביות בעברית
            שנראות נכון — מימין לשמאל, בלי אותיות הפוכות ובלי תרגום של כלי אמריקאי.
          </p>
          <p className="mt-3">
            לצד המודעות שנבנות מסרטון ההדגמה שלכם, אפשר להפיק מודעות עם דמות AI קבועה: פרזנטור
            דיגיטלי בעברית שמציג את המוצר מול המצלמה, בלי צלם, בלי אולפן ובלי יום צילום.
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
