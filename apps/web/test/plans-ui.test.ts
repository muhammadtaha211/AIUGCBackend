import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PlanChangeQuote } from "@aiugc/core/plan-change";
import {
  BANNER_PAST_DUE,
  BANNER_SUSPENDED,
  cancelDialogBody,
  CHECKOUT_FAILED_LINE,
  CHECKOUT_STATES,
  CHECKOUT_UNCONFIRMED_LINE,
  CURRENT_PLAN_BADGE,
  downgradeDialogBody,
  formatDate,
  formatShekels,
  parseCheckoutParam,
  pendingKind,
  periodLine,
  planCardStates,
  rateLine,
  type SubscriptionView,
  upgradeDialogBody,
} from "@/lib/plans-ui";

/**
 * The account page's button matrix and dialog copy (founder, 2026-09-17),
 * pinned as pure functions: the page maps an intent to a dialog, nothing
 * more. Higher/lower comes off the quote's `kind`, the same call /change
 * charges through, so the card and the charge cannot disagree.
 */

const LADDER = [
  { code: "starter", name: "התחלה", priceAgorot: 15000, monthlyCredits: 1000 },
  { code: "pro", name: "מתקדם", priceAgorot: 30000, monthlyCredits: 2500 },
  { code: "studio", name: "פרימיום", priceAgorot: 50000, monthlyCredits: 5000 },
];

/** quotePlanChange for a pro subscription 10 days into a 30-day period. */
function quote(
  kind: PlanChangeQuote["kind"],
  extra: Partial<PlanChangeQuote> = {},
): PlanChangeQuote {
  const upgrade = kind === "upgrade";
  return {
    kind,
    daysInPeriod: 30,
    daysRemaining: 20,
    fraction: 20 / 30,
    chargeAgorot: upgrade ? 13334 : 0,
    creditsGranted: upgrade ? 1666 : 0,
    scheduleInstead: false,
    ...extra,
  };
}

const PERIOD_START = "2026-09-07T10:00:00.000Z";
const PERIOD_END = "2026-10-07T10:00:00.000Z";

function onPro(
  over: Partial<NonNullable<SubscriptionView["subscription"]>> = {},
): SubscriptionView {
  return {
    subscription: {
      planCode: "pro",
      status: "active",
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      cancelAtPeriodEnd: false,
      scheduledPlanCode: null,
      ...over,
    },
    plans: LADDER,
    currentPlan: LADDER[1]!,
    balance: 2500,
    manualOutstanding: 0,
    quotes: { starter: quote("downgrade"), studio: quote("upgrade") },
  };
}

describe("formatting", () => {
  it("whole shekels carry no decimals, fractions carry exactly two", () => {
    expect(formatShekels(15000)).toBe("₪150");
    expect(formatShekels(150000)).toBe("₪1,500");
    expect(formatShekels(15)).toBe("₪0.15");
    expect(formatShekels(10)).toBe("₪0.10");
    expect(formatShekels(13334)).toBe("₪133.34");
  });

  it("the rate line", () => {
    expect(rateLine(12)).toBe("₪0.12 לקרדיט");
  });

  it("dates are Israel's calendar day, whatever the viewer's zone", () => {
    // 23:30 UTC is already the next day in Jerusalem.
    expect(formatDate("2026-10-06T23:30:00.000Z")).toBe("7.10.2026");
    expect(formatDate(PERIOD_END)).toBe("7.10.2026");
  });
});

