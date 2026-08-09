import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BWizard } from "@/components/b-wizard/b-wizard";
import { CreditsChip } from "@/components/credits-chip";
import { NoCreditsCard } from "@/components/no-credits-card";
import { Wordmark } from "@/components/wordmark";
import { loadPersonaCatalog } from "@/lib/persona-catalog";
import { BUSINESS_COOKIE, pickSelectedBusiness } from "@/lib/service-b-ui";
import { createServerSupabase } from "@/lib/supabase/server";
import { wizardGate } from "@/lib/wizard-gate";

/**
 * Server shell for the Service B wizard: resolves the selected business (same
 * cookie the homepage header writes) and hands name + questionnaire category
 * to the client wizard — no extra API round-trips. The persona catalog ships
 * in the HTML too, so the picker's image URLs are known to the preload
 * scanner before React hydrates.
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
  const questionnaire = selected.questionnaire as { category?: string } | null;
  if (!questionnaire) redirect("/home");

  // Spam control only — the 402 at confirm is the real boundary. Admin bypasses.
  const gate = await wizardGate(selected.id);

  // Undefined on failure: the wizard falls back to the client fetch + retry UI.
  const personaCatalog = await loadPersonaCatalog().catch(() => undefined);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 px-6 sm:px-10">
        <Link href="/home">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-3">
          <CreditsChip balance={gate.balance} />
          <Link
            href="/home"
            className="text-sm text-gray-400 transition-colors duration-150 hover:text-white"
          >
            חזרה לדף הבית
          </Link>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center px-6 pb-20">
        {gate.allowed ? (
          <BWizard
            businessId={selected.id}
            businessName={selected.name}
            category={questionnaire.category ?? ""}
            initialCatalog={personaCatalog}
          />
        ) : (
          <NoCreditsCard />
        )}
      </main>
    </div>
  );
}
