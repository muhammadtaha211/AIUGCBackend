import { NextResponse } from "next/server";
import { getAccountBilling, getAccountIntro, getDb } from "@aiugc/core";
import { coreErrorResponse, requireUser } from "@/lib/api";
import { INTRO_OFFER_VIEW, introPageConfigured } from "@/lib/intro";

/**
 * The account page's one read: the live subscription (or null), the plan
 * ladder by price, the balance and its manual portion, and a quote for every
 * plan the account is not on — the same arithmetic /change will charge.
 * Keyed on the session user; there is no id in the URL to get wrong.
 *
 * Plus the ₪5 intro offer (decision 0109): the account's trial in any state,
 * and the offer itself when this account may buy it now — which needs its
 * Sumit page configured as well as core's yes.
 */
export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const [view, intro] = await Promise.all([
      getAccountBilling(db, { userId: auth.userId }),
      getAccountIntro(db, auth.userId),
    ]);
    const sub = view.subscription;
    const trial = intro.trial;
    return NextResponse.json({
      subscription: sub
        ? {
            planCode: sub.planCode,
            status: sub.status,
            currentPeriodStart: sub.currentPeriodStart.toISOString(),
            currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
            scheduledPlanCode: sub.scheduledPlanCode,
          }
        : null,
      plans: view.plans.map((p) => ({
        code: p.code,
        name: p.name,
        priceAgorot: p.priceAgorot,
        monthlyCredits: p.monthlyCredits,
      })),
      // The subscribed plan even when it has been retired off the ladder —
      // the page needs its name and price for the dialogs either way.
      currentPlan: view.currentPlan
        ? {
            code: view.currentPlan.code,
            name: view.currentPlan.name,
            priceAgorot: view.currentPlan.priceAgorot,
            monthlyCredits: view.currentPlan.monthlyCredits,
          }
        : null,
      balance: view.balance,
      manualOutstanding: view.manualOutstanding,
      quotes: view.quotes,
      trial: trial
        ? {
            credits: trial.credits,
            creditsLeft: trial.creditsLeft,
            ended: trial.ended,
            expiresAt: trial.expiresAt.toISOString(),
            expiredAt: trial.expiredAt?.toISOString() ?? null,
            convertedAt: trial.convertedAt?.toISOString() ?? null,
            attemptPending: trial.attemptPending,
          }
        : null,
      intro: intro.introEligible && introPageConfigured() ? INTRO_OFFER_VIEW : null,
    });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
