import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { BUSINESS_COOKIE, pickSelectedBusiness } from "@/lib/service-b-ui";
import { HomeHeader } from "./home-header";
import { PathwayCards } from "./pathway-cards";
import { RendersStrip } from "./renders-strip";

/**
 * The signed-in homepage: business switcher, the two service pathways, and
 * the recent renders strip. Businesses are read with the user's own session,
 * so RLS scopes the list to what they own.
 */
export default async function HomePage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/start");

  const { data: businesses } = await supabase
    .from("businesses")
    .select("id, name, questionnaire")
    .order("created_at", { ascending: true });

  // Signed in with no business (e.g. an interrupted signup): straight into the
  // questionnaire wizard — the homepage has nothing to show yet.
  if (!businesses || businesses.length === 0) redirect("/home/new-business");

  const cookieStore = await cookies();
  const selected = pickSelectedBusiness(businesses, cookieStore.get(BUSINESS_COOKIE)?.value)!;
  const hasQuestionnaire = selected.questionnaire != null;

  return (
    <div className="flex min-h-dvh flex-col">
      <HomeHeader
        businesses={businesses.map(({ id, name }) => ({ id, name }))}
        selectedId={selected.id}
      />

      <main className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-6 pb-16 pt-8 sm:pt-12">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            מה יוצרים היום ל־{selected.name}?
          </h1>
          <p className="mt-2 text-[15px] text-gray-400">
            בוחרים מסלול — ומקבלים סרטון מוכן לפרסום.
          </p>

          <div className="mt-8">
            <PathwayCards hasQuestionnaire={hasQuestionnaire} />
          </div>

          <RendersStrip businessId={selected.id} />
        </div>
      </main>
    </div>
  );
}
