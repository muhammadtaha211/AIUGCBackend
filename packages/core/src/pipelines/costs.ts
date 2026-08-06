import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "../db";
import { usageEvents, videoRenders } from "../db/schema";

/**
 * What a delivered video actually costs us, by provider, over a date range.
 *
 * Pricing was set from estimates. Two weeks of real traffic through this query
 * replaces the guesswork: if the per-video agorot here drift away from the
 * assumptions behind `credit_costs`, the rates are wrong and the fix is an
 * UPDATE on that app_config row, not a deploy.
 *
 * Every paid call already records business_id (verified across all three
 * providers), so this can be narrowed to one account when a bill looks odd.
 */
export interface CostReport {
  from: Date;
  to: Date;
  /** Videos released in the window — the denominator. */
  releasedVideos: number;
  byProvider: {
    provider: string;
    kind: string;
    events: number;
    quantity: number;
    agorot: number;
    /** agorot / releasedVideos, or null when nothing was delivered. */
    agorotPerVideo: number | null;
  }[];
  totalAgorot: number;
  totalAgorotPerVideo: number | null;
}

export async function costReport(
  db: Db,
  opts: { from: Date; to: Date; businessId?: string },
): Promise<CostReport> {
  const inWindow = [gte(usageEvents.createdAt, opts.from), lt(usageEvents.createdAt, opts.to)];
  if (opts.businessId) inWindow.push(eq(usageEvents.businessId, opts.businessId));

  const rows = await db
    .select({
      provider: usageEvents.provider,
      kind: usageEvents.kind,
      events: sql<string>`count(*)`,
      quantity: sql<string>`coalesce(sum(${usageEvents.quantity}), 0)`,
      agorot: sql<string>`coalesce(sum(${usageEvents.costEstimateAgorot}), 0)`,
    })
    .from(usageEvents)
    .where(and(...inWindow))
    .groupBy(usageEvents.provider, usageEvents.kind)
    .orderBy(usageEvents.provider, usageEvents.kind);

  const releasedFilter = [
    eq(videoRenders.status, "released"),
    gte(videoRenders.releasedAt, opts.from),
    lt(videoRenders.releasedAt, opts.to),
  ];
  if (opts.businessId) releasedFilter.push(eq(videoRenders.businessId, opts.businessId));

  const releasedRows = await db
    .select({ n: sql<string>`count(*)` })
    .from(videoRenders)
    .where(and(...releasedFilter));
  const releasedVideos = Number(releasedRows[0]?.n ?? 0);
  const perVideo = (agorot: number) => (releasedVideos > 0 ? agorot / releasedVideos : null);

  const byProvider = rows.map((row) => {
    const agorot = Number(row.agorot);
    return {
      provider: row.provider,
      kind: row.kind,
      events: Number(row.events),
      quantity: Number(row.quantity),
      agorot,
      agorotPerVideo: perVideo(agorot),
    };
  });
  const totalAgorot = byProvider.reduce((sum, row) => sum + row.agorot, 0);

  return {
    from: opts.from,
    to: opts.to,
    releasedVideos,
    byProvider,
    totalAgorot,
    totalAgorotPerVideo: perVideo(totalAgorot),
  };
}
