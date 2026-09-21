import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALREADY_SUBSCRIBED, PAYMENTS_SOON } from "../src/lib/api-errors";

/**
 * The account billing routes: the auth gate, the checkout's 400/503 pair, and
 * the two Hebrew answers /change gives for "no subscription" and "no gateway
 * yet". Core is mocked at the function boundary — changePlan and friends are
 * pinned on PGlite in packages/core; these cases pin the HTTP layer only.
 */

const fixture = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111", email: "dana@business.co.il" } as {
    id: string;
    email: string;
  } | null,
  getAccountBilling: vi.fn(),
  changePlan: vi.fn(),
  cancelSubscription: vi.fn(),
  resumeSubscription: vi.fn(),
  createCheckoutIntent: vi.fn(),
  accountContact: vi.fn(),
  termsVersion: "11.09.2026",
  businessCookie: undefined as string | undefined,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: fixture.user }, error: null }) },
  }),
}));

// The legal module is TSX (React components); the route only wants its date.
vi.mock("@/app/(legal)/legal", () => ({ UPDATED: fixture.termsVersion }));

// The checkout route reads the selected-business cookie; outside a request
// there is no cookie store, so the test hands it one.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "aiugc.business" && fixture.businessCookie
        ? { value: fixture.businessCookie }
        : undefined,
  }),
}));

vi.mock("@aiugc/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aiugc/core")>();
  return {
    ...actual,
    getDb: () => ({}),
    getBillingGateway: () => new actual.NotConfiguredGateway(),
    getAccountBilling: fixture.getAccountBilling,
    changePlan: fixture.changePlan,
    cancelSubscription: fixture.cancelSubscription,
    resumeSubscription: fixture.resumeSubscription,
    createCheckoutIntent: fixture.createCheckoutIntent,
    accountContact: fixture.accountContact,
  };
});

const core = await import("@aiugc/core");
const { GET: getSubscription } = await import("../src/app/api/account/subscription/route");
const { POST: change } = await import("../src/app/api/account/subscription/change/route");
const { POST: cancel } = await import("../src/app/api/account/subscription/cancel/route");
const { POST: resume } = await import("../src/app/api/account/subscription/resume/route");
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
  fixture.getAccountBilling.mockReset();
  fixture.changePlan.mockReset();
  fixture.cancelSubscription.mockReset();
  fixture.resumeSubscription.mockReset();
  fixture.createCheckoutIntent.mockReset();
  fixture.accountContact.mockReset();
  fixture.businessCookie = undefined;
  delete process.env.SUMIT_CHECKOUT_PAGES;
  core.resetEnvCache();
});

describe("the auth gate", () => {
  it("every account route answers 401 in Hebrew to a signed-out request", async () => {
    fixture.user = null;
    const responses = await Promise.all([
      getSubscription(),
      change(post("/api/account/subscription/change", { planCode: "pro" })),
      cancel(),
      resume(),
      checkout(post("/api/account/checkout", { planCode: "pro", acceptedTerms: true })),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ ok: false, error: "צריך להתחבר קודם." });
    }
    expect(fixture.createCheckoutIntent).not.toHaveBeenCalled();
    expect(fixture.changePlan).not.toHaveBeenCalled();
  });
});

describe("GET /api/account/subscription", () => {
  it("serialises the core view for the session user, dates as ISO strings", async () => {
    const start = new Date("2026-09-01T00:00:00Z");
    const end = new Date("2026-10-01T00:00:00Z");
    fixture.getAccountBilling.mockResolvedValue({
      subscription: {
        id: "s1",
        userId: signedIn.id,
        planCode: "starter",
        status: "active",
        gateway: "sumit",
        gatewayRecurringRef: "tok",
        currentPeriodStart: start,
        currentPeriodEnd: end,
        cancelAtPeriodEnd: false,
        scheduledPlanCode: null,
        createdAt: start,
        updatedAt: start,
      },
      plans: [
        { code: "starter", name: "א", priceAgorot: 1, monthlyCredits: 1, active: true, config: {} },
      ],
      // A retired plan the account is still on: not in the ladder, but the
      // route must still hand its name and price to the page.
      currentPlan: {
        code: "legacy",
        name: "ותיק",
        priceAgorot: 9,
        monthlyCredits: 90,
        active: false,
        config: {},
      },
      balance: 12,
      manualOutstanding: 2,
      quotes: { pro: { kind: "upgrade" } },
    });
    const response = await getSubscription();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      subscription: {
        planCode: "starter",
        status: "active",
        currentPeriodStart: start.toISOString(),
        currentPeriodEnd: end.toISOString(),
        cancelAtPeriodEnd: false,
        scheduledPlanCode: null,
      },
      plans: [{ code: "starter", name: "א", priceAgorot: 1, monthlyCredits: 1 }],
      currentPlan: { code: "legacy", name: "ותיק", priceAgorot: 9, monthlyCredits: 90 },
      balance: 12,
      manualOutstanding: 2,
      quotes: { pro: { kind: "upgrade" } },
    });
    expect(fixture.getAccountBilling).toHaveBeenCalledWith(expect.anything(), {
      userId: signedIn.id,
    });
  });
});

