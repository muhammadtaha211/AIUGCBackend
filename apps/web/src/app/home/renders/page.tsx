import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { ownedBusinesses } from "@/lib/businesses";
import { BUSINESS_COOKIE, pickSelectedBusiness } from "@/lib/service-b-ui";
import { RendersLibrary } from "./renders-library";

/**
 * Every ad the selected business has made, both services, newest first and
 * paged. The homepage strip is the live window onto the same rows — this is
 * the archive, so it carries no progress indicator and does no polling. Same
 * shell pattern as /home/demos; business switching stays on the homepage.
 */
export default async function RendersPage() {
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
    <div className="mx-auto w-full max-w-4xl px-6 pb-16 pt-8 sm:pt-10">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        כל היצירות של {selected.name}
      </h1>
      <p className="mt-2 text-[15px] text-ink/65">
        כאן נמצאות כל המודעות שיצרתם, משני המסלולים. לוחצים על סרטון מוכן כדי לצפות בו ולשמור אותו.
      </p>

      {/* Keyed by business: the sidebar switch calls router.refresh(), which
          re-renders the server tree but PRESERVES client state — the pager
          would stay on page 3 of the old business and request a page the new
          one may not have. Same reason /home/a/new keys its wizard. */}
      <RendersLibrary key={selected.id} businessId={selected.id} />
    </div>
  );
}
