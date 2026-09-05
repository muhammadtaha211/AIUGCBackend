import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BWizard } from "@/components/b-wizard/b-wizard";
import { NoCreditsCard } from "@/components/no-credits-card";
import { loadPersonaCatalog } from "@/lib/persona-catalog";
import { BUSINESS_COOKIE, pickSelectedBusiness } from "@/lib/service-b-ui";
import { createServerSupabase } from "@/lib/supabase/server";
import { wizardGate } from "@/lib/wizard-gate";

/**
 * Server shell for the Service B wizard: resolves the selected business (same
 * cookie the homepage header writes) and hands its id + name to the client
 * wizard — no extra API round-trips. The questionnaire gate stays: the script
 * is written from it. The persona catalog ships in the HTML too, so the
 * picker's image URLs are known to the preload scanner before React hydrates.
 */
export default async function NewBRenderPage() {
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

  // Spam control only — the 402 at confirm is the real boundary. Admin bypasses.
  const gate = await wizardGate(selected.id);

  // Undefined on failure: the wizard falls back to the client fetch + retry UI.
  const personaCatalog = await loadPersonaCatalog("b").catch(() => undefined);

  return (
    <div className="flex flex-col items-center px-6 pb-16">
      {gate.allowed ? (
        <BWizard
          businessId={selected.id}
          businessName={selected.name}
          initialCatalog={personaCatalog}
        />
      ) : (
        <NoCreditsCard />
      )}
    </div>
  );
}
