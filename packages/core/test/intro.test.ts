import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "../src/db/schema";
import type { Db } from "../src/db";
import { setSumitClient, type SumitClient, type SumitPayment } from "../src/gateways/sumit";
import {
  NotConfiguredGateway,
  processDueRenewals,
  type BillingGateway,
} from "../src/pipelines/billing";
import { createBusiness } from "../src/pipelines/businesses";
import {
  completeCheckout,
  createCheckoutIntent,
  createIntroIntent,
} from "../src/pipelines/checkout";
import {
  creditBalance,
  debitRender,
  grantCredits,
  refundRenderIfNeeded,
} from "../src/pipelines/credits";
import {
  CONTINUE_SETTLE_AFTER_MS,
  continueFromTrial,
  expireDueTrials,
  getTrialView,
  INTRO_OFFER,
  IntroOfferError,
  CONTINUE_SETTLE_MAX_RETRIES,
  CONTINUE_SETTLE_RETRY_MS,
  handleReconcileContinue,
  settleContinueAttempts,
} from "../src/pipelines/intro";
import { buildHandlers } from "../src/handlers";
import { ensureDailyJobs } from "../src/jobs/schedule";
import { createTestDb } from "./helpers/pglite";

/**
 * The ₪5 intro offer (decision 0109) on PGlite, the Sumit client and the
 * gateway faked at their interfaces. The founder's done-when list first, then
 * the races and edges the plan review found.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-14T10:00:00Z");
const CUSTOMER = "2400000001";
let paymentSeq = 2400000100;

async function account(db: Db) {
  const business = await createBusiness(db, {
    ownerEmail: `buyer-${crypto.randomUUID()}@test.local`,
    name: "עסק",
  });
  return { userId: business.ownerUserId, businessId: business.id };
}

async function switchOn(db: Db, enabled = true) {
  await db
    .update(schema.appConfig)
    .set({ value: { enabled } })
    .where(eq(schema.appConfig.key, "intro_offer"));
}

async function plan(db: Db, code: string) {
  return (await db.select().from(schema.plans).where(eq(schema.plans.code, code)))[0]!;
}

/** A Sumit client that answers one payment for one intent, and lists what it is given. */
function sumit(opts: {
  intentId?: string;
  amountAgorot?: number;
  date?: Date;
  saved?: boolean;
  list?: SumitPayment[];
}): SumitClient {
  return {
    async getPayment(id) {
      return {
        id: Number(id),
        customerId: Number(CUSTOMER),
        date: opts.date ?? NOW,
        valid: true,
        status: "000",
        statusDescription: null,
        amountAgorot: opts.amountAgorot ?? INTRO_OFFER.priceAgorot,
        externalIdentifier: opts.intentId ?? null,
        documentId: 40001,
        paymentMethod: {
          id: 1,
          lastDigits: "0772",
          expirationMonth: 5,
          expirationYear: 2031,
          token: "tok",
        },
      };
    },
    async getPaymentMethod() {
      return opts.saved === false
        ? null
        : { id: 1, lastDigits: "0772", expirationMonth: 5, expirationYear: 2031, token: "tok" };
    },
    async setPaymentMethod() {
      return null;
    },
    async listPayments() {
      return opts.list ?? [];
    },
    async charge() {
      throw new Error("not used");
    },
  };
}

/** The ₪5 bought: intent, then the verified return. Returns the intent id. */
async function buyIntro(db: Db, userId: string, now = NOW): Promise<string> {
  const { intent } = await createIntroIntent(db, {
    userId,
    termsVersion: "14.10.2026",
    ip: "203.0.113.7",
    userAgent: "vitest",
    now,
  });
  await completeCheckout(db, {
    intentId: intent.id,
    sumitPaymentId: String(paymentSeq++),
    sumitCustomerId: CUSTOMER,
    now,
    client: sumit({ intentId: intent.id, date: now }),
  });
  return intent.id;
}

/** A gateway that records every charge and answers as told. */
function gateway(answer: "ok" | "declined" | "unconfirmed", during?: () => Promise<void>) {
  const calls: Array<{ recurringRef: string; amountAgorot: number; description: string }> = [];
  const gw: BillingGateway = {
    name: "test",
    async chargeRecurring(input) {
      calls.push(input);
      await during?.();
      if (answer === "ok") return { ok: true, gatewayEventId: String(paymentSeq++) };
      if (answer === "declined") {
        return { ok: false, gatewayEventId: String(paymentSeq++), error: "(קוד 003)" };
      }
      return {
        ok: false,
        gatewayEventId: `sumit_unconfirmed_${crypto.randomUUID()}`,
        error: "unconfirmed",
      };
    },
  };
  return { gw, calls };
}

function continueOpts(userId: string, planCode = "starter", now = NOW) {
  return {
    userId,
    planCode,
    termsVersion: "14.10.2026",
    ip: "203.0.113.7",
    userAgent: "vitest",
    now,
  };
}

