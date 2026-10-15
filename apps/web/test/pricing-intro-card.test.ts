import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreditCosts } from "@aiugc/core/pricing";
import type { PlanRow } from "../src/lib/plans";
import {
  INTRO_CARD_CLAIM,
  INTRO_CARD_BADGE,
  INTRO_CARD_TITLE,
  INTRO_OFFER_ACTION,
  INTRO_PATH,
  POPULAR_BADGE,
  PUBLIC_SIGNED_OUT_ACTION,
} from "../src/lib/plans-ui";

/**
 * /pricing's ₪5 intro card (decision 0112): who sees it, where its button
 * goes, and what the row around it no longer carries. Core is mocked at the
 * function boundary (the switch and the account's eligibility); the offer's
 * own rules are pinned on PGlite in packages/core/test/intro.test.ts.
 */

const INTRO_PAGE = "https://pay.sumit.co.il/138f5dl/14m9m60/14m9m61/payment/";

const fixture = vi.hoisted(() => ({
  user: null as { id: string } | null,
  switchOn: vi.fn(),
  eligibility: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: fixture.user }, error: null }) },
  }),
}));

vi.mock("@aiugc/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aiugc/core")>();
  return {
    ...actual,
    getDb: () => ({}),
    introOfferEnabled: fixture.switchOn,
    introEligibility: fixture.eligibility,
  };
});

/** The 0043 rates and plans, as plans.test.ts pins them. */
const COSTS: CreditCosts = {
  a_assembly_flat: 75,
  a_demo_per_second: 3.75,
  a_outro_per_second: 25,
  a_minimum_credits: 100,
  b_per_second: 5,
  b_minimum_credits: 75,
  a_ending_reroll_per_second: 25,
  a_remix_assembly_credits: 10,
  a_steps_credits: 25,
  a_demo_analysis_credits: 20,
  c_text_block_credits: 25,
};
const PLANS: PlanRow[] = [
  { code: "starter", name: "התחלה", priceAgorot: 15000, monthlyCredits: 1000 },
  { code: "pro", name: "מתקדם", priceAgorot: 30000, monthlyCredits: 2500 },
  { code: "studio", name: "פרימיום", priceAgorot: 50000, monthlyCredits: 5000 },
];

vi.mock("@/lib/plans", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/plans")>();
  return { ...actual, loadPlansViewCached: async () => actual.buildPlansView(PLANS, COSTS) };
});

const core = await import("@aiugc/core");
const { pricingIntroOffer } = await import("../src/lib/intro");
const { default: PricingPage } = await import("../src/app/(marketing)/pricing/page");
const { PlanCards } = await import("../src/components/plans/plan-cards");
const { buildPlansView } = await import("../src/lib/plans");

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const OFFER = { priceAgorot: 500, credits: 150, days: 30 };

function setIntroPage(value: string | undefined) {
  if (value === undefined) delete process.env.SUMIT_INTRO_PAGE;
  else process.env.SUMIT_INTRO_PAGE = value;
  core.resetEnvCache();
}

async function renderPricing(): Promise<string> {
  return renderToStaticMarkup(await PricingPage());
}

/** Each <article>'s markup, in page order. */
function articles(html: string): string[] {
  return html
    .split("<article")
    .slice(1)
    .map((a) => a.split("</article>")[0] ?? "");
}

/** The intro card's own markup: the first <article> on the page. */
function introArticle(html: string): string {
  return articles(html)[0] ?? "";
}

beforeEach(() => {
  fixture.user = null;
  fixture.switchOn.mockReset().mockResolvedValue(true);
  fixture.eligibility.mockReset().mockResolvedValue("eligible");
  setIntroPage(INTRO_PAGE);
});

describe("the gate (pricingIntroOffer)", () => {
  it("a stranger sees the offer while it is switched on and its page is set", async () => {
    expect(await pricingIntroOffer(null)).toEqual(OFFER);
    fixture.switchOn.mockResolvedValue(false);
    expect(await pricingIntroOffer(null)).toBeNull();
  });

  it("no page, no offer — for anyone", async () => {
    setIntroPage(undefined);
    expect(await pricingIntroOffer(null)).toBeNull();
    expect(await pricingIntroOffer(ACCOUNT)).toBeNull();
  });

  it("a signed-in account sees it only while THAT account may buy it", async () => {
    expect(await pricingIntroOffer(ACCOUNT)).toEqual(OFFER);
    expect(fixture.eligibility).toHaveBeenCalledWith(expect.anything(), ACCOUNT);
    for (const verdict of ["already_used", "has_paid", "offer_off"]) {
      fixture.eligibility.mockResolvedValue(verdict);
      expect(await pricingIntroOffer(ACCOUNT)).toBeNull();
    }
  });

  it("a failed read hides the card, never the page", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    fixture.switchOn.mockRejectedValue(new Error("db down"));
    expect(await pricingIntroOffer(null)).toBeNull();
    fixture.eligibility.mockRejectedValue(new Error("db down"));
    expect(await pricingIntroOffer(ACCOUNT)).toBeNull();
    quiet.mockRestore();
  });
});

