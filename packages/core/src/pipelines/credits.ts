import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db";
import { creditLedger } from "../db/schema";

/** Ledger is append-only; balance is always SUM(delta). */
export async function creditBalance(db: Db, businessId: string): Promise<number> {
  const rows = await db
    .select({ balance: sql<string>`coalesce(sum(${creditLedger.delta}), 0)` })
    .from(creditLedger)
    .where(eq(creditLedger.businessId, businessId));
  return Number(rows[0]?.balance ?? 0);
}

/** Debit at render enqueue time (reserve); refunded on terminal failure. */
export async function debitRender(
  db: Db,
  opts: { businessId: string; videoRenderId: string; cost: number },
): Promise<void> {
  await db.insert(creditLedger).values({
    businessId: opts.businessId,
    delta: -opts.cost,
    reason: "debit_render",
    refId: opts.videoRenderId,
  });
}

/** Idempotent: refunds once per render, only if a debit exists. */
export async function refundRenderIfNeeded(db: Db, videoRenderId: string): Promise<boolean> {
  const debit = await db
    .select()
    .from(creditLedger)
    .where(and(eq(creditLedger.refId, videoRenderId), eq(creditLedger.reason, "debit_render")))
    .limit(1);
  if (!debit[0]) return false;

  const refund = await db
    .select()
    .from(creditLedger)
    .where(and(eq(creditLedger.refId, videoRenderId), eq(creditLedger.reason, "refund_failed")))
    .limit(1);
  if (refund[0]) return false;

  await db.insert(creditLedger).values({
    businessId: debit[0].businessId,
    delta: -debit[0].delta,
    reason: "refund_failed",
    refId: videoRenderId,
  });
  return true;
}

/** Founder manual grant (admin console): one append-only row; the note is the why. */
export async function grantCredits(
  db: Db,
  opts: { businessId: string; credits: number; note: string },
): Promise<void> {
  if (!Number.isInteger(opts.credits) || opts.credits <= 0) {
    throw new Error("credits must be a positive integer");
  }
  await db.insert(creditLedger).values({
    businessId: opts.businessId,
    delta: opts.credits,
    reason: "grant_manual",
    note: opts.note,
  });
}

export async function grantPeriod(
  db: Db,
  opts: { businessId: string; credits: number; subscriptionId: string },
): Promise<void> {
  await db.insert(creditLedger).values({
    businessId: opts.businessId,
    delta: opts.credits,
    reason: "grant_period",
    refId: opts.subscriptionId,
  });
}

/** No-rollover: zero out whatever remains at renewal, keeping SUM(delta) truthful. */
export async function expirePeriodRemainder(
  db: Db,
  opts: { businessId: string; subscriptionId: string },
): Promise<void> {
  const balance = await creditBalance(db, opts.businessId);
  if (balance > 0) {
    await db.insert(creditLedger).values({
      businessId: opts.businessId,
      delta: -balance,
      reason: "expire_period",
      refId: opts.subscriptionId,
    });
  }
}
