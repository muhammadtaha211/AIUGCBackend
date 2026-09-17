import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { authedUser } from "@/lib/auth-user";
import { parsePlanParam, PLAN_PARAM } from "@/lib/onboarding";
import { loadPlansView } from "@/lib/plans";
import { PLAN_META_TITLE, PLAN_PAGE_SUB, PLAN_PAGE_TITLE } from "@/lib/plans-ui";
import { createServerSupabase } from "@/lib/supabase/server";
import { PlanManager } from "./plan-manager";

/**
 * The account's plan page: the three cards with the account's own button on
 * each (choose, upgrade, downgrade, cancel, resume, undo) and the dialogs
 * behind them. The subscription itself is read client-side by PlanManager
 * from GET /api/account/subscription — the same read every action refetches
 * — so this page only resolves the session, the query and the plan ladder.
 *
 * loadPlansView, not the cached one: a price change must reach the signed-in
 * page immediately (lib/plans.ts).
 *
 * ?plan=<code> opens that card's checkout dialog (the /pricing hand-off);
 * ?checkout=success|failed is where the gateway sends the browser back.
 */
export const metadata: Metadata = { title: PLAN_META_TITLE };

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string | string[]; checkout?: string }>;
}) {
  const supabase = await createServerSupabase();
  // authedUser throws on a FAILED read rather than letting it collapse into
  // "signed out" — see the note in @/lib/auth-user. A null user still means
  // exactly what it always did.
  const user = authedUser(await supabase.auth.getUser());
  if (!user) redirect("/start");

  const params = await searchParams;
  // The same parser /start uses for the same param — one slug rule, one place.
  const plan = parsePlanParam(params[PLAN_PARAM]);
  const checkout =
    params.checkout === "success" || params.checkout === "failed" ? params.checkout : null;
  const view = await loadPlansView();

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-16 pt-8 sm:pt-10">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{PLAN_PAGE_TITLE}</h1>
      <p className="mt-2 text-[15px] text-ink/65">{PLAN_PAGE_SUB}</p>
      <PlanManager view={view} openPlan={plan} checkout={checkout} />
    </div>
  );
}
