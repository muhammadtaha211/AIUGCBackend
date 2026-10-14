import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDb, getTrialView } from "@aiugc/core";
import { authedUser } from "@/lib/auth-user";
import { parsePlanParam, PLAN_PARAM } from "@/lib/onboarding";
import { loadPlansView } from "@/lib/plans";
import {
  checkoutPath,
  continuePath,
  parseCheckoutParam,
  PLAN_META_TITLE,
  PLAN_PAGE_SUB,
  PLAN_PAGE_TITLE,
} from "@/lib/plans-ui";
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
 * ?plan=<code> (the /pricing and signup hand-off) goes straight to that
 * plan's checkout page, which decides for itself whether this account can
 * buy — or, for an account holding a ₪5 intro trial that has not joined a plan
 * (decision 0109), to the continue page, so joining never asks for the card
 * again; ?checkout=… is where the return route and the continue page send the
 * browser (CHECKOUT_STATES).
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
  if (plan) {
    const trial = await getTrialView(getDb(), user.id);
    // A continue still being confirmed falls through to the checkout page,
    // whose own gate sends it back here to the notice.
    const continues = trial && !trial.convertedAt && !trial.attemptPending;
    redirect(continues ? continuePath(plan) : checkoutPath(plan));
  }
  const checkout = parseCheckoutParam(params.checkout);
  const view = await loadPlansView();

  return (
    // Tavnit's own plans, prices and dialogs: readable in a recording.
    <div className="mx-auto w-full max-w-5xl px-6 pb-16 pt-8 sm:pt-10" data-ph-unmask>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{PLAN_PAGE_TITLE}</h1>
      <p className="mt-2 text-[15px] text-ink/65">{PLAN_PAGE_SUB}</p>
      <PlanManager view={view} checkout={checkout} />
    </div>
  );
}
