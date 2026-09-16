/**
 * The proration arithmetic for a mid-period plan change — the one place it is
 * computed, so the number the account page shows is the number changePlan
 * charges. Pure: no db, no env, no server imports. Bundled into client
 * components via the "@aiugc/core/plan-change" subpath, the same wiring as
 * "@aiugc/core/pricing".
 *
 * Founder decisions 2026-09-17 (docs/vault/decisions/0052, 0053):
 *   upgrade   immediate and prorated — the charge AND the credits use the same
 *             fraction of the period that is left.
 *   downgrade from the next renewal (scheduled, never charged here).
 *   cancel    at period end, no refund.
 *
 * "Upgrade" and "downgrade" are decided by PRICE, never by code order.
 */

export interface PlanLike {
  code: string;
  priceAgorot: number;
  monthlyCredits: number;
}

export type PlanChangeKind = "upgrade" | "downgrade" | "same";

export interface PlanChangeQuote {
  kind: PlanChangeKind;
  /** round((periodEnd − periodStart) / 1 day). */
  daysInPeriod: number;
  /** ceil((periodEnd − now) / 1 day), clamped to [0, daysInPeriod]. */
  daysRemaining: number;
  /** daysRemaining / daysInPeriod — for display; the money uses integer math. */
  fraction: number;
  /**
   * ceil(price difference × fraction). Money rounds UP. 0 unless `kind` is
   * "upgrade": a downgrade is scheduled and nothing is charged or refunded.
   */
  chargeAgorot: number;
  /**
   * floor(credit difference × fraction). Credits round DOWN. 0 unless `kind`
   * is "upgrade", for the same reason.
   */
  creditsGranted: number;
  /**
   * daysRemaining ≤ 1: too little of the period left to charge for, so an
   * upgrade is scheduled for the renewal instead of charged now.
   */
  scheduleInstead: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function quotePlanChange(input: {
  from: PlanLike;
  to: PlanLike;
  periodStart: Date;
  periodEnd: Date;
  now: Date;
}): PlanChangeQuote {
  const { from, to } = input;
  const kind: PlanChangeKind =
    to.priceAgorot > from.priceAgorot
      ? "upgrade"
      : to.priceAgorot < from.priceAgorot
        ? "downgrade"
        : "same";

  const daysInPeriod = Math.max(
    0,
    Math.round((input.periodEnd.getTime() - input.periodStart.getTime()) / DAY_MS),
  );
  const rawRemaining = Math.ceil((input.periodEnd.getTime() - input.now.getTime()) / DAY_MS);
  const daysRemaining = Math.min(daysInPeriod, Math.max(0, rawRemaining));
  const fraction = daysInPeriod === 0 ? 0 : daysRemaining / daysInPeriod;

  // Multiply before dividing: the product of two integers is exact, so an
  // evenly divisible case (15000 × 10 / 30) lands on the integer itself and
  // ceil/floor cannot be pushed over by a floating-point hair.
  const prorate = (diff: number, round: (n: number) => number): number =>
    kind === "upgrade" && daysInPeriod > 0 ? round((diff * daysRemaining) / daysInPeriod) : 0;

  return {
    kind,
    daysInPeriod,
    daysRemaining,
    fraction,
    chargeAgorot: prorate(to.priceAgorot - from.priceAgorot, Math.ceil),
    creditsGranted: prorate(to.monthlyCredits - from.monthlyCredits, Math.floor),
    scheduleInstead: daysRemaining <= 1,
  };
}
