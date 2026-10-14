import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AWizard } from "@/components/a-wizard/a-wizard";
import { NoCreditsCard } from "@/components/no-credits-card";
import { authedUser } from "@/lib/auth-user";
import { introOfferFor } from "@/lib/intro";
import { ownedBusinesses } from "@/lib/businesses";
import { loadPersonaCatalog } from "@/lib/persona-catalog";
import { BUSINESS_COOKIE, pickSelectedBusiness } from "@/lib/service-b-ui";
import { createServerSupabase } from "@/lib/supabase/server";
import { wizardGate } from "@/lib/wizard-gate";

/**
 * Server shell for the Service A wizard (steps format): resolves the selected
 * business (same cookie the homepage header writes) and hands its id + name
 * to the client wizard. The wizard is persona-first now, so the persona
 * catalog ships in the HTML like the B shell's — narrowed to personas that
 * have hook clips, since the gallery is one persona's column of the hook
 * matrix. The questionnaire gate stays — hook lines derive from it.
 */
export default async function NewARenderPage() {
  const supabase = await createServerSupabase();
  // authedUser throws on a FAILED read rather than letting it collapse into
  // "signed out" — see the note in @/lib/auth-user. A null user still means
  // exactly what it always did.
  const user = authedUser(await supabase.auth.getUser());
  if (!user) redirect("/start");

  // ownedBusinesses throws on a FAILED read rather than letting it collapse
  // into "owns nothing" — see the note in @/lib/businesses. An empty list still
  // means exactly what it always did.
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

  // Spam control only — nothing else stands in front of the upload routes
  // today (billing is not wired; the burn is bounded by the account caps).
  const gate = await wizardGate(selected.id);
  // The ₪5 intro offer for the no-credits card (decision 0109) — read only when
  // the card is what renders, so a wizard load pays nothing for it.
  const intro = gate.allowed ? null : await introOfferFor(user.id);

  // Undefined on failure: the wizard falls back to the client fetch + retry UI.
  const personaCatalog = await loadPersonaCatalog("a").catch(() => undefined);

  return (
    <div className="flex flex-col items-center px-6 pb-8">
      {gate.allowed ? (
        // Keyed by business: the sidebar switch calls router.refresh(), which
        // PRESERVES unkeyed client state — a two-business account would carry
        // business A's demo (and ?demo=) under business B's chrome. The key
        // remounts the wizard, re-running the ownership-scoped URL restore.
        <AWizard
          key={selected.id}
          businessId={selected.id}
          businessName={selected.name}
          initialCatalog={personaCatalog}
        />
      ) : (
        <NoCreditsCard service="a" intro={intro} />
      )}
    </div>
  );
}
