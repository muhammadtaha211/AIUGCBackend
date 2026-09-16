import { and, eq, inArray, lte } from "drizzle-orm";
import { getConfigValue } from "../appConfig";
import { dunningSchema } from "../config";
import { getEnv } from "../config";
import type { Db } from "../db";
import { gatewayEvents, plans, subscriptions } from "../db/schema";
import type { Job } from "../jobs/queue";
import type { JobContext, JobResult } from "../jobs/worker";
import { expirePeriodRemainder, grantPeriod } from "./credits";

/**
 * The subscription state machine is OURS; the gateway only executes charges
 * (hosted pages + server callbacks — Grow/Meshulam is the reference, see
 * docs/05-billing.md). This interface is what a gateway adapter implements.
 */
export interface BillingGateway {
  name: string;
  chargeRecurring(input: {
    recurringRef: string;
    amountAgorot: number;
    description: string;
  }): Promise<{ ok: boolean; gatewayEventId: string; error?: string }>;
}

/** Pre-launch placeholder: fails loudly if a real renewal is ever attempted. */
export class NotConfiguredGateway implements BillingGateway {
  name = "not_configured";
  async chargeRecurring(): Promise<never> {
    throw new Error("no payment gateway configured — see docs/05-billing.md");
  }
}

export class DryRunGateway implements BillingGateway {
  name = "dry_run";
  async chargeRecurring() {
    return { ok: true, gatewayEventId: `dry_${crypto.randomUUID()}` };
  }
}

export function getBillingGateway(): BillingGateway {
  return getEnv().DRY_RUN ? new DryRunGateway() : new NotConfiguredGateway();
}

/**
 * Daily renewal pass. Success: extend period one month, expire leftover
 * credits, grant the new period's credits. Failure: past_due with retries on
 * the configured dunning days, then suspended.
 */
export async function processDueRenewals(
  db: Db,
  gateway: BillingGateway,
  now: Date = new Date(),
): Promise<{ renewed: number; failed: number; suspended: number; canceled: number }> {
  const dunning = await getConfigValue(db, "dunning", dunningSchema);
  const result = { renewed: 0, failed: 0, suspended: 0, canceled: 0 };

  const due = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        inArray(subscriptions.status, ["active", "past_due"]),
        lte(subscriptions.currentPeriodEnd, now),
      ),
    );

  for (const sub of due) {
    if (sub.cancelAtPeriodEnd) {
      await db
        .update(subscriptions)
        .set({ status: "canceled", updatedAt: now })
        .where(eq(subscriptions.id, sub.id));
      await expirePeriodRemainder(db, { userId: sub.userId, subscriptionId: sub.id });
      result.canceled++;
      continue;
    }

    const daysPast = Math.floor(
      (now.getTime() - sub.currentPeriodEnd.getTime()) / (24 * 60 * 60 * 1000),
    );
    if (daysPast >= dunning.suspend_after_days) {
      await db
        .update(subscriptions)
        .set({ status: "suspended", updatedAt: now })
        .where(eq(subscriptions.id, sub.id));
      result.suspended++;
      continue;
    }
    // Charge on day 0 and on each configured retry day; skip the days between.
    if (daysPast !== 0 && !dunning.retry_days.includes(daysPast)) continue;
    if (!sub.gatewayRecurringRef) continue;

    const plan = (await db.select().from(plans).where(eq(plans.code, sub.planCode)).limit(1))[0];
    if (!plan) continue;

    const charge = await gateway.chargeRecurring({
      recurringRef: sub.gatewayRecurringRef,
      amountAgorot: plan.priceAgorot,
      description: `AIUGC ${plan.name} — monthly renewal`,
    });
    await db
      .insert(gatewayEvents)
      .values({
        gateway: gateway.name,
        gatewayEventId: charge.gatewayEventId,
        kind: charge.ok ? "recurring_charge_success" : "recurring_charge_failed",
        payload: { subscriptionId: sub.id, amountAgorot: plan.priceAgorot, error: charge.error },
        processedAt: now,
      })
      .onConflictDoNothing({ target: gatewayEvents.gatewayEventId });

    if (charge.ok) {
      await expirePeriodRemainder(db, { userId: sub.userId, subscriptionId: sub.id });
      await grantPeriod(db, {
        userId: sub.userId,
        credits: plan.monthlyCredits,
        subscriptionId: sub.id,
      });
      await db
        .update(subscriptions)
        .set({
          status: "active",
          currentPeriodStart: sub.currentPeriodEnd,
          currentPeriodEnd: addOneMonth(sub.currentPeriodEnd),
          updatedAt: now,
        })
        .where(eq(subscriptions.id, sub.id));
      result.renewed++;
    } else {
      await db
        .update(subscriptions)
        .set({ status: "past_due", updatedAt: now })
        .where(eq(subscriptions.id, sub.id));
      result.failed++;
    }
  }
  return result;
}

export async function handleBillingRenewals(_job: Job, ctx: JobContext): Promise<JobResult> {
  const summary = await processDueRenewals(ctx.db, getBillingGateway());
  ctx.log.info(summary, "billing renewals processed");
  return { kind: "done" };
}

function addOneMonth(date: Date): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCMonth(result.getUTCMonth() + 1);
  if (result.getUTCDate() < day) result.setUTCDate(0); // clamp (Jan 31 -> Feb 28)
  return result;
}
