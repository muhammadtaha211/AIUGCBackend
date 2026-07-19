"use client";

import Link from "next/link";
import { Wordmark } from "@/components/wordmark";

const NAV_LINK = "text-sm text-gray-400 transition-colors duration-150 hover:text-white";

/**
 * The onboarding environment: nav, lighting, and page structure. Every step renders
 * inside it, so moving between questions changes the content — never the scene.
 * Steps mark their interactive area with id="onboarding-content" (one per screen).
 */
export function OnboardingShell({ children }: { children: React.ReactNode }) {
  function startNow() {
    const content = document.getElementById("onboarding-content");
    content?.scrollIntoView({ behavior: "smooth", block: "center" });
    content
      ?.querySelector<HTMLElement>('input, textarea, [role="radio"]')
      ?.focus({ preventScroll: true });
  }

  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden">
      {/* Background only — a blurred lime shape for depth; the UI stays clean. */}
      <div
        aria-hidden
        className="absolute left-1/2 top-16 -z-10 h-64 w-[36rem] max-w-full -translate-x-1/2 rounded-full bg-accent/10 blur-3xl"
      />

      <header className="relative flex h-16 shrink-0 items-center justify-between px-6 sm:px-10">
        <Wordmark />

        <nav
          aria-label="ניווט ראשי"
          className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-8 sm:flex"
        >
          <button type="button" className={NAV_LINK}>
            מחירים
          </button>
          <button type="button" className={NAV_LINK}>
            צור קשר
          </button>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="flex h-9 items-center rounded-lg px-3 text-sm font-medium text-gray-300 transition-colors duration-150 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            התחברות
          </Link>
          <button
            type="button"
            onClick={startNow}
            className="flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-ink transition-colors duration-150 hover:bg-accent-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            התחל עכשיו
          </button>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center px-6 pb-20">{children}</main>
    </div>
  );
}
