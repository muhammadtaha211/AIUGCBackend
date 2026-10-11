"use client";

import Link from "next/link";
import { Brand } from "@/components/brand";
import { NAV_PRICING } from "@/lib/plans-ui";

const NAV_LINK =
  "text-sm font-medium text-ink/60 transition-colors duration-150 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink";

/**
 * The onboarding environment, matching the landing page: paper base, soft
 * green glow, sticky header. Every step renders inside it, so moving between
 * questions changes the content — never the scene. Steps mark their
 * interactive area with id="onboarding-content" (one per screen).
 */
export function OnboardingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-light relative isolate flex min-h-dvh flex-col overflow-hidden bg-paper text-ink">
      {/* Background only — the landing's aurora, dialed down so the forms stay calm. */}
      <div
        aria-hidden
        className="absolute left-1/2 top-8 -z-10 h-64 w-[38rem] max-w-full -translate-x-1/2 rounded-full bg-accent/30 blur-3xl"
      />
      <div
        aria-hidden
        className="absolute right-[10%] top-28 -z-10 h-40 w-72 rounded-full bg-emerald-300/20 blur-3xl"
      />

      <header
        className="sticky top-0 z-40 border-b border-ink/[0.06] bg-paper/85 backdrop-blur-md"
        data-ph-unmask
      >
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
            <Link href="/#features" className={NAV_LINK}>
              יכולות
            </Link>
            <Link href="/pricing" className={NAV_LINK}>
              {NAV_PRICING}
            </Link>
            <Link href="/#how" className={NAV_LINK}>
              איך זה עובד
            </Link>
          </nav>

          <Link
            href="/login"
            className="flex h-11 items-center rounded-lg bg-ink px-4 text-sm font-semibold text-paper transition-colors duration-150 hover:bg-ink/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink sm:h-9"
          >
            התחברות
          </Link>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center px-6 pb-20">{children}</main>
    </div>
  );
}