describe("POST /api/account/subscription/change", () => {
  it("400 on a body without a plan code", async () => {
    const response = await change(post("/api/account/subscription/change", {}));
    expect(response.status).toBe(400);
    expect(fixture.changePlan).not.toHaveBeenCalled();
  });

  it("404 in Hebrew when the account has no subscription", async () => {
    fixture.changePlan.mockRejectedValue(new core.PlanChangeError("no_subscription"));
    const response = await change(post("/api/account/subscription/change", { planCode: "pro" }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "אין מנוי פעיל בחשבון הזה." });
  });

  it("503 with the Hebrew 'coming soon' body when the gateway is not configured", async () => {
    // What changePlan surfaces when NotConfiguredGateway.chargeRecurring throws.
    fixture.changePlan.mockImplementation(async () =>
      new core.NotConfiguredGateway().chargeRecurring(),
    );
    const response = await change(post("/api/account/subscription/change", { planCode: "pro" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: PAYMENTS_SOON });
    expect(PAYMENTS_SOON).toBe("התשלום המקוון יופעל בקרוב.");
  });

  it("hands the plan code and the session user to core with the configured gateway", async () => {
    fixture.changePlan.mockResolvedValue({ kind: "scheduled", quote: { kind: "downgrade" } });
    const response = await change(
      post("/api/account/subscription/change", { planCode: "starter" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      result: { kind: "scheduled", quote: { kind: "downgrade" } },
    });
    const [, gateway, opts] = fixture.changePlan.mock.calls[0]!;
    expect(gateway).toBeInstanceOf(core.NotConfiguredGateway);
    expect(opts).toEqual({ userId: signedIn.id, toPlanCode: "starter" });
  });

  it("a declined charge is a 402, not a success", async () => {
    fixture.changePlan.mockResolvedValue({ kind: "charge_failed", quote: {}, error: "declined" });
    const response = await change(post("/api/account/subscription/change", { planCode: "pro" }));
    expect(response.status).toBe(402);
  });
});

describe("POST /api/account/subscription/cancel and /resume", () => {
  it("call core for the session user and answer ok", async () => {
    expect((await cancel()).status).toBe(200);
    expect(fixture.cancelSubscription).toHaveBeenCalledWith(expect.anything(), {
      userId: signedIn.id,
    });
    expect((await resume()).status).toBe(200);
    expect(fixture.resumeSubscription).toHaveBeenCalledWith(expect.anything(), {
      userId: signedIn.id,
    });
  });

  it("404 in Hebrew when there is nothing to cancel", async () => {
    fixture.cancelSubscription.mockRejectedValue(new core.PlanChangeError("no_subscription"));
    const response = await cancel();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "אין מנוי פעיל בחשבון הזה." });
  });
});

const PAGES = {
  starter: "https://pay.sumit.co.il/138f5dl/13b59j6/13b59is/payment/",
  pro: "https://pay.sumit.co.il/138f5dl/13b59j6/13b59iu/payment/",
};
const INTENT_ID = "2b7c5a41-9e10-4a53-a7a8-0c1c1a9f52d1";

function withPages(pages: unknown) {
  process.env.SUMIT_CHECKOUT_PAGES = typeof pages === "string" ? pages : JSON.stringify(pages);
  core.resetEnvCache();
}

