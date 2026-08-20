import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AWizard } from "@/components/a-wizard/a-wizard";
import { NoCreditsCard } from "@/components/no-credits-card";
import { BUSINESS_COOKIE, pickSelectedBusiness } from "@/lib/service-b-ui";
import { createServerSupabase } from "@/lib/supabase/server";
import { wizardGate } from "@/lib/wizard-gate";

/**
 * Server shell for the Service A wizard (steps format — no persona step, so
 * no catalog preload): resolves the selected business (same cookie the
 * homepage header writes) and hands its id + name to the client wizard. The
 * questionnaire gate stays — hook lines derive from it.
 */
export default async function NewARenderPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/start");

  const { data: businesses } = await supabase
    .from("businesses")
    .select("id, name, questionnaire")
    .order("created_at", { ascending: true });
  if (!businesses || businesses.length === 0) redirect("/home/new-business");

  const cookieStore = await cookies();
  const selected = pickSelectedBusiness(businesses, cookieStore.get(BUSINESS_COOKIE)?.value)!;
  if (!selected.questionnaire) redirect("/home");

  // Spam control only — nothing else stands in front of the upload routes
  // today (billing is not wired; the burn is bounded by the account caps).
  const gate = await wizardGate(selected.id);

  return (
    <div className="flex flex-col items-center px-6 pb-8">
      {gate.allowed ? (
        // Keyed by business: the sidebar switch calls router.refresh(), which
        // PRESERVES unkeyed client state — a two-business account would carry
        // business A's demo (and ?demo=) under business B's chrome. The key
        // remounts the wizard, re-running the ownership-scoped URL restore.
        <AWizard key={selected.id} businessId={selected.id} businessName={selected.name} />
      ) : (
        <NoCreditsCard />
      )}
    </div>
  );
}
