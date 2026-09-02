import Link from "next/link";
import { Brand } from "@/components/brand";

const NAV_LINK =
  "text-sm font-medium text-ink/60 transition-colors duration-150 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink";

/**
 * The landing page's sticky header, shared with the legal pages. The section
 * anchors are absolute (`/#features`) so they resolve from any route; on `/`
 * itself that is the same fragment navigation as before.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-ink/[0.06] bg-paper/85 backdrop-blur-md">
      <div className="relative mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link
          href="/"
          className="focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
        >
          <Brand />
        </Link>

        <nav
          aria-label="ניווט ראשי"
          className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 md:flex"
        >
          <a href="/#features" className={NAV_LINK}>
            יכולות
          </a>
          <a href="/#how" className={NAV_LINK}>
            איך זה עובד
          </a>
        </nav>

        <Link
          href="/login"
          className="flex h-11 items-center rounded-lg bg-ink px-4 text-sm font-semibold text-paper transition-colors duration-150 hover:bg-ink/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:h-9"
        >
          התחברות
        </Link>
      </div>
    </header>
  );
}
