import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALREADY_SUBSCRIBED, INVALID_BODY, PAYMENTS_SOON } from "../src/lib/api-errors";
import {
  ATTEMPT_PENDING_LINE,
  CONTINUE_CONVERTED,
  CONTINUE_DECLINED_LINE,
  CONTINUE_NO_TRIAL,
  INTRO_ALREADY_USED,
  INTRO_HAS_PAID,
  INTRO_OFF,
} from "../src/lib/plans-ui";

/**
 * The ₪5 intro offer's routes (decision 0109): the intent route and the
 * continue route, the offer's fields on the subscription read, and the
 * checkout's refusal while a continue is being confirmed. Core is mocked at
 * the function boundary — the trial, its expiry and the continue are pinned on
 * PGlite in packages/core/test/intro.test.ts; these cases pin the HTTP layer.
 */

const INTRO_PAGE = "https://pay.sumit.co.il/138f5dl/14m9m60/14m9m61/payment/";

const fixture = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111", email: "dana@business.co.il" } as {
    id: string;
    email: string;
  } | null,
  getAccountBilling: vi.fn(),
  getAccountIntro: vi.fn(),
  createIntroIntent: vi.fn(),
  createCheckoutIntent: vi.fn(),
  continueFromTrial: vi.fn(),
  accountContact: vi.fn(),
  termsVersion: "14.10.2026",
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: fixture.user }, error: null }) },
  }),
}));
vi.mock("@/app/(legal)/legal", () => ({ UPDATED: fixture.termsVersion }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

vi.mock("@aiugc/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aiugc/core")>();
  return {
    ...actual,
    getDb: () => ({}),
    getBillingGateway: () => ({ name: "test", chargeRecurring: vi.fn() }),
    getAccountBilling: fixture.getAccountBilling,
    getAccountIntro: fixture.getAccountIntro,
    createIntroIntent: fixture.createIntroIntent,
    createCheckoutIntent: fixture.createCheckoutIntent,
    continueFromTrial: fixture.continueFromTrial,
    accountContact: fixture.accountContact,
  };
});

const core = await import("@aiugc/core");
const { POST: intro } = await import("../src/app/api/account/intro/route");
const { POST: continueRoute } = await import("../src/app/api/account/intro/continue/route");
const { GET: getSubscription } = await import("../src/app/api/account/subscription/route");
const { POST: checkout } = await import("../src/app/api/account/checkout/route");

const signedIn = { id: "11111111-1111-4111-8111-111111111111", email: "dana@business.co.il" };

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  fixture.user = signedIn;
  for (const fn of [
    fixture.getAccountBilling,
    fixture.getAccountIntro,
    fixture.createIntroIntent,
    fixture.createCheckoutIntent,
    fixture.continueFromTrial,
    fixture.accountContact,
  ]) {
    fn.mockReset();
  }
  fixture.accountContact.mockResolvedValue({
    email: "dana@business.co.il",
    businesses: [{ id: "b1", name: "הקפה של דנה" }],
  });
  delete process.env.SUMIT_INTRO_PAGE;
  delete process.env.SUMIT_CHECKOUT_PAGES;
  core.resetEnvCache();
});

function withIntroPage(value = INTRO_PAGE) {
  process.env.SUMIT_INTRO_PAGE = value;
  core.resetEnvCache();
}

describe("POST /api/account/intro", () => {
  it("401 signed out, nothing written", async () => {
    fixture.user = null;
    const response = await intro(post("/api/account/intro", { acceptedTerms: true }));
    expect(response.status).toBe(401);
    expect(fixture.createIntroIntent).not.toHaveBeenCalled();
  });

  it("400 without the ticked checkbox, before anything else", async () => {
    withIntroPage();
    for (const body of [{}, { acceptedTerms: false }, null]) {
      const response = await intro(post("/api/account/intro", body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ ok: false, error: INVALID_BODY });
    }
    expect(fixture.createIntroIntent).not.toHaveBeenCalled();
  });

  it("503 when the offer's page is unset or not https — nothing written", async () => {
    let response = await intro(post("/api/account/intro", { acceptedTerms: true }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: PAYMENTS_SOON });
    withIntroPage("http://pay.sumit.co.il/x/payment/");
    response = await intro(post("/api/account/intro", { acceptedTerms: true }));
    expect(response.status).toBe(503);
    expect(fixture.createIntroIntent).not.toHaveBeenCalled();
  });

  it("200: the intent for the session account, the terms version and address recorded, the page URL carrying the intent", async () => {
    withIntroPage();
    fixture.createIntroIntent.mockResolvedValue({
      intent: { id: "22222222-2222-4222-8222-222222222222" },
      reused: false,
    });
    const response = await intro(
      post(
        "/api/account/intro",
        { planCode: "intro", acceptedTerms: true },
        { "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "vitest" },
      ),
    );
    expect(response.status).toBe(200);
    expect(fixture.createIntroIntent).toHaveBeenCalledWith(expect.anything(), {
      userId: signedIn.id,
      termsVersion: "14.10.2026",
      ip: "203.0.113.7",
      userAgent: "vitest",
    });
    const { redirectUrl } = (await response.json()) as { redirectUrl: string };
    const url = new URL(redirectUrl);
    expect(url.origin + url.pathname).toBe(INTRO_PAGE);
    expect(url.searchParams.get("externalidentifier")).toBe("22222222-2222-4222-8222-222222222222");
    expect(url.searchParams.get("customerexternalidentifier")).toBe(signedIn.id);
    expect(url.searchParams.get("emailaddress")).toBe("dana@business.co.il");
    // Never a price on the URL: the Sumit product is fixed-price.
    expect(redirectUrl).not.toMatch(/price|amount/i);
  });

  it("409 with the offer's own line for each refusal core raises before writing", async () => {
    withIntroPage();
    const cases = [
      ["already_used", INTRO_ALREADY_USED],
      ["has_paid", INTRO_HAS_PAID],
      ["offer_off", INTRO_OFF],
    ] as const;
    for (const [code, line] of cases) {
      fixture.createIntroIntent.mockRejectedValueOnce(new core.IntroOfferError(code));
      const response = await intro(post("/api/account/intro", { acceptedTerms: true }));
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ ok: false, error: line });
    }
  });
});

