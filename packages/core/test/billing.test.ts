import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "../src/db/schema";
import type { Db } from "../src/db";
import { createBusiness } from "../src/pipelines/businesses";
import { creditBalance, debitRender, grantCredits, grantPeriod } from "../src/pipelines/credits";
import { processDueRenewals, type BillingGateway } from "../src/pipelines/billing";
import { createTestDb } from "./helpers/pglite";

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

async function makeSubscription(
  db: Db,
  periodEndDaysAgo: number,
  status: "active" | "past_due" = "active",
) {
  const business = await createBusiness(db, {
    ownerEmail: `owner-${crypto.randomUUID()}@test.local`,
    name: "Biz",
  });
  const end = new Date(Date.now() - periodEndDaysAgo * 24 * 60 * 60 * 1000);
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  const inserted = await db
    .insert(schema.subscriptions)
    .values({
      userId: business.ownerUserId,
      planCode: "starter",
      status,
      gatewayRecurringRef: "tok_test",
      currentPeriodStart: start,
      currentPeriodEnd: end,
    })
    .returning();
  return { business, sub: inserted[0]! };
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
