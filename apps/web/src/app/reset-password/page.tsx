import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "סיסמה חדשה | תבנית" };

/**
 * Set-new-password screen. Two ways in: from /auth/recovery with a live
 * recovery session (default email template), or directly from the email with
 * ?token_hash=… (the scanner-proof template variant — docs/08 §1), where the
 * token is verified only on submit. The form gates on the session when there
 * is no token and shows a request-again path when neither exists.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string }>;
}) {
  const { token_hash } = await searchParams;
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
            <h1 className="text-2xl font-semibold tracking-tight text-ink">בחירת סיסמה חדשה</h1>
            <p className="mt-2 text-[15px] text-ink/65">עוד רגע חוזרים לעבודה.</p>

            <ResetPasswordForm tokenHash={token_hash} />
          </div>
        </div>
      </main>
    </div>
  );
}