describe("POST /api/account/intro/continue", () => {
  const body = { planCode: "starter", acceptedTerms: true };

  it("400 without the ticked checkbox or a plan, before core", async () => {
    for (const bad of [{ planCode: "starter" }, { acceptedTerms: true }, null]) {
      const response = await continueRoute(post("/api/account/intro/continue", bad));
      expect(response.status).toBe(400);
    }
    expect(fixture.continueFromTrial).not.toHaveBeenCalled();
  });

  it("activated and pending are both 200, told apart by the body — never by the status", async () => {
    fixture.continueFromTrial.mockResolvedValueOnce({
      outcome: "activated",
      subscriptionId: "s1",
      planCode: "starter",
    });
    let response = await continueRoute(
      post("/api/account/intro/continue", body, { "x-forwarded-for": "203.0.113.7" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "activated", planCode: "starter" });
    expect(fixture.continueFromTrial).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      userId: signedIn.id,
      planCode: "starter",
      termsVersion: "14.10.2026",
      ip: "203.0.113.7",
      userAgent: null,
    });

    fixture.continueFromTrial.mockResolvedValueOnce({ outcome: "pending" });
    response = await continueRoute(post("/api/account/intro/continue", body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "pending" });
  });

  it("402 on a decline (the page offers the hosted checkout); an orphaned charge is its own 200 body", async () => {
    fixture.continueFromTrial.mockResolvedValueOnce({ outcome: "declined", error: "(קוד 003)" });
    let response = await continueRoute(post("/api/account/intro/continue", body));
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ ok: false, error: CONTINUE_DECLINED_LINE });

    // Charged on an account that joined a plan meanwhile: a body the page locks on, not an error.
    fixture.continueFromTrial.mockResolvedValueOnce({ outcome: "orphaned", paymentId: "1" });
    response = await continueRoute(post("/api/account/intro/continue", body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "orphaned" });
  });

  it("each refusal before a charge has its line; no gateway is the 503", async () => {
    const cases = [
      ["no_trial", 409, CONTINUE_NO_TRIAL],
      ["converted", 409, CONTINUE_CONVERTED],
      ["attempt_pending", 409, ATTEMPT_PENDING_LINE],
      ["already_subscribed", 409, ALREADY_SUBSCRIBED],
      ["unknown_plan", 400, INVALID_BODY],
    ] as const;
    for (const [code, status, line] of cases) {
      fixture.continueFromTrial.mockRejectedValueOnce(new core.IntroOfferError(code));
      const response = await continueRoute(post("/api/account/intro/continue", body));
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ ok: false, error: line });
    }
    fixture.continueFromTrial.mockRejectedValueOnce(
      new Error("no payment gateway configured — see docs/05-billing.md"),
    );
    const response = await continueRoute(post("/api/account/intro/continue", body));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: PAYMENTS_SOON });
  });
});

describe("the offer on the subscription read", () => {
  const billing = {
    subscription: null,
    plans: [],
    currentPlan: null,
    balance: 105,
    manualOutstanding: 0,
    quotes: {},
  };

  it("the trial in ISO dates; the offer only for an eligible account AND a configured page", async () => {
    fixture.getAccountBilling.mockResolvedValue(billing);
    fixture.getAccountIntro.mockResolvedValue({
      trial: {
        credits: 150,
        creditsLeft: 105,
        ended: false,
        startedAt: new Date("2026-10-14T10:00:00Z"),
        expiresAt: new Date("2026-11-13T10:00:00Z"),
        expiredAt: null,
        convertedAt: null,
        attemptPending: false,
      },
      introEligible: false,
    });
    let json = await (await getSubscription()).json();
    expect(json.trial).toEqual({
      credits: 150,
      creditsLeft: 105,
      ended: false,
      expiresAt: "2026-11-13T10:00:00.000Z",
      expiredAt: null,
      convertedAt: null,
      attemptPending: false,
    });
    expect(json.intro).toBeNull();

    fixture.getAccountIntro.mockResolvedValue({ trial: null, introEligible: true });
    json = await (await getSubscription()).json();
    expect(json.intro).toBeNull(); // eligible, but no page configured
    withIntroPage();
    json = await (await getSubscription()).json();
    expect(json.intro).toEqual({ priceAgorot: 500, credits: 150, days: 30 });
  });
});

describe("POST /api/account/checkout while a continue is being confirmed", () => {
  it("409 with the being-confirmed line: a second purchase could charge twice", async () => {
    process.env.SUMIT_CHECKOUT_PAGES = JSON.stringify({
      starter: "https://pay.sumit.co.il/a/b/c/payment/",
    });
    core.resetEnvCache();
    fixture.createCheckoutIntent.mockRejectedValueOnce(new core.IntroOfferError("attempt_pending"));
    const response = await checkout(
      post("/api/account/checkout", { planCode: "starter", acceptedTerms: true }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: ATTEMPT_PENDING_LINE });
  });
});
