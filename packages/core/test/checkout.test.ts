import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "../src/db/schema";
import type { Db } from "../src/db";
import type { SumitClient, SumitPayment, SumitPaymentMethod } from "../src/gateways/sumit";
import { PlanChangeError } from "../src/pipelines/billing";
import { createBusiness } from "../src/pipelines/businesses";
import {
  CheckoutVerificationError,
  completeCheckout,
  createCheckoutIntent,
  INTENT_REUSE_MS,
  INTENT_TTL_MS,
  recordUnconfirmedCheckoutReturn,
} from "../src/pipelines/checkout";
import { creditBalance, grantPeriod } from "../src/pipelines/credits";
import { createTestDb } from "./helpers/pglite";

/**
 * Hosted checkout (decision 0062) on PGlite with the Sumit client faked at
 * the interface: the intent's lifecycle, and completeCheckout's verification
 * and activation — including the two things measured on the test business
 * that shaped it (the payment echoes our intent id; the customer's default
 * card can be a different card from the one that paid).
 */

const NOW = new Date("2026-09-21T10:00:00Z");
const CUSTOMER = "2376907140";
const PAYMENT_ID = "2376907759";
const PAYING = {
  id: 2376907758,
  lastDigits: "0772",
  expirationMonth: 5,
  expirationYear: 2031,
  token: "tok-paying",
};

async function account(db: Db) {
  const business = await createBusiness(db, {
    ownerEmail: `buyer-${crypto.randomUUID()}@test.local`,
    name: "עסק",
  });
  return { userId: business.ownerUserId, business };
}

async function plan(db: Db, code: string) {
  return (await db.select().from(schema.plans).where(eq(schema.plans.code, code)))[0]!;
}

async function intentFor(db: Db, userId: string, planCode = "starter", now = NOW) {
  const { intent } = await createCheckoutIntent(db, {
    userId,
    planCode,
    termsVersion: "17.09.2026",
    ip: "203.0.113.7",
    userAgent: "vitest",
    now,
  });
  return intent;
}

function fake(opts: {
  payment?: Partial<SumitPayment> | null;
  saved?: SumitPaymentMethod | null;
  setFails?: boolean;
}) {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const client: SumitClient = {
    async getPayment(id) {
      calls.push({ fn: "getPayment", args: [id] });
      if (opts.payment === null) return null;
      return {
        id: Number(id),
        customerId: Number(CUSTOMER),
        date: NOW,
        valid: true,
        status: "000",
        statusDescription: " (קוד 000)",
        amountAgorot: 15000,
        externalIdentifier: null,
        documentId: 2376907762,
        paymentMethod: PAYING,
        ...opts.payment,
      };
    },
    async getPaymentMethod(customerId) {
      calls.push({ fn: "getPaymentMethod", args: [customerId] });
      return opts.saved === undefined ? PAYING : opts.saved;
    },
    async setPaymentMethod(customerId, card) {
      calls.push({ fn: "setPaymentMethod", args: [customerId, card] });
      if (opts.setFails) throw new Error("sumit /billing/paymentmethods/setforcustomer/: refused");
      return { ...PAYING, token: card.token };
    },
    async listPayments() {
      throw new Error("not used by checkout");
    },
    async charge() {
      throw new Error("not used by checkout");
    },
  };
  return { client, calls };
}

