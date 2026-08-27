import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "איפוס סיסמה | תבנית" };

/**
 * Request a password-recovery email. Same light card shell as /login.
 * /auth/recovery returns here with ?error=expired when a link cannot be
 * exchanged, so the failure message and the re-request form are one screen.
 */
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

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
            <h1 className="text-2xl font-semibold tracking-tight text-ink">איפוס סיסמה</h1>
            <p className="mt-2 text-[15px] text-ink/65">נשלח קישור למייל, ומשם בוחרים סיסמה חדשה.</p>

            <ForgotPasswordForm linkExpired={error === "expired"} />
          </div>

          <p className="mt-4 text-center text-sm text-ink/60">
            נזכרתם בסיסמה?{" "}
            <Link
              href="/login"
              className="font-medium text-ink underline decoration-ink/30 underline-offset-4"
            >
              חזרה לכניסה
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
