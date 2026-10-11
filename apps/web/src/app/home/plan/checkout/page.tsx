import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { addOneMonth, getAccountBilling, getDb } from "@aiugc/core";
import { Amounts } from "@/components/plans/plan-cards";
import { authedUser } from "@/lib/auth-user";
import { parsePlanParam, PLAN_PARAM } from "@/lib/onboarding";
import { loadPlansView } from "@/lib/plans";
import {
  CHECKOUT_BACK,
  CHECKOUT_META_TITLE,
  CHECKOUT_RENEWAL_LINE,
  CHECKOUT_SECURE_LINE,
  checkoutTitle,
  creditsLine,
  firstChargeLine,
  formatDate,
  priceLine,
  RENEW_LINE,
  VAT_FOOTNOTE,
} from "@/lib/plans-ui";
import { createServerSupabase } from "@/lib/supabase/server";
import { CheckoutForm } from "./checkout-form";

/**
 * The order summary before the customer leaves for Sumit's payment page
 * (founder decision 2026-09-21: no payment from a popup — decision 0062).
 * One plan, its price and credits, when the first and the next charge fall,
 * the VAT footnote, the required terms checkbox and the one button. Reached
 * from the plan cards and from /home/plan?plan=<code> (the /pricing and
 * signup hand-off), and only by an account with nothing live or a suspended
 * subscription — anyone else is sent back to the plan page, where the
 * upgrade/downgrade/cancel dialogs are the right tools.
 */
export const metadata: Metadata = { title: CHECKOUT_META_TITLE };

export default async function CheckoutPage({
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

  const [view, billing] = await Promise.all([
    loadPlansView(),
    getAccountBilling(getDb(), { userId: user.id }),
  ]);
  const plan = view.plans.find((candidate) => candidate.code === code);
  if (!plan) redirect("/home/plan");
  const live = billing.subscription;
  if (live && live.status !== "suspended") redirect("/home/plan");
  const renew = live?.status === "suspended";
  const nextCharge = formatDate(addOneMonth(new Date()));

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
          <p>{firstChargeLine(nextCharge)}</p>
          <p>{CHECKOUT_RENEWAL_LINE}</p>
          {renew && <p>{RENEW_LINE}</p>}
          <p className="text-sm text-ink/65">{VAT_FOOTNOTE}</p>
          <p className="text-sm text-ink/65">{CHECKOUT_SECURE_LINE}</p>
        </div>

        <CheckoutForm planCode={plan.code} />
      </div>
    </div>
  );
}
