import { beforeEach, describe, expect, it, vi } from "vitest";
import { PAYMENTS_SOON } from "../src/lib/api-errors";

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
  recordTermsAcceptance: vi.fn(),
  termsVersion: "11.09.2026",
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: fixture.user }, error: null }) },
  }),
}));

// The legal module is TSX (React components); the route only wants its date.
vi.mock("@/app/(legal)/legal", () => ({ UPDATED: fixture.termsVersion }));

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
    recordTermsAcceptance: fixture.recordTermsAcceptance,
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
  fixture.recordTermsAcceptance.mockReset();
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
    expect(fixture.recordTermsAcceptance).not.toHaveBeenCalled();
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

describe("POST /api/account/checkout", () => {
  it("400 unless acceptedTerms is literally true — and records nothing", async () => {
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
    expect(fixture.recordTermsAcceptance).not.toHaveBeenCalled();
  });

  it("records the acceptance (version, first forwarded hop, user agent) and then answers the 503", async () => {
    fixture.recordTermsAcceptance.mockResolvedValue({ id: "t1", acceptedAt: new Date() });
    const response = await checkout(
      post(
        "/api/account/checkout",
        { planCode: "pro", acceptedTerms: true },
        { "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "vitest/1" },
      ),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: PAYMENTS_SOON });
    expect(fixture.recordTermsAcceptance).toHaveBeenCalledTimes(1);
    expect(fixture.recordTermsAcceptance.mock.calls[0]![1]).toEqual({
      userId: signedIn.id,
      termsVersion: fixture.termsVersion,
      context: "checkout",
      ip: "203.0.113.7",
      userAgent: "vitest/1",
    });
  });

  it("stores null when the request carries no forwarded address", async () => {
    fixture.recordTermsAcceptance.mockResolvedValue({ id: "t1", acceptedAt: new Date() });
    await checkout(post("/api/account/checkout", { planCode: "pro", acceptedTerms: true }));
    expect(fixture.recordTermsAcceptance.mock.calls[0]![1]).toMatchObject({ ip: null });
  });
});
