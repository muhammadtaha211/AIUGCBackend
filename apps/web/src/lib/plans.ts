import { unstable_cache } from "next/cache";
import { asc, eq } from "drizzle-orm";
import {
  creditCostsSchema,
  getConfigValue,
  getDb,
  quoteServiceASteps,
  quoteServiceB,
  quoteServiceC,
  schema,
  type CreditCosts,
} from "@aiugc/core";
import type { PlanExamples, PlansView, PlanView } from "@/lib/plans-ui";

/**
 * Server-only. The plan view model: the active plans by price, each with its
 * per-credit rate, its discount against the cheapest plan, and the three worked
 * estimates the cards show — how many Service B ads of B_EXAMPLE_SECONDS, how
 * many hook+demo ads off one recording, and how many גוש טקסט videos a month's
 * credits buy. Every number comes from `plans` and `credit_costs` through the
 * same quote functions the wizards charge with, so a rate change moves the
 * cards without a deploy and a card can never quote a price the render would
 * not.
 *
 * This is the ONLY place a plan price, rate or count is computed (founder
 * constraint, 2026-09-17): components format what they are handed.
 *
 * The "עד N" counts are the one sanctioned count on a card — vault 0055,
 * which narrows 0051 §5's copy rule to exactly this computed form with the
 * Service B length stated beside it; 0112 added the third.
 */

/** The Service B example length, in seconds — stated on the card beside the count. */
export const B_EXAMPLE_SECONDS = 20;

export type PlanRow = {
  code: string;
  name: string;
  priceAgorot: number;
  monthlyCredits: number;
};

/** The card that pops: the middle tier (founder, 2026-09-17). */
const POPULAR_CODE = "pro";

/** Pure — the arithmetic, kept apart from the reads so a test can pin it. */
export function buildPlansView(rows: PlanRow[], costs: CreditCosts): PlansView {
  const bAd = quoteServiceB({ durationMs: B_EXAMPLE_SECONDS * 1000, costs }).credits;
  const aFirst = quoteServiceASteps({ costs, firstPaidRenderOfDemo: true }).credits;
  const aNext = quoteServiceASteps({ costs, firstPaidRenderOfDemo: false }).credits;
  const cAd = quoteServiceC({ costs }).credits;
  const examples: PlanExamples = {
    bAd,
    bSeconds: B_EXAMPLE_SECONDS,
    aFirst,
    aNext,
    cAd,
  };

  // A plan with no credits has no rate — guard the division so a bad row
  // shows 0, never "₪∞ לקרדיט" (nothing today writes such a row; a CHECK
  // constraint would be a migration, not this file's job).
  const rateOf = (row: PlanRow): number =>
    row.monthlyCredits > 0 ? row.priceAgorot / row.monthlyCredits : 0;
  const byPrice = [...rows].sort((a, b) => a.priceAgorot - b.priceAgorot);
  const cheapestRate = byPrice[0] ? rateOf(byPrice[0]) : 0;

  const plans: PlanView[] = byPrice.map((row) => {
    const rate = rateOf(row);
    const credits = row.monthlyCredits;
    return {
      code: row.code,
      name: row.name,
      priceAgorot: row.priceAgorot,
      monthlyCredits: credits,
      rateAgorotPerCredit: rate,
      discountPctVsCheapest:
        cheapestRate > 0
          ? Math.max(0, Math.round(((cheapestRate - rate) / cheapestRate) * 100))
          : 0,
      countB: bAd > 0 ? Math.floor(credits / bAd) : 0,
      // One recording: the first ad carries the analysis, every later one is
      // the render alone (vault 0048).
      countA: credits >= aFirst && aNext > 0 ? 1 + Math.floor((credits - aFirst) / aNext) : 0,
      // A flat per render (decision 0099), so a plain division.
      countC: cAd > 0 ? Math.floor(credits / cAd) : 0,
      popular: row.code === POPULAR_CODE,
    };
  });

  return { plans, examples };
}

/** Fresh read — the app page (/home/plan) uses this. */
export async function loadPlansView(): Promise<PlansView> {
  const db = getDb();
  const [rows, costs] = await Promise.all([
    db
      .select({
        code: schema.plans.code,
        name: schema.plans.name,
        priceAgorot: schema.plans.priceAgorot,
        monthlyCredits: schema.plans.monthlyCredits,
      })
      .from(schema.plans)
      .where(eq(schema.plans.active, true))
      .orderBy(asc(schema.plans.priceAgorot)),
    getConfigValue(db, "credit_costs", creditCostsSchema),
  ]);
  return buildPlansView(rows, costs);
}

/**
 * The public /pricing page's read: the same view, cached for an hour. A price
 * change reaches the marketing page within the hour and the signed-in page
 * immediately, which is the right way round.
 */
// The key part names the view's shape: bump it when PlanView or PlanExamples
// changes, so an entry cached before a deploy can never reach the new code.
export const loadPlansViewCached = unstable_cache(loadPlansView, ["plans-view", "v2"], {
  revalidate: 3600,
});
