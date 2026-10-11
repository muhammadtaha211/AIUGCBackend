import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { RecordingNotice } from "@/components/recording-notice";
import { GOOGLE_SIGN_IN_FAILED } from "@/lib/auth";
import { safeNextPath } from "@/lib/onboarding";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "כניסה | תבנית" };

/**
 * Light login, matching the landing/onboarding scene. The layout is sized to
 * fit a laptop viewport with no scrollbar: 64px header + centered card, tight
 * vertical rhythm. Shared components pick up their light styles via theme-light.
 *
 * Also the landing for a failed Google round-trip: /auth/callback sends the
 * user here with ?error=oauth, and the message sits above the email form that
 * is the way out.
 *
 * ?next=<path> is where the email sign-in lands afterwards — the Sumit
 * return route sets it to its own URL for a browser that came back from the
 * payment page without a session, so signing in completes the payment
 * (safeNextPath refuses anything but /home paths and that route).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string | string[] }>;
}) {
  const { error, next } = await searchParams;

  return (
    <div className="theme-light relative isolate flex min-h-dvh flex-col overflow-hidden bg-paper text-ink">
      <div
        aria-hidden
        className="absolute left-1/2 top-8 -z-10 h-56 w-[34rem] max-w-full -translate-x-1/2 rounded-full bg-accent/25 blur-3xl"
      />

      <header className="flex h-16 shrink-0 items-center px-5 sm:px-8" data-ph-unmask>
        <Link
          href="/"
          aria-label="לעמוד הראשי"
          className="focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
        >
          <Brand />
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-4" data-ph-unmask>
        <div className="w-full max-w-md">
          <div className="rounded-xl border border-ink/[0.08] bg-white p-6 shadow-xl shadow-ink/[0.05] sm:p-8">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">כניסה לחשבון</h1>
            <p className="mt-2 text-[15px] text-ink/65">ממשיכים מאיפה שהפסקתם.</p>

            <LoginForm
              initialError={error === "oauth" ? GOOGLE_SIGN_IN_FAILED : null}
              next={safeNextPath(next)}
            />

            <p className="mt-4 text-sm">
              <Link
                href="/forgot-password"
                className="text-ink/60 underline decoration-ink/30 underline-offset-4 hover:text-ink"
              >
                שכחתם את הסיסמה?
              </Link>
            </p>
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
          <RecordingNotice className="mt-3 text-center" />
        </div>
      </main>
    </div>
  );
}
