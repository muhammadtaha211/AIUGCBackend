import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { getConfigValue } from "../appConfig";
import { dunningSchema } from "../config";
import { getEnv } from "../config";
import type { Db } from "../db";
import { gatewayEvents, plans, subscriptions, termsAcceptances } from "../db/schema";
import type { Job } from "../jobs/queue";
import type { JobContext, JobResult } from "../jobs/worker";
import { quotePlanChange, type PlanChangeQuote } from "../plan-change";
import { creditBalance, expirePeriodRemainder, grantPeriod, manualOutstanding } from "./credits";

/**
 * The subscription state machine is OURS; the gateway only executes charges
 * (hosted first charge + API charges on the saved card — the stack is Sumit
 * on Upay, decision 0054; Grow/Meshulam was the reference, see
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

    // The charge and everything it commits run under a row lock taken on a
    // FRESH read. The due list above was read without one, and changePlan —
    // which holds FOR UPDATE across its own gateway call — may have committed
    // a schedule, an undo or a cancel since; writing plan_code from the stale
    // row would erase that after the customer was already told 200. The lock
    // serializes the two, and the fresh row is what decides the charge.
    const outcome = await db.transaction(async (tx) => {
      const fresh = (
        await tx.select().from(subscriptions).where(eq(subscriptions.id, sub.id)).for("update")
      )[0];
      if (
        !fresh ||
        (fresh.status !== "active" && fresh.status !== "past_due") ||
        fresh.cancelAtPeriodEnd ||
        fresh.currentPeriodEnd > now ||
        !fresh.gatewayRecurringRef
      ) {
        return "skipped";
      }

      // A scheduled change (0045) is applied HERE: charge that plan's price,
      // grant that plan's credits, and only on success copy it into plan_code.
      // A failed charge leaves the schedule in place for the retry.
      const planCode = fresh.scheduledPlanCode ?? fresh.planCode;
      const plan = (await tx.select().from(plans).where(eq(plans.code, planCode)).limit(1))[0];
      if (!plan) return "skipped";

      const charge = await gateway.chargeRecurring({
        recurringRef: fresh.gatewayRecurringRef,
        amountAgorot: plan.priceAgorot,
        description: `AIUGC ${plan.name} — monthly renewal`,
      });
      await tx
        .insert(gatewayEvents)
        .values({
          gateway: gateway.name,
          gatewayEventId: charge.gatewayEventId,
          kind: charge.ok ? "recurring_charge_success" : "recurring_charge_failed",
          payload: {
            subscriptionId: fresh.id,
            planCode,
            amountAgorot: plan.priceAgorot,
            error: charge.error,
          },
          processedAt: now,
        })
        .onConflictDoNothing({ target: gatewayEvents.gatewayEventId });

      if (!charge.ok) {
        await tx
          .update(subscriptions)
          .set({ status: "past_due", updatedAt: now })
          .where(eq(subscriptions.id, fresh.id));
        return "failed";
      }

      await expirePeriodRemainder(tx as Db, { userId: fresh.userId, subscriptionId: fresh.id });
      await grantPeriod(tx as Db, {
        userId: fresh.userId,
        credits: plan.monthlyCredits,
        subscriptionId: fresh.id,
      });
      await tx
        .update(subscriptions)
        .set({
          status: "active",
          planCode,
          scheduledPlanCode: null,
          currentPeriodStart: fresh.currentPeriodEnd,
          currentPeriodEnd: addOneMonth(fresh.currentPeriodEnd),
          updatedAt: now,
        })
        .where(eq(subscriptions.id, fresh.id));
      return "renewed";
    });
    if (outcome === "renewed") result.renewed++;
    else if (outcome === "failed") result.failed++;
  }
  return result;
}

export async function handleBillingRenewals(_job: Job, ctx: JobContext): Promise<JobResult> {
  const summary = await processDueRenewals(ctx.db, getBillingGateway());
  ctx.log.info(summary, "billing renewals processed");
  return { kind: "done" };
}

export function addOneMonth(date: Date): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCMonth(result.getUTCMonth() + 1);
  if (result.getUTCDate() < day) result.setUTCDate(0); // clamp (Jan 31 -> Feb 28)
  return result;
}

// ---------------------------------------------------------------------------
// Plan changes, cancel/resume, terms acceptance (founder decisions 2026-09-17,
// docs/vault/decisions/0052, 0053). The account holds at most one live
// subscription (0041), so every function below is keyed on the user.
// ---------------------------------------------------------------------------

/** The statuses subscriptions_one_live_per_user covers. */
const LIVE_STATUSES: Array<"active" | "past_due" | "suspended"> = [
  "active",
  "past_due",
  "suspended",
];

