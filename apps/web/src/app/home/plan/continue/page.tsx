import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { addOneMonth, getAccountBilling, getDb, getTrialView } from "@aiugc/core";
import { Amounts } from "@/components/plans/plan-cards";
import { authedUser } from "@/lib/auth-user";
import { parsePlanParam, PLAN_PARAM } from "@/lib/onboarding";
import { loadPlansView } from "@/lib/plans";
import {
  CHECKOUT_BACK,
  CHECKOUT_RENEWAL_LINE,
  checkoutTitle,
  CONTINUE_META_TITLE,
  continueChargeLine,
  continueLeftoverLine,
  creditsLine,
  formatDate,
  priceLine,
  VAT_FOOTNOTE,
} from "@/lib/plans-ui";
import { createServerSupabase } from "@/lib/supabase/server";
import { ContinueForm } from "./continue-form";

/**
 * Continue from the ₪5 intro trial (decision 0109): the checkout summary
 * without the card step — the plan's price and credits, that today's charge is
 * on the card saved at the ₪5 payment and when the next one falls, the
 * auto-renewal line, the leftover trial credits it keeps (only while the trial
 * is live), the VAT footnote, the required terms checkbox, one button that
 * names the amount. An ordinary first month: full price, full credits, the
 * period from the click — not 0052's proration.
 *
 * Only an account holding a trial that has not joined a plan, with no live
 * subscription and no continue still being confirmed, gets here; the trial may
 * have ended (continuing stays open, with nothing left to keep).
 */
export const metadata: Metadata = { title: CONTINUE_META_TITLE };

export default async function ContinuePage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string | string[] }>;
}) {
  const supabase = await createServerSupabase();
  const user = authedUser(await supabase.auth.getUser());
  if (!user) redirect("/start");

  const params = await searchParams;
  const code = parsePlanParam(params[PLAN_PARAM]);
  if (!code) redirect("/home/plan");

  const db = getDb();
  const [view, billing, trial] = await Promise.all([
    loadPlansView(),
    getAccountBilling(db, { userId: user.id }),
    getTrialView(db, user.id),
  ]);
  const plan = view.plans.find((candidate) => candidate.code === code);
  if (!plan) redirect("/home/plan");
  if (!trial || trial.convertedAt || trial.attemptPending || billing.subscription) {
    redirect("/home/plan");
  }
  const nextCharge = formatDate(addOneMonth(new Date()));
  const keeps = !trial.expiredAt && trial.creditsLeft > 0;

  return (
    // The plan's name, price and terms: Tavnit's copy, readable in a recording.
    <div className="mx-auto w-full max-w-lg px-6 pb-16 pt-8 sm:pt-10" data-ph-unmask>
      <Link
        href="/home/plan"
        className="text-sm text-ink/60 underline decoration-ink/25 underline-offset-4 transition-colors duration-150 hover:text-ink"
      >
        {CHECKOUT_BACK}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink">
        {checkoutTitle(plan.name)}
      </h1>

      <div className="mt-6 rounded-xl border border-ink/[0.08] bg-white p-6 shadow-xl shadow-ink/[0.05] sm:p-7">
        <p className="text-sm text-ink/65">
          <Amounts
            line={priceLine(plan.priceAgorot)}
            amountClassName="font-display text-4xl text-ink sm:text-5xl"
          />
        </p>
        <p className="mt-2 text-sm text-ink/65">{creditsLine(plan.monthlyCredits)}</p>

        <div className="mt-5 space-y-2 text-[15px] leading-relaxed text-ink/80">
          <p>{continueChargeLine(nextCharge)}</p>
          <p>{CHECKOUT_RENEWAL_LINE}</p>
          {keeps && <p>{continueLeftoverLine(trial.creditsLeft)}</p>}
          <p className="text-sm text-ink/65">{VAT_FOOTNOTE}</p>
        </div>

        <ContinueForm planCode={plan.code} priceAgorot={plan.priceAgorot} />
      </div>
    </div>
  );
}
