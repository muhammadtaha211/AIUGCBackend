import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db";
import {
  appConfig,
  checkoutIntents,
  gatewayEvents,
  introTrials,
  plans,
  subscriptions,
  users,
} from "../db/schema";
import {
  CLOCK_SKEW_MS,
  getSumitClient,
  type SumitClient,
  type SumitPayment,
} from "../gateways/sumit";
import { enqueue, type Job } from "../jobs/queue";
import type { JobContext, JobResult } from "../jobs/worker";
import { logger } from "../logger";
import {
  addOneMonth,
  liveSubscription,
  recordTermsAcceptance,
  type BillingGateway,
} from "./billing";
import {
  expireTrialRemainder,
  grantPeriod,
  grantTrial,
  trialBaseline,
  unusedTrialCredits,
  type TrialLedgerState,
} from "./credits";

/**
 * The ₪5 intro offer (decision 0109, founder 2026-10-13/14). An account that
 * has never paid buys, once, on its own Sumit payment page, credits for every
 * service that expire 30 days after the payment. It never becomes a charge by
 * itself. "Continue" is the customer's choice: the card Sumit saved at the ₪5
 * payment is charged for an ordinary first month of a plan — full price, full
 * credits, period from that moment — and leftover trial credits ride along
 * until that month ends (they leave with the period remainder).
 *
 * The ₪5 payment itself completes through the hosted checkout's own intent and
 * return route (checkout.ts, kind 'intro'); this module owns the trial row,
 * its expiry, the continue and the settling of a continue whose answer was lost.
 *
 * Lock order, everywhere a trial is touched: users → intro_trials →
 * subscriptions. completeCheckout takes the intent first and then the same
 * three; debitRender takes users alone.
 */

/**
 * The numbers are the founder's (0109): ₪5, 30 days, and 150 credits — §1.2
 * said 145 (45 + 75 + 25, one of each service) and he raised it to 150 at plan
 * review. Constants, not config: only the on/off switch is a setting (§1.7),
 * and a number edited mid-checkout must not be able to refuse a paid ₪5.
 */