describe("planCardStates — the button matrix", () => {
  it("no live subscription: every card is a checkout", () => {
    const { banner, cards } = planCardStates(
      {
        subscription: null,
        plans: LADDER,
        currentPlan: null,
        balance: 0,
        manualOutstanding: 0,
        quotes: {},
      },
      LADDER,
    );
    expect(banner).toBeNull();
    expect(Object.values(cards).map((c) => c.intent)).toEqual(["checkout", "checkout", "checkout"]);
    expect(Object.values(cards).every((c) => !c.disabled && !c.current)).toBe(true);
  });

  it("active, nothing pending: cancel on the current card, downgrade below, upgrade above", () => {
    const { banner, cards } = planCardStates(onPro(), LADDER);
    expect(banner).toBeNull();
    expect(cards.pro).toMatchObject({
      intent: "cancel",
      current: true,
      badge: CURRENT_PLAN_BADGE,
      tone: "danger",
    });
    expect(cards.starter).toMatchObject({ intent: "downgrade", sub: "מהחיוב הבא" });
    expect(cards.studio).toMatchObject({ intent: "upgrade", sub: "מיידי" });
  });

  it("a last-day upgrade says 'from the next charge', not 'immediate'", () => {
    const view = onPro();
    view.quotes.studio = quote("upgrade", { scheduleInstead: true, daysRemaining: 1 });
    expect(planCardStates(view, LADDER).cards.studio).toMatchObject({
      intent: "upgrade",
      sub: "מהחיוב הבא",
    });
  });

  it("pending stop: the current card offers resume and names the end date", () => {
    const { cards } = planCardStates(onPro({ cancelAtPeriodEnd: true }), LADDER);
    expect(cards.pro).toMatchObject({
      intent: "resume",
      badge: "המנוי מסתיים ב־7.10.2026",
      current: true,
    });
    expect(cards.starter!.intent).toBe("downgrade");
    expect(cards.studio!.intent).toBe("upgrade");
  });

  it("pending change: the target card offers undo, the rest as usual", () => {
    const { cards } = planCardStates(onPro({ scheduledPlanCode: "starter" }), LADDER);
    expect(cards.starter).toMatchObject({
      intent: "undo",
      badge: "מהחיוב הבא · 7.10.2026",
      current: false,
    });
    expect(cards.pro!.intent).toBe("cancel");
    expect(cards.studio!.intent).toBe("upgrade");
  });

  it("past_due: the banner, and only cancel is enabled", () => {
    const { banner, cards } = planCardStates(onPro({ status: "past_due" }), LADDER);
    expect(banner).toBe(BANNER_PAST_DUE);
    expect(cards.pro).toMatchObject({ intent: "cancel", disabled: false });
    expect(cards.starter!.disabled).toBe(true);
    expect(cards.studio!.disabled).toBe(true);
  });

  it("suspended: the banner, and every card renews", () => {
    const { banner, cards } = planCardStates(onPro({ status: "suspended" }), LADDER);
    expect(banner).toBe(BANNER_SUSPENDED);
    expect(Object.values(cards).map((c) => c.intent)).toEqual(["renew", "renew", "renew"]);
    expect(cards.pro!.current).toBe(true);
  });

  it("higher/lower is read off the quote, never off code order", () => {
    // A ladder whose codes sort the other way round from its prices.
    const view = onPro();
    view.quotes = { starter: quote("upgrade"), studio: quote("downgrade") };
    const { cards } = planCardStates(view, LADDER);
    expect(cards.starter!.intent).toBe("upgrade");
    expect(cards.studio!.intent).toBe("downgrade");
  });

  it("pendingKind reads the row", () => {
    expect(pendingKind(null)).toBe("none");
    expect(pendingKind(onPro().subscription)).toBe("none");
    expect(pendingKind(onPro({ cancelAtPeriodEnd: true }).subscription)).toBe("cancel");
    expect(pendingKind(onPro({ scheduledPlanCode: "starter" }).subscription)).toBe("change");
  });
});

