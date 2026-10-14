import { and, asc, eq, gt, inArray, lt } from "drizzle-orm";
import type { Db } from "../db";
import {
  businesses,
  checkoutIntents,
  gatewayEvents,
  introTrials,
  plans,
  subscriptions,
  users,
} from "../db/schema";
import { getSumitClient, type SumitClient, type SumitPayment } from "../gateways/sumit";
import { logger } from "../logger";
import { addOneMonth, liveSubscription, PlanChangeError, recordTermsAcceptance } from "./billing";
import { expirePeriodRemainder, grantPeriod } from "./credits";
import {
  activateIntroTrial,
  convertTrial,
  INTRO_OFFER,
  introEligibility,
  IntroOfferError,
  lockOpenTrial,
} from "./intro";

/**
 * Hosted checkout via Sumit payment pages (decision 0062). The customer pays
 * on Sumit's page; the browser comes back to /api/billing/sumit/return with
 * three plain-text ids; NOTHING on that URL is trusted. What activates a
 * subscription is (a) the intent this account wrote before leaving, and (b) a
 * server-to-server read of the payment that must agree with it on amount,
 * customer and intent id. Both halves live here.
 */

/** A pending intent younger than this is reused instead of writing another (queue item 12). */
export const INTENT_REUSE_MS = 30 * 60 * 1000;
/** A pending intent older than this is expired lazily on the next create. */
export const INTENT_TTL_MS = 24 * 60 * 60 * 1000;

type IntentRow = typeof checkoutIntents.$inferSelect;

/**
 * The row POST /api/account/checkout writes before building the payment-page
 * URL. Reuses this account's pending intent for the same plan when it is
 * younger than INTENT_REUSE_MS — a second click is the same purchase, not a
 * second terms-acceptance row. Otherwise records the acceptance and inserts
 * an intent with the plan's price snapshotted.
 *
 * An account with a live subscription that is not suspended is refused
 * BEFORE anything is written (already_subscribed). The checkout page bounces
 * those accounts, but the API is reachable from a tab rendered earlier, and
 * a payment-page URL handed to an account completeCheckout would refuse is
 * money taken for nothing.
 */
export async function createCheckoutIntent(
  db: Db,
  opts: {
    userId: string;
    planCode: string;
    termsVersion: string;
    ip?: string | null;
    userAgent?: string | null;
    now?: Date;
  },
): Promise<{ intent: IntentRow; reused: boolean }> {
  const now = opts.now ?? new Date();

  const live = await liveSubscription(db, opts.userId);
  if (live && live.status !== "suspended") {
    throw new CheckoutVerificationError("already_subscribed", live.status);
  }
  // A continue whose answer is not known yet (intro.ts): a second purchase now
  // could charge the same customer twice. Refused until it settles.
  const trial = (
    await db
      .select({ attemptAt: introTrials.continueAttemptAt })
      .from(introTrials)
      .where(eq(introTrials.userId, opts.userId))
      .limit(1)
  )[0];
  if (trial?.attemptAt) throw new IntroOfferError("attempt_pending");

  await expireStalePendingIntents(db, now);

  const reusable = (
    await db
      .select()
      .from(checkoutIntents)
      .where(
        and(
          eq(checkoutIntents.userId, opts.userId),
          eq(checkoutIntents.planCode, opts.planCode),
          eq(checkoutIntents.status, "pending"),
          gt(checkoutIntents.createdAt, new Date(now.getTime() - INTENT_REUSE_MS)),
        ),
      )
      .orderBy(asc(checkoutIntents.createdAt))
      .limit(1)
  )[0];
  if (reusable) return { intent: reusable, reused: true };

  const plan = (await db.select().from(plans).where(eq(plans.code, opts.planCode)).limit(1))[0];
  if (!plan || !plan.active) throw new PlanChangeError("unknown_plan");

  const acceptance = await recordTermsAcceptance(db, {
    userId: opts.userId,
    termsVersion: opts.termsVersion,
    context: "checkout",
    ip: opts.ip,
    userAgent: opts.userAgent,
  });
  const inserted = await db
    .insert(checkoutIntents)
    .values({
      userId: opts.userId,
      planCode: plan.code,
      priceAgorot: plan.priceAgorot,
      status: "pending",
      termsAcceptanceId: acceptance.id,
      createdAt: now,
    })
    .returning();
  return { intent: inserted[0]!, reused: false };
}