export const INTRO_OFFER = { priceAgorot: 500, credits: 150, days: 30 } as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * app_config key. `{"enabled": true}` is the offer on; absent, false or
 * unparseable is off — never a throw, so a typo switches the offer off rather
 * than breaking a page (0102's reader shape). Seeded off by 0062.
 */
export const INTRO_SWITCH_KEY = "intro_offer";
const introSwitchSchema = z.object({ enabled: z.boolean() });

/** Read only where a NEW trial could start: the intent and the offer's visibility. */
export async function introOfferEnabled(db: Db): Promise<boolean> {
  const rows = await db
    .select({ value: appConfig.value })
    .from(appConfig)
    .where(eq(appConfig.key, INTRO_SWITCH_KEY))
    .limit(1);
  const parsed = introSwitchSchema.safeParse(rows[0]?.value);
  return parsed.success && parsed.data.enabled;
}

export type IntroEligibility = "eligible" | "already_used" | "has_paid" | "offer_off";

/**
 * Once per account, and only an account that has never paid (§1.6): no trial
 * before, no subscription ever in any status (cancelled and suspended
 * included), no completed plan purchase. No card or IP check — the address is
 * evidence only. Checked in this order so a trial account reads "already used".
 * `ignoreSwitch` is the completion's re-check: a page already paid activates
 * even after the switch went off.
 */
export async function introEligibility(
  db: Db,
  userId: string,
  opts: { ignoreSwitch?: boolean } = {},
): Promise<IntroEligibility> {
  const trial = await db
    .select({ userId: introTrials.userId })
    .from(introTrials)
    .where(eq(introTrials.userId, userId))
    .limit(1);
  if (trial[0]) return "already_used";
  const subscription = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  if (subscription[0]) return "has_paid";
  const bought = await db
    .select({ id: checkoutIntents.id })
    .from(checkoutIntents)
    .where(
      and(
        eq(checkoutIntents.userId, userId),
        eq(checkoutIntents.kind, "plan"),
        eq(checkoutIntents.status, "completed"),
      ),
    )
    .limit(1);
  if (bought[0]) return "has_paid";
  if (!opts.ignoreSwitch && !(await introOfferEnabled(db))) return "offer_off";
  return "eligible";
}

export type IntroOfferErrorCode =
  | "already_used"
  | "has_paid"
  | "offer_off"
  | "no_trial"
  | "converted"
  | "attempt_pending"
  | "already_subscribed"
  | "unknown_plan";

/** Typed so the web tier answers in Hebrew by `code`. Every one is raised before any money moves. */
export class IntroOfferError extends Error {
  readonly code: IntroOfferErrorCode;

  constructor(code: IntroOfferErrorCode) {
    super(`intro offer refused: ${code}`);
    this.name = "IntroOfferError";
    this.code = code;
  }
}

type TrialRow = typeof introTrials.$inferSelect;

function ledgerState(trial: TrialRow): TrialLedgerState {
  return {
    credits: trial.credits,
    balanceBefore: trial.balanceBefore,
    manualBefore: trial.manualBefore,
    openDebitsBefore: trial.openDebitsBefore,
  };
}

/**
 * NO KEY UPDATE, not UPDATE: it still serializes against debitRender's FOR UPDATE
 * and every other path here, but it does not block the FOR KEY SHARE that a
 * credit_ledger insert's foreign key takes on the users row — so a renewal or
 * a plan change holding its subscription lock across a charge can never form a
 * deadlock cycle with a completion or a continue.
 */
async function lockUser(db: Db, userId: string): Promise<void> {
  await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("no key update");
}

async function lockTrial(db: Db, userId: string): Promise<TrialRow | undefined> {
  return (
    await db.select().from(introTrials).where(eq(introTrials.userId, userId)).for("update")
  )[0];
}

/**
 * The trial row, written inside completeCheckout once the ₪5 payment is
 * verified and the users lock is held. Returns the refusal the caller raises
 * WITH the payment (money moved: `checkout_refused`, a refund by hand), or null
 * when the trial is active. The re-check ignores the switch on purpose.
 */
export async function activateIntroTrial(
  db: Db,
  opts: {
    userId: string;
    intentId: string;
    sumitCustomerId: string;
    payment: SumitPayment;
    now: Date;
  },
): Promise<"intro_already_used" | "not_eligible" | null> {
  const eligibility = await introEligibility(db, opts.userId, { ignoreSwitch: true });
  if (eligibility === "already_used") return "intro_already_used";
  if (eligibility !== "eligible") return "not_eligible";

  const baseline = await trialBaseline(db, opts.userId);
  // "30 days after the payment": the payment's own date, so a return replayed
  // later (decision 0062's recovery) does not stretch the trial.
  const startedAt = opts.payment.date ?? opts.now;
  await db.insert(introTrials).values({
    userId: opts.userId,
    intentId: opts.intentId,
    sumitCustomerId: opts.sumitCustomerId,
    priceAgorot: opts.payment.amountAgorot,
    credits: INTRO_OFFER.credits,
    balanceBefore: baseline.balance,
    manualBefore: baseline.manual,
    openDebitsBefore: baseline.openDebits,
    startedAt,
    expiresAt: new Date(startedAt.getTime() + INTRO_OFFER.days * DAY_MS),
  });
  await grantTrial(db, {
    userId: opts.userId,
    credits: INTRO_OFFER.credits,
    intentId: opts.intentId,
  });
  return null;
}

/**
 * Lock the account's trial that has not yet joined a plan, if any — for the
 * hosted plan checkout, which converts it. Called after the users lock and
 * BEFORE any subscription row is read or written (the lock order).
 */
export async function lockOpenTrial(db: Db, userId: string): Promise<TrialRow | undefined> {
  const trial = await lockTrial(db, userId);
  return trial && !trial.convertedAt ? trial : undefined;
}

/**
 * The account joins a plan: the trial is converted and its expiry no longer
 * applies — unless the decision came at or after the 30 days and the sweep had
 * not run yet, in which case the unused trial credits expire first, exactly as
 * the sweep would have taken them. MUST run before the plan's grantPeriod: the
 * expiry counts every non-manual credit as trial. Caller holds both locks.
 */
export async function convertTrial(
  db: Db,
  opts: {
    trial: TrialRow;
    subscriptionId: string;
    decisionAt: Date;
    now: Date;
    /**
     * Only the continue's own activation clears the attempt. A hosted plan
     * purchase that completes while a continue's answer is still unknown (a
     * page opened before the click) leaves it open, so the settle still looks
     * that charge up — and records it orphaned if it went through.
     */
    clearAttempt: boolean;
  },
): Promise<void> {
  const { trial } = opts;
  let expiredAt = trial.expiredAt;
  if (!expiredAt && opts.decisionAt.getTime() >= trial.expiresAt.getTime()) {
    await expireTrialRemainder(db, {
      userId: trial.userId,
      intentId: trial.intentId,
      trial: ledgerState(trial),
    });
    expiredAt = opts.now;
  }
  await db
    .update(introTrials)
    .set({
      expiredAt,
      convertedAt: opts.now,
      subscriptionId: opts.subscriptionId,
      ...(opts.clearAttempt
        ? { continueAttemptAt: null, continueAttemptPlan: null, continueAttemptAgorot: null }
        : {}),
    })
    .where(eq(introTrials.userId, trial.userId));
}

export type TrialView = {
  credits: number;
  /**
   * Past its 30 days — swept or not. Credits stay spendable until the sweep
   * runs, but nothing may promise them past the date: a continue decided now
   * expires them first.
   */
  ended: boolean;
  /** Unused trial credits while the trial is live; 0 once it expired or joined a plan. */
  creditsLeft: number;
  startedAt: Date;
  expiresAt: Date;
  expiredAt: Date | null;
  convertedAt: Date | null;
  /** A continue whose answer is not known yet: both purchase paths are closed until it settles. */
  attemptPending: boolean;
};

/** What the plan page and the continue page show. */
export async function getTrialView(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<TrialView | null> {
  const trial = (
    await db.select().from(introTrials).where(eq(introTrials.userId, userId)).limit(1)
  )[0];
  if (!trial) return null;
  const live = !trial.expiredAt && !trial.convertedAt;
  return {
    credits: trial.credits,
    ended: trial.expiredAt !== null || trial.expiresAt.getTime() <= now.getTime(),
    creditsLeft: live ? await unusedTrialCredits(db, userId, ledgerState(trial)) : 0,
    startedAt: trial.startedAt,
    expiresAt: trial.expiresAt,
    expiredAt: trial.expiredAt,
    convertedAt: trial.convertedAt,
    attemptPending: trial.continueAttemptAt !== null,
  };
}

/**
 * Everything the account surfaces need about the offer in one read. The web
 * also requires SUMIT_INTRO_PAGE before it shows anything.
 */
export async function getAccountIntro(
  db: Db,
  userId: string,
): Promise<{ trial: TrialView | null; introEligible: boolean }> {
  const [trial, eligibility] = await Promise.all([
    getTrialView(db, userId),
    introEligibility(db, userId),
  ]);
  return { trial, introEligible: eligibility === "eligible" };
}

// ---------------------------------------------------------------------------
// Day 30
// ---------------------------------------------------------------------------

/**
 * The daily sweep: every trial past its 30 days that has not joined a plan and
 * has no continue pending loses its unused credits. A pending continue is left
 * alone — the customer chose before the date, and the settle decides. An
 * account that somehow holds a subscription is skipped and logged: its
 * credits are no longer only trial and manual. Idempotent: expired_at is set
 * under the lock in the same transaction as the ledger row.
 */
export async function expireDueTrials(
  db: Db,
  now: Date = new Date(),
): Promise<{ expired: number; credits: number }> {
  const due = await db
    .select({ userId: introTrials.userId })
    .from(introTrials)
    .where(
      and(
        isNull(introTrials.expiredAt),
        isNull(introTrials.convertedAt),
        isNull(introTrials.continueAttemptAt),
        lte(introTrials.expiresAt, now),
      ),
    );
  const result = { expired: 0, credits: 0 };
  for (const { userId } of due) {
    const taken = await db.transaction(async (tx) => {
      await lockUser(tx as Db, userId);
      const trial = await lockTrial(tx as Db, userId);
      if (
        !trial ||
        trial.expiredAt ||
        trial.convertedAt ||
        trial.continueAttemptAt ||
        trial.expiresAt.getTime() > now.getTime()
      ) {
        return null;
      }
      const subscription = await tx
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(eq(subscriptions.userId, userId))
        .limit(1);
      if (subscription[0]) {
        logger.warn(
          { userId },
          "intro trial past its date on an account with a subscription — left alone",
        );
        return null;
      }
      const credits = await expireTrialRemainder(tx as Db, {
        userId,
        intentId: trial.intentId,
        trial: ledgerState(trial),
      });
      await tx.update(introTrials).set({ expiredAt: now }).where(eq(introTrials.userId, userId));
      return credits;
    });
    if (taken !== null) {
      result.expired++;
      result.credits += taken;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Continue
// ---------------------------------------------------------------------------

/**
 * How long a continue's answer may stay unknown before reconcile_continue
 * reads Sumit's list for it. The gateway already looked three times over ~20s;
 * a charge Sumit lists later than this is decision 0062's accepted residual.
 */
export const CONTINUE_SETTLE_AFTER_MS = 10 * 60 * 1000;

/** The receipt line of a continue's charge. COPY PENDING FOUNDER REVIEW. */
export function continueChargeDescription(planName: string): string {
  return `תבנית — מסלול ${planName}, חודש ראשון`;
}

export type ContinueResult =
  | { outcome: "activated"; subscriptionId: string; planCode: string }
  /** The answer was lost: the attempt stays open, both purchase paths stay shut, the settle decides. */
  | { outcome: "pending" }
  | { outcome: "declined"; error?: string }
  /** Charged, but the account had already joined a plan another way: a refund by hand. */
  | { outcome: "orphaned"; paymentId: string };

/**
 * The customer's continue. Three steps, and the charge is in none of the
 * transactions:
 *
 *   1. under the users → trial locks: refuse what cannot continue, record the
 *      terms acceptance, write the attempt (plan, amount, time) and enqueue its
 *      settle — committed BEFORE the card is touched, so a lost answer or a
 *      function killed mid-charge leaves a trace that refuses a second charge;
 *   2. charge the trial's Sumit customer (its default card is the card that
 *      paid the ₪5, aligned at completion) and record the answer at once, in
 *      its own statement;
 *   3. under the same locks: activate the month, or clear the attempt on a
 *      decline. An unconfirmed answer leaves the attempt for the settle.
 *
 * Classified by `ok` and `error === "unconfirmed"` only (the gateway's
 * contract) — the event id is never parsed.
 */
export async function continueFromTrial(
  db: Db,
  gateway: BillingGateway,
  opts: {
    userId: string;
    planCode: string;
    termsVersion: string;
    ip?: string | null;
    userAgent?: string | null;
    now?: Date;
  },
): Promise<ContinueResult> {
  // No gateway means no charge can be sent: refuse before anything is written
  // (the web maps the message to its 503), never leave an attempt that
  // nothing will ever charge.
  if (gateway.name === "not_configured") {
    throw new Error("no payment gateway configured — see docs/05-billing.md");
  }
  const now = opts.now ?? new Date();

  const prepared = await db.transaction(async (tx) => {
    await lockUser(tx as Db, opts.userId);
    const trial = await lockTrial(tx as Db, opts.userId);
    if (!trial) throw new IntroOfferError("no_trial");
    if (trial.convertedAt) throw new IntroOfferError("converted");
    if (trial.continueAttemptAt) throw new IntroOfferError("attempt_pending");
    if (await liveSubscription(tx as Db, opts.userId)) {
      throw new IntroOfferError("already_subscribed");
    }
    const plan = (await tx.select().from(plans).where(eq(plans.code, opts.planCode)).limit(1))[0];
    if (!plan || !plan.active) throw new IntroOfferError("unknown_plan");

    await recordTermsAcceptance(tx as Db, {
      userId: opts.userId,
      termsVersion: opts.termsVersion,
      context: "continue",
      ip: opts.ip,
      userAgent: opts.userAgent,
    });
    await tx
      .update(introTrials)
      .set({
        continueAttemptAt: now,
        continueAttemptPlan: plan.code,
        continueAttemptAgorot: plan.priceAgorot,
      })
      .where(eq(introTrials.userId, opts.userId));
    await enqueue(tx as Db, {
      type: "reconcile_continue",
      idempotencyKey: `reconcile_continue:${opts.userId}:${now.getTime()}`,
      payload: { userId: opts.userId, attemptAt: now.toISOString() },
      runAt: new Date(now.getTime() + CONTINUE_SETTLE_AFTER_MS),
    });
    return { trial, plan };
  });
  const { trial, plan } = prepared;

  const charge = await gateway.chargeRecurring({
    recurringRef: trial.sumitCustomerId,
    amountAgorot: plan.priceAgorot,
    description: continueChargeDescription(plan.name),
  });
  const unconfirmed = !charge.ok && charge.error === "unconfirmed";
  // The answer is on record before anything else can fail: an ok charge whose
  // activation then breaks is still findable by its payment id, and the settle
  // activates on it.
  await db
    .insert(gatewayEvents)
    .values({
      gateway: gateway.name,
      gatewayEventId: charge.gatewayEventId,
      kind: charge.ok
        ? "continue_charge"
        : unconfirmed
          ? "continue_charge_unconfirmed"
          : "continue_charge_failed",
      payload: {
        userId: opts.userId,
        planCode: plan.code,
        amountAgorot: plan.priceAgorot,
        sumitCustomerId: trial.sumitCustomerId,
        attemptAt: now.toISOString(),
        error: charge.error,
      },
      // An ok charge is processed when its month is activated; a lost answer
      // when it settles; a decline is done now.
      processedAt: charge.ok || unconfirmed ? null : now,
    })
    .onConflictDoNothing({ target: gatewayEvents.gatewayEventId });

  if (unconfirmed) {
    logger.warn(
      { userId: opts.userId, planCode: plan.code },
      "continue charge unconfirmed — left for the settle",
    );
    return { outcome: "pending" };
  }
  if (!charge.ok) {
    await db.transaction(async (tx) => {
      await lockUser(tx as Db, opts.userId);
      const fresh = await lockTrial(tx as Db, opts.userId);
      if (fresh?.continueAttemptAt?.getTime() === now.getTime()) {
        await tx
          .update(introTrials)
          .set({ continueAttemptAt: null, continueAttemptPlan: null, continueAttemptAgorot: null })
          .where(eq(introTrials.userId, opts.userId));
      }
    });
    return { outcome: "declined", error: charge.error };
  }
  return applyContinuePayment(db, {
    userId: opts.userId,
    attemptAt: now,
    planCode: plan.code,
    paymentId: charge.gatewayEventId,
    now,
  });
}

/**
 * A continue's payment is known to exist: activate the month on it, under the
 * users → trial locks. If the account joined a plan some other way meanwhile
 * (a hosted page paid in another tab during the charge), nothing is activated
 * twice — the payment is recorded `continue_charge_orphaned` for a refund by
 * hand. Shared by the continue's step 3 and the settle.
 */
async function applyContinuePayment(
  db: Db,
  opts: { userId: string; attemptAt: Date; planCode: string; paymentId: string; now: Date },
): Promise<ContinueResult> {
  return db.transaction(async (tx) => {
    await lockUser(tx as Db, opts.userId);
    const trial = await lockTrial(tx as Db, opts.userId);
    const attemptOpen = trial?.continueAttemptAt?.getTime() === opts.attemptAt.getTime();
    // The settle may have activated on this very payment already.
    if (trial?.convertedAt && trial.subscriptionId && !attemptOpen) {
      const existing = (
        await tx
          .select({ processedAt: gatewayEvents.processedAt })
          .from(gatewayEvents)
          .where(eq(gatewayEvents.gatewayEventId, opts.paymentId))
          .limit(1)
      )[0];
      if (existing?.processedAt) {
        return {
          outcome: "activated",
          subscriptionId: trial.subscriptionId,
          planCode: opts.planCode,
        };
      }
    }
    const live = await liveSubscription(tx as Db, opts.userId);
    if (!trial || trial.convertedAt || live) {
      await tx
        .insert(gatewayEvents)
        .values({
          gateway: "sumit",
          gatewayEventId: `continue_orphaned_${opts.paymentId}`,
          kind: "continue_charge_orphaned",
          payload: {
            userId: opts.userId,
            planCode: opts.planCode,
            sumitPaymentId: opts.paymentId,
            reason: trial?.convertedAt
              ? "already_converted"
              : live
                ? "already_subscribed"
                : "no_trial",
          },
        })
        .onConflictDoNothing({ target: gatewayEvents.gatewayEventId });
      if (attemptOpen) {
        await tx
          .update(introTrials)
          .set({ continueAttemptAt: null, continueAttemptPlan: null, continueAttemptAgorot: null })
          .where(eq(introTrials.userId, opts.userId));
      }
      logger.error(
        { userId: opts.userId, paymentId: opts.paymentId },
        "continue charged an account that had already joined a plan — refund by hand",
      );
      return { outcome: "orphaned", paymentId: opts.paymentId };
    }

    const plan = (await tx.select().from(plans).where(eq(plans.code, opts.planCode)).limit(1))[0];
    if (!plan) throw new Error(`continue: plan ${opts.planCode} is gone`);
    const inserted = await tx
      .insert(subscriptions)
      .values({
        userId: opts.userId,
        planCode: plan.code,
        status: "active",
        gateway: "sumit",
        gatewayRecurringRef: trial.sumitCustomerId,
        currentPeriodStart: opts.now,
        currentPeriodEnd: addOneMonth(opts.now),
        createdAt: opts.now,
        updatedAt: opts.now,
      })
      .returning({ id: subscriptions.id });
    const subscriptionId = inserted[0]!.id;
    // Before the grant: a continue chosen at or after the 30 days loses the
    // unused trial credits exactly as the sweep would have taken them.
    await convertTrial(tx as Db, {
      trial,
      subscriptionId,
      decisionAt: opts.attemptAt,
      now: opts.now,
      clearAttempt: true,
    });
    await grantPeriod(tx as Db, {
      userId: opts.userId,
      credits: plan.monthlyCredits,
      subscriptionId,
      note: "continue from the intro offer",
    });
    await tx
      .update(gatewayEvents)
      .set({ processedAt: opts.now })
      .where(eq(gatewayEvents.gatewayEventId, opts.paymentId));
    logger.info(
      { userId: opts.userId, subscriptionId, planCode: plan.code, paymentId: opts.paymentId },
      "continue activated the first month",
    );
    return { outcome: "activated", subscriptionId, planCode: plan.code };
  });
}

/**
 * Settle every continue whose answer has been unknown for
 * CONTINUE_SETTLE_AFTER_MS (founder's choice, 2026-10-14: automatic). Read
 * Sumit's payments list over [attempt − CLOCK_SKEW_MS, attempt + the wait] for
 * THIS customer, exactly the attempt's amount, valid, and no
 * ExternalIdentifier (an API charge, not a page payment). That narrow look is
 * safe here as it is not for renewals (decision 0062): a trial's customer has
 * no subscription, so no renewal or upgrade charges it, and the open attempt
 * refuses every new continue and hosted checkout. Found → the month activates
 * on it. Not found → the attempt is cleared and the customer may try again.
 * A list that cannot be read leaves the attempt for the next run.
 */
export async function settleContinueAttempts(
  db: Db,
  client: SumitClient,
  now: Date = new Date(),
  opts: { userId?: string; attemptAt?: Date } = {},
): Promise<{ activated: number; cleared: number; orphaned: number; waiting: number }> {
  const result = { activated: 0, cleared: 0, orphaned: 0, waiting: 0 };
  const open = await db
    .select()
    .from(introTrials)
    .where(
      and(
        // A job settles exactly the attempt that enqueued it (its run_at
        // already carried the wait, on the database's clock); the daily
        // backstop settles every attempt old enough on this one.
        opts.attemptAt
          ? eq(introTrials.continueAttemptAt, opts.attemptAt)
          : lte(introTrials.continueAttemptAt, new Date(now.getTime() - CONTINUE_SETTLE_AFTER_MS)),
        isNotNull(introTrials.continueAttemptAt),
        ...(opts.userId ? [eq(introTrials.userId, opts.userId)] : []),
      ),
    );
  for (const trial of open) {
    const attemptAt = trial.continueAttemptAt!;
    const planCode = trial.continueAttemptPlan!;
    const amountAgorot = trial.continueAttemptAgorot!;
    const from = new Date(attemptAt.getTime() - CLOCK_SKEW_MS);
    const to = new Date(attemptAt.getTime() + CONTINUE_SETTLE_AFTER_MS);
    let payments: SumitPayment[];
    try {
      payments = await client.listPayments(from, to);
    } catch (err) {
      logger.warn(
        { userId: trial.userId, error: String(err) },
        "continue settle: payments list failed — retrying later",
      );
      result.waiting++;
      continue;
    }
    const found = payments
      .filter(
        (p) =>
          String(p.customerId) === trial.sumitCustomerId &&
          p.valid &&
          p.amountAgorot === amountAgorot &&
          p.externalIdentifier === null &&
          p.date !== null &&
          p.date.getTime() >= from.getTime() &&
          p.date.getTime() <= to.getTime(),
      )
      .sort((a, b) => b.date!.getTime() - a.date!.getTime())[0];

    if (found) {
      const paymentId = String(found.id);
      await db
        .insert(gatewayEvents)
        .values({
          gateway: "sumit",
          gatewayEventId: paymentId,
          kind: "continue_charge",
          payload: {
            userId: trial.userId,
            planCode,
            amountAgorot,
            sumitCustomerId: trial.sumitCustomerId,
            attemptAt: attemptAt.toISOString(),
            settled: true,
          },
        })
        .onConflictDoNothing({ target: gatewayEvents.gatewayEventId });
      const applied = await applyContinuePayment(db, {
        userId: trial.userId,
        attemptAt,
        planCode,
        paymentId,
        now,
      });
      if (applied.outcome === "activated") result.activated++;
      else if (applied.outcome === "orphaned") result.orphaned++;
      continue;
    }

    const cleared = await db.transaction(async (tx) => {
      await lockUser(tx as Db, trial.userId);
      const fresh = await lockTrial(tx as Db, trial.userId);
      if (fresh?.continueAttemptAt?.getTime() !== attemptAt.getTime()) return false;
      await tx
        .update(introTrials)
        .set({ continueAttemptAt: null, continueAttemptPlan: null, continueAttemptAgorot: null })
        .where(eq(introTrials.userId, trial.userId));
      await tx
        .insert(gatewayEvents)
        .values({
          gateway: "sumit",
          gatewayEventId: `continue_cleared_${trial.userId}_${attemptAt.getTime()}`,
          kind: "continue_charge_cleared",
          payload: {
            userId: trial.userId,
            planCode,
            amountAgorot,
            attemptAt: attemptAt.toISOString(),
          },
          processedAt: now,
        })
        .onConflictDoNothing({ target: gatewayEvents.gatewayEventId });
      return true;
    });
    if (cleared) result.cleared++;
  }
  return result;
}

/** The delayed job each continue enqueues, CONTINUE_SETTLE_AFTER_MS after the click. */
/** How often, and how many times, a settle whose payments list could not be read tries again. */
export const CONTINUE_SETTLE_RETRY_MS = 5 * 60 * 1000;
export const CONTINUE_SETTLE_MAX_RETRIES = 12;

/**
 * The delayed job each continue enqueues, CONTINUE_SETTLE_AFTER_MS after the
 * click. It settles exactly the attempt that enqueued it — never a newer one,
 * whose charge may still be in flight — and its run_at already carried the
 * wait. When Sumit's list cannot be read (likely the very outage that lost the
 * answer) it tries again every few minutes for an hour before leaving the
 * attempt to the daily backstop, so a customer who paid is not left without
 * the month for a day.
 */
export async function handleReconcileContinue(job: Job, ctx: JobContext): Promise<JobResult> {
  const payload = job.payload as { userId?: unknown; attemptAt?: unknown };
  const userId = typeof payload.userId === "string" ? payload.userId : undefined;
  const attemptAt = typeof payload.attemptAt === "string" ? new Date(payload.attemptAt) : undefined;
  if (!userId || !attemptAt || Number.isNaN(attemptAt.getTime())) return { kind: "done" };
  const summary = await settleContinueAttempts(ctx.db, getSumitClient(), new Date(), {
    userId,
    attemptAt,
  });
  ctx.log.info({ userId, ...summary }, "continue attempt settled");
  const state = (job.state ?? {}) as { retries?: number };
  const retries = typeof state.retries === "number" ? state.retries : 0;
  if (summary.waiting > 0 && retries < CONTINUE_SETTLE_MAX_RETRIES) {
    return {
      kind: "reschedule",
      delayMs: CONTINUE_SETTLE_RETRY_MS,
      state: { retries: retries + 1 },
    };
  }
  return { kind: "done" };
}

/**
 * The daily pass beside billing_renewals: the backstop settle for any attempt
 * whose own job was lost, then the day-30 expiry.
 */
export async function handleExpireTrials(_job: Job, ctx: JobContext): Promise<JobResult> {
  const now = new Date();
  const settled = await settleContinueAttempts(ctx.db, getSumitClient(), now);
  const expired = await expireDueTrials(ctx.db, now);
  ctx.log.info({ settled, expired }, "intro trials processed");
  return { kind: "done" };
}
