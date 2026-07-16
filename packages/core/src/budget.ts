import { and, eq, gt, sql } from "drizzle-orm";
import { dailyCapsSchema } from "./config";
import type { Db } from "./db";
import { appConfig, usageEvents } from "./db/schema";
import { BudgetError } from "./jobs/errors";

export type UsageKind = "llm_tokens" | "tts_chars" | "gpu_seconds";
export type UsageProvider = "anthropic" | "elevenlabs" | "fal";

/**
 * Hard platform-wide spend caps, per provider unit, over a rolling 24h window
 * (rolling avoids timezone math and midnight burst-throughs). Handlers call
 * this immediately before any paid external call; BudgetError parks the job
 * without consuming an attempt.
 */
export async function assertBudget(db: Db, kind: UsageKind): Promise<void> {
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
    throw new BudgetError(`daily cap reached for ${kind}: used ${used} of ${cap} in the last 24h`);
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