/** Pending intents older than INTENT_TTL_MS stop being reused (they stay payable). */
async function expireStalePendingIntents(db: Db, now: Date): Promise<void> {
  await db
    .update(checkoutIntents)
    .set({ status: "expired" })
    .where(
      and(
        eq(checkoutIntents.status, "pending"),
        lt(checkoutIntents.createdAt, new Date(now.getTime() - INTENT_TTL_MS)),
      ),
    );
}

/**
 * The ₪5 intro offer's intent (decision 0109): the row POST /api/account/intro
 * writes before the browser leaves for the offer's own Sumit page. Eligibility
 * first — once per account, never paid, the switch on — and a refusal writes
 * NOTHING (0109 §1.6: refused before any intent is written). Then the same lazy
 * expiry and 30-minute reuse as a plan intent, a terms acceptance in context
 * 'intro', and a row with kind 'intro', no plan and the offer's price. The
 * return route and completeCheckout bind on it exactly as on a plan intent.
 */
export async function createIntroIntent(
  db: Db,
  opts: {
    userId: string;
    termsVersion: string;
    ip?: string | null;
    userAgent?: string | null;
    now?: Date;
  },
): Promise<{ intent: IntentRow; reused: boolean }> {
  const now = opts.now ?? new Date();

  const eligibility = await introEligibility(db, opts.userId);
  if (eligibility !== "eligible") throw new IntroOfferError(eligibility);

  await expireStalePendingIntents(db, now);

  const reusable = (
    await db
      .select()
      .from(checkoutIntents)
      .where(
        and(
          eq(checkoutIntents.userId, opts.userId),
          eq(checkoutIntents.kind, "intro"),
          eq(checkoutIntents.status, "pending"),
          gt(checkoutIntents.createdAt, new Date(now.getTime() - INTENT_REUSE_MS)),
        ),
      )
      .orderBy(asc(checkoutIntents.createdAt))
      .limit(1)
  )[0];
  if (reusable) return { intent: reusable, reused: true };

  const acceptance = await recordTermsAcceptance(db, {
    userId: opts.userId,
    termsVersion: opts.termsVersion,
    context: "intro",
    ip: opts.ip,
    userAgent: opts.userAgent,
  });
  const inserted = await db
    .insert(checkoutIntents)
    .values({
      userId: opts.userId,
      kind: "intro",
      planCode: null,
      priceAgorot: INTRO_OFFER.priceAgorot,
      status: "pending",
      termsAcceptanceId: acceptance.id,
      createdAt: now,
    })
    .returning();
  return { intent: inserted[0]!, reused: false };
}

export async function getCheckoutIntent(db: Db, intentId: string): Promise<IntentRow | undefined> {
  return (
    await db.select().from(checkoutIntents).where(eq(checkoutIntents.id, intentId)).limit(1)
  )[0];
}

/**
 * What the payment-page URL is built from: the account's email (Sumit's
 * emailaddress param, where the receipt goes) and the businesses it owns, so
 * the web tier can pick the selected one as the Sumit customer name.
 */
export async function accountContact(
  db: Db,
  userId: string,
): Promise<{ email: string; businesses: { id: string; name: string }[] }> {
  const user = (
    await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1)
  )[0];
  if (!user) throw new Error(`user ${userId} not found`);
  const rows = await db
    .select({ id: businesses.id, name: businesses.name })
    .from(businesses)
    .where(eq(businesses.ownerUserId, userId))
    .orderBy(asc(businesses.createdAt));
  return { email: user.email, businesses: rows };
}

export type CheckoutVerificationReason =
  | "intent_not_found"
  | "payment_not_found"
  | "payment_invalid"
  | "amount_mismatch"
  | "customer_mismatch"
  | "identifier_mismatch"
  | "no_saved_card"
  | "already_subscribed"
  | "intent_already_completed"
  // The ₪5 offer (intro.ts), re-checked once the payment is verified: a second
  // trial (two paid tabs), or a plan bought between the intent and the payment.
  | "intro_already_used"
  | "not_eligible";

/**
 * Typed so the return route can log the reason and choose a landing; the
 * customer never sees the reason. `payment` is the valid Sumit payment that
 * had already been verified when the refusal was raised — money moved and
 * nothing was activated — or null when nothing was verified to have moved.
 */