export type PlanChangeErrorCode =
  "no_subscription" | "not_active" | "unknown_plan" | "nothing_pending" | "no_recurring_ref";

/**
 * Typed so the web tier can answer in Hebrew by `code` instead of scraping an
 * English message. `not_active` carries the status it found.
 */
export class PlanChangeError extends Error {
  readonly code: PlanChangeErrorCode;
  readonly status?: string;

  constructor(code: PlanChangeErrorCode, status?: string) {
    super(`plan change refused: ${code}${status ? ` (${status})` : ""}`);
    this.name = "PlanChangeError";
    this.code = code;
    this.status = status;
  }
}

export type PlanChangeResult =
  | { kind: "upgraded"; quote: PlanChangeQuote }
  | { kind: "scheduled"; quote: PlanChangeQuote }
  | { kind: "undone" }
  | { kind: "charge_failed"; quote: PlanChangeQuote; error?: string };

type SubscriptionRow = typeof subscriptions.$inferSelect;

/** The account's live subscription, if any — one at most by the 0041 index. */
export async function liveSubscription(
  db: Db,
  userId: string,
): Promise<SubscriptionRow | undefined> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), inArray(subscriptions.status, LIVE_STATUSES)))
    .limit(1);
  return rows[0];
}

/**
 * Change the account's plan.
 *
 *   upgrade (by price), with ≥ 2 days left   charge the prorated difference
 *     NOW through the gateway; on success grant the prorated credits as a
 *     grant_period row (they expire at the next renewal like the rest of the
 *     period — never grant_manual, which expirePeriodRemainder spares) and
 *     switch plan_code. Period dates never move. On a declined charge nothing
 *     changes except the gateway_events row.
 *   upgrade on the last day, or any downgrade   scheduled_plan_code = to; the
 *     renewal applies it. A plan change replaces a pending cancel.
 *   to == the current plan   the undo: clears the schedule and the pending
 *     cancel. Refused as nothing_pending when there was nothing to undo.
 *
 * Only an `active` subscription may change plan; past_due and suspended are
 * refused with `not_active`. The row is locked FOR UPDATE for the whole
 * transaction, gateway call included, so two clicks serialize.
 */
export async function changePlan(
  db: Db,
  gateway: BillingGateway,
  opts: { userId: string; toPlanCode: string; now?: Date },
): Promise<PlanChangeResult> {
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const sub = (
      await tx
        .select()
        .from(subscriptions)
        .where(
          and(eq(subscriptions.userId, opts.userId), inArray(subscriptions.status, LIVE_STATUSES)),
        )
        .limit(1)
        .for("update")
    )[0];
    if (!sub) throw new PlanChangeError("no_subscription");
    if (sub.status !== "active") throw new PlanChangeError("not_active", sub.status);

    if (opts.toPlanCode === sub.planCode) {
      if (!sub.scheduledPlanCode && !sub.cancelAtPeriodEnd) {
        throw new PlanChangeError("nothing_pending");
      }
      await tx
        .update(subscriptions)
        .set({ scheduledPlanCode: null, cancelAtPeriodEnd: false, updatedAt: now })
        .where(eq(subscriptions.id, sub.id));
      return { kind: "undone" };
    }

    const planRows = await tx
      .select()
      .from(plans)
      .where(inArray(plans.code, [sub.planCode, opts.toPlanCode]));
    const from = planRows.find((p) => p.code === sub.planCode);
    const to = planRows.find((p) => p.code === opts.toPlanCode);
    if (!from || !to || !to.active) throw new PlanChangeError("unknown_plan");

    const quote = quotePlanChange({
      from,
      to,
      periodStart: sub.currentPeriodStart,
      periodEnd: sub.currentPeriodEnd,
      now,
    });

    if (quote.kind === "upgrade" && !quote.scheduleInstead) {
      if (!sub.gatewayRecurringRef) throw new PlanChangeError("no_recurring_ref");
      const charge = await gateway.chargeRecurring({
        recurringRef: sub.gatewayRecurringRef,
        amountAgorot: quote.chargeAgorot,
        description: `תבנית — שדרוג ל${to.name}`,
      });
      await tx
        .insert(gatewayEvents)
        .values({
          gateway: gateway.name,
          gatewayEventId: charge.gatewayEventId,
          kind: charge.ok ? "plan_change_charge_success" : "plan_change_charge_failed",
          payload: {
            subscriptionId: sub.id,
            fromPlanCode: from.code,
            toPlanCode: to.code,
            amountAgorot: quote.chargeAgorot,
            creditsGranted: quote.creditsGranted,
            error: charge.error,
          },
          processedAt: now,
        })
        .onConflictDoNothing({ target: gatewayEvents.gatewayEventId });
      if (!charge.ok) return { kind: "charge_failed", quote, error: charge.error };

      if (quote.creditsGranted > 0) {
        await grantPeriod(tx as Db, {
          userId: sub.userId,
          credits: quote.creditsGranted,
          subscriptionId: sub.id,
          note: `upgrade ${from.code}→${to.code} ${quote.daysRemaining}/${quote.daysInPeriod}`,
        });
      }
      await tx
        .update(subscriptions)
        .set({
          planCode: to.code,
          scheduledPlanCode: null,
          cancelAtPeriodEnd: false,
          updatedAt: now,
        })
        .where(eq(subscriptions.id, sub.id));
      return { kind: "upgraded", quote };
    }

    await tx
      .update(subscriptions)
      .set({ scheduledPlanCode: to.code, cancelAtPeriodEnd: false, updatedAt: now })
      .where(eq(subscriptions.id, sub.id));
    return { kind: "scheduled", quote };
  });
}

