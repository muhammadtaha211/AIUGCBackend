import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db";
import { businesses, creditLedger, users } from "../db/schema";

/** Ledger is append-only; balance is always SUM(delta), keyed to the account (user). */
export async function creditBalance(db: Db, userId: string): Promise<number> {
  const rows = await db
    .select({ balance: sql<string>`coalesce(sum(${creditLedger.delta}), 0)` })
    .from(creditLedger)
    .where(eq(creditLedger.userId, userId));
  return Number(rows[0]?.balance ?? 0);
}

/** Business-scoped rows are owned by the business's owner account. */
export async function businessOwnerId(db: Db, businessId: string): Promise<string> {
  const rows = await db
    .select({ ownerUserId: businesses.ownerUserId })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!rows[0]) throw new Error(`business ${businessId} not found`);
  return rows[0].ownerUserId;
}

/**
 * Carries the numbers the wizard needs to say "you're 4 credits short" instead
 * of a bare refusal. The message text is unchanged on purpose — apps/web's
 * coreErrorResponse still matches it by regex; the fields are additive.
 */
export class InsufficientCreditsError extends Error {
  readonly needed: number;
  readonly balance: number;

  constructor(needed: number, balance: number) {
    super(`insufficient credits: need ${needed}, balance is ${balance}`);
    this.name = "InsufficientCreditsError";
    this.needed = needed;
    this.balance = balance;
  }

  get shortfall(): number {
    return Math.max(0, this.needed - this.balance);
  }
}

/**
 * Debit at render enqueue time (reserve); refunded on terminal failure.
 *
 * The balance is re-read INSIDE the transaction, behind a row lock on the
 * owner account, so two tabs confirming at once serialize instead of both
 * seeing the same pre-spend balance and overdrawing. Pass a transaction as
 * `db` to fold several cells of one Set into a single all-or-nothing debit.
 */
export async function debitRender(
  db: Db,
  opts: { businessId: string; videoRenderId: string; cost: number },
): Promise<void> {
  const userId = await businessOwnerId(db, opts.businessId);
  await db.transaction(async (tx) => {
    // The serialization point. Everything below sees a balance nobody else
    // can move until this transaction commits.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");

    const balance = await creditBalance(tx as Db, userId);
    if (balance < opts.cost) throw new InsufficientCreditsError(opts.cost, balance);

    await tx.insert(creditLedger).values({
      userId,
      businessId: opts.businessId,
      delta: -opts.cost,
      reason: "debit_render",
      refId: opts.videoRenderId,
    });
  });
}

/**
 * Idempotent: refunds once per render, only if a debit exists. The read is an
 * optimisation and a source of the debit's amount; the 0016 unique index is
 * what actually makes it safe. ON CONFLICT DO NOTHING instead of catching the
 * violation, so this composes inside a caller's transaction — a raised 23505
 * would abort the whole thing. A conflict means the render handler and the
 * reaper raced and the other one won — that is success, not an error.
 */
export async function refundRenderIfNeeded(db: Db, videoRenderId: string): Promise<boolean> {
  const debit = await db
    .select()
    .from(creditLedger)
    .where(and(eq(creditLedger.refId, videoRenderId), eq(creditLedger.reason, "debit_render")))
    .limit(1);
  if (!debit[0]) return false;

  const inserted = await db
    .insert(creditLedger)
    .values({
      userId: debit[0].userId,
      businessId: debit[0].businessId,
      delta: -debit[0].delta,
      reason: "refund_failed",
      refId: videoRenderId,
    })
    .onConflictDoNothing()
    .returning({ id: creditLedger.id });
  return inserted.length > 0;
}

/** Founder manual grant (admin console): one append-only row; the note is the why. */
export async function grantCredits(
  db: Db,
  opts: { userId: string; credits: number; note: string },
): Promise<void> {
  if (!Number.isInteger(opts.credits) || opts.credits <= 0) {
    throw new Error("credits must be a positive integer");
  }
  await db.insert(creditLedger).values({
    userId: opts.userId,
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
    userId: await businessOwnerId(db, opts.businessId),
    businessId: opts.businessId,
    delta: opts.credits,
    reason: "grant_period",
    refId: opts.subscriptionId,
  });
}

/** Everything ever granted by hand — the portion no renewal may take back. */
async function manualOutstanding(db: Db, userId: string): Promise<number> {
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${creditLedger.delta}), 0)` })
    .from(creditLedger)
    .where(and(eq(creditLedger.userId, userId), eq(creditLedger.reason, "grant_manual")));
  return Number(rows[0]?.total ?? 0);
}

/**
 * No-rollover: zero out the PERIOD remainder at renewal, keeping SUM(delta)
 * truthful. Manual grants are goodwill and survive — expiring them would
 * quietly delete the compensation the founder just handed a customer.
 *
 * Without a per-lot ledger, "spend consumes period credits first, manual
 * credits last" is expressed as expirable = balance - manualOutstanding. Once
 * spend has eaten into the manual portion the remainder is all manual, so
 * nothing expires.
 */
export async function expirePeriodRemainder(
  db: Db,
  opts: { businessId: string; subscriptionId: string },
): Promise<void> {
  const userId = await businessOwnerId(db, opts.businessId);
  const balance = await creditBalance(db, userId);
  const expirable = Math.max(0, balance - (await manualOutstanding(db, userId)));
  if (expirable > 0) {
    await db.insert(creditLedger).values({
      userId,
      businessId: opts.businessId,
      delta: -expirable,
      reason: "expire_period",
      refId: opts.subscriptionId,
    });
  }
}
