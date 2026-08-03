import type { Metadata } from "next";
import { Wordmark } from "@/components/wordmark";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "כניסה — ניהול AIUGC" };

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between px-6 sm:px-10">
        <Wordmark />
      </header>

      <main className="flex flex-1 items-start justify-center px-6">
        <div className="w-full max-w-md pb-16 pt-10 sm:pt-16">
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 sm:p-10">
            <h1 className="text-2xl font-semibold tracking-tight text-white">כניסה לניהול</h1>

            <LoginForm />
          </div>
        </div>
      </main>
    </div>
  );
}
