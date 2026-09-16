import { describe, expect, it } from "vitest";
import { quotePlanChange, type PlanLike } from "../src/plan-change";

/**
 * The proration arithmetic, pinned at its boundaries. Plans here are
 * DELIBERATELY not the live ones — the point is the rounding and the
 * clamping, and a test that hard-codes ₪150/1000cr would break on the next
 * re-pricing without saying anything about the arithmetic.
 */

const low: PlanLike = { code: "low", priceAgorot: 10_000, monthlyCredits: 1_000 };
const high: PlanLike = { code: "high", priceAgorot: 25_000, monthlyCredits: 2_500 };

const DAY = 24 * 60 * 60 * 1000;
const start = new Date("2026-09-01T00:00:00Z");
const end = new Date(start.getTime() + 30 * DAY);

function at(daysAfterStart: number, extraMs = 0) {
  return new Date(start.getTime() + daysAfterStart * DAY + extraMs);
}

describe("quotePlanChange", () => {
  it("at period start the whole difference is charged and granted (fraction 1)", () => {
    const q = quotePlanChange({
      from: low,
      to: high,
      periodStart: start,
      periodEnd: end,
      now: at(0),
    });
    expect(q).toMatchObject({
      kind: "upgrade",
      daysInPeriod: 30,
      daysRemaining: 30,
      fraction: 1,
      chargeAgorot: 15_000,
      creditsGranted: 1_500,
      scheduleInstead: false,
    });
  });

  it("mid-period charges and grants the same fraction, money up and credits down", () => {
    // 20 days in: 10 of 30 left. 15000 × 10/30 = 5000 exactly; 1500 × 10/30 = 500.
    expect(
      quotePlanChange({ from: low, to: high, periodStart: start, periodEnd: end, now: at(20) }),
    ).toMatchObject({ daysRemaining: 10, chargeAgorot: 5_000, creditsGranted: 500 });

    // 23 days in: 7 of 30 left. 15000 × 7/30 = 3500; 1500 × 7/30 = 350. Both exact.
    // Use a plan pair that does NOT divide: 10001 × 7/30 = 2333.56… → ceil 2334;
    // 1001 × 7/30 = 233.56… → floor 233.
    const odd: PlanLike = { code: "odd", priceAgorot: 20_001, monthlyCredits: 2_001 };
    const q = quotePlanChange({
      from: low,
      to: odd,
      periodStart: start,
      periodEnd: end,
      now: at(23),
    });
    expect(q.daysRemaining).toBe(7);
    expect(q.chargeAgorot).toBe(2_334);
    expect(q.creditsGranted).toBe(233);
    // The two directions are the rule, not an accident of these numbers.
    expect(q.chargeAgorot).toBe(Math.ceil((10_001 * 7) / 30));
    expect(q.creditsGranted).toBe(Math.floor((1_001 * 7) / 30));
  });

  it("a partial day counts as a whole day remaining (ceil), so it is never under-charged", () => {
    // 20 days and 1 ms in: 9.99… days left → 10.
    const q = quotePlanChange({
      from: low,
      to: high,
      periodStart: start,
      periodEnd: end,
      now: at(20, 1),
    });
    expect(q.daysRemaining).toBe(10);
    // 20 days less 1 ms in: 10.00…01 days left → 11.
    const q2 = quotePlanChange({
      from: low,
      to: high,
      periodStart: start,
      periodEnd: end,
      now: at(20, -1),
    });
    expect(q2.daysRemaining).toBe(11);
  });

  it("the last day is scheduled, not charged; day 0 likewise", () => {
    const lastDay = quotePlanChange({
      from: low,
      to: high,
      periodStart: start,
      periodEnd: end,
      now: at(29, 1),
    });
    expect(lastDay.daysRemaining).toBe(1);
    expect(lastDay.scheduleInstead).toBe(true);
    // Still quoted — the UI can say what the renewal will look like.
    expect(lastDay.chargeAgorot).toBe(500);
    expect(lastDay.creditsGranted).toBe(50);

    const atEnd = quotePlanChange({
      from: low,
      to: high,
      periodStart: start,
      periodEnd: end,
      now: end,
    });
    expect(atEnd).toMatchObject({
      daysRemaining: 0,
      fraction: 0,
      chargeAgorot: 0,
      creditsGranted: 0,
      scheduleInstead: true,
    });

    // Two days left is the first day an upgrade charges.
    const twoDays = quotePlanChange({
      from: low,
      to: high,
      periodStart: start,
      periodEnd: end,
      now: at(28),
    });
    expect(twoDays.daysRemaining).toBe(2);
    expect(twoDays.scheduleInstead).toBe(false);
  });

  it("clamps: a `now` past the end is 0 days, a `now` before the start is the whole period", () => {
    const past = quotePlanChange({
      from: low,
      to: high,
      periodStart: start,
      periodEnd: end,
      now: at(45),
    });
    expect(past.daysRemaining).toBe(0);
    const early = quotePlanChange({
      from: low,
      to: high,
      periodStart: start,
      periodEnd: end,
      now: at(-5),
    });
    expect(early.daysRemaining).toBe(30);
    expect(early.fraction).toBe(1);
  });

  it("a downgrade is by price, carries no charge and no credits, and is never 'scheduleInstead' by itself", () => {
    const q = quotePlanChange({
      from: high,
      to: low,
      periodStart: start,
      periodEnd: end,
      now: at(10),
    });
    expect(q.kind).toBe("downgrade");
    expect(q.chargeAgorot).toBe(0);
    expect(q.creditsGranted).toBe(0);
    expect(q.daysRemaining).toBe(20);
    expect(q.scheduleInstead).toBe(false);
  });

  it("orders by price, not by code", () => {
    // 'a' sorts before 'z' alphabetically but costs more: that is an upgrade.
    const a: PlanLike = { code: "a", priceAgorot: 50_000, monthlyCredits: 5_000 };
    const z: PlanLike = { code: "z", priceAgorot: 20_000, monthlyCredits: 2_000 };
    expect(
      quotePlanChange({ from: z, to: a, periodStart: start, periodEnd: end, now: at(0) }).kind,
    ).toBe("upgrade");
    expect(
      quotePlanChange({ from: a, to: z, periodStart: start, periodEnd: end, now: at(0) }).kind,
    ).toBe("downgrade");
    expect(
      quotePlanChange({
        from: a,
        to: { ...a, code: "same-price" },
        periodStart: start,
        periodEnd: end,
        now: at(0),
      }).kind,
    ).toBe("same");
  });

  it("a month-length period counts its real days (31 in a 31-day month)", () => {
    const s = new Date("2026-01-01T00:00:00Z");
    const e = new Date("2026-02-01T00:00:00Z");
    const q = quotePlanChange({ from: low, to: high, periodStart: s, periodEnd: e, now: s });
    expect(q.daysInPeriod).toBe(31);
    expect(q.daysRemaining).toBe(31);
  });
});
