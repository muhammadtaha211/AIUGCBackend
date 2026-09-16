import { NextResponse } from "next/server";
import { getAccountBilling, getDb } from "@aiugc/core";
import { coreErrorResponse, requireUser } from "@/lib/api";

/**
 * The account page's one read: the live subscription (or null), the plan
 * ladder by price, the balance and its manual portion, and a quote for every
 * plan the account is not on — the same arithmetic /change will charge.
 * Keyed on the session user; there is no id in the URL to get wrong.
 */
export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const view = await getAccountBilling(getDb(), { userId: auth.userId });
    const sub = view.subscription;
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
      balance: view.balance,
      manualOutstanding: view.manualOutstanding,
      quotes: view.quotes,
    });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
