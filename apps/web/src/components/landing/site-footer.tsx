import Link from "next/link";
import { Brand } from "@/components/brand";
import { NAV_PRICING } from "@/lib/plans-ui";

/**
 * The landing page's footer, shared with the legal pages. Section anchors are
 * absolute (`/#features`) so they resolve from any route.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-ink/[0.06] bg-white">
      {/* Five columns since אודות/צור קשר joined: the brand keeps its 2fr and
          the four nav groups share the rest evenly. */}
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:grid-cols-[2fr_1fr_1fr_1fr_1fr] sm:px-8">
        <div>
          <Brand />
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-ink/60">
            מודעות וידאו בעברית לעסקים ישראליים. מסרטון אחד מהטלפון לחבילת מודעות מוכנה לפרסום.
          </p>
        </div>
        <nav aria-label="קישורי מוצר">
          <p className="text-sm font-bold text-ink">מוצר</p>
          <ul className="mt-2 space-y-1 text-sm text-ink/60">
            <li>
              <a href="/#features" className="inline-block py-1.5 transition-colors hover:text-ink">
                יכולות
              </a>
            </li>
            <li>
              <a href="/#how" className="inline-block py-1.5 transition-colors hover:text-ink">
                איך זה עובד
              </a>
            </li>
            <li>
              <Link
                href="/pricing"
                className="inline-block py-1.5 transition-colors hover:text-ink"
              >
                {NAV_PRICING}
              </Link>
            </li>
          </ul>
        </nav>
        <nav aria-label="קישורי חשבון">
          <p className="text-sm font-bold text-ink">חשבון</p>
          <ul className="mt-2 space-y-1 text-sm text-ink/60">
            <li>
              <Link href="/start" className="inline-block py-1.5 transition-colors hover:text-ink">
                יצירת חשבון
              </Link>
            </li>
            <li>
              <Link href="/login" className="inline-block py-1.5 transition-colors hover:text-ink">
                התחברות
              </Link>
            </li>
          </ul>
        </nav>
        <nav aria-label="קישורי חברה">
          <p className="text-sm font-bold text-ink">חברה</p>
          <ul className="mt-2 space-y-1 text-sm text-ink/60">
            <li>
              <Link href="/about" className="inline-block py-1.5 transition-colors hover:text-ink">
                אודות
              </Link>
            </li>
            <li>
              <Link
                href="/contact"
                className="inline-block py-1.5 transition-colors hover:text-ink"
              >
                צור קשר
              </Link>
            </li>
          </ul>
        </nav>
        <nav aria-label="קישורים משפטיים">
          <p className="text-sm font-bold text-ink">משפטי</p>
          <ul className="mt-2 space-y-1 text-sm text-ink/60">
            <li>
              <Link
                href="/privacy"
                className="inline-block py-1.5 transition-colors hover:text-ink"
              >
                מדיניות פרטיות
              </Link>
            </li>
            <li>
              <Link href="/terms" className="inline-block py-1.5 transition-colors hover:text-ink">
                תנאי שימוש
              </Link>
            </li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-ink/[0.06]">
        <p className="mx-auto max-w-6xl px-5 py-5 text-sm text-ink/45 sm:px-8">
          © תבנית <span dir="ltr">2026</span>. כל הזכויות שמורות.
        </p>
      </div>
    </footer>
  );
}