/**
 * Cancel at period end, no refund; service runs to the end of what was paid
 * for. A cancel replaces a pending plan change. Idempotent on the flag.
 */
export async function cancelSubscription(
  db: Db,
  opts: { userId: string; now?: Date },
): Promise<void> {
  const sub = await liveSubscription(db, opts.userId);
  if (!sub) throw new PlanChangeError("no_subscription");
  await db
    .update(subscriptions)
    .set({ cancelAtPeriodEnd: true, scheduledPlanCode: null, updatedAt: opts.now ?? new Date() })
    .where(eq(subscriptions.id, sub.id));
}

/** Undo a pending cancel. Idempotent on the flag. */
export async function resumeSubscription(
  db: Db,
  opts: { userId: string; now?: Date },
): Promise<void> {
  const sub = await liveSubscription(db, opts.userId);
  if (!sub) throw new PlanChangeError("no_subscription");
  await db
    .update(subscriptions)
    .set({ cancelAtPeriodEnd: false, updatedAt: opts.now ?? new Date() })
    .where(eq(subscriptions.id, sub.id));
}

/**
 * Everything the account page needs in one read: the live subscription, the
 * active plans by price, the balance, the manual portion of it, and a quote
 * for every plan the account is not on — computed by the same function the
 * change route charges through, so the page cannot show a different number.
 */
export async function getAccountBilling(
  db: Db,
  opts: { userId: string; now?: Date },
): Promise<{
  subscription: SubscriptionRow | null;
  plans: Array<typeof plans.$inferSelect>;
  balance: number;
  manualOutstanding: number;
  quotes: Record<string, PlanChangeQuote>;
}> {
  const now = opts.now ?? new Date();
  const [subscription, allPlans, balance, manual] = await Promise.all([
    liveSubscription(db, opts.userId),
    db.select().from(plans).orderBy(asc(plans.priceAgorot)),
    creditBalance(db, opts.userId),
    manualOutstanding(db, opts.userId),
  ]);
  // The ladder offered is the ACTIVE plans; the plan the account is on is
  // looked up without that filter, exactly as changePlan does — a retired
  // plan keeps serving and still gets quoted, so the page and the route agree.
  const planRows = allPlans.filter((p) => p.active);
  const quotes: Record<string, PlanChangeQuote> = {};
  const from = subscription ? allPlans.find((p) => p.code === subscription.planCode) : undefined;
  if (subscription && from) {
    for (const to of planRows) {
      if (to.code === from.code) continue;
      quotes[to.code] = quotePlanChange({
        from,
        to,
        periodStart: subscription.currentPeriodStart,
        periodEnd: subscription.currentPeriodEnd,
        now,
      });
    }
  }
  return {
    subscription: subscription ?? null,
    plans: planRows,
    balance,
    manualOutstanding: manual,
    quotes,
  };
}

/**
 * The stored half of "checkbox + a stored record" (founder, 2026-09-17; a
 * card-company requirement of the acquirer). `termsVersion` is the date string the terms
 * page shows at its head; `ip` is the first hop of x-forwarded-for.
 */
export async function recordTermsAcceptance(
  db: Db,
  opts: {
    userId: string;
    termsVersion: string;
    context: string;
    ip?: string | null;
    userAgent?: string | null;
  },
): Promise<{ id: string; acceptedAt: Date }> {
  const inserted = await db
    .insert(termsAcceptances)
    .values({
      userId: opts.userId,
      termsVersion: opts.termsVersion,
      context: opts.context,
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
    })
    .returning({ id: termsAcceptances.id, acceptedAt: termsAcceptances.acceptedAt });
  return inserted[0]!;
}