async function spend(db: Db, businessId: string, cost: number): Promise<string> {
  const renderId = crypto.randomUUID();
  await debitRender(db, { businessId, videoRenderId: renderId, cost });
  return renderId;
}

async function trialRow(db: Db, userId: string) {
  return (
    await db.select().from(schema.introTrials).where(eq(schema.introTrials.userId, userId))
  )[0];
}

async function ledgerSum(db: Db, userId: string, reason: "expire_trial" | "expire_period") {
  const rows = await db
    .select()
    .from(schema.creditLedger)
    .where(eq(schema.creditLedger.userId, userId));
  return rows.filter((r) => r.reason === reason).reduce((s, r) => s + r.delta, 0);
}

describe("the intro offer — who may buy it", () => {
  it("an eligible account activates with 150 credits, 30 days from the payment, and no subscription", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    const { userId } = await account(db);

    const intentId = await buyIntro(db, userId);

    expect(await creditBalance(db, userId)).toBe(150);
    const trial = (await trialRow(db, userId))!;
    expect(trial).toMatchObject({
      intentId,
      sumitCustomerId: CUSTOMER,
      priceAgorot: 500,
      credits: 150,
    });
    expect(trial.startedAt.getTime()).toBe(NOW.getTime());
    expect(trial.expiresAt.getTime()).toBe(NOW.getTime() + 30 * DAY);
    expect(await db.select().from(schema.subscriptions)).toHaveLength(0);
    const intent = (
      await db.select().from(schema.checkoutIntents).where(eq(schema.checkoutIntents.id, intentId))
    )[0]!;
    expect(intent).toMatchObject({
      kind: "intro",
      planCode: null,
      priceAgorot: 500,
      status: "completed",
    });
    const acceptance = (await db.select().from(schema.termsAcceptances))[0]!;
    expect(acceptance).toMatchObject({ context: "intro", ip: "203.0.113.7" });
    const event = (await db.select().from(schema.gatewayEvents))[0]!;
    expect(event).toMatchObject({ kind: "intro_charge" });
    await pg.close();
  });

  it("a second trial is refused before any intent is written", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    const { userId } = await account(db);
    await buyIntro(db, userId);
    const intentsBefore = (await db.select().from(schema.checkoutIntents)).length;
    const acceptancesBefore = (await db.select().from(schema.termsAcceptances)).length;

    await expect(
      createIntroIntent(db, { userId, termsVersion: "14.10.2026", now: NOW }),
    ).rejects.toMatchObject({ code: "already_used" });
    expect(await db.select().from(schema.checkoutIntents)).toHaveLength(intentsBefore);
    expect(await db.select().from(schema.termsAcceptances)).toHaveLength(acceptancesBefore);
    await pg.close();
  });

  it("a former subscriber — cancelled or suspended — is refused before any intent is written", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    for (const status of ["canceled", "suspended"] as const) {
      const { userId } = await account(db);
      await db.insert(schema.subscriptions).values({
        userId,
        planCode: "starter",
        status,
        gatewayRecurringRef: "1",
        currentPeriodStart: new Date(NOW.getTime() - 60 * DAY),
        currentPeriodEnd: new Date(NOW.getTime() - 30 * DAY),
      });
      await expect(
        createIntroIntent(db, { userId, termsVersion: "14.10.2026", now: NOW }),
      ).rejects.toMatchObject({ code: "has_paid" });
    }
    expect(await db.select().from(schema.checkoutIntents)).toHaveLength(0);
    expect(await db.select().from(schema.termsAcceptances)).toHaveLength(0);
    await pg.close();
  });

  it("the switch refuses new trials — off by default, and when turned off — with nothing written", async () => {
    const { db, pg } = await createTestDb();
    const { userId } = await account(db);
    // Seeded off by 0062.
    await expect(
      createIntroIntent(db, { userId, termsVersion: "14.10.2026", now: NOW }),
    ).rejects.toMatchObject({ code: "offer_off" });
    // An unparseable row is off, never a throw.
    await db
      .update(schema.appConfig)
      .set({ value: { enabled: "yes" } })
      .where(eq(schema.appConfig.key, "intro_offer"));
    await expect(
      createIntroIntent(db, { userId, termsVersion: "14.10.2026", now: NOW }),
    ).rejects.toMatchObject({ code: "offer_off" });
    await switchOn(db, false);
    await expect(
      createIntroIntent(db, { userId, termsVersion: "14.10.2026", now: NOW }),
    ).rejects.toBeInstanceOf(IntroOfferError);
    expect(await db.select().from(schema.checkoutIntents)).toHaveLength(0);
    expect(await db.select().from(schema.termsAcceptances)).toHaveLength(0);
    await pg.close();
  });

  it("a second click reuses the pending intro intent; a plan intent never reuses it", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    const { userId } = await account(db);
    const first = await createIntroIntent(db, { userId, termsVersion: "v", now: NOW });
    const again = await createIntroIntent(db, {
      userId,
      termsVersion: "v",
      now: new Date(NOW.getTime() + 60_000),
    });
    expect(again).toMatchObject({ reused: true, intent: { id: first.intent.id } });
    const planIntent = await createCheckoutIntent(db, {
      userId,
      planCode: "starter",
      termsVersion: "v",
      now: NOW,
    });
    expect(planIntent.reused).toBe(false);
    expect(planIntent.intent.id).not.toBe(first.intent.id);
    await pg.close();
  });
});

