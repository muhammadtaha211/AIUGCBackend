import { and, eq, gt, sql } from "drizzle-orm";
import { dailyCapsSchema } from "./config";
import type { Db } from "./db";
import { appConfig, businesses, events, usageEvents, users } from "./db/schema";
import { BudgetError } from "./jobs/errors";

export type UsageKind = "llm_tokens" | "tts_chars" | "gpu_seconds" | "images" | "stt_seconds";
/**
 * The kinds with a platform-wide cap in daily_caps. stt_seconds (ElevenLabs
 * Scribe, the customer's own voice) has none: the founder's answer of
 * 2026-10-19 caps it per account only, by the shared 20-a-day preview count —
 * at most 30 minutes of audio, about NIS 0.33 a day per account (decision
 * 0118). Adding daily_caps.stt_seconds later closes that exception.
 */
export type CappedUsageKind = Exclude<UsageKind, "stt_seconds">;
export type UsageProvider = "anthropic" | "elevenlabs" | "fal" | "heygen";

/**
 * events.kind: the platform-wide cap refused a paid call. With per-account
 * caps absorbing legitimate load, a trip here means something is BROKEN — a
 * runaway loop or a leaked key — not that we are busy. One row per refused
 * attempt (parked jobs recheck hourly; the reaper's park-age valve bounds how
 * long that can accrue).
 */
export const PLATFORM_BUDGET_TRIPPED = "platform_budget_tripped";

/**
 * Hard platform-wide spend caps, per provider unit, over a rolling 24h window
 * (rolling avoids timezone math and midnight burst-throughs). Handlers call
 * this immediately before any paid external call; BudgetError parks the job
 * without consuming an attempt.
 */
export async function assertBudget(db: Db, kind: CappedUsageKind): Promise<void> {
  const caps = await getDailyCaps(db);
  const cap = caps[kind];

  const rows = await db
    .select({ used: sql<string>`coalesce(sum(${usageEvents.quantity}), 0)` })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.kind, kind),
        gt(usageEvents.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
      ),
    );
  const used = Number(rows[0]?.used ?? 0);

  if (used >= cap) {
    await db.insert(events).values({
      kind: PLATFORM_BUDGET_TRIPPED,
      subjectType: "usage_kind",
      payload: { kind, used, cap },
    });
    throw new BudgetError(`daily cap reached for ${kind}: used ${used} of ${cap} in the last 24h`);
  }
}

/**
 * A per-account allowance was spent. Deliberately NOT a BudgetError: that one
 * parks the job and resumes when the window frees, which is right for a
 * capacity ceiling and wrong for an abuse ceiling — a parked TTS job leaves the
 * wizard spinning forever (useJobPoll only gives up after consecutive
 * FAILURES, and a parked job never fails). This one is thrown before anything
 * is enqueued and surfaces as an immediate Hebrew rejection.
 */
export class AccountBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountBudgetError";
  }
}

/**
 * The abuse ceiling, checked at the wizard's entry point before a paid job is
 * ever created. Keyed on the OWNER ACCOUNT, not the business: business
 * creation is self-serve and unlimited, so a per-business cap is farmable at
 * N businesses. The founder's own accounts bypass it.
 *
 * The platform-wide assertBudget stays as an unchanged backstop.
 */
export async function assertAccountBudget(
  db: Db,
  kind: keyof Awaited<ReturnType<typeof getDailyCaps>>["per_account"],
  businessId: string,
): Promise<void> {
  const owner = await db
    .select({ userId: businesses.ownerUserId, role: users.role })
    .from(businesses)
    .innerJoin(users, eq(businesses.ownerUserId, users.id))
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!owner[0]) throw new Error(`business ${businessId} not found`);
  // The founder's own accounts render outreach samples in volume — the abuse
  // ceiling is for strangers. Same bypass as credits and watermarks.
  if (owner[0].role === "admin") return;

  const caps = await getDailyCaps(db);
  const cap = caps.per_account[kind];

  // Every business this account owns, summed together — usage_events already
  // carries business_id on every paid call, so no new column is needed.
  const rows = await db
    .select({ used: sql<string>`coalesce(sum(${usageEvents.quantity}), 0)` })
    .from(usageEvents)
    .innerJoin(businesses, eq(usageEvents.businessId, businesses.id))
    .where(
      and(
        eq(usageEvents.kind, kind),
        eq(businesses.ownerUserId, owner[0].userId),
        gt(usageEvents.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
      ),
    );
  const used = Number(rows[0]?.used ?? 0);

  if (used >= cap) {
    throw new AccountBudgetError(
      `account daily cap reached for ${kind}: used ${used} of ${cap} in the last 24h`,
    );
  }
}

export async function recordUsage(
  db: Db,
  usage: {
    provider: UsageProvider;
    kind: UsageKind;
    quantity: number;
    costEstimateAgorot?: number;
    jobId?: string;
    businessId?: string;
  },
): Promise<void> {
  await db.insert(usageEvents).values({
    provider: usage.provider,
    kind: usage.kind,
    quantity: usage.quantity,
    costEstimateAgorot: usage.costEstimateAgorot ?? 0,
    jobId: usage.jobId,
    businessId: usage.businessId,
  });
}

async function getDailyCaps(db: Db) {
  const rows = await db.select().from(appConfig).where(eq(appConfig.key, "daily_caps")).limit(1);
  if (!rows[0]) throw new Error("app_config row 'daily_caps' is missing (seed not applied?)");
  return dailyCapsSchema.parse(rows[0].value);
}
