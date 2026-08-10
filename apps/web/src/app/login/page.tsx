import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "כניסה | תבנית" };

/**
 * Light login, matching the landing/onboarding scene. The layout is sized to
 * fit a laptop viewport with no scrollbar: 64px header + centered card, tight
 * vertical rhythm. Shared components pick up their light styles via theme-light.
 */
export default function LoginPage() {
  return (
    <div className="theme-light relative isolate flex min-h-dvh flex-col overflow-hidden bg-paper text-ink">
      <div
        aria-hidden
        className="absolute left-1/2 top-8 -z-10 h-56 w-[34rem] max-w-full -translate-x-1/2 rounded-full bg-accent/25 blur-3xl"
      />

      <header className="flex h-16 shrink-0 items-center px-5 sm:px-8">
        <Link
          href="/"
          aria-label="לעמוד הראשי"
          className="focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
        >
          <Brand />
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-4">
        <div className="w-full max-w-md">
          <div className="rounded-xl border border-ink/[0.08] bg-white p-6 shadow-xl shadow-ink/[0.05] sm:p-8">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">כניסה לחשבון</h1>
            <p className="mt-2 text-[15px] text-ink/65">ממשיכים מאיפה שהפסקתם.</p>

            <LoginForm />
          </div>

          <p className="mt-4 text-center text-sm text-ink/60">
            עוד אין לכם חשבון?{" "}
            <Link
              href="/"
              className="font-medium text-ink underline decoration-ink/30 underline-offset-4"
            >
              יצירת המודעה הראשונה
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