describe("the intro offer — the ₪5 payment comes back", () => {
  it("a page paid after the switch went off still activates: the money moved", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    const { userId } = await account(db);
    const { intent } = await createIntroIntent(db, { userId, termsVersion: "v", now: NOW });
    await switchOn(db, false);
    await completeCheckout(db, {
      intentId: intent.id,
      sumitPaymentId: "2400009001",
      sumitCustomerId: CUSTOMER,
      now: NOW,
      client: sumit({ intentId: intent.id }),
    });
    expect(await creditBalance(db, userId)).toBe(150);
    await pg.close();
  });

  it("two paid ₪5 tabs: the second payment is refused and recorded for a refund, nothing granted twice", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    const { userId } = await account(db);
    const a = await createIntroIntent(db, { userId, termsVersion: "v", now: NOW });
    // The second tab's intent, written after the first one went stale.
    const b = await createIntroIntent(db, {
      userId,
      termsVersion: "v",
      now: new Date(NOW.getTime() + 31 * 60_000),
    });
    expect(b.intent.id).not.toBe(a.intent.id);

    await completeCheckout(db, {
      intentId: a.intent.id,
      sumitPaymentId: "2400009101",
      sumitCustomerId: CUSTOMER,
      now: NOW,
      client: sumit({ intentId: a.intent.id }),
    });
    const second = completeCheckout(db, {
      intentId: b.intent.id,
      sumitPaymentId: "2400009102",
      sumitCustomerId: CUSTOMER,
      now: NOW,
      client: sumit({ intentId: b.intent.id }),
    });
    await expect(second).rejects.toMatchObject({ reason: "intro_already_used" });
    expect(await creditBalance(db, userId)).toBe(150);
    const refused = await db
      .select()
      .from(schema.gatewayEvents)
      .where(eq(schema.gatewayEvents.kind, "checkout_refused"));
    expect(refused).toHaveLength(1);
    expect(refused[0]!.gatewayEventId).toBe("sumit_refused_2400009102");
    await pg.close();
  });

  it("a plan bought between the ₪5 intent and its payment: the ₪5 is refused, not a trial for a paying account", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    const { userId } = await account(db);
    const intro = await createIntroIntent(db, { userId, termsVersion: "v", now: NOW });
    const planIntent = await createCheckoutIntent(db, {
      userId,
      planCode: "starter",
      termsVersion: "v",
      now: NOW,
    });
    const starter = await plan(db, "starter");
    await completeCheckout(db, {
      intentId: planIntent.intent.id,
      sumitPaymentId: "2400009201",
      sumitCustomerId: CUSTOMER,
      now: NOW,
      client: sumit({ intentId: planIntent.intent.id, amountAgorot: starter.priceAgorot }),
    });
    await expect(
      completeCheckout(db, {
        intentId: intro.intent.id,
        sumitPaymentId: "2400009202",
        sumitCustomerId: CUSTOMER,
        now: NOW,
        client: sumit({ intentId: intro.intent.id }),
      }),
    ).rejects.toMatchObject({ reason: "not_eligible" });
    expect(await trialRow(db, userId)).toBeUndefined();
    expect(await creditBalance(db, userId)).toBe(starter.monthlyCredits);
    await pg.close();
  });

  it("no saved card still activates the trial (a plan still refuses)", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    const { userId } = await account(db);
    const { intent } = await createIntroIntent(db, { userId, termsVersion: "v", now: NOW });
    await completeCheckout(db, {
      intentId: intent.id,
      sumitPaymentId: "2400009301",
      sumitCustomerId: CUSTOMER,
      now: NOW,
      client: sumit({ intentId: intent.id, saved: false }),
    });
    expect(await creditBalance(db, userId)).toBe(150);

    const other = await account(db);
    const planIntent = await createCheckoutIntent(db, {
      userId: other.userId,
      planCode: "starter",
      termsVersion: "v",
      now: NOW,
    });
    const starter = await plan(db, "starter");
    await expect(
      completeCheckout(db, {
        intentId: planIntent.intent.id,
        sumitPaymentId: "2400009302",
        sumitCustomerId: CUSTOMER,
        now: NOW,
        client: sumit({
          intentId: planIntent.intent.id,
          amountAgorot: starter.priceAgorot,
          saved: false,
        }),
      }),
    ).rejects.toMatchObject({ reason: "no_saved_card" });
    await pg.close();
  });

  it("a replayed ₪5 return grants nothing again and says it was the intro", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    const { userId } = await account(db);
    const { intent } = await createIntroIntent(db, { userId, termsVersion: "v", now: NOW });
    const args = {
      intentId: intent.id,
      sumitPaymentId: "2400009401",
      sumitCustomerId: CUSTOMER,
      now: NOW,
      client: sumit({ intentId: intent.id }),
    };
    expect(await completeCheckout(db, args)).toMatchObject({
      outcome: "completed",
      kind: "intro",
      planCode: null,
    });
    expect(await completeCheckout(db, args)).toMatchObject({
      outcome: "replayed",
      kind: "intro",
      subscriptionId: null,
    });
    expect(await creditBalance(db, userId)).toBe(150);
    await pg.close();
  });

  it("no renewal ever fires for a trial", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    const { userId } = await account(db);
    await buyIntro(db, userId);
    const { gw, calls } = gateway("ok");
    for (const days of [1, 29, 30, 31, 60, 400]) {
      await processDueRenewals(db, gw, new Date(NOW.getTime() + days * DAY));
    }
    expect(calls).toHaveLength(0);
    expect(await db.select().from(schema.subscriptions)).toHaveLength(0);
    await pg.close();
  });
});