describe("createCheckoutIntent", () => {
  it("records one terms acceptance and snapshots the plan's price", async () => {
    const { db, pg } = await createTestDb();
    const { userId } = await account(db);
    const starter = await plan(db, "starter");

    const intent = await intentFor(db, userId);
    expect(intent.status).toBe("pending");
    expect(intent.planCode).toBe("starter");
    expect(intent.priceAgorot).toBe(starter.priceAgorot);
    expect(intent.sumitPaymentId).toBeNull();
    const acceptances = await db.select().from(schema.termsAcceptances);
    expect(acceptances).toHaveLength(1);
    expect(intent.termsAcceptanceId).toBe(acceptances[0]!.id);
    expect(acceptances[0]).toMatchObject({
      userId,
      termsVersion: "17.09.2026",
      context: "checkout",
      ip: "203.0.113.7",
    });
    await pg.close();
  });

  it("a second click inside 30 minutes reuses the intent and writes NO second acceptance row", async () => {
    const { db, pg } = await createTestDb();
    const { userId } = await account(db);
    const first = await intentFor(db, userId);
    const { intent: second, reused } = await createCheckoutIntent(db, {
      userId,
      planCode: "starter",
      termsVersion: "17.09.2026",
      now: new Date(NOW.getTime() + INTENT_REUSE_MS - 60_000),
    });
    expect(reused).toBe(true);
    expect(second.id).toBe(first.id);
    expect(await db.select().from(schema.termsAcceptances)).toHaveLength(1);

    // A different plan is a different purchase.
    const { intent: other, reused: otherReused } = await createCheckoutIntent(db, {
      userId,
      planCode: "pro",
      termsVersion: "17.09.2026",
      now: NOW,
    });
    expect(otherReused).toBe(false);
    expect(other.id).not.toBe(first.id);
    expect(await db.select().from(schema.termsAcceptances)).toHaveLength(2);
    await pg.close();
  });

  it("a pending intent older than 24h is expired lazily by the next create, and not reused", async () => {
    const { db, pg } = await createTestDb();
    const { userId } = await account(db);
    const old = await intentFor(
      db,
      userId,
      "starter",
      new Date(NOW.getTime() - INTENT_TTL_MS - 1000),
    );
    const { intent: fresh, reused } = await createCheckoutIntent(db, {
      userId,
      planCode: "starter",
      termsVersion: "17.09.2026",
      now: NOW,
    });
    expect(reused).toBe(false);
    expect(fresh.id).not.toBe(old.id);
    const rows = await db
      .select()
      .from(schema.checkoutIntents)
      .orderBy(asc(schema.checkoutIntents.createdAt));
    expect(rows.map((r) => r.status)).toEqual(["expired", "pending"]);
    await pg.close();
  });

  it("an unknown or inactive plan is refused before anything is written", async () => {
    const { db, pg } = await createTestDb();
    const { userId } = await account(db);
    await expect(intentFor(db, userId, "platinum")).rejects.toMatchObject({
      code: "unknown_plan",
    } satisfies Partial<PlanChangeError>);
    expect(await db.select().from(schema.termsAcceptances)).toHaveLength(0);
    expect(await db.select().from(schema.checkoutIntents)).toHaveLength(0);
    await pg.close();
  });

  it("an account whose subscription is active or past_due is refused before anything is written; suspended may buy", async () => {
    const { db, pg } = await createTestDb();
    const { userId } = await account(db);
    const [row] = await db
      .insert(schema.subscriptions)
      .values({
        userId,
        planCode: "starter",
        status: "active",
        gatewayRecurringRef: CUSTOMER,
        currentPeriodStart: NOW,
        currentPeriodEnd: new Date("2026-10-21T10:00:00Z"),
      })
      .returning({ id: schema.subscriptions.id });
    for (const status of ["active", "past_due"] as const) {
      await db
        .update(schema.subscriptions)
        .set({ status })
        .where(eq(schema.subscriptions.id, row!.id));
      await expect(intentFor(db, userId, "pro")).rejects.toMatchObject({
        name: "CheckoutVerificationError",
        reason: "already_subscribed",
        payment: null,
      });
    }
    expect(await db.select().from(schema.termsAcceptances)).toHaveLength(0);
    expect(await db.select().from(schema.checkoutIntents)).toHaveLength(0);

    await db
      .update(schema.subscriptions)
      .set({ status: "suspended" })
      .where(eq(schema.subscriptions.id, row!.id));
    expect((await intentFor(db, userId, "pro")).status).toBe("pending");
    await pg.close();
  });
});

