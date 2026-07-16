import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "../src/db/schema";
import type { Db } from "../src/db";
import { createBusiness } from "../src/pipelines/businesses";
import { creditBalance, grantPeriod } from "../src/pipelines/credits";
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
      businessId: business.id,
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
    await grantPeriod(db, { businessId: business.id, credits: 7, subscriptionId: sub.id });

    const summary = await processDueRenewals(db, okGateway);
    expect(summary.renewed).toBe(1);

    // Starter grants 40; leftover 7 expired first -> balance is exactly 40.
    expect(await creditBalance(db, business.id)).toBe(40);

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
    await grantPeriod(db, { businessId: b2.id, credits: 12, subscriptionId: sub2.id });

    const second = await processDueRenewals(db, okGateway);
    expect(second.canceled).toBe(1);
    expect(await creditBalance(db, b2.id)).toBe(0);
    await pg.close();
  });
});