describe("the intro offer — day 30", () => {
  it("takes only the unused trial credits; a manual grant before or after is never taken", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    const { userId, businessId } = await account(db);
    await grantCredits(db, { userId, credits: 200, note: "hand trial" });
    await buyIntro(db, userId);
    await spend(db, businessId, 50);
    await grantCredits(db, { userId, credits: 75, note: "goodwill after the start" });
    // 200 + 150 − 50 + 75 = 375; the 50 came out of the trial.

    expect(await expireDueTrials(db, new Date(NOW.getTime() + 29 * DAY))).toEqual({
      expired: 0,
      credits: 0,
    });
    expect(await expireDueTrials(db, new Date(NOW.getTime() + 30 * DAY))).toEqual({
      expired: 1,
      credits: 100,
    });
    expect(await creditBalance(db, userId)).toBe(275);
    // Idempotent.
    expect(await expireDueTrials(db, new Date(NOW.getTime() + 31 * DAY))).toEqual({
      expired: 0,
      credits: 0,
    });
    expect(await creditBalance(db, userId)).toBe(275);
    await pg.close();
  });

  it("spend beyond the trial eats manual credits, and then nothing expires", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    const { userId, businessId } = await account(db);
    await grantCredits(db, { userId, credits: 100, note: "hand trial" });
    await buyIntro(db, userId);
    await spend(db, businessId, 200);
    await expireDueTrials(db, new Date(NOW.getTime() + 30 * DAY));
    expect(await creditBalance(db, userId)).toBe(50);
    expect(await ledgerSum(db, userId, "expire_trial")).toBe(0);
    await pg.close();
  });

  it("a hand grant spent BEFORE the trial does not shield the trial credits from expiring", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    const { userId, businessId } = await account(db);
    await grantCredits(db, { userId, credits: 100, note: "hand trial" });
    await spend(db, businessId, 100);
    await buyIntro(db, userId);
    await spend(db, businessId, 50);
    await expireDueTrials(db, new Date(NOW.getTime() + 30 * DAY));
    expect(await creditBalance(db, userId)).toBe(0);
    expect(await ledgerSum(db, userId, "expire_trial")).toBe(-100);
    await pg.close();
  });

  it("a render in flight at purchase, refunded after it, gives MANUAL credits back — never expired", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    const { userId, businessId } = await account(db);
    await grantCredits(db, { userId, credits: 75, note: "hand trial" });
    const inFlight = await spend(db, businessId, 75);
    await buyIntro(db, userId);
    await spend(db, businessId, 50); // trial credits
    await refundRenderIfNeeded(db, inFlight); // the 75 manual come back
    // 75 − 75 + 150 − 50 + 75: 100 trial and 75 manual.
    expect(await creditBalance(db, userId)).toBe(175);
    expect((await getTrialView(db, userId))!.creditsLeft).toBe(100);

    await expireDueTrials(db, new Date(NOW.getTime() + 30 * DAY));
    expect(await creditBalance(db, userId)).toBe(75);

    // And when the whole trial was spent, nothing at all is expired.
    const second = await account(db);
    await grantCredits(db, { userId: second.userId, credits: 75, note: "hand trial" });
    const r2 = await spend(db, second.businessId, 75);
    await buyIntro(db, second.userId);
    await spend(db, second.businessId, 150);
    await refundRenderIfNeeded(db, r2);
    await expireDueTrials(db, new Date(NOW.getTime() + 30 * DAY));
    expect(await creditBalance(db, second.userId)).toBe(75);
    expect(await ledgerSum(db, second.userId, "expire_trial")).toBe(0);
    await pg.close();
  });

  it("accepted edge, pinned: a trial-era render refunded AFTER the sweep keeps its credits", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    const { userId, businessId } = await account(db);
    await buyIntro(db, userId);
    const render = await spend(db, businessId, 75);
    await expireDueTrials(db, new Date(NOW.getTime() + 30 * DAY));
    expect(await creditBalance(db, userId)).toBe(0);
    await refundRenderIfNeeded(db, render);
    await expireDueTrials(db, new Date(NOW.getTime() + 31 * DAY));
    expect(await creditBalance(db, userId)).toBe(75);
    await pg.close();
  });
});

