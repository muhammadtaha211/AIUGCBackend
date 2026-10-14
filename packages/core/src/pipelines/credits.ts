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

/**
 * Subscriptions are account-keyed (0041), so a period grant is an
 * account-level row with no business context — the same shape grant_manual
 * has always had. A prorated upgrade grant is ALSO a period grant, with a
 * note saying so: it must expire at the next renewal like the rest of the
 * period's credits, and expirePeriodRemainder never touches grant_manual.
 */
export async function grantPeriod(
  db: Db,
  opts: { userId: string; credits: number; subscriptionId: string; note?: string },
): Promise<void> {
  await db.insert(creditLedger).values({
    userId: opts.userId,
    delta: opts.credits,
    reason: "grant_period",
    refId: opts.subscriptionId,
    note: opts.note ?? null,
  });
}

/** Everything ever granted by hand — the portion no renewal may take back. */
export async function manualOutstanding(db: Db, userId: string): Promise<number> {
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
  opts: { userId: string; subscriptionId: string },
): Promise<void> {
  const balance = await creditBalance(db, opts.userId);
  const expirable = Math.max(0, balance - (await manualOutstanding(db, opts.userId)));
  if (expirable > 0) {
    await db.insert(creditLedger).values({
      userId: opts.userId,
      delta: -expirable,
      reason: "expire_period",
      refId: opts.subscriptionId,
    });
  }
}

// ---------------------------------------------------------------------------
// The ₪5 intro offer's credits (decision 0109). A trial grant is neither
// manual (never expires) nor period (rides a subscription): it expires 30 days
// after the payment unless the account joins a plan first, and spend uses it
// BEFORE any manual credit — the same order expirePeriodRemainder encodes for
// period credits. pipelines/intro.ts holds the locks; these only read and write.
// ---------------------------------------------------------------------------

/** The +credits row written when the ₪5 payment is verified; ref = the intro intent. */
export async function grantTrial(
  db: Db,
  opts: { userId: string; credits: number; intentId: string },
): Promise<void> {
  await db.insert(creditLedger).values({
    userId: opts.userId,
    delta: opts.credits,
    reason: "grant_trial",
    refId: opts.intentId,
  });
}

/**
 * Where the account stood the moment its trial began, in ONE statement so the
 * three numbers share a snapshot (grants and refunds take no lock): the
 * balance, the lifetime manual grants, and the renders it had been debited for
 * and not refunded. For a never-paid account every credit in that balance is
 * manual — or a refund of its own spend — so it IS the manual layer; a later
 * refund of one of those open renders hands manual credits back.
 */
export async function trialBaseline(
  db: Db,
  userId: string,
): Promise<{ balance: number; manual: number; openDebits: string[] }> {
  const rows = await db
    .select({
      balance: sql<string>`coalesce(sum(${creditLedger.delta}), 0)`,
      manual: sql<string>`coalesce(sum(${creditLedger.delta}) filter (where ${creditLedger.reason} = 'grant_manual'), 0)`,
      openDebits: sql<string[] | null>`(
        select jsonb_agg(d.ref_id) from credit_ledger d
        where d.user_id = ${userId} and d.reason = 'debit_render'
          and not exists (
            select 1 from credit_ledger r where r.reason = 'refund_failed' and r.ref_id = d.ref_id
          )
      )`,
    })
    .from(creditLedger)
    .where(eq(creditLedger.userId, userId));
  return {
    balance: Number(rows[0]?.balance ?? 0),
    manual: Number(rows[0]?.manual ?? 0),
    openDebits: rows[0]?.openDebits ?? [],
  };
}

export type TrialLedgerState = {
  credits: number;
  balanceBefore: number;
  manualBefore: number;
  openDebitsBefore: string[];
};

/**
 * The trial credits not yet spent:
 *
 *   min(credits, balance − balance_before − manual granted since − refunds of
 *   the renders open at activation), never below 0.
 *
 * Everything in the balance that is not trial is the manual layer at
 * activation plus what was granted by hand or refunded to it since — so
 * subtracting it leaves the trial remainder, and an expiry of that amount can
 * never reach a manual credit. No clock is involved: the three live numbers
 * are read in one statement.
 */
export async function unusedTrialCredits(
  db: Db,
  userId: string,
  trial: TrialLedgerState,
): Promise<number> {
  const rows = await db
    .select({
      balance: sql<string>`coalesce(sum(${creditLedger.delta}), 0)`,
      manual: sql<string>`coalesce(sum(${creditLedger.delta}) filter (where ${creditLedger.reason} = 'grant_manual'), 0)`,
      refundsOfOpen: sql<string>`coalesce(sum(${creditLedger.delta}) filter (
        where ${creditLedger.reason} = 'refund_failed'
          and ${creditLedger.refId}::text in (select jsonb_array_elements_text(${JSON.stringify(trial.openDebitsBefore)}::jsonb))
      ), 0)`,
    })
    .from(creditLedger)
    .where(eq(creditLedger.userId, userId));
  const balance = Number(rows[0]?.balance ?? 0);
  const manualSince = Number(rows[0]?.manual ?? 0) - trial.manualBefore;
  const refundsOfOpen = Number(rows[0]?.refundsOfOpen ?? 0);
  const left = balance - trial.balanceBefore - manualSince - refundsOfOpen;
  return Math.max(0, Math.min(trial.credits, left));
}

/**
 * Day 30: expire the unused trial credits (ref = the intro intent). The caller
 * holds the users and trial locks and has checked that no period grant exists
 * yet — the formula counts every non-manual credit as trial. Returns what it
 * expired; nothing is written at 0.
 */
export async function expireTrialRemainder(
  db: Db,
  opts: { userId: string; intentId: string; trial: TrialLedgerState },
): Promise<number> {
  const expirable = await unusedTrialCredits(db, opts.userId, opts.trial);
  if (expirable > 0) {
    await db.insert(creditLedger).values({
      userId: opts.userId,
      delta: -expirable,
      reason: "expire_trial",
      refId: opts.intentId,
    });
  }
  return expirable;
}
