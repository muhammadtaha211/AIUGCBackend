import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "../src/db/schema";
import type { Db } from "../src/db";
import { createBusiness } from "../src/pipelines/businesses";
import { creditBalance, debitRender, grantCredits, grantPeriod } from "../src/pipelines/credits";
import {
  cancelSubscription,
  changePlan,
  getAccountBilling,
  PlanChangeError,
  processDueRenewals,
  recordTermsAcceptance,
  resumeSubscription,
  type BillingGateway,
} from "../src/pipelines/billing";
import { createTestDb } from "./helpers/pglite";

const DAY = 24 * 60 * 60 * 1000;

const okGateway: BillingGateway = {
  name: "test",
  async chargeRecurring() {
    return { ok: true, gatewayEventId: `evt_${crypto.randomUUID()}` };
  },
};

const failGateway: BillingGateway = {
  name: "test",
  async chargeRecurring() {
    return { ok: false, gatewayEventId: `evt_${crypto.randomUUID()}`, error: "card declined" };
  },
};

/** A gateway that records what it was asked to charge. */
function recordingGateway(ok = true) {
  const calls: Array<{ recurringRef: string; amountAgorot: number; description: string }> = [];
  const gateway: BillingGateway = {
    name: "test",
    async chargeRecurring(input) {
      calls.push(input);
      return {
        ok,
        gatewayEventId: `evt_${crypto.randomUUID()}`,
        error: ok ? undefined : "declined",
      };
    },
  };
  return { gateway, calls };
}

async function makeSubscription(
  db: Db,
  periodEndDaysAgo: number,
  status: "active" | "past_due" | "suspended" = "active",
  extra: {
    planCode?: string;
    cancelAtPeriodEnd?: boolean;
    scheduledPlanCode?: string | null;
    gatewayRecurringRef?: string | null;
  } = {},
) {
  const business = await createBusiness(db, {
    ownerEmail: `owner-${crypto.randomUUID()}@test.local`,
    name: "Biz",
  });
  const end = new Date(Date.now() - periodEndDaysAgo * DAY);
  const start = new Date(end.getTime() - 30 * DAY);
  const inserted = await db
    .insert(schema.subscriptions)
    .values({
      userId: business.ownerUserId,
      planCode: extra.planCode ?? "starter",
      status,
      gatewayRecurringRef:
        extra.gatewayRecurringRef === undefined ? "tok_test" : extra.gatewayRecurringRef,
      currentPeriodStart: start,
      currentPeriodEnd: end,
      cancelAtPeriodEnd: extra.cancelAtPeriodEnd ?? false,
      scheduledPlanCode: extra.scheduledPlanCode ?? null,
    })
    .returning();
  return { business, sub: inserted[0]! };
}

async function readSub(db: Db, id: string) {
  return (await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, id)))[0]!;
}

/** The live plan ladder, by price — never hard-coded in these tests. */
async function ladder(db: Db) {
  const rows = await db.select().from(schema.plans).orderBy(asc(schema.plans.priceAgorot));
  return { lowest: rows[0]!, middle: rows[1]!, highest: rows[rows.length - 1]!, rows };
}