describe("the intro offer — continue", () => {
  it("a continue before expiry: full price and credits on the saved card's customer, the leftover kept, never swept, gone at the first month's end", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    const { userId, businessId } = await account(db);
    await buyIntro(db, userId);
    await spend(db, businessId, 45);
    const starter = await plan(db, "starter");
    const { gw, calls } = gateway("ok");

    const at = new Date(NOW.getTime() + 10 * DAY);
    const result = await continueFromTrial(db, gw, continueOpts(userId, "starter", at));
    expect(result.outcome).toBe("activated");
    expect(calls).toEqual([
      {
        recurringRef: CUSTOMER,
        amountAgorot: starter.priceAgorot,
        description: `תבנית — מסלול ${starter.name}, חודש ראשון`,
      },
    ]);
    expect(await creditBalance(db, userId)).toBe(105 + starter.monthlyCredits);
    const sub = (await db.select().from(schema.subscriptions))[0]!;
    expect(sub).toMatchObject({
      planCode: "starter",
      status: "active",
      gatewayRecurringRef: CUSTOMER,
    });
    expect(sub.currentPeriodStart.getTime()).toBe(at.getTime());
    const trial = (await trialRow(db, userId))!;
    expect(trial.convertedAt?.getTime()).toBe(at.getTime());
    expect(trial.subscriptionId).toBe(sub.id);
    expect(trial.continueAttemptAt).toBeNull();
    expect((await db.select().from(schema.termsAcceptances)).map((t) => t.context).sort()).toEqual([
      "continue",
      "intro",
    ]);

    // Day 30 passes: the 30-day expiry no longer applies.
    await expireDueTrials(db, new Date(NOW.getTime() + 31 * DAY));
    expect(await creditBalance(db, userId)).toBe(105 + starter.monthlyCredits);

    // The first month ends: the leftover leaves with the period remainder.
    const { gw: renew } = gateway("ok");
    await processDueRenewals(db, renew, sub.currentPeriodEnd);
    expect(await creditBalance(db, userId)).toBe(starter.monthlyCredits);
    await pg.close();
  });

  it("a continue after expiry works, with nothing left to keep", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    const { userId } = await account(db);
    await buyIntro(db, userId);
    await expireDueTrials(db, new Date(NOW.getTime() + 30 * DAY));
    expect(await creditBalance(db, userId)).toBe(0);
    const pro = await plan(db, "pro");
    const { gw } = gateway("ok");
    const result = await continueFromTrial(
      db,
      gw,
      continueOpts(userId, "pro", new Date(NOW.getTime() + 45 * DAY)),
    );
    expect(result).toMatchObject({ outcome: "activated", planCode: "pro" });
    expect(await creditBalance(db, userId)).toBe(pro.monthlyCredits);
    await pg.close();
  });

  it("a continue after the 30 days but before the sweep expires the leftover first, the plan's credits intact", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    const { userId, businessId } = await account(db);
    await buyIntro(db, userId);
    await spend(db, businessId, 25);
    const starter = await plan(db, "starter");
    const { gw } = gateway("ok");
    await continueFromTrial(
      db,
      gw,
      continueOpts(userId, "starter", new Date(NOW.getTime() + 30 * DAY + 3600_000)),
    );
    expect(await creditBalance(db, userId)).toBe(starter.monthlyCredits);
    expect(await ledgerSum(db, userId, "expire_trial")).toBe(-125);
    await pg.close();
  });

  it("declined: nothing activated, the attempt cleared, a retry possible", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    const { userId } = await account(db);
    await buyIntro(db, userId);
    const { gw } = gateway("declined");
    expect(await continueFromTrial(db, gw, continueOpts(userId))).toMatchObject({
      outcome: "declined",
    });
    expect(await db.select().from(schema.subscriptions)).toHaveLength(0);
    expect((await trialRow(db, userId))!.continueAttemptAt).toBeNull();
    const failed = await db
      .select()
      .from(schema.gatewayEvents)
      .where(eq(schema.gatewayEvents.kind, "continue_charge_failed"));
    expect(failed).toHaveLength(1);
    const { gw: ok } = gateway("ok");
    expect((await continueFromTrial(db, ok, continueOpts(userId))).outcome).toBe("activated");
    await pg.close();
  });

  it("unconfirmed: the attempt stays, and both purchase paths refuse until it settles", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    const { userId } = await account(db);
    await buyIntro(db, userId);
    const { gw } = gateway("unconfirmed");
    expect(await continueFromTrial(db, gw, continueOpts(userId))).toEqual({ outcome: "pending" });
    expect((await trialRow(db, userId))!.continueAttemptPlan).toBe("starter");
    expect((await getTrialView(db, userId))!.attemptPending).toBe(true);

    const { gw: again } = gateway("ok");
    await expect(continueFromTrial(db, again, continueOpts(userId))).rejects.toMatchObject({
      code: "attempt_pending",
    });
    await expect(
      createCheckoutIntent(db, { userId, planCode: "starter", termsVersion: "v", now: NOW }),
    ).rejects.toMatchObject({ code: "attempt_pending" });
    // The settle job was enqueued for ten minutes on.
    const job = (
      await db.select().from(schema.jobs).where(eq(schema.jobs.type, "reconcile_continue"))
    )[0]!;
    expect(job.runAt.getTime()).toBe(NOW.getTime() + CONTINUE_SETTLE_AFTER_MS);
    await pg.close();
  });

  it("no gateway configured: refused before anything is written", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    const { userId } = await account(db);
    await buyIntro(db, userId);
    const acceptances = (await db.select().from(schema.termsAcceptances)).length;
    await expect(
      continueFromTrial(db, new NotConfiguredGateway(), continueOpts(userId)),
    ).rejects.toThrow(/no payment gateway configured/);
    expect((await trialRow(db, userId))!.continueAttemptAt).toBeNull();
    expect(await db.select().from(schema.termsAcceptances)).toHaveLength(acceptances);
    await pg.close();
  });

  it("refuses what cannot continue: no trial, an unknown plan, a converted trial", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    const { userId } = await account(db);
    const { gw, calls } = gateway("ok");
    await expect(continueFromTrial(db, gw, continueOpts(userId))).rejects.toMatchObject({
      code: "no_trial",
    });
    await buyIntro(db, userId);
    await expect(continueFromTrial(db, gw, continueOpts(userId, "platinum"))).rejects.toMatchObject(
      {
        code: "unknown_plan",
      },
    );
    await continueFromTrial(db, gw, continueOpts(userId));
    await expect(continueFromTrial(db, gw, continueOpts(userId))).rejects.toMatchObject({
      code: "converted",
    });
    expect(calls).toHaveLength(1);
    await pg.close();
  });

  it("a hosted page paid during the charge: one month, the continue's payment recorded orphaned for a refund", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    const { userId } = await account(db);
    await buyIntro(db, userId);
    const starter = await plan(db, "starter");
    // Opened before the continue (the decline fallback), paid while it charges.
    const hosted = await createCheckoutIntent(db, {
      userId,
      planCode: "starter",
      termsVersion: "v",
      now: NOW,
    });
    const { gw } = gateway("ok", async () => {
      await completeCheckout(db, {
        intentId: hosted.intent.id,
        sumitPaymentId: "2400009501",
        sumitCustomerId: CUSTOMER,
        now: NOW,
        client: sumit({ intentId: hosted.intent.id, amountAgorot: starter.priceAgorot }),
      });
    });
    const result = await continueFromTrial(db, gw, continueOpts(userId));
    expect(result.outcome).toBe("orphaned");
    expect(await db.select().from(schema.subscriptions)).toHaveLength(1);
    const orphaned = await db
      .select()
      .from(schema.gatewayEvents)
      .where(eq(schema.gatewayEvents.kind, "continue_charge_orphaned"));
    expect(orphaned).toHaveLength(1);
    expect((await trialRow(db, userId))!.continueAttemptAt).toBeNull();
    await pg.close();
  });

  it("a plan bought on the hosted page converts the trial; the leftover goes at the first month's end", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    const { userId, businessId } = await account(db);
    await buyIntro(db, userId);
    await spend(db, businessId, 100);
    const starter = await plan(db, "starter");
    const hosted = await createCheckoutIntent(db, {
      userId,
      planCode: "starter",
      termsVersion: "v",
      now: NOW,
    });
    await completeCheckout(db, {
      intentId: hosted.intent.id,
      sumitPaymentId: "2400009601",
      sumitCustomerId: CUSTOMER,
      now: NOW,
      client: sumit({ intentId: hosted.intent.id, amountAgorot: starter.priceAgorot }),
    });
    expect((await trialRow(db, userId))!.convertedAt).not.toBeNull();
    expect(await creditBalance(db, userId)).toBe(50 + starter.monthlyCredits);
    await expireDueTrials(db, new Date(NOW.getTime() + 31 * DAY));
    expect(await creditBalance(db, userId)).toBe(50 + starter.monthlyCredits);
    await pg.close();
  });

  it("pinned, a pre-existing residual: a hand grant spent before the trial survives the first renewal after a continue", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    const { userId, businessId } = await account(db);
    await grantCredits(db, { userId, credits: 100, note: "hand trial" });
    await spend(db, businessId, 100);
    await buyIntro(db, userId);
    const starter = await plan(db, "starter");
    const { gw } = gateway("ok");
    await continueFromTrial(db, gw, continueOpts(userId));
    const sub = (await db.select().from(schema.subscriptions))[0]!;
    await processDueRenewals(db, gw, sub.currentPeriodEnd);
    // expirePeriodRemainder spares the LIFETIME manual sum (100), so 100 of the
    // 150 leftover trial credits ride on. Customer-favourable; renewals untouched.
    expect(await creditBalance(db, userId)).toBe(100 + starter.monthlyCredits);
    await pg.close();
  });
});