export class CheckoutVerificationError extends Error {
  readonly reason: CheckoutVerificationReason;
  readonly payment: SumitPayment | null;

  constructor(
    reason: CheckoutVerificationReason,
    detail?: string,
    payment: SumitPayment | null = null,
  ) {
    super(`checkout verification failed: ${reason}${detail ? ` (${detail})` : ""}`);
    this.name = "CheckoutVerificationError";
    this.reason = reason;
    this.payment = payment;
  }
}

export type CheckoutOutcome = {
  /** `replayed` — the intent was already completed; nothing was granted again. */
  outcome: "completed" | "replayed";
  /** Which purchase completed — the return route lands an intro on its own line. */
  kind: "plan" | "intro";
  intentId: string;
  subscriptionId: string | null;
  /** null for the intro offer. */
  planCode: string | null;
};

/**
 * Complete an intent from the ids the return URL carried. In one transaction:
 * lock the intent; a completed one with the SAME payment id returns its
 * existing outcome (a reloaded return URL grants nothing twice) and with a
 * different payment id is refused loudly (paid twice — a refund, not an
 * activation); an expired one is completable (expiry only stops reuse);
 * verify the payment server-to-server —
 * valid, the intent's exact price, that customer, and carrying this intent's
 * id as its ExternalIdentifier (the payment page echoes our externalidentifier
 * param onto the payment, measured); verify the customer has a saved card;
 * then activate.
 *
 * The saved card is checked and, when needed, ALIGNED. Measured 2026-09-21 on
 * the test business: a card the customer tried first and had declined stays
 * the customer's default, and the card that then paid is tokenised but is not
 * made the default. A renewal charged against that default would hit the
 * declined card. So when the default's token differs from the paying card's,
 * setforcustomer makes the paying card the default. A failure THERE is logged
 * and does not stop the activation: the customer paid, and the worst case is
 * a renewal that fails into dunning, which is recoverable — an activation
 * refused after a successful payment is not.
 *
 * Reactivation: an account with a `suspended` subscription (the only live
 * status a checkout is offered from) gets it reactivated in place — a fresh
 * period from now, the intent's plan, the new customer id — after its old
 * period remainder is expired. `active` and `past_due` cannot reach checkout
 * from the plan page, and if they arrive here anyway the one-live index would
 * refuse a second row, so they are refused as already_subscribed before any
 * change. A `canceled` row is history: a new row is inserted beside it.
 *
 * Any verification failure throws BEFORE anything is written, so the
 * transaction has nothing to roll back; the intent stays pending. A refusal
 * raised AFTER the payment was verified valid — the money moved and nothing
 * was activated — is also recorded as a `checkout_refused` gateway event
 * outside the transaction, under the payment's id, so a paid-but-unactivated
 * customer is findable from our own tables and not only from a log line.
 */
export async function completeCheckout(
  db: Db,
  opts: {
    intentId: string;
    sumitPaymentId: string;
    sumitCustomerId: string;
    now?: Date;
    client?: SumitClient;
  },
): Promise<CheckoutOutcome> {
  const now = opts.now ?? new Date();
  const client = opts.client ?? getSumitClient();

  try {
    return await completeCheckoutTx(db, { ...opts, now, client });
  } catch (err) {
    if (err instanceof CheckoutVerificationError && err.payment) {
      await db
        .insert(gatewayEvents)
        .values({
          gateway: "sumit",
          gatewayEventId: `sumit_refused_${err.payment.id}`,
          kind: "checkout_refused",
          payload: {
            intentId: opts.intentId,
            reason: err.reason,
            detail: err.message,
            sumitPaymentId: String(err.payment.id),
            sumitCustomerId: opts.sumitCustomerId,
            amountAgorot: err.payment.amountAgorot,
            documentId: err.payment.documentId,
          },
          processedAt: now,
        })
        .onConflictDoNothing({ target: gatewayEvents.gatewayEventId });
    }
    throw err;
  }
}

