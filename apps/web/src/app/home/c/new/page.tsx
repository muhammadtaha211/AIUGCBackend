import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CWizard } from "@/components/c-wizard/c-wizard";
import { NoCreditsCard } from "@/components/no-credits-card";
import { authedUser } from "@/lib/auth-user";
import { ownedBusinesses } from "@/lib/businesses";
import { loadPersonaCatalog } from "@/lib/persona-catalog";
import { BUSINESS_COOKIE, pickSelectedBusiness } from "@/lib/service-b-ui";
import { createServerSupabase } from "@/lib/supabase/server";
import { wizardGate } from "@/lib/wizard-gate";

/**
 * Server shell for the Service C (גוש טקסט) wizard, on B's shape: resolves
 * the selected business (the cookie the sidebar switch writes) and hands its
 * id + name to the client wizard. The questionnaire gate stays — the texts
 * are written from it. The catalog ships in the HTML too, narrowed to
 * characters with at least one usable clip, so the gallery never dead-ends.
 */
export default async function NewCRenderPage() {
  const supabase = await createServerSupabase();
  // authedUser throws on a FAILED read rather than letting it collapse into
  // "signed out" — see the note in @/lib/auth-user.
  const user = authedUser(await supabase.auth.getUser());
  if (!user) redirect("/start");

  // ownedBusinesses throws on a FAILED read rather than letting it collapse
  // into "owns nothing" — see the note in @/lib/businesses.
  const businesses = ownedBusinesses(
    await supabase
      .from("businesses")
      .select("id, name, questionnaire")
      .order("created_at", { ascending: true }),
  );
  if (businesses.length === 0) redirect("/home/new-business");

  const cookieStore = await cookies();
  const selected = pickSelectedBusiness(businesses, cookieStore.get(BUSINESS_COOKIE)?.value)!;
  if (!selected.questionnaire) redirect("/home");

  // Spam control only — the 402 at confirm is the real boundary. Admin bypasses.
  const gate = await wizardGate(selected.id);

  // Undefined on failure: the wizard falls back to the client fetch + retry UI.
  const personaCatalog = await loadPersonaCatalog("c").catch(() => undefined);

  return (
    <div className="flex flex-col items-center px-6 pb-16">
      {gate.allowed ? (
        // Keyed by business, as A's shell is: the sidebar switch's
        // router.refresh() preserves unkeyed client state, and the texts are
        // the previous business's.
        <CWizard
          key={selected.id}
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
