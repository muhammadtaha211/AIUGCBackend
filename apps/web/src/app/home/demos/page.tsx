import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { ownedBusinesses } from "@/lib/businesses";
import { BUSINESS_COOKIE, pickSelectedBusiness } from "@/lib/service-b-ui";
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

  // ownedBusinesses throws on a FAILED read rather than letting it collapse
  // into "owns nothing" — see the note in @/lib/businesses. An empty list still
  // means exactly what it always did.
  const businesses = ownedBusinesses(
    await supabase.from("businesses").select("id, name").order("created_at", { ascending: true }),
  );
  if (businesses.length === 0) redirect("/home/new-business");

  const cookieStore = await cookies();
  const selected = pickSelectedBusiness(businesses, cookieStore.get(BUSINESS_COOKIE)?.value)!;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-16 pt-8 sm:pt-10">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        סרטוני המוצר של {selected.name}
      </h1>
      <p className="mt-2 text-[15px] text-ink/65">
        כל סרטון שהעליתם נשמר כאן. אפשר להשתמש בו שוב בכל מודעה חדשה, והתיאור שלו עוזר לקריינות
        להתייחס למה שבאמת רואים.
      </p>

      <DemoLibrary businessId={selected.id} />
    </div>
  );
}