describe("completeCheckout", () => {
  it("happy path: verifies the payment, activates, grants, records the event, completes the intent", async () => {
    const { db, pg } = await createTestDb();
    const { userId } = await account(db);
    const intent = await intentFor(db, userId);
    const starter = await plan(db, "starter");
    const { client, calls } = fake({ payment: { externalIdentifier: intent.id } });

    const result = await completeCheckout(db, {
      intentId: intent.id,
      sumitPaymentId: PAYMENT_ID,
      sumitCustomerId: CUSTOMER,
      now: NOW,
      client,
    });
    expect(result.outcome).toBe("completed");
    expect(result.planCode).toBe("starter");

    const sub = (await db.select().from(schema.subscriptions))[0]!;
    expect(sub.id).toBe(result.subscriptionId);
    expect(sub).toMatchObject({
      userId,
      planCode: "starter",
      status: "active",
      gateway: "sumit",
      gatewayRecurringRef: CUSTOMER,
      cancelAtPeriodEnd: false,
      scheduledPlanCode: null,
    });
    expect(sub.currentPeriodStart.getTime()).toBe(NOW.getTime());
    expect(sub.currentPeriodEnd.toISOString()).toBe("2026-10-21T10:00:00.000Z");
    expect(await creditBalance(db, userId)).toBe(starter.monthlyCredits);

    const events = await db.select().from(schema.gatewayEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      gateway: "sumit",
      gatewayEventId: PAYMENT_ID,
      kind: "checkout_charge",
    });
    expect(events[0]!.payload).toMatchObject({ intentId: intent.id, amountAgorot: 15000 });

    const done = (await db.select().from(schema.checkoutIntents))[0]!;
    expect(done).toMatchObject({
      status: "completed",
      sumitPaymentId: PAYMENT_ID,
      sumitCustomerId: CUSTOMER,
    });
    expect(done.completedAt?.getTime()).toBe(NOW.getTime());

    // The default card already IS the paying card: nothing to align.
    expect(calls.map((c) => c.fn)).toEqual(["getPayment", "getPaymentMethod"]);
    await pg.close();
  });

  it("an EXPIRED intent is still completable: expiry stops reuse, not payment", async () => {
    const { db, pg } = await createTestDb();
    const { userId } = await account(db);
    const intent = await intentFor(db, userId);
    await db
      .update(schema.checkoutIntents)
      .set({ status: "expired" })
      .where(eq(schema.checkoutIntents.id, intent.id));
    const { client } = fake({ payment: { externalIdentifier: intent.id } });
    const result = await completeCheckout(db, {
      intentId: intent.id,
      sumitPaymentId: PAYMENT_ID,
      sumitCustomerId: CUSTOMER,
      now: NOW,
      client,
    });
    expect(result.outcome).toBe("completed");
    expect(await creditBalance(db, userId)).toBeGreaterThan(0);
    expect((await db.select().from(schema.checkoutIntents))[0]!.status).toBe("completed");
    await pg.close();
  });

  it("a DIFFERENT payment on a completed intent is refused loudly, never swallowed as a replay", async () => {
    const { db, pg } = await createTestDb();
    const { userId } = await account(db);
    const intent = await intentFor(db, userId);
    const { client } = fake({ payment: { externalIdentifier: intent.id } });
    await completeCheckout(db, {
      intentId: intent.id,
      sumitPaymentId: PAYMENT_ID,
      sumitCustomerId: CUSTOMER,
      now: NOW,
      client,
    });
    const balance = await creditBalance(db, userId);
    // Two tabs on one reused intent, both paid: the second payment id differs.
    await expect(
      completeCheckout(db, {
        intentId: intent.id,
        sumitPaymentId: "9999999999",
        sumitCustomerId: CUSTOMER,
        now: NOW,
        client,
      }),
    ).rejects.toMatchObject({ reason: "intent_already_completed", payment: { id: 9999999999 } });
    expect(await creditBalance(db, userId)).toBe(balance);
    // The second payment is valid at Sumit, so it is on record as refused.
    const events = await db.select().from(schema.gatewayEvents);
    expect(events.map((e) => e.kind).sort()).toEqual(["checkout_charge", "checkout_refused"]);
    expect(events.find((e) => e.kind === "checkout_refused")!.gatewayEventId).toBe(
      "sumit_refused_9999999999",
    );
    await pg.close();
  });

  it("a replayed return URL grants nothing twice and returns the existing outcome", async () => {
    const { db, pg } = await createTestDb();
    const { userId } = await account(db);
    const intent = await intentFor(db, userId);
    const { client, calls } = fake({ payment: { externalIdentifier: intent.id } });
    const args = {
      intentId: intent.id,
      sumitPaymentId: PAYMENT_ID,
      sumitCustomerId: CUSTOMER,
      now: NOW,
      client,
    };

    const first = await completeCheckout(db, args);
    const balanceAfterFirst = await creditBalance(db, userId);
    const second = await completeCheckout(db, args);

    expect(second.outcome).toBe("replayed");
    expect(second.subscriptionId).toBe(first.subscriptionId);
    expect(await creditBalance(db, userId)).toBe(balanceAfterFirst);
    expect(await db.select().from(schema.subscriptions)).toHaveLength(1);
    expect(await db.select().from(schema.gatewayEvents)).toHaveLength(1);
    // The replay never went back to Sumit.
    expect(calls.filter((c) => c.fn === "getPayment")).toHaveLength(1);
    await pg.close();
  });

  it("an amount that differs from the intent's price changes nothing", async () => {
    const { db, pg } = await createTestDb();
    const { userId } = await account(db);
    const intent = await intentFor(db, userId);
    const { client } = fake({ payment: { externalIdentifier: intent.id, amountAgorot: 14900 } });

    await expect(
      completeCheckout(db, {
        intentId: intent.id,
        sumitPaymentId: PAYMENT_ID,
        sumitCustomerId: CUSTOMER,
        now: NOW,
        client,
      }),
    ).rejects.toMatchObject({ name: "CheckoutVerificationError", reason: "amount_mismatch" });

    expect(await db.select().from(schema.subscriptions)).toHaveLength(0);
    expect(await creditBalance(db, userId)).toBe(0);
    expect((await db.select().from(schema.checkoutIntents))[0]!.status).toBe("pending");
    // The money moved at Sumit: the refusal is on record under the payment's
    // id, so the founder can find the paid-but-unactivated customer here.
    const events = await db.select().from(schema.gatewayEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      gateway: "sumit",
      gatewayEventId: `sumit_refused_${PAYMENT_ID}`,
      kind: "checkout_refused",
    });
    expect(events[0]!.payload).toMatchObject({
      intentId: intent.id,
      reason: "amount_mismatch",
      sumitPaymentId: PAYMENT_ID,
      amountAgorot: 14900,
    });
    await pg.close();
  });

  it("a refusal raised BEFORE any payment was verified leaves no event — nothing is known to have moved", async () => {
    const { db, pg } = await createTestDb();
    const { userId } = await account(db);
    const intent = await intentFor(db, userId);
    await expect(
      completeCheckout(db, {
        intentId: intent.id,
        sumitPaymentId: PAYMENT_ID,
        sumitCustomerId: CUSTOMER,
        now: NOW,
        client: fake({ payment: null }).client,
      }),
    ).rejects.toMatchObject({ reason: "payment_not_found", payment: null });
    expect(await db.select().from(schema.gatewayEvents)).toHaveLength(0);
    await pg.close();
  });

  it("a missing payment, an invalid one, another customer, or another intent's id are each refused", async () => {
    const { db, pg } = await createTestDb();
    const { userId } = await account(db);
    const intent = await intentFor(db, userId);
    const attempt = (client: SumitClient) =>
      completeCheckout(db, {
        intentId: intent.id,
        sumitPaymentId: PAYMENT_ID,
        sumitCustomerId: CUSTOMER,
        now: NOW,
        client,
      })
        .then(() => "completed")
        .catch((err: unknown) => (err instanceof CheckoutVerificationError ? err.reason : "other"));

    expect(await attempt(fake({ payment: null }).client)).toBe("payment_not_found");
    expect(
      await attempt(
        fake({ payment: { externalIdentifier: intent.id, valid: false, status: "003" } }).client,
      ),
    ).toBe("payment_invalid");
    expect(
      await attempt(fake({ payment: { externalIdentifier: intent.id, customerId: 1 } }).client),
    ).toBe("customer_mismatch");
    expect(
      await attempt(fake({ payment: { externalIdentifier: crypto.randomUUID() } }).client),
    ).toBe("identifier_mismatch");
    expect(
      await attempt(fake({ payment: { externalIdentifier: intent.id }, saved: null }).client),
    ).toBe("no_saved_card");
    expect(await db.select().from(schema.subscriptions)).toHaveLength(0);
    expect((await db.select().from(schema.checkoutIntents))[0]!.status).toBe("pending");
    await pg.close();
  });

  it("a default card that is not the paying card is realigned to it (measured 2026-09-21), and a failure there does not block", async () => {
    const { db, pg } = await createTestDb();
    const { userId } = await account(db);
    const intent = await intentFor(db, userId);
    const declinedFirst = {
      id: 1,
      lastDigits: "1333",
      expirationMonth: 5,
      expirationYear: 2031,
      token: "tok-declined",
    };
    const { client, calls } = fake({
      payment: { externalIdentifier: intent.id },
      saved: declinedFirst,
    });

    await completeCheckout(db, {
      intentId: intent.id,
      sumitPaymentId: PAYMENT_ID,
      sumitCustomerId: CUSTOMER,
      now: NOW,
      client,
    });
    const set = calls.find((c) => c.fn === "setPaymentMethod");
    expect(set?.args).toEqual([
      CUSTOMER,
      { token: "tok-paying", expirationMonth: 5, expirationYear: 2031 },
    ]);

    // Same scenario, Sumit refuses the realignment: still activated.
    const other = await account(db);
    const intent2 = await intentFor(db, other.userId);
    const failing = fake({
      payment: { externalIdentifier: intent2.id, id: 99, customerId: 77 },
      saved: declinedFirst,
      setFails: true,
    });
    const result = await completeCheckout(db, {
      intentId: intent2.id,
      sumitPaymentId: "99",
      sumitCustomerId: "77",
      now: NOW,
      client: failing.client,
    });
    expect(result.outcome).toBe("completed");
    expect(await creditBalance(db, other.userId)).toBeGreaterThan(0);
    await pg.close();
  });

  it("a suspended subscription is reactivated IN PLACE: new period, new plan, new customer ref, leftover expired", async () => {
    const { db, pg } = await createTestDb();
    const { userId } = await account(db);
    const suspended = (
      await db
        .insert(schema.subscriptions)
        .values({
          userId,
          planCode: "starter",
          status: "suspended",
          gateway: "sumit",
          gatewayRecurringRef: "old-customer",
          currentPeriodStart: new Date("2026-07-01T00:00:00Z"),
          currentPeriodEnd: new Date("2026-08-01T00:00:00Z"),
          cancelAtPeriodEnd: true,
          scheduledPlanCode: "pro",
        })
        .returning()
    )[0]!;
    await grantPeriod(db, { userId, credits: 7, subscriptionId: suspended.id });
    const pro = await plan(db, "pro");
    const intent = await intentFor(db, userId, "pro");
    const { client } = fake({
      payment: { externalIdentifier: intent.id, amountAgorot: pro.priceAgorot },
    });

    const result = await completeCheckout(db, {
      intentId: intent.id,
      sumitPaymentId: PAYMENT_ID,
      sumitCustomerId: CUSTOMER,
      now: NOW,
      client,
    });
    expect(result.subscriptionId).toBe(suspended.id);
    const rows = await db.select().from(schema.subscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: suspended.id,
      status: "active",
      planCode: "pro",
      gatewayRecurringRef: CUSTOMER,
      cancelAtPeriodEnd: false,
      scheduledPlanCode: null,
    });
    expect(rows[0]!.currentPeriodStart.getTime()).toBe(NOW.getTime());
    // The 7 leftover credits expired first: the balance is exactly the new plan's month.
    expect(await creditBalance(db, userId)).toBe(pro.monthlyCredits);
    expect((await db.select().from(schema.gatewayEvents))[0]!.payload).toMatchObject({
      reactivated: true,
    });
    await pg.close();
  });

  it("an account that became active after the intent was written is refused — the one-live index would refuse a second row too", async () => {
    const { db, pg } = await createTestDb();
    const { userId } = await account(db);
    // The intent was written first (createCheckoutIntent refuses a live
    // account); the subscription went active in between — a second tab.
    const intent = await intentFor(db, userId, "pro");
    await db.insert(schema.subscriptions).values({
      userId,
      planCode: "starter",
      status: "active",
      gatewayRecurringRef: CUSTOMER,
      currentPeriodStart: NOW,
      currentPeriodEnd: new Date("2026-10-21T10:00:00Z"),
    });
    const pro = await plan(db, "pro");
    const { client } = fake({
      payment: { externalIdentifier: intent.id, amountAgorot: pro.priceAgorot },
    });

    await expect(
      completeCheckout(db, {
        intentId: intent.id,
        sumitPaymentId: PAYMENT_ID,
        sumitCustomerId: CUSTOMER,
        now: NOW,
        client,
      }),
    ).rejects.toMatchObject({ reason: "already_subscribed", payment: { id: Number(PAYMENT_ID) } });
    expect(await db.select().from(schema.subscriptions)).toHaveLength(1);
    expect((await db.select().from(schema.checkoutIntents))[0]!.status).toBe("pending");
    expect((await db.select().from(schema.gatewayEvents)).map((e) => e.kind)).toEqual([
      "checkout_refused",
    ]);

    // The database's own rule, for the record: a second live row is impossible.
    await expect(
      db.insert(schema.subscriptions).values({
        userId,
        planCode: "pro",
        status: "active",
        currentPeriodStart: NOW,
        currentPeriodEnd: NOW,
      }),
    ).rejects.toThrow(/subscriptions_one_live_per_user/);
    await pg.close();
  });

  it("a canceled row is history: a new subscription is inserted beside it", async () => {
    const { db, pg } = await createTestDb();
    const { userId } = await account(db);
    await db.insert(schema.subscriptions).values({
      userId,
      planCode: "starter",
      status: "canceled",
      gatewayRecurringRef: "old",
      // Explicit, because the assertion below orders on it: the default is the
      // real clock, which is now later than NOW and flipped the order.
      createdAt: new Date("2026-07-01T00:00:00Z"),
      currentPeriodStart: new Date("2026-07-01T00:00:00Z"),
      currentPeriodEnd: new Date("2026-08-01T00:00:00Z"),
    });
    const intent = await intentFor(db, userId);
    const { client } = fake({ payment: { externalIdentifier: intent.id } });
    await completeCheckout(db, {
      intentId: intent.id,
      sumitPaymentId: PAYMENT_ID,
      sumitCustomerId: CUSTOMER,
      now: NOW,
      client,
    });
    const rows = await db
      .select()
      .from(schema.subscriptions)
      .orderBy(asc(schema.subscriptions.createdAt));
    expect(rows.map((r) => r.status)).toEqual(["canceled", "active"]);
    await pg.close();
  });
});

