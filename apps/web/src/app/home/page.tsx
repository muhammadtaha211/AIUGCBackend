import { redirect } from "next/navigation";
import { Wordmark } from "@/components/wordmark";
import { createServerSupabase } from "@/lib/supabase/server";
import { LogoutButton } from "./logout-button";

/**
 * Placeholder homepage — proves the auth + RLS path end-to-end: the business
 * list below is read with the user's own (anon-key) session, so rows appear
 * only if the 0002 policies resolve them. The real signed-in experience
 * (demo upload, ad variants) replaces this later.
 */
export default async function HomePage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/start");

  const { data: businesses } = await supabase
    .from("businesses")
    .select("id, name, created_at")
    .order("created_at", { ascending: true });

  const dateFormat = new Intl.DateTimeFormat("he-IL", { dateStyle: "long" });

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between px-6 sm:px-10">
        <Wordmark />
        <div className="flex items-center gap-4">
          {user.email && (
            <span dir="ltr" className="hidden text-sm text-gray-500 sm:block">
              {user.email}
            </span>
          )}
          <LogoutButton />
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-6 pb-16 pt-10 sm:pt-16">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            החשבון מוכן. ברוכים הבאים.
          </h1>
          <p className="mt-2 text-[15px] text-gray-400">כאן ינוהלו המודעות שלכם.</p>

          {businesses && businesses.length > 0 && (
            <ul className="mt-8 space-y-3">
              {businesses.map((business) => (
                <li
                  key={business.id}
                  className="flex items-baseline justify-between rounded-xl border border-white/10 bg-white/5 px-5 py-4"
                >
                  <span className="text-base font-medium text-white">{business.name}</span>
                  <span className="text-sm text-gray-500">
                    נוצר ב־{dateFormat.format(new Date(business.created_at))}
                  </span>
                </li>
              ))}
            </ul>
          )}

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