describe("POST /api/account/checkout", () => {
  beforeEach(() => {
    fixture.createCheckoutIntent.mockResolvedValue({
      intent: { id: INTENT_ID, planCode: "pro", priceAgorot: 30000, status: "pending" },
      reused: false,
    });
    fixture.accountContact.mockResolvedValue({
      email: "dana@business.co.il",
      businesses: [
        { id: "b1", name: "עסק ראשון" },
        { id: "b2", name: "עסק שני" },
      ],
    });
  });

  it("400 unless acceptedTerms is literally true — and writes nothing", async () => {
    withPages(PAGES);
    for (const body of [
      { planCode: "pro" },
      { planCode: "pro", acceptedTerms: false },
      { planCode: "pro", acceptedTerms: "true" },
      { acceptedTerms: true },
      null,
    ]) {
      const response = await checkout(post("/api/account/checkout", body ?? undefined));
      expect(response.status).toBe(400);
    }
    expect(fixture.createCheckoutIntent).not.toHaveBeenCalled();
  });

  it("503 with the Hebrew 'coming soon' line when no payment pages are configured — nothing written", async () => {
    const response = await checkout(
      post("/api/account/checkout", { planCode: "pro", acceptedTerms: true }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: PAYMENTS_SOON });
    expect(fixture.createCheckoutIntent).not.toHaveBeenCalled();
  });

  it("503 for a plan that has no page, and for a malformed SUMIT_CHECKOUT_PAGES", async () => {
    withPages(PAGES);
    expect(
      (await checkout(post("/api/account/checkout", { planCode: "studio", acceptedTerms: true })))
        .status,
    ).toBe(503);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    withPages("{not json");
    expect(
      (await checkout(post("/api/account/checkout", { planCode: "pro", acceptedTerms: true })))
        .status,
    ).toBe(503);
    withPages({ pro: "http://insecure.example/pay" });
    expect(
      (await checkout(post("/api/account/checkout", { planCode: "pro", acceptedTerms: true })))
        .status,
    ).toBe(503);
    errors.mockRestore();
    expect(fixture.createCheckoutIntent).not.toHaveBeenCalled();
  });

  it("writes the intent (version, first forwarded hop, user agent) and answers the payment-page URL", async () => {
    withPages(PAGES);
    fixture.businessCookie = "b2";
    const response = await checkout(
      post(
        "/api/account/checkout",
        { planCode: "pro", acceptedTerms: true },
        { "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "vitest/1" },
      ),
    );
    expect(response.status).toBe(200);
    const { redirectUrl } = (await response.json()) as { redirectUrl: string };
    const url = new URL(redirectUrl);
    expect(url.origin + url.pathname).toBe(PAGES.pro);
    expect(url.searchParams.get("externalidentifier")).toBe(INTENT_ID);
    expect(url.searchParams.get("customerexternalidentifier")).toBe(signedIn.id);
    expect(url.searchParams.get("name")).toBe("עסק שני");
    expect(url.searchParams.get("emailaddress")).toBe("dana@business.co.il");
    // Never a price, never a secret.
    expect([...url.searchParams.keys()].sort()).toEqual([
      "customerexternalidentifier",
      "emailaddress",
      "externalidentifier",
      "name",
    ]);

    expect(fixture.createCheckoutIntent).toHaveBeenCalledTimes(1);
    expect(fixture.createCheckoutIntent.mock.calls[0]![1]).toEqual({
      userId: signedIn.id,
      planCode: "pro",
      termsVersion: fixture.termsVersion,
      ip: "203.0.113.7",
      userAgent: "vitest/1",
    });
  });

  it("falls back to the first business without a cookie, and stores null without a forwarded address", async () => {
    withPages(PAGES);
    const response = await checkout(
      post("/api/account/checkout", { planCode: "pro", acceptedTerms: true }),
    );
    const url = new URL(((await response.json()) as { redirectUrl: string }).redirectUrl);
    expect(url.searchParams.get("name")).toBe("עסק ראשון");
    expect(fixture.createCheckoutIntent.mock.calls[0]![1]).toMatchObject({ ip: null });
  });

  it("an account with a live subscription is a 409 in Hebrew — no payment URL for money the return leg could not activate on", async () => {
    withPages(PAGES);
    fixture.createCheckoutIntent.mockRejectedValue(
      new core.CheckoutVerificationError("already_subscribed", "active"),
    );
    const response = await checkout(
      post("/api/account/checkout", { planCode: "pro", acceptedTerms: true }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: ALREADY_SUBSCRIBED });
    expect(fixture.accountContact).not.toHaveBeenCalled();
  });

  it("an unknown plan that HAS a page is core's 400", async () => {
    withPages({ ...PAGES, platinum: PAGES.pro });
    fixture.createCheckoutIntent.mockRejectedValue(new core.PlanChangeError("unknown_plan"));
    const response = await checkout(
      post("/api/account/checkout", { planCode: "platinum", acceptedTerms: true }),
    );
    expect(response.status).toBe(400);
  });
});