/**
 * The return leg could not CONFIRM a payment, and the browser got here by
 * being redirected off Sumit's payment page — which, measured on the test
 * business, only happens after a payment the page accepted (a decline
 * re-rendered the page and never redirected: facts/sumit-payment-page-saves-the-card.md).
 * So the customer has almost certainly paid, and the landing must not invite a
 * second payment. This is that return's record: one row per payment id, so a
 * paid-but-unactivated customer is findable from our own tables and not only
 * from a log line that may have rolled off.
 *
 * Deliberately NOT inside completeCheckout, which is unchanged: `checkout_refused`
 * is a VERDICT — Sumit answered, the payment is valid, and we refused to
 * activate on it. This is the absence of a verdict — Sumit unreachable or
 * misconfigured, an unexpected throw. The route decides which it had and calls
 * this one itself.
 *
 * One case the ROW cannot cover, though the landing does: when the failure is
 * this database, the write fails with it. Then the log line is the whole
 * record — which is why every failure line carries the ids (route.ts).
 *
 * `processed_at` stays null: nothing was processed. What RESOLVES one of these
 * rows is a `checkout_charge` row under the same payment id — the query is in
 * docs/05-billing.md. Recording is best-effort by design: the caller logs a
 * failure here and lands the customer on the same line either way.
 */
export async function recordUnconfirmedCheckoutReturn(
  db: Db,
  opts: {
    intentId: string;
    sumitPaymentId: string;
    sumitCustomerId: string;
    /** `CheckoutVerificationReason`, `sumit_<SumitApiError kind>`, or `unexpected_error`. */
    reason: string;
    /** The error's message. Never a stack — this row is read in the SQL editor. */
    detail: string;
    /** The route path plus the og-* query it arrived with, so the founder can replay it. */
    returnPath: string;
  },
): Promise<void> {
  await db
    .insert(gatewayEvents)
    .values({
      gateway: "sumit",
      gatewayEventId: `sumit_unconfirmed_${opts.sumitPaymentId}`,
      kind: "checkout_unconfirmed",
      payload: {
        intentId: opts.intentId,
        sumitPaymentId: opts.sumitPaymentId,
        sumitCustomerId: opts.sumitCustomerId,
        reason: opts.reason,
        detail: opts.detail,
        returnPath: opts.returnPath,
      },
    })
    // A reloaded return URL keeps the FIRST reason rather than overwriting it
    // with the second attempt's, and one payment is one row however many times
    // the customer refreshes.
    .onConflictDoNothing({ target: gatewayEvents.gatewayEventId });
}