describe("dialog copy", () => {
  it("upgrade: the prorated charge and credits, then the full price from the next charge", () => {
    const { lines, button } = upgradeDialogBody({
      plan: LADDER[2]!,
      quote: quote("upgrade"),
      periodEnd: PERIOD_END,
      pending: "none",
    });
    expect(lines).toEqual([
      "השדרוג נכנס לתוקף מיד. נותרו 20 ימים מתוך 30 בתקופת החיוב הנוכחית, ולכן תחויבו עכשיו ב־₪133.34 בלבד — החלק היחסי מההפרש בין המסלולים — ותקבלו מיד 1,666 קרדיטים נוספים.",
      "מהחיוב הבא, ב־7.10.2026, תחויבו במחיר המלא: ₪500 לחודש עם 5,000 קרדיטים.",
    ]);
    expect(button).toBe("אישור ותשלום ₪133.34");
  });

  it("upgrade on the last day: scheduled, no charge now, plain 'אישור'", () => {
    const { lines, button } = upgradeDialogBody({
      plan: LADDER[2]!,
      quote: quote("upgrade", { scheduleInstead: true, daysRemaining: 1, chargeAgorot: 667 }),
      periodEnd: PERIOD_END,
      pending: "cancel",
    });
    expect(lines[0]).toContain("נותר פחות מיום בתקופה הנוכחית");
    expect(lines[0]).toContain("בלי חיוב עכשיו");
    expect(lines.at(-1)).toBe("השדרוג מבטל את ההפסקה שתוכננה, והמנוי ימשיך להתחדש.");
    expect(button).toBe("אישור");
  });

  it("downgrade: from the next charge, the current plan until then, and the pending line", () => {
    const { lines, button } = downgradeDialogBody({
      plan: LADDER[0]!,
      currentName: "מתקדם",
      periodEnd: PERIOD_END,
      pending: "change",
    });
    expect(lines).toEqual([
      "המעבר ייכנס לתוקף בחיוב הבא, ב־7.10.2026. עד אז אתם נשארים במסלול מתקדם עם כל הקרדיטים שלו.",
      "מ־7.10.2026 תחויבו ב־₪150 לחודש ותקבלו 1,000 קרדיטים. אפשר לבטל את המעבר בכל רגע לפני כן.",
      "המעבר מחליף את המעבר שתוכנן.",
    ]);
    expect(button).toBe("אישור המעבר");
  });

  it("cancel: active to period end, no refund, credits expire then, undo any time before", () => {
    expect(
      cancelDialogBody({ periodEnd: PERIOD_END, balance: 1800, manualOutstanding: 0 }),
    ).toEqual([
      "המנוי יישאר פעיל עד סוף תקופת החיוב הנוכחית, 7.10.2026, ולא יחודש. לא יינתן החזר על התקופה הנוכחית.",
      "1,800 הקרדיטים שבחשבון זמינים לשימוש עד 7.10.2026, ואז פוקעים.",
      "אפשר לחזור בכם מהביטול בכל רגע לפני 7.10.2026.",
    ]);
  });

  it("cancel with manual credits: only the subscription's part expires, the manual part is named", () => {
    const lines = cancelDialogBody({
      periodEnd: PERIOD_END,
      balance: 1800,
      manualOutstanding: 300,
    });
    expect(lines[1]).toBe("1,500 קרדיטים של המנוי שבחשבון זמינים לשימוש עד 7.10.2026, ואז פוקעים.");
    expect(lines[2]).toBe("300 קרדיטים שנטענו ידנית אינם פוקעים ונשארים בחשבון.");
  });

  it("cancel with nothing to expire skips the expiry sentence", () => {
    const lines = cancelDialogBody({ periodEnd: PERIOD_END, balance: 200, manualOutstanding: 300 });
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("300 קרדיטים שנטענו ידנית אינם פוקעים ונשארים בחשבון.");
  });

  it("cancel in past_due: no dated promises — the period end is already behind the customer", () => {
    // The renewal pass cancels the row on its next run and expires the
    // period credits then; there is no end date to wait for and no undo
    // window (resume is disabled in past_due).
    const lines = cancelDialogBody({
      periodEnd: PERIOD_END,
      balance: 1800,
      manualOutstanding: 300,
      status: "past_due",
    });
    expect(lines).toEqual([
      "המנוי יבוטל ולא יחודש. הביטול נכנס לתוקף בסבב החיוב הבא, בתוך יום, ולא יינתן החזר.",
      "1,500 קרדיטים של המנוי שבחשבון פוקעים עם הביטול.",
      "300 קרדיטים שנטענו ידנית אינם פוקעים ונשארים בחשבון.",
    ]);
    expect(lines.join(" ")).not.toContain("7.10.2026");
  });
});