describe("billing state machine", { timeout: 60_000 }, () => {
  it("successful renewal: expire leftover, grant plan credits, advance period", async () => {
    const { db, pg } = await createTestDb();
    const { business, sub } = await makeSubscription(db, 0);
    // Leftover credits from last period — must not roll over.
    await grantPeriod(db, { userId: business.ownerUserId, credits: 7, subscriptionId: sub.id });

    const summary = await processDueRenewals(db, okGateway);
    expect(summary.renewed).toBe(1);

    // Starter grants 1000 (migration 0043); leftover 7 expired first -> balance
    // is exactly 1000.
    expect(await creditBalance(db, business.ownerUserId)).toBe(1000);

    const updated = (
      await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, sub.id))
    )[0]!;
    expect(updated.status).toBe("active");
    expect(updated.currentPeriodStart.getTime()).toBe(sub.currentPeriodEnd.getTime());
    expect(updated.currentPeriodEnd.getTime()).toBeGreaterThan(sub.currentPeriodEnd.getTime());

    const events = await db.select().from(schema.gatewayEvents);
    expect(events[0]!.kind).toBe("recurring_charge_success");
    await pg.close();
  });

  it("failed charge on day 0 -> past_due; day between retries is skipped", async () => {
    const { db, pg } = await createTestDb();
    const { sub } = await makeSubscription(db, 0);

    const summary = await processDueRenewals(db, failGateway);
    expect(summary.failed).toBe(1);
    let row = (
      await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, sub.id))
    )[0]!;
    expect(row.status).toBe("past_due");

    // Day 1 is not in retry_days [2,5] -> no charge attempt, still past_due.
    const dayOne = new Date(sub.currentPeriodEnd.getTime() + 1 * 24 * 60 * 60 * 1000);
    const second = await processDueRenewals(db, failGateway, dayOne);
    expect(second.failed).toBe(0);
    expect((await db.select().from(schema.gatewayEvents)).length).toBe(1);

    // Day 2 IS a retry day -> attempt again.
    const dayTwo = new Date(sub.currentPeriodEnd.getTime() + 2 * 24 * 60 * 60 * 1000);
    const third = await processDueRenewals(db, failGateway, dayTwo);
    expect(third.failed).toBe(1);
    row = (
      await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, sub.id))
    )[0]!;
    expect(row.status).toBe("past_due");
    await pg.close();
  });

  it("suspends after the dunning window, cancels at period end when requested", async () => {
    const { db, pg } = await createTestDb();
    const { sub } = await makeSubscription(db, 7, "past_due"); // 7 days past due
    const summary = await processDueRenewals(db, failGateway);
    expect(summary.suspended).toBe(1);
    const row = (
      await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, sub.id))
    )[0]!;
    expect(row.status).toBe("suspended");

    // cancel_at_period_end: canceled without charging, leftover credits expired.
    const { business: b2, sub: sub2 } = await makeSubscription(db, 0);
    await db
      .update(schema.subscriptions)
      .set({ cancelAtPeriodEnd: true })
      .where(eq(schema.subscriptions.id, sub2.id));
    await grantPeriod(db, { userId: b2.ownerUserId, credits: 12, subscriptionId: sub2.id });

    const second = await processDueRenewals(db, okGateway);
    expect(second.canceled).toBe(1);
    expect(await creditBalance(db, b2.ownerUserId)).toBe(0);
    await pg.close();
  });
});

describe("manual credit grants (admin console)", { timeout: 60_000 }, () => {
  it("writes exactly one user-keyed grant_manual row with the note; rejects bad amounts", async () => {
    const { db, pg } = await createTestDb();
    const business = await createBusiness(db, {
      ownerEmail: `owner-${crypto.randomUUID()}@test.local`,
      name: "Biz",
    });
    const owner = business.ownerUserId;

    await grantCredits(db, { userId: owner, credits: 25, note: "פיצוי על רינדור תקוע" });

    const rows = await db
      .select()
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.userId, owner));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe("grant_manual");
    expect(rows[0]!.delta).toBe(25);
    expect(rows[0]!.note).toBe("פיצוי על רינדור תקוע");
    // User-level grant: no business context on the row.
    expect(rows[0]!.businessId).toBeNull();
    expect(await creditBalance(db, owner)).toBe(25);

    // The ledger only ever gains positive integer grants from this path.
    await expect(grantCredits(db, { userId: owner, credits: 0, note: "x" })).rejects.toThrow(
      /positive integer/,
    );
    await expect(grantCredits(db, { userId: owner, credits: -5, note: "x" })).rejects.toThrow(
      /positive integer/,
    );
    await expect(grantCredits(db, { userId: owner, credits: 2.5, note: "x" })).rejects.toThrow(
      /positive integer/,
    );
    expect(await creditBalance(db, owner)).toBe(25);
    await pg.close();
  });

  it("account-level credits: two businesses, one owner, one shared balance", async () => {
    const { db, pg } = await createTestDb();
    const ownerEmail = `owner-${crypto.randomUUID()}@test.local`;
    const b1 = await createBusiness(db, { ownerEmail, name: "עסק א" });
    const b2 = await createBusiness(db, { ownerEmail, name: "עסק ב" });
    expect(b2.ownerUserId).toBe(b1.ownerUserId);
    const owner = b1.ownerUserId;

    await grantCredits(db, { userId: owner, credits: 10, note: "מתנת פתיחה" });
    await debitRender(db, { businessId: b1.id, videoRenderId: crypto.randomUUID(), cost: 3 });
    await debitRender(db, { businessId: b2.id, videoRenderId: crypto.randomUUID(), cost: 4 });
    expect(await creditBalance(db, owner)).toBe(3);

    // Debits keep the business as context; both rows share the owner key.
    const debits = await db
      .select()
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.reason, "debit_render"));
    expect(debits.map((row) => row.userId)).toEqual([owner, owner]);
    expect(debits.map((row) => row.businessId).sort()).toEqual([b1.id, b2.id].sort());
    await pg.close();
  });
});