async function completeCheckoutTx(
  db: Db,
  opts: {
    intentId: string;
    sumitPaymentId: string;
    sumitCustomerId: string;
    now: Date;
    client: SumitClient;
  },
): Promise<CheckoutOutcome> {
  const { now, client } = opts;

  return db.transaction(async (tx) => {
    const intent = (
      await tx
        .select()
        .from(checkoutIntents)
        .where(eq(checkoutIntents.id, opts.intentId))
        .limit(1)
        .for("update")
    )[0];
    if (!intent) throw new CheckoutVerificationError("intent_not_found");
    if (intent.status === "completed") {
      // The SAME payment again is a reloaded return URL: nothing to do. A
      // DIFFERENT payment against a completed intent is money taken twice
      // (two tabs on one reused intent, both paid): nothing is activated
      // twice, and the refusal is loud so the founder refunds it in Sumit.
      if (intent.sumitPaymentId !== opts.sumitPaymentId) {
        // Read the second payment so the refusal records whether money moved.
        const other = await client.getPayment(opts.sumitPaymentId);
        throw new CheckoutVerificationError(
          "intent_already_completed",
          `completed with payment ${intent.sumitPaymentId}, now ${opts.sumitPaymentId}`,
          other?.valid && other.externalIdentifier === intent.id ? other : null,
        );
      }
      const existing = (
        await tx
          .select({ id: subscriptions.id })
          .from(subscriptions)
          .where(
            and(
              eq(subscriptions.userId, intent.userId),
              inArray(subscriptions.status, ["active", "past_due", "suspended"]),
            ),
          )
          .limit(1)
      )[0];
      logger.info(
        { intentId: intent.id, paymentId: opts.sumitPaymentId },
        "checkout return replayed",
      );
      return {
        outcome: "replayed",
        kind: intent.kind,
        intentId: intent.id,
        subscriptionId: intent.kind === "intro" ? null : (existing?.id ?? null),
        planCode: intent.planCode,
      };
    }
    // `expired` falls through: expiry only stops the row being REUSED by a
    // new click. The Sumit page carrying this intent id stays payable for as
    // long as the customer keeps it open, and a payment made on it verifies
    // against the snapshotted price like any other — refusing it would take
    // the money and activate nothing.

    const payment = await verifyHostedPayment(
      client,
      intent,
      opts.sumitPaymentId,
      opts.sumitCustomerId,
      {
        // A plan's renewals charge the saved card, so a plan activation needs one.
        // The ₪5 only needs it for an optional continue, which falls back to the
        // hosted page when the charge is refused — never refuse a paid trial over it.
        requireSavedCard: intent.kind === "plan",
      },
    );

    // One lock order on every path that touches an account's purchases
    // (decision 0109): intent → users → intro_trials → subscriptions. The users
    // row serializes a ₪5 completing against a plan completing in another tab,
    // and against the trial sweep and a continue.
    // NO KEY UPDATE: it serializes against debitRender and the intro paths but
    // never blocks the FOR KEY SHARE a ledger insert's foreign key takes, so a
    // renewal holding its subscription lock across a charge cannot deadlock it.
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, intent.userId))
      .for("no key update");

    if (intent.kind === "intro") {
      const refusal = await activateIntroTrial(tx as Db, {
        userId: intent.userId,
        intentId: intent.id,
        sumitCustomerId: opts.sumitCustomerId,
        payment,
        now,
      });
      if (refusal) throw new CheckoutVerificationError(refusal, undefined, payment);
      await tx
        .insert(gatewayEvents)
        .values({
          gateway: "sumit",
          gatewayEventId: String(payment.id),
          kind: "intro_charge",
          payload: {
            intentId: intent.id,
            amountAgorot: payment.amountAgorot,
            sumitCustomerId: opts.sumitCustomerId,
            documentId: payment.documentId,
          },
          processedAt: now,
        })
        .onConflictDoNothing({ target: gatewayEvents.gatewayEventId });
      await tx
        .update(checkoutIntents)
        .set({
          status: "completed",
          sumitPaymentId: String(payment.id),
          sumitCustomerId: opts.sumitCustomerId,
          completedAt: now,
        })
        .where(eq(checkoutIntents.id, intent.id));
      logger.info(
        { intentId: intent.id, userId: intent.userId, paymentId: payment.id },
        "checkout started the intro trial",
      );
      return {
        outcome: "completed",
        kind: "intro",
        intentId: intent.id,
        subscriptionId: null,
        planCode: null,
      };
    }

    if (intent.planCode === null) {
      throw new CheckoutVerificationError(
        "intent_not_found",
        "plan intent without a plan",
        payment,
      );
    }
    const plan = (await tx.select().from(plans).where(eq(plans.code, intent.planCode)).limit(1))[0];
    if (!plan) throw new CheckoutVerificationError("intent_not_found", "plan gone");

    // A trial account joining a plan on the hosted page converts its trial,
    // exactly as a continue would. Locked before any subscription row.
    const trial = await lockOpenTrial(tx as Db, intent.userId);

    const live = (
      await tx
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.userId, intent.userId),
            inArray(subscriptions.status, ["active", "past_due", "suspended"]),
          ),
        )
        .limit(1)
        .for("update")
    )[0];
    if (live && live.status !== "suspended") {
      throw new CheckoutVerificationError("already_subscribed", live.status, payment);
    }

    const period = {
      status: "active" as const,
      planCode: plan.code,
      gateway: "sumit",
      gatewayRecurringRef: opts.sumitCustomerId,
      currentPeriodStart: now,
      currentPeriodEnd: addOneMonth(now),
      cancelAtPeriodEnd: false,
      scheduledPlanCode: null,
      updatedAt: now,
    };
    let subscriptionId: string;
    if (live) {
      await tx.update(subscriptions).set(period).where(eq(subscriptions.id, live.id));
      subscriptionId = live.id;
      await expirePeriodRemainder(tx as Db, { userId: intent.userId, subscriptionId });
    } else {
      const inserted = await tx
        .insert(subscriptions)
        .values({ userId: intent.userId, ...period, createdAt: now })
        .returning({ id: subscriptions.id });
      subscriptionId = inserted[0]!.id;
    }
    if (trial) {
      // Before the grant: the trial's own expiry counts every non-manual credit.
      await convertTrial(tx as Db, {
        trial,
        subscriptionId,
        decisionAt: payment.date ?? now,
        now,
        // A continue still being confirmed keeps its attempt: the settle looks
        // that charge up and records it orphaned if it went through.
        clearAttempt: false,
      });
    }
    await grantPeriod(tx as Db, {
      userId: intent.userId,
      credits: plan.monthlyCredits,
      subscriptionId,
    });

    await tx
      .insert(gatewayEvents)
      .values({
        gateway: "sumit",
        gatewayEventId: String(payment.id),
        kind: "checkout_charge",
        payload: {
          intentId: intent.id,
          subscriptionId,
          planCode: plan.code,
          amountAgorot: payment.amountAgorot,
          sumitCustomerId: opts.sumitCustomerId,
          documentId: payment.documentId,
          reactivated: Boolean(live),
        },
        processedAt: now,
      })
      .onConflictDoNothing({ target: gatewayEvents.gatewayEventId });

    await tx
      .update(checkoutIntents)
      .set({
        status: "completed",
        sumitPaymentId: String(payment.id),
        sumitCustomerId: opts.sumitCustomerId,
        completedAt: now,
      })
      .where(eq(checkoutIntents.id, intent.id));

    logger.info(
      { intentId: intent.id, subscriptionId, planCode: plan.code, paymentId: payment.id },
      live ? "checkout reactivated the subscription" : "checkout created the subscription",
    );
    return {
      outcome: "completed",
      kind: "plan",
      intentId: intent.id,
      subscriptionId,
      planCode: plan.code,
    };
  });
}

