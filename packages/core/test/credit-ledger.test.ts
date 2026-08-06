import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import { createBusiness } from "../src/pipelines/businesses";
import {
  creditBalance,
  debitRender,
  expirePeriodRemainder,
  grantCredits,
  grantPeriod,
  InsufficientCreditsError,
  refundRenderIfNeeded,
} from "../src/pipelines/credits";
import { createTestDb } from "./helpers/pglite";

async function makeBusiness(db: Db) {
  return createBusiness(db, {
    ownerEmail: `owner-${crypto.randomUUID()}@test.local`,
    name: "Biz",
  });
}

/** A render row, so ref_id points at something real. */
async function makeRender(db: Db, businessId: string) {
  const rows = await db
    .insert(schema.videoRenders)
    .values({ businessId, service: "b", params: {} })
    .returning();
  return rows[0]!;
}

async function ledgerRows(db: Db, refId: string) {
  return db.select().from(schema.creditLedger).where(eq(schema.creditLedger.refId, refId));
}

describe("atomic debit", { timeout: 60_000 }, () => {
  it("re-reads the balance inside the transaction — two confirms cannot overdraw", async () => {
    const { db, pg } = await createTestDb();
    const business = await makeBusiness(db);
    await grantCredits(db, { userId: business.ownerUserId, credits: 15, note: "מתנת פתיחה" });

    // Both render rows first: an await between the two debitRender calls would
    // let the first one commit and the race would never happen.
    const a = await makeRender(db, business.id);
    const b = await makeRender(db, business.id);

    // Two tabs hitting confirm at the same instant. The balance covers exactly one.
    const [first, second] = await Promise.allSettled([
      debitRender(db, { businessId: business.id, videoRenderId: a.id, cost: 15 }),
      debitRender(db, { businessId: business.id, videoRenderId: b.id, cost: 15 }),
    ]);

    const outcomes = [first!.status, second!.status].sort();
    expect(outcomes).toEqual(["fulfilled", "rejected"]);
    expect(await creditBalance(db, business.ownerUserId)).toBe(0);
    expect(await db.select().from(schema.creditLedger)).toHaveLength(2); // grant + one debit
    await pg.close();
  });

  it("throws the typed error carrying needed/balance/shortfall, and writes nothing", async () => {
    const { db, pg } = await createTestDb();
    const business = await makeBusiness(db);
    await grantCredits(db, { userId: business.ownerUserId, credits: 4, note: "n" });
    const render = await makeRender(db, business.id);

    const err = await debitRender(db, {
      businessId: business.id,
      videoRenderId: render.id,
      cost: 15,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(InsufficientCreditsError);
    const typed = err as InsufficientCreditsError;
    expect(typed.needed).toBe(15);
    expect(typed.balance).toBe(4);
    expect(typed.shortfall).toBe(11);
    // The old English text still matches apps/web's coreErrorResponse regex.
    expect(typed.message).toMatch(/insufficient credits/);

    expect(await ledgerRows(db, render.id)).toHaveLength(0);
    expect(await creditBalance(db, business.ownerUserId)).toBe(4);
    await pg.close();
  });

  it("a caller-supplied transaction makes a multi-cell Set all-or-nothing", async () => {
    const { db, pg } = await createTestDb();
    const business = await makeBusiness(db);
    await grantCredits(db, { userId: business.ownerUserId, credits: 20, note: "n" });
    const renders = [
      await makeRender(db, business.id),
      await makeRender(db, business.id),
      await makeRender(db, business.id),
    ];

    // 3 cells x 9 credits = 27 against a balance of 20: the third fails and
    // the first two must roll back with it.
    await expect(
      db.transaction(async (tx) => {
        for (const render of renders) {
          await debitRender(tx as Db, {
            businessId: business.id,
            videoRenderId: render.id,
            cost: 9,
          });
        }
      }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);

    expect(await creditBalance(db, business.ownerUserId)).toBe(20);
    expect(await db.select().from(schema.creditLedger)).toHaveLength(1); // the grant only
    await pg.close();
  });
});

describe("refund idempotence under the 0016 unique index", { timeout: 60_000 }, () => {
  it("the render handler and the janitor racing produce exactly one refund", async () => {
    const { db, pg } = await createTestDb();
    const business = await makeBusiness(db);
    await grantCredits(db, { userId: business.ownerUserId, credits: 30, note: "n" });
    const render = await makeRender(db, business.id);
    await debitRender(db, { businessId: business.id, videoRenderId: render.id, cost: 15 });

    const results = await Promise.all([
      refundRenderIfNeeded(db, render.id),
      refundRenderIfNeeded(db, render.id),
      refundRenderIfNeeded(db, render.id),
    ]);

    // Exactly one caller reports having done the refund; the losers return
    // false rather than throwing a 23505 up into a job handler.
    expect(results.filter(Boolean)).toHaveLength(1);
    const refunds = (await ledgerRows(db, render.id)).filter((r) => r.reason === "refund_failed");
    expect(refunds).toHaveLength(1);
    expect(await creditBalance(db, business.ownerUserId)).toBe(30);
    await pg.close();
  });

  it("a render that was never debited (admin-owned) is a no-op, not a credit grant", async () => {
    const { db, pg } = await createTestDb();
    const business = await makeBusiness(db);
    const render = await makeRender(db, business.id);

    expect(await refundRenderIfNeeded(db, render.id)).toBe(false);
    expect(await ledgerRows(db, render.id)).toHaveLength(0);
    expect(await creditBalance(db, business.ownerUserId)).toBe(0);
    await pg.close();
  });

  it("the database refuses a second debit for one render", async () => {
    const { db, pg } = await createTestDb();
    const business = await makeBusiness(db);
    await grantCredits(db, { userId: business.ownerUserId, credits: 100, note: "n" });
    const render = await makeRender(db, business.id);

    await debitRender(db, { businessId: business.id, videoRenderId: render.id, cost: 15 });
    await expect(
      debitRender(db, { businessId: business.id, videoRenderId: render.id, cost: 15 }),
    ).rejects.toThrow();

    expect(
      (await ledgerRows(db, render.id)).filter((r) => r.reason === "debit_render"),
    ).toHaveLength(1);
    await pg.close();
  });
});

describe("expiry never eats grant_manual", { timeout: 60_000 }, () => {
  async function subscribed(db: Db) {
    const business = await makeBusiness(db);
    const sub = (
      await db
        .insert(schema.subscriptions)
        .values({
          businessId: business.id,
          planCode: "starter",
          status: "active",
          currentPeriodStart: new Date(Date.now() - 30 * 86_400_000),
          currentPeriodEnd: new Date(),
        })
        .returning()
    )[0]!;
    return { business, sub };
  }

  it("expires the period remainder and leaves the manual grant standing", async () => {
    const { db, pg } = await createTestDb();
    const { business, sub } = await subscribed(db);
    await grantPeriod(db, { businessId: business.id, credits: 40, subscriptionId: sub.id });
    await grantCredits(db, {
      userId: business.ownerUserId,
      credits: 25,
      note: "פיצוי על רינדור תקוע",
    });

    await expirePeriodRemainder(db, { businessId: business.id, subscriptionId: sub.id });

    // 65 total, 40 of it period money -> exactly 40 expires.
    expect(await creditBalance(db, business.ownerUserId)).toBe(25);
    const expiries = await db
      .select()
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.reason, "expire_period"));
    expect(expiries).toHaveLength(1);
    expect(expiries[0]!.delta).toBe(-40);
    await pg.close();
  });

  it("spend consumes period credits first — a partly-spent period expires only what is left", async () => {
    const { db, pg } = await createTestDb();
    const { business, sub } = await subscribed(db);
    await grantPeriod(db, { businessId: business.id, credits: 40, subscriptionId: sub.id });
    await grantCredits(db, { userId: business.ownerUserId, credits: 25, note: "goodwill" });
    await debitRender(db, {
      businessId: business.id,
      videoRenderId: (await makeRender(db, business.id)).id,
      cost: 30,
    });

    await expirePeriodRemainder(db, { businessId: business.id, subscriptionId: sub.id });

    // 65 - 30 = 35 balance, 25 of it manual -> 10 period credits expire.
    expect(await creditBalance(db, business.ownerUserId)).toBe(25);
    await pg.close();
  });

  it("once spend has eaten into the manual portion, nothing expires at all", async () => {
    const { db, pg } = await createTestDb();
    const { business, sub } = await subscribed(db);
    await grantPeriod(db, { businessId: business.id, credits: 40, subscriptionId: sub.id });
    await grantCredits(db, { userId: business.ownerUserId, credits: 25, note: "goodwill" });
    await debitRender(db, {
      businessId: business.id,
      videoRenderId: (await makeRender(db, business.id)).id,
      cost: 50,
    });

    await expirePeriodRemainder(db, { businessId: business.id, subscriptionId: sub.id });

    // Balance 15, all of it inside the 25 manual grant -> untouchable.
    expect(await creditBalance(db, business.ownerUserId)).toBe(15);
    expect(
      await db
        .select()
        .from(schema.creditLedger)
        .where(eq(schema.creditLedger.reason, "expire_period")),
    ).toHaveLength(0);
    await pg.close();
  });

  it("a pure manual balance survives a renewal untouched", async () => {
    const { db, pg } = await createTestDb();
    const { business, sub } = await subscribed(db);
    await grantCredits(db, { userId: business.ownerUserId, credits: 10, note: "goodwill" });

    await expirePeriodRemainder(db, { businessId: business.id, subscriptionId: sub.id });

    expect(await creditBalance(db, business.ownerUserId)).toBe(10);
    await pg.close();
  });
});