describe("recordUnconfirmedCheckoutReturn", () => {
  const unconfirmed = {
    intentId: "2b7c5a41-9e10-4a53-a7a8-0c1c1a9f52d1",
    sumitPaymentId: PAYMENT_ID,
    sumitCustomerId: CUSTOMER,
    reason: "sumit_business",
    detail: "sumit /billing/payments/get/: Invalid Credentials",
    returnPath: `/api/billing/sumit/return?OG-PaymentID=${PAYMENT_ID}`,
  };

  it("one row per payment id, whatever the customer does with the URL — and the FIRST reason is the one kept", async () => {
    const { db, pg } = await createTestDb();

    await recordUnconfirmedCheckoutReturn(db, unconfirmed);
    // The customer reloads, and by then the failure is a different one.
    await recordUnconfirmedCheckoutReturn(db, {
      ...unconfirmed,
      reason: "unexpected_error",
      detail: "pooler dropped the connection",
    });

    const rows = await db.select().from(schema.gatewayEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      gateway: "sumit",
      gatewayEventId: `sumit_unconfirmed_${PAYMENT_ID}`,
      kind: "checkout_unconfirmed",
    });
    expect(rows[0]!.payload).toEqual(unconfirmed);
    // Nothing was processed: that is what the null says, and what resolves the
    // row is a checkout_charge under the same payment id, not this column.
    expect(rows[0]!.processedAt).toBeNull();

    // A different payment is a different row.
    await recordUnconfirmedCheckoutReturn(db, { ...unconfirmed, sumitPaymentId: "9999999999" });
    expect(await db.select().from(schema.gatewayEvents)).toHaveLength(2);
    await pg.close();
  });

  it("leaves a checkout_charge alone: the row sits beside it and the completed checkout is untouched", async () => {
    const { db, pg } = await createTestDb();
    const { userId } = await account(db);
    const intent = await intentFor(db, userId);
    const { client } = fake({ payment: { externalIdentifier: intent.id } });
    await completeCheckout(db, {
      intentId: intent.id,
      sumitPaymentId: PAYMENT_ID,
      sumitCustomerId: CUSTOMER,
      now: NOW,
      client,
    });
    const balance = await creditBalance(db, userId);

    await recordUnconfirmedCheckoutReturn(db, { ...unconfirmed, intentId: intent.id });

    const rows = await db.select().from(schema.gatewayEvents);
    expect(rows.map((r) => r.gatewayEventId).sort()).toEqual([
      PAYMENT_ID,
      `sumit_unconfirmed_${PAYMENT_ID}`,
    ]);
    const charge = rows.find((r) => r.gatewayEventId === PAYMENT_ID)!;
    expect(charge.kind).toBe("checkout_charge");
    expect(charge.processedAt?.getTime()).toBe(NOW.getTime());
    expect(charge.payload).toMatchObject({ intentId: intent.id, planCode: "starter" });
    expect(await creditBalance(db, userId)).toBe(balance);
    expect((await db.select().from(schema.checkoutIntents))[0]!.status).toBe("completed");
    await pg.close();
  });

  it("leaves a checkout_refused alone: three different ids, three different meanings", async () => {
    const { db, pg } = await createTestDb();
    const { userId } = await account(db);
    const intent = await intentFor(db, userId);
    // A valid payment at the wrong price: core records the refusal itself.
    await expect(
      completeCheckout(db, {
        intentId: intent.id,
        sumitPaymentId: PAYMENT_ID,
        sumitCustomerId: CUSTOMER,
        now: NOW,
        client: fake({ payment: { externalIdentifier: intent.id, amountAgorot: 14900 } }).client,
      }),
    ).rejects.toMatchObject({ reason: "amount_mismatch" });

    await recordUnconfirmedCheckoutReturn(db, { ...unconfirmed, intentId: intent.id });

    const rows = await db.select().from(schema.gatewayEvents);
    expect(rows.map((r) => r.kind).sort()).toEqual(["checkout_refused", "checkout_unconfirmed"]);
    const refused = rows.find((r) => r.kind === "checkout_refused")!;
    expect(refused.gatewayEventId).toBe(`sumit_refused_${PAYMENT_ID}`);
    expect(refused.payload).toMatchObject({ reason: "amount_mismatch", amountAgorot: 14900 });
    expect(refused.processedAt?.getTime()).toBe(NOW.getTime());
    await pg.close();
  });
});