describe("subscriptions are keyed on the account (0041)", { timeout: 60_000 }, () => {
  it("one subscription, two businesses: both spend down the same period grant", async () => {
    const { db, pg } = await createTestDb();
    const ownerEmail = `owner-${crypto.randomUUID()}@test.local`;
    const b1 = await createBusiness(db, { ownerEmail, name: "עסק א" });
    const b2 = await createBusiness(db, { ownerEmail, name: "עסק ב" });
    const owner = b1.ownerUserId;
    expect(b2.ownerUserId).toBe(owner);

    // ONE subscription for the account — not one per business.
    const sub = (
      await db
        .insert(schema.subscriptions)
        .values({
          userId: owner,
          planCode: "pro",
          status: "active",
          currentPeriodStart: new Date(Date.now() - 30 * 86_400_000),
          currentPeriodEnd: new Date(Date.now() + 1 * 86_400_000),
        })
        .returning()
    )[0]!;
    await grantPeriod(db, { userId: owner, credits: 100, subscriptionId: sub.id });

    await debitRender(db, { businessId: b1.id, videoRenderId: crypto.randomUUID(), cost: 15 });
    await debitRender(db, { businessId: b2.id, videoRenderId: crypto.randomUUID(), cost: 25 });
    expect(await creditBalance(db, owner)).toBe(60);

    // The grant is an account-level row; only the spend rows carry a business.
    const grant = (
      await db
        .select()
        .from(schema.creditLedger)
        .where(eq(schema.creditLedger.reason, "grant_period"))
    )[0]!;
    expect(grant.userId).toBe(owner);
    expect(grant.businessId).toBeNull();
    await pg.close();
  });

  it("the database refuses a second live subscription for one account, and allows one after cancellation", async () => {
    const { db, pg } = await createTestDb();
    const ownerEmail = `owner-${crypto.randomUUID()}@test.local`;
    const b1 = await createBusiness(db, { ownerEmail, name: "עסק א" });
    await createBusiness(db, { ownerEmail, name: "עסק ב" });
    const owner = b1.ownerUserId;

    const live = (status: "active" | "past_due" | "suspended" | "canceled") => ({
      userId: owner,
      planCode: "starter" as const,
      status,
      currentPeriodStart: new Date(Date.now() - 30 * 86_400_000),
      currentPeriodEnd: new Date(Date.now() + 1 * 86_400_000),
    });

    const first = (await db.insert(schema.subscriptions).values(live("active")).returning())[0]!;
    // A second business is no longer a second subscription: past_due and
    // suspended are live too, so the index covers the whole live set.
    // Named, not a bare toThrow: the point is THIS index refusing, not any error.
    const refused = /subscriptions_one_live_per_user/;
    await expect(db.insert(schema.subscriptions).values(live("active"))).rejects.toThrow(refused);
    await expect(db.insert(schema.subscriptions).values(live("past_due"))).rejects.toThrow(refused);
    await expect(db.insert(schema.subscriptions).values(live("suspended"))).rejects.toThrow(
      refused,
    );

    // Canceled rows fall outside the partial index and may pile up.
    await db
      .update(schema.subscriptions)
      .set({ status: "canceled" })
      .where(eq(schema.subscriptions.id, first.id));
    const second = (await db.insert(schema.subscriptions).values(live("active")).returning())[0]!;
    expect(second.id).not.toBe(first.id);
    expect(await db.select().from(schema.subscriptions)).toHaveLength(2);
    await pg.close();
  });
});