describe("periodLine — one sentence for the settings row and the plan page", () => {
  it("active: the next charge; pending stop and pending change name their date", () => {
    expect(periodLine(onPro().subscription!, null)).toBe("החיוב הבא: 7.10.2026");
    expect(periodLine(onPro({ cancelAtPeriodEnd: true }).subscription!, null)).toBe(
      "המנוי מסתיים ב־7.10.2026 ולא יחודש.",
    );
    expect(periodLine(onPro({ scheduledPlanCode: "starter" }).subscription!, "התחלה")).toBe(
      "מעבר למסלול התחלה מהחיוב הבא, ב־7.10.2026.",
    );
  });

  it("past_due and suspended never promise a next charge on a date that has passed", () => {
    expect(periodLine(onPro({ status: "past_due" }).subscription!, null)).toBe(
      "החיוב של 7.10.2026 נכשל. ננסה לחייב שוב בימים הקרובים.",
    );
    // The status wins over a pending change: the failed charge is the news.
    expect(
      periodLine(
        onPro({ status: "suspended", scheduledPlanCode: "starter" }).subscription!,
        "התחלה",
      ),
    ).toBe("המנוי הושעה אחרי שהחיוב של 7.10.2026 לא הוסדר.");
  });
});

describe("the ?checkout= landing the return route sends the browser to", () => {
  it("the plan page accepts every value the route lands on, and nothing else", () => {
    // Spelled out, not derived: the loops below iterate the same array they
    // test, so this is what pins it against the route's four landing constants.
    expect([...CHECKOUT_STATES]).toEqual(["success", "refused", "failed", "unconfirmed"]);
    for (const state of CHECKOUT_STATES) expect(parseCheckoutParam(state)).toBe(state);
    expect(parseCheckoutParam(undefined)).toBeNull();
    expect(parseCheckoutParam("")).toBeNull();
    expect(parseCheckoutParam("Success")).toBeNull();
    expect(parseCheckoutParam("javascript:alert(1)")).toBeNull();
  });

  it("the unconfirmed line says paid, being confirmed, do not pay again — and never invites a retry", () => {
    expect(CHECKOUT_UNCONFIRMED_LINE).toContain("\u05e0\u05e7\u05dc\u05d8");
    expect(CHECKOUT_UNCONFIRMED_LINE).toContain("\u05de\u05d0\u05de\u05ea\u05d9\u05dd");
    expect(CHECKOUT_UNCONFIRMED_LINE).toContain(
      "\u05d0\u05d9\u05df \u05e6\u05d5\u05e8\u05da \u05dc\u05e9\u05dc\u05dd \u05e9\u05d5\u05d1",
    );
    expect(CHECKOUT_UNCONFIRMED_LINE).toContain("\u05db\u05ea\u05d1\u05d5 \u05dc\u05e0\u05d5");
    // The retry invitation belongs to ?checkout=failed alone.
    expect(CHECKOUT_FAILED_LINE).toContain("\u05dc\u05e0\u05e1\u05d5\u05ea \u05e9\u05d5\u05d1");
    expect(CHECKOUT_UNCONFIRMED_LINE).not.toContain(
      "\u05dc\u05e0\u05e1\u05d5\u05ea \u05e9\u05d5\u05d1",
    );
    // No time promise: nothing retries on its own yet.
    expect(CHECKOUT_UNCONFIRMED_LINE).not.toMatch(/\d/);
  });

  /**
   * There is no jsdom or @testing-library in this repo (apps/web/vitest.config.ts
   * sets no environment, and adding one is new infrastructure), and PlanManager is
   * a client component whose useEffect never runs under renderToStaticMarkup. So
   * the banner block is pinned by reading the source, the way auth-user.test.ts
   * pins its 503 markers. What it protects is real: the four states are four
   * independent `&&` guards with no exhaustiveness check, so a state with no
   * branch renders the page with no banner at all — the customer is simply not
   * told — and nothing in the type system says so.
   */
  it("every landing the route can send has a branch on the plan page, and the new one renders its own line", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/app/home/plan/plan-manager.tsx", import.meta.url)),
      "utf8",
    );
    for (const state of CHECKOUT_STATES) {
      expect(source, `no branch renders ?checkout=${state}`).toContain(`checkout === "${state}"`);
    }
    const banner = source.split(`{checkout === "unconfirmed" && (`)[1]?.split("</p>")[0] ?? "";
    expect(banner).toContain("CHECKOUT_UNCONFIRMED_LINE");
    // The same contact page the refused banner offers — not a new channel.
    expect(banner).toContain(`href="/contact"`);
    expect(banner).toContain("CHECKOUT_REFUSED_CONTACT");
  });
});
