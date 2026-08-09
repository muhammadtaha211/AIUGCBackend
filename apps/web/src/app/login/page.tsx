import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/wordmark";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "כניסה — Tavnit" };

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between px-6 sm:px-10">
        <Link href="/" aria-label="לעמוד הראשי">
          <Wordmark />
        </Link>
      </header>

      <main className="flex flex-1 items-start justify-center px-6">
        <div className="w-full max-w-md pb-16 pt-10 sm:pt-16">
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 sm:p-10">
            <h1 className="text-2xl font-semibold tracking-tight text-white">כניסה לחשבון</h1>
            <p className="mt-2 text-[15px] text-gray-400">ממשיכים מאיפה שהפסקתם.</p>

            <LoginForm />
          </div>

          <p className="mt-6 text-center text-sm text-gray-400">
            עוד אין לכם חשבון?{" "}
            <Link
              href="/"
              className="font-medium text-white underline decoration-white/30 underline-offset-4"
            >
              יצירת המודעה הראשונה
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