describe("plan changes (0045, decisions 0052/0053)", { timeout: 60_000 }, () => {
  it("upgrade mid-period: charges the prorated difference, grants prorated PERIOD credits, keeps the period dates", async () => {
    const { db, pg } = await createTestDb();
    const { lowest, highest } = await ladder(db);
    // 10 of 30 days left (the period ends in 10 days).
    const { business, sub } = await makeSubscription(db, -10, "active", { planCode: lowest.code });
    await grantPeriod(db, {
      userId: business.ownerUserId,
      credits: lowest.monthlyCredits,
      subscriptionId: sub.id,
    });
    const { gateway, calls } = recordingGateway();

    const result = await changePlan(db, gateway, {
      userId: business.ownerUserId,
      toPlanCode: highest.code,
    });
    expect(result.kind).toBe("upgraded");
    if (result.kind !== "upgraded") throw new Error("unreachable");
    expect(result.quote.daysInPeriod).toBe(30);
    expect(result.quote.daysRemaining).toBe(10);

    // The gateway was asked for exactly the quoted amount, in Hebrew.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.amountAgorot).toBe(result.quote.chargeAgorot);
    expect(calls[0]!.amountAgorot).toBe(
      Math.ceil(((highest.priceAgorot - lowest.priceAgorot) * 10) / 30),
    );
    expect(calls[0]!.description).toBe(`תבנית — שדרוג ל${highest.name}`);

    const after = await readSub(db, sub.id);
    expect(after.planCode).toBe(highest.code);
    expect(after.scheduledPlanCode).toBeNull();
    expect(after.cancelAtPeriodEnd).toBe(false);
    expect(after.currentPeriodStart.getTime()).toBe(sub.currentPeriodStart.getTime());
    expect(after.currentPeriodEnd.getTime()).toBe(sub.currentPeriodEnd.getTime());

    // The grant is a grant_period row with the upgrade note — NOT grant_manual.
    const grants = await db
      .select()
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.userId, business.ownerUserId));
    const upgradeRow = grants.find((r) => r.note?.startsWith("upgrade "));
    expect(upgradeRow).toBeDefined();
    expect(upgradeRow!.reason).toBe("grant_period");
    expect(upgradeRow!.delta).toBe(result.quote.creditsGranted);
    expect(upgradeRow!.delta).toBe(
      Math.floor(((highest.monthlyCredits - lowest.monthlyCredits) * 10) / 30),
    );
    expect(upgradeRow!.note).toBe(`upgrade ${lowest.code}→${highest.code} 10/30`);
    expect(upgradeRow!.refId).toBe(sub.id);

    const events = await db.select().from(schema.gatewayEvents);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("plan_change_charge_success");
    await pg.close();
  });

  it("the upgrade's credits EXPIRE at the next renewal: balance after renewal is exactly the new plan's credits", async () => {
    const { db, pg } = await createTestDb();
    const { lowest, highest } = await ladder(db);
    const { business, sub } = await makeSubscription(db, -10, "active", { planCode: lowest.code });
    await grantPeriod(db, {
      userId: business.ownerUserId,
      credits: lowest.monthlyCredits,
      subscriptionId: sub.id,
    });
    // A goodwill grant that MUST survive — the proof that the upgrade credits
    // are the period kind and the manual kind is untouched.
    await grantCredits(db, { userId: business.ownerUserId, credits: 7, note: "מתנה" });

    const upgraded = await changePlan(db, okGateway, {
      userId: business.ownerUserId,
      toPlanCode: highest.code,
    });
    expect(upgraded.kind).toBe("upgraded");
    expect(await creditBalance(db, business.ownerUserId)).toBeGreaterThan(
      lowest.monthlyCredits + 7,
    );

    // Renew at the period end: expire_period must take the upgrade credits
    // with the rest of the period, spare the 7, and grant the NEW plan.
    const summary = await processDueRenewals(
      db,
      okGateway,
      new Date(sub.currentPeriodEnd.getTime() + 1000),
    );
    expect(summary.renewed).toBe(1);
    expect(await creditBalance(db, business.ownerUserId)).toBe(highest.monthlyCredits + 7);
    expect((await readSub(db, sub.id)).planCode).toBe(highest.code);
    await pg.close();
  });

  it("a declined upgrade charge changes nothing except the failed gateway_events row", async () => {
    const { db, pg } = await createTestDb();
    const { lowest, highest } = await ladder(db);
    const { business, sub } = await makeSubscription(db, -10, "active", {
      planCode: lowest.code,
      cancelAtPeriodEnd: true,
    });
    await grantPeriod(db, {
      userId: business.ownerUserId,
      credits: lowest.monthlyCredits,
      subscriptionId: sub.id,
    });

    const result = await changePlan(db, failGateway, {
      userId: business.ownerUserId,
      toPlanCode: highest.code,
    });
    expect(result.kind).toBe("charge_failed");
    if (result.kind !== "charge_failed") throw new Error("unreachable");
    expect(result.error).toBe("card declined");

    const after = await readSub(db, sub.id);
    expect(after.planCode).toBe(lowest.code);
    expect(after.cancelAtPeriodEnd).toBe(true); // untouched
    expect(after.scheduledPlanCode).toBeNull();
    expect(await creditBalance(db, business.ownerUserId)).toBe(lowest.monthlyCredits);
    const events = await db.select().from(schema.gatewayEvents);
    expect(events.map((e) => e.kind)).toEqual(["plan_change_charge_failed"]);
    await pg.close();
  });

  it("downgrade: scheduled, nothing charged; the renewal charges and grants the NEW plan and clears the schedule", async () => {
    const { db, pg } = await createTestDb();
    const { lowest, highest } = await ladder(db);
    const { business, sub } = await makeSubscription(db, -10, "active", { planCode: highest.code });
    await grantPeriod(db, {
      userId: business.ownerUserId,
      credits: highest.monthlyCredits,
      subscriptionId: sub.id,
    });
    const { gateway, calls } = recordingGateway();

    const result = await changePlan(db, gateway, {
      userId: business.ownerUserId,
      toPlanCode: lowest.code,
    });
    expect(result.kind).toBe("scheduled");
    if (result.kind !== "scheduled") throw new Error("unreachable");
    expect(result.quote.kind).toBe("downgrade");
    expect(calls).toHaveLength(0);
    let row = await readSub(db, sub.id);
    expect(row.planCode).toBe(highest.code); // still on what was paid for
    expect(row.scheduledPlanCode).toBe(lowest.code);

    // getAccountBilling reports the pending change and quotes from the CURRENT plan.
    const view = await getAccountBilling(db, { userId: business.ownerUserId });
    expect(view.subscription?.scheduledPlanCode).toBe(lowest.code);
    expect(Object.keys(view.quotes).sort()).toEqual(
      view.plans
        .map((p) => p.code)
        .filter((c) => c !== highest.code)
        .sort(),
    );
    expect(view.quotes[lowest.code]!.kind).toBe("downgrade");
    const prices = view.plans.map((p) => p.priceAgorot);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));

    const renewal = await processDueRenewals(
      db,
      gateway,
      new Date(sub.currentPeriodEnd.getTime() + 1000),
    );
    expect(renewal.renewed).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.amountAgorot).toBe(lowest.priceAgorot);
    row = await readSub(db, sub.id);
    expect(row.planCode).toBe(lowest.code);
    expect(row.scheduledPlanCode).toBeNull();
    expect(await creditBalance(db, business.ownerUserId)).toBe(lowest.monthlyCredits);
    await pg.close();
  });

  it("a failed renewal charge leaves the schedule in place", async () => {
    const { db, pg } = await createTestDb();
    const { lowest, highest } = await ladder(db);
    const { business, sub } = await makeSubscription(db, 0, "active", {
      planCode: highest.code,
      scheduledPlanCode: lowest.code,
    });
    const summary = await processDueRenewals(db, failGateway);
    expect(summary.failed).toBe(1);
    const row = await readSub(db, sub.id);
    expect(row.status).toBe("past_due");
    expect(row.planCode).toBe(highest.code);
    expect(row.scheduledPlanCode).toBe(lowest.code);
    expect(await creditBalance(db, business.ownerUserId)).toBe(0);
    await pg.close();
  });

  it("an upgrade on the last day is scheduled, not charged", async () => {
    const { db, pg } = await createTestDb();
    const { lowest, highest } = await ladder(db);
    // The period ends in 12 hours -> 1 day remaining.
    const { business, sub } = await makeSubscription(db, -0.5, "active", { planCode: lowest.code });
    const { gateway, calls } = recordingGateway();
    const result = await changePlan(db, gateway, {
      userId: business.ownerUserId,
      toPlanCode: highest.code,
    });
    expect(result.kind).toBe("scheduled");
    if (result.kind !== "scheduled") throw new Error("unreachable");
    expect(result.quote.scheduleInstead).toBe(true);
    expect(calls).toHaveLength(0);
    expect((await readSub(db, sub.id)).scheduledPlanCode).toBe(highest.code);
    await pg.close();
  });

  it("an upgrade clears a pending cancel and a pending downgrade", async () => {
    const { db, pg } = await createTestDb();
    const { lowest, middle, highest } = await ladder(db);
    const { business, sub } = await makeSubscription(db, -10, "active", {
      planCode: middle.code,
      cancelAtPeriodEnd: true,
      scheduledPlanCode: lowest.code,
    });
    const result = await changePlan(db, okGateway, {
      userId: business.ownerUserId,
      toPlanCode: highest.code,
    });
    expect(result.kind).toBe("upgraded");
    const row = await readSub(db, sub.id);
    expect(row.planCode).toBe(highest.code);
    expect(row.cancelAtPeriodEnd).toBe(false);
    expect(row.scheduledPlanCode).toBeNull();
    await pg.close();
  });

  it("undo: re-choosing the current plan clears the schedule and the cancel; nothing pending is refused", async () => {
    const { db, pg } = await createTestDb();
    const { lowest, highest } = await ladder(db);
    const { business, sub } = await makeSubscription(db, -10, "active", {
      planCode: highest.code,
      cancelAtPeriodEnd: true,
      scheduledPlanCode: lowest.code,
    });
    const result = await changePlan(db, okGateway, {
      userId: business.ownerUserId,
      toPlanCode: highest.code,
    });
    expect(result.kind).toBe("undone");
    const row = await readSub(db, sub.id);
    expect(row.planCode).toBe(highest.code);
    expect(row.cancelAtPeriodEnd).toBe(false);
    expect(row.scheduledPlanCode).toBeNull();

    await expect(
      changePlan(db, okGateway, { userId: business.ownerUserId, toPlanCode: highest.code }),
    ).rejects.toMatchObject({ name: "PlanChangeError", code: "nothing_pending" });
    await pg.close();
  });

  it("refuses past_due and suspended (typed), an unknown plan, an account with no subscription, and a missing token", async () => {
    const { db, pg } = await createTestDb();
    const { lowest, highest } = await ladder(db);

    const pastDue = await makeSubscription(db, 1, "past_due", { planCode: lowest.code });
    await expect(
      changePlan(db, okGateway, { userId: pastDue.business.ownerUserId, toPlanCode: highest.code }),
    ).rejects.toMatchObject({ code: "not_active", status: "past_due" });

    const suspended = await makeSubscription(db, 8, "suspended", { planCode: lowest.code });
    await expect(
      changePlan(db, okGateway, {
        userId: suspended.business.ownerUserId,
        toPlanCode: highest.code,
      }),
    ).rejects.toMatchObject({ code: "not_active", status: "suspended" });

    const active = await makeSubscription(db, -10, "active", { planCode: lowest.code });
    await expect(
      changePlan(db, okGateway, { userId: active.business.ownerUserId, toPlanCode: "no-such" }),
    ).rejects.toMatchObject({ code: "unknown_plan" });

    const nobody = await createBusiness(db, {
      ownerEmail: `nobody-${crypto.randomUUID()}@test.local`,
      name: "x",
    });
    const err = await changePlan(db, okGateway, {
      userId: nobody.ownerUserId,
      toPlanCode: highest.code,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlanChangeError);
    expect((err as PlanChangeError).code).toBe("no_subscription");

    const tokenless = await makeSubscription(db, -10, "active", {
      planCode: lowest.code,
      gatewayRecurringRef: null,
    });
    await expect(
      changePlan(db, okGateway, {
        userId: tokenless.business.ownerUserId,
        toPlanCode: highest.code,
      }),
    ).rejects.toMatchObject({ code: "no_recurring_ref" });
    // Nothing above touched the events log.
    expect(await db.select().from(schema.gatewayEvents)).toHaveLength(0);
    await pg.close();
  });

  it("cancel clears a pending plan change and stops the renewal; resume undoes it", async () => {
    const { db, pg } = await createTestDb();
    const { lowest, highest } = await ladder(db);
    const { business, sub } = await makeSubscription(db, -10, "active", {
      planCode: highest.code,
      scheduledPlanCode: lowest.code,
    });
    await cancelSubscription(db, { userId: business.ownerUserId });
    let row = await readSub(db, sub.id);
    expect(row.cancelAtPeriodEnd).toBe(true);
    expect(row.scheduledPlanCode).toBeNull();

    await resumeSubscription(db, { userId: business.ownerUserId });
    row = await readSub(db, sub.id);
    expect(row.cancelAtPeriodEnd).toBe(false);

    const nobody = await createBusiness(db, {
      ownerEmail: `nobody-${crypto.randomUUID()}@test.local`,
      name: "x",
    });
    await expect(cancelSubscription(db, { userId: nobody.ownerUserId })).rejects.toMatchObject({
      code: "no_subscription",
    });
    await expect(resumeSubscription(db, { userId: nobody.ownerUserId })).rejects.toMatchObject({
      code: "no_subscription",
    });
    await pg.close();
  });

  it("the one-live-subscription index still holds with the new column; the FK on it is real", async () => {
    const { db, pg } = await createTestDb();
    const { lowest } = await ladder(db);
    const { business, sub } = await makeSubscription(db, -10, "active", {
      planCode: lowest.code,
      scheduledPlanCode: lowest.code,
    });
    const another = {
      userId: business.ownerUserId,
      planCode: lowest.code,
      status: "active" as const,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
    };
    await expect(db.insert(schema.subscriptions).values(another)).rejects.toThrow(
      /subscriptions_one_live_per_user/,
    );
    await db
      .update(schema.subscriptions)
      .set({ status: "canceled" })
      .where(eq(schema.subscriptions.id, sub.id));
    await db.insert(schema.subscriptions).values(another);
    expect(await db.select().from(schema.subscriptions)).toHaveLength(2);

    await expect(
      db
        .update(schema.subscriptions)
        .set({ scheduledPlanCode: "no-such-plan" })
        .where(eq(schema.subscriptions.id, sub.id)),
    ).rejects.toThrow(/subscriptions_scheduled_plan_code_plans_code_fk/);
    await pg.close();
  });

  it("getAccountBilling with no subscription: null, the ladder by price, the balance split, no quotes, Hebrew names", async () => {
    const { db, pg } = await createTestDb();
    const business = await createBusiness(db, {
      ownerEmail: `owner-${crypto.randomUUID()}@test.local`,
      name: "Biz",
    });
    await grantCredits(db, { userId: business.ownerUserId, credits: 9, note: "מתנה" });
    const view = await getAccountBilling(db, { userId: business.ownerUserId });
    expect(view.subscription).toBeNull();
    expect(view.quotes).toEqual({});
    expect(view.balance).toBe(9);
    expect(view.manualOutstanding).toBe(9);
    expect(view.plans.length).toBeGreaterThanOrEqual(3);
    // 0044: every plan name is Hebrew now.
    for (const plan of view.plans) expect(plan.name).toMatch(/[א-ת]/);
    await pg.close();
  });
});

describe("terms acceptance (0046)", { timeout: 60_000 }, () => {
  it("records who, which version, where, from what", async () => {
    const { db, pg } = await createTestDb();
    const business = await createBusiness(db, {
      ownerEmail: `owner-${crypto.randomUUID()}@test.local`,
      name: "Biz",
    });
    const { id, acceptedAt } = await recordTermsAcceptance(db, {
      userId: business.ownerUserId,
      termsVersion: "11.09.2026",
      context: "checkout",
      ip: "203.0.113.7",
      userAgent: "vitest",
    });
    const rows = await db.select().from(schema.termsAcceptances);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      userId: business.ownerUserId,
      termsVersion: "11.09.2026",
      context: "checkout",
      ip: "203.0.113.7",
      userAgent: "vitest",
    });
    expect(rows[0]!.acceptedAt.getTime()).toBe(acceptedAt.getTime());
    // The request context is optional.
    await recordTermsAcceptance(db, {
      userId: business.ownerUserId,
      termsVersion: "11.09.2026",
      context: "checkout",
    });
    expect(await db.select().from(schema.termsAcceptances)).toHaveLength(2);
    await pg.close();
  });
});