describe("the intro offer — settling a continue whose answer was lost", () => {
  async function pendingTrial(db: Db) {
    await switchOn(db);
    const { userId } = await account(db);
    await buyIntro(db, userId);
    await continueFromTrial(db, gateway("unconfirmed").gw, continueOpts(userId));
    return userId;
  }

  it("found in Sumit's list: the month activates on that payment", async () => {
    const { db, pg } = await createTestDb();
    const userId = await pendingTrial(db);
    const starter = await plan(db, "starter");
    const charge: SumitPayment = {
      id: 2400009701,
      customerId: Number(CUSTOMER),
      date: new Date(NOW.getTime() + 20_000),
      valid: true,
      status: "000",
      statusDescription: null,
      amountAgorot: starter.priceAgorot,
      externalIdentifier: null,
      documentId: 40002,
      paymentMethod: null,
    };
    const later = new Date(NOW.getTime() + CONTINUE_SETTLE_AFTER_MS);
    // A page payment and another customer's charge do not match.
    const noise: SumitPayment[] = [
      { ...charge, id: 1, externalIdentifier: crypto.randomUUID() },
      { ...charge, id: 2, customerId: 1 },
      { ...charge, id: 3, amountAgorot: 500 },
    ];
    expect(
      await settleContinueAttempts(db, sumit({ list: [...noise, charge] }), later),
    ).toMatchObject({
      activated: 1,
    });
    expect((await db.select().from(schema.subscriptions))[0]).toMatchObject({
      status: "active",
      planCode: "starter",
    });
    expect((await trialRow(db, userId))!.continueAttemptAt).toBeNull();
    expect(await creditBalance(db, userId)).toBe(150 + starter.monthlyCredits);
    await pg.close();
  });

  it("not found: the attempt clears and the customer may try again; too early does nothing", async () => {
    const { db, pg } = await createTestDb();
    const userId = await pendingTrial(db);
    expect(
      await settleContinueAttempts(db, sumit({}), new Date(NOW.getTime() + 60_000)),
    ).toMatchObject({ cleared: 0, activated: 0 });
    expect((await trialRow(db, userId))!.continueAttemptAt).not.toBeNull();

    expect(
      await settleContinueAttempts(
        db,
        sumit({}),
        new Date(NOW.getTime() + CONTINUE_SETTLE_AFTER_MS),
      ),
    ).toMatchObject({ cleared: 1 });
    expect((await trialRow(db, userId))!.continueAttemptAt).toBeNull();
    expect(await db.select().from(schema.subscriptions)).toHaveLength(0);
    await pg.close();
  });

  it("the worker carries both jobs: expire_trials daily beside the renewals, reconcile_continue on demand", async () => {
    const { db, pg } = await createTestDb();
    await ensureDailyJobs(db, NOW);
    const daily = await db.select().from(schema.jobs).where(eq(schema.jobs.type, "expire_trials"));
    expect(daily.map((j) => j.idempotencyKey)).toEqual(["expire_trials:2026-10-14"]);
    const handlers = buildHandlers();
    expect(handlers).toHaveProperty("expire_trials");
    expect(handlers).toHaveProperty("reconcile_continue");
    await pg.close();
  });

  it("a hosted page opened before an unconfirmed continue, paid meanwhile: the attempt survives the conversion and the settle records the continue charge orphaned", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    const { userId } = await account(db);
    await buyIntro(db, userId);
    const starter = await plan(db, "starter");
    // The page is opened first (the decline fallback, another tab)…
    const hosted = await createCheckoutIntent(db, {
      userId,
      planCode: "starter",
      termsVersion: "v",
      now: NOW,
    });
    // …then a continue whose answer is lost…
    await continueFromTrial(db, gateway("unconfirmed").gw, continueOpts(userId));
    // …then the page is paid and completes: one month, the trial converted.
    await completeCheckout(db, {
      intentId: hosted.intent.id,
      sumitPaymentId: "2400009801",
      sumitCustomerId: CUSTOMER,
      now: NOW,
      client: sumit({ intentId: hosted.intent.id, amountAgorot: starter.priceAgorot }),
    });
    const trial = (await trialRow(db, userId))!;
    expect(trial.convertedAt).not.toBeNull();
    expect(trial.continueAttemptAt).not.toBeNull();
    // The continue's charge DID go through: the settle finds it and records it.
    const charge: SumitPayment = {
      id: 2400009802,
      customerId: Number(CUSTOMER),
      date: new Date(NOW.getTime() + 15_000),
      valid: true,
      status: "000",
      statusDescription: null,
      amountAgorot: starter.priceAgorot,
      externalIdentifier: null,
      documentId: 40003,
      paymentMethod: null,
    };
    const summary = await settleContinueAttempts(
      db,
      sumit({ list: [charge] }),
      new Date(NOW.getTime() + CONTINUE_SETTLE_AFTER_MS),
    );
    expect(summary).toMatchObject({ orphaned: 1, activated: 0 });
    expect(await db.select().from(schema.subscriptions)).toHaveLength(1);
    const orphaned = await db
      .select()
      .from(schema.gatewayEvents)
      .where(eq(schema.gatewayEvents.kind, "continue_charge_orphaned"));
    expect(orphaned.map((e) => e.gatewayEventId)).toEqual(["continue_orphaned_2400009802"]);
    expect((await trialRow(db, userId))!.continueAttemptAt).toBeNull();
    await pg.close();
  });

  it("the settle job settles only its own attempt, and retries a while when Sumit's list cannot be read", async () => {
    const { db, pg } = await createTestDb();
    const userId = await pendingTrial(db);
    const attemptAt = (await trialRow(db, userId))!.continueAttemptAt!;
    const failing: SumitClient = {
      ...sumit({}),
      async listPayments() {
        throw new Error("sumit /billing/payments/list/: HTTP 503");
      },
    };
    setSumitClient(failing);
    try {
      const job = (
        await db.select().from(schema.jobs).where(eq(schema.jobs.type, "reconcile_continue"))
      )[0]!;
      expect(job.payload).toEqual({ userId, attemptAt: attemptAt.toISOString() });
      const ctx = { db, log: { info() {} }, checkpoint: async () => {} } as never;
      const first = await handleReconcileContinue(job, ctx);
      expect(first).toEqual({
        kind: "reschedule",
        delayMs: CONTINUE_SETTLE_RETRY_MS,
        state: { retries: 1 },
      });
      // Bounded: after the last retry it leaves the attempt to the daily backstop.
      const last = await handleReconcileContinue(
        { ...job, state: { retries: CONTINUE_SETTLE_MAX_RETRIES } },
        ctx,
      );
      expect(last).toEqual({ kind: "done" });
      expect((await trialRow(db, userId))!.continueAttemptAt).not.toBeNull();
      // A job for an older attempt never touches the open one.
      setSumitClient(sumit({}));
      await handleReconcileContinue(
        {
          ...job,
          payload: { userId, attemptAt: new Date(attemptAt.getTime() - 60_000).toISOString() },
        },
        ctx,
      );
      expect((await trialRow(db, userId))!.continueAttemptAt).not.toBeNull();
      // Its own job, with the list readable and nothing in it, clears it.
      await handleReconcileContinue(job, ctx);
      expect((await trialRow(db, userId))!.continueAttemptAt).toBeNull();
    } finally {
      setSumitClient(undefined);
    }
    await pg.close();
  });

  it("a trial past its date reads as ended before the sweep runs, though its credits are still spendable", async () => {
    const { db, pg } = await createTestDb();
    await switchOn(db);
    const { userId } = await account(db);
    await buyIntro(db, userId);
    const before = await getTrialView(db, userId, new Date(NOW.getTime() + 29 * DAY));
    expect(before).toMatchObject({ ended: false, creditsLeft: 150 });
    const after = await getTrialView(db, userId, new Date(NOW.getTime() + 30 * DAY + 3600_000));
    expect(after).toMatchObject({ ended: true, creditsLeft: 150, expiredAt: null });
    await pg.close();
  });

  it("the day-30 sweep leaves a trial with a pending continue alone", async () => {
    const { db, pg } = await createTestDb();
    const userId = await pendingTrial(db);
    await expireDueTrials(db, new Date(NOW.getTime() + 31 * DAY));
    expect(await creditBalance(db, userId)).toBe(150);
    expect((await trialRow(db, userId))!.expiredAt).toBeNull();
    await pg.close();
  });
});
