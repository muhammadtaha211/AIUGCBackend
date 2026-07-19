"use client";

/**
 * Placeholder homepage — exists only to demonstrate the post-signup flow.
 * The real signed-in experience (demo upload, ad variants) replaces this later.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Wordmark } from "@/components/wordmark";
import { clearSession, loadSession, type Session } from "@/lib/auth";

export default function HomePage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const saved = loadSession();
    if (!saved) {
      router.replace("/");
      return;
    }
    setSession(saved);
  }, [router]);

  if (!session) return <div className="min-h-dvh" />;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between px-6 sm:px-10">
        <Wordmark />
        <div className="flex items-center gap-4">
          {session.email && (
            <span dir="ltr" className="hidden text-sm text-gray-500 sm:block">
              {session.email}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              clearSession();
              router.replace("/");
            }}
            className="text-sm text-gray-400 transition-colors duration-150 hover:text-white"
          >
            התנתקות
          </button>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-6 pb-16 pt-10 sm:pt-16">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            החשבון מוכן. ברוכים הבאים.
          </h1>
          <p className="mt-2 text-[15px] text-gray-400">כאן ינוהלו המודעות שלכם.</p>

          <div className="mt-10 rounded-xl border border-dashed border-white/15 bg-white/5 px-8 py-16 text-center">
            <p className="text-base font-medium text-white">עוד אין כאן מודעות</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-400">
              בשלב הבא תעלו סרטון קצר של המוצר, ואנחנו נרכיב ממנו כמה גרסאות של מודעה — הן יופיעו
              כאן, מוכנות להורדה ולפרסום.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