/**
 * The plan-agnostic half of a completion: the payment Sumit holds must be
 * valid, at the intent's exact price, from the customer the return named, and
 * carry this intent's id — and the customer's saved default card is aligned to
 * the card that paid (measured 2026-09-21: a declined first card stays the
 * default otherwise). Throws CheckoutVerificationError; every refusal raised
 * after the payment is known valid carries it, so it is recorded as
 * `checkout_refused`.
 */
async function verifyHostedPayment(
  client: SumitClient,
  intent: IntentRow,
  sumitPaymentId: string,
  sumitCustomerId: string,
  opts: { requireSavedCard: boolean },
): Promise<SumitPayment> {
  const payment = await client.getPayment(sumitPaymentId);
  if (!payment) throw new CheckoutVerificationError("payment_not_found", sumitPaymentId);
  if (!payment.valid) {
    throw new CheckoutVerificationError("payment_invalid", payment.status ?? "invalid");
  }
  if (payment.amountAgorot !== intent.priceAgorot) {
    throw new CheckoutVerificationError(
      "amount_mismatch",
      `paid ${payment.amountAgorot}, intent ${intent.priceAgorot}`,
      payment,
    );
  }
  if (String(payment.customerId) !== sumitCustomerId) {
    throw new CheckoutVerificationError("customer_mismatch", undefined, payment);
  }
  if (payment.externalIdentifier !== intent.id) {
    throw new CheckoutVerificationError("identifier_mismatch", undefined, payment);
  }

  let saved: Awaited<ReturnType<SumitClient["getPaymentMethod"]>>;
  try {
    saved = await client.getPaymentMethod(sumitCustomerId);
  } catch (err) {
    // The intro's card is optional: a failed read must not hold back a paid ₪5.
    if (opts.requireSavedCard) throw err;
    logger.warn(
      { intentId: intent.id, customerId: sumitCustomerId, error: String(err) },
      "intro: could not read the saved card — activating without it",
    );
    return payment;
  }
  if (!saved) {
    if (opts.requireSavedCard) {
      throw new CheckoutVerificationError("no_saved_card", undefined, payment);
    }
    logger.warn(
      { intentId: intent.id, customerId: sumitCustomerId },
      "intro payment left no saved card — a continue will fall back to the payment page",
    );
    return payment;
  }
  const paying = payment.paymentMethod;
  if (
    paying?.token &&
    paying.expirationMonth &&
    paying.expirationYear &&
    saved.token !== paying.token
  ) {
    try {
      await client.setPaymentMethod(sumitCustomerId, {
        token: paying.token,
        expirationMonth: paying.expirationMonth,
        expirationYear: paying.expirationYear,
      });
    } catch (err) {
      logger.error(
        { intentId: intent.id, customerId: sumitCustomerId, error: String(err) },
        "could not make the paying card the customer's default — renewals may hit the wrong card",
      );
    }
  }
  return payment;
}