describe("the /pricing page", () => {
  it("a stranger: the gradient card first in the row, its pill on top, its button to plain signup", async () => {
    const html = await renderPricing();
    const card = introArticle(html);
    expect(card).toContain(INTRO_CARD_TITLE);
    // The "new customers" line is the pill over the card's top edge now (0113), not a line under the title.
    expect(card).toMatch(
      new RegExp(`<span class="absolute inset-x-0 -top-3[^"]*">${INTRO_CARD_BADGE}</span>`),
    );
    expect(card.indexOf(INTRO_CARD_BADGE)).toBeLessThan(card.indexOf(INTRO_CARD_TITLE));
    expect(card.split(INTRO_CARD_BADGE).length - 1).toBe(1);
    expect(card).toContain("₪5");
    expect(card).toContain("150 קרדיטים, בתוקף 30 יום");
    expect(card).toContain(INTRO_CARD_CLAIM);
    expect(card).toContain('href="/start"');
    expect(card).toContain(PUBLIC_SIGNED_OUT_ACTION);
    // The article itself carries the brand gradient (lime to emerald): its own opening tag,
    // not the button inside it.
    expect(card.split(">")[0]).toContain("bg-gradient-to-br from-accent to-emerald-300");
    // A one-time purchase: nothing on it says monthly, renews, free, or a count of videos.
    expect(card).not.toMatch(/לחודש|בחודש|מתחדש|חינם|סרטונים|לפחות/);
    expect(card).not.toContain(POPULAR_BADGE);
    // Four cards in the row, the popular pill still on pro.
    expect(html.split("<article").length - 1).toBe(4);
    const withPill = articles(html).filter((a) => a.includes(POPULAR_BADGE));
    expect(withPill.map((a) => a.includes("מתקדם"))).toEqual([true]);
  });

  it("an eligible account: the card's button goes to the offer's own page", async () => {
    fixture.user = { id: ACCOUNT };
    const card = introArticle(await renderPricing());
    expect(card).toContain(INTRO_CARD_TITLE);
    expect(card).toContain(`href="${INTRO_PATH}"`);
    expect(card).toContain(INTRO_OFFER_ACTION);
  });

  it("an account that cannot buy it sees no card, even with the offer live", async () => {
    fixture.user = { id: ACCOUNT };
    fixture.eligibility.mockResolvedValue("has_paid");
    const html = await renderPricing();
    expect(html).not.toContain(INTRO_CARD_TITLE);
    expect(html.split("<article").length - 1).toBe(3);
  });

  it("the switch off: no card, and no line in its place", async () => {
    fixture.switchOn.mockResolvedValue(false);
    const html = await renderPricing();
    expect(html).not.toContain(INTRO_CARD_TITLE);
    expect(html).not.toContain("היכרות");
    // "₪500" is studio's price; the offer's amount is "₪5" with nothing after it.
    expect(html).not.toMatch(/₪5(?![\d.,])/);
  });
});

describe("the plan cards", () => {
  const view = buildPlansView(PLANS, COSTS);

  it("each card names all three services in one estimate, with no credit key and no VAT footnote", () => {
    for (const mode of ["public-signed-out", "app"] as const) {
      const html = renderToStaticMarkup(createElement(PlanCards, { view, mode }));
      expect(html).toContain("סרטוני גוש טקסט");
      expect(html).toContain("לדוגמה: בערך 10 סרטונים");
      expect(html).toContain("או 40 מודעות הוק + דמו");
      expect(html).toContain("או 40 סרטוני גוש טקסט");
      expect(html).not.toContain("עד ");
      expect(html).not.toContain("קרדיטים ל־20 שנ׳");
      expect(html).not.toContain("ניתוח ההקלטה");
      expect(html).not.toContain("עוסק פטור");
      expect(html).not.toContain("מע״מ");
    }
  });

  it("without the offer the row is the three plans, as before", () => {
    const html = renderToStaticMarkup(
      createElement(PlanCards, { view, mode: "public-signed-out" }),
    );
    expect(html).not.toContain(INTRO_CARD_TITLE);
    expect(html).toContain("md:grid-cols-3");
  });

  it("/home/plan (app mode): the same card first in the row, its button to the offer's page", () => {
    const html = renderToStaticMarkup(
      createElement(PlanCards, {
        view,
        mode: "app",
        intro: { offer: OFFER, action: { href: INTRO_PATH, label: INTRO_OFFER_ACTION } },
      }),
    );
    const card = introArticle(html);
    expect(card).toContain(INTRO_CARD_TITLE);
    expect(card).toContain(INTRO_CARD_BADGE);
    expect(card).toContain(`href="${INTRO_PATH}"`);
    expect(html.split("<article").length - 1).toBe(4);
    // One row of four from lg (0114), every card a size down so four fit the pane.
    expect(html).toContain("lg:grid-cols-4");
    expect(card.split(">")[0]).toContain(" p-4 ");
    expect(card).toContain("font-display text-3xl");
    const planCard = articles(html)[1] ?? "";
    expect(planCard.split(">")[0]).toContain(" p-4 ");
    expect(planCard).toContain("font-display text-3xl");
    expect(planCard).not.toContain("text-5xl");
    // Without the offer the app row is the three plans, as before.
    const plain = renderToStaticMarkup(createElement(PlanCards, { view, mode: "app" }));
    expect(plain).not.toContain(INTRO_CARD_TITLE);
    expect(plain).toContain("lg:grid-cols-3");
    // Without the intro card nothing is shrunk.
    expect(plain).toContain("text-5xl");
  });

  it("/home/plan hands the card the offer the account may buy, and no longer draws the old box", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/app/home/plan/plan-manager.tsx", import.meta.url)),
      "utf8",
    );
    expect(source).toContain("const offer = !live && !paymentInFlight ? sub.intro : null;");
    expect(source).toContain("intro={offer && { offer, action: introCardAction(true) }}");
    expect(source).not.toMatch(/introOfferTitle|introOfferLine|INTRO_NEVER_CHARGES_LINE/);
  });
});
