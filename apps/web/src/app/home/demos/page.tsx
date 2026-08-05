import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/wordmark";
import { createServerSupabase } from "@/lib/supabase/server";
import { BUSINESS_COOKIE, pickSelectedBusiness } from "@/lib/service-b-ui";
import { LogoutButton } from "../logout-button";
import { DemoLibrary } from "./demo-library";

/**
 * The demo library: every product video the selected business uploaded, with
 * an editable footage note. The wizard's reuse picker reads the same rows —
 * a demo is uploaded once and reused across ads. Same shell pattern as
 * /home/new-business; business switching stays on the homepage.
 */
export default async function DemosPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/start");

  const { data: businesses } = await supabase
    .from("businesses")
    .select("id, name")
    .order("created_at", { ascending: true });
  if (!businesses || businesses.length === 0) redirect("/home/new-business");

  const cookieStore = await cookies();
  const selected = pickSelectedBusiness(businesses, cookieStore.get(BUSINESS_COOKIE)?.value)!;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between px-6 sm:px-10">
        <Link href="/home">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-4">
          <Link
            href="/home"
            className="text-sm text-gray-400 transition-colors duration-150 hover:text-white"
          >
            חזרה לדף הבית
          </Link>
          <LogoutButton />
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-6 pb-16 pt-8 sm:pt-12">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            סרטוני המוצר של {selected.name}
          </h1>
          <p className="mt-2 text-[15px] text-gray-400">
            כל סרטון שהעליתם נשמר כאן — אפשר להשתמש בו שוב בכל מודעה חדשה, והתיאור שלו עוזר לקריינות
            להתייחס למה שבאמת רואים.
          </p>

          <DemoLibrary businessId={selected.id} />
        </div>
      </main>
    </div>
  );
}
