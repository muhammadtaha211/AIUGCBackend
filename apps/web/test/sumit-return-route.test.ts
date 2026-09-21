import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/billing/sumit/return — the leg of the hosted checkout the browser
 * arrives on from Sumit. Core is mocked at the function boundary
 * (completeCheckout is pinned on PGlite in packages/core); these cases pin
 * the HTTP layer: the case-insensitive og-* parsing, the intent + session
 * binding (no session → /login with this URL as next, nothing completed; a
 * foreign session → 403), where each outcome lands, and that a refusal
 * renders one redirect and no stack.
 */

const fixture = vi.hoisted(() => ({
  user: null as { id: string } | null,
  getCheckoutIntent: vi.fn(),
  completeCheckout: vi.fn(),
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
    getCheckoutIntent: fixture.getCheckoutIntent,
    completeCheckout: fixture.completeCheckout,
  };
});

const core = await import("@aiugc/core");
const { GET } = await import("../src/app/api/billing/sumit/return/route");
const { safeNextPath } = await import("../src/lib/onboarding");

const BUYER = "11111111-1111-4111-8111-111111111111";
const INTENT = "2b7c5a41-9e10-4a53-a7a8-0c1c1a9f52d1";
/** The return URL exactly as the payment page sent it on 2026-09-21 (mixed-case keys). */
const RETURN =
  `http://localhost:3000/api/billing/sumit/return?OG-CustomerID=2376907140&OG-PaymentID=2376907759` +
  `&OG-PaymentType=CreditCard&OG-ExternalIdentifier=${INTENT}&OG-DocumentNumber=40000`;

// The route's rate limiter is module-level state, so each call gets its own
// address unless a test is about the limiter itself.
let nextAddress = 1;
function get(url: string, ip = `203.0.113.${nextAddress++}`) {
  return GET(new Request(url, { headers: { "x-forwarded-for": ip } }));
}

beforeEach(() => {
  fixture.user = { id: BUYER };
  fixture.getCheckoutIntent.mockReset();
  fixture.getCheckoutIntent.mockResolvedValue({ id: INTENT, userId: BUYER, status: "pending" });
  fixture.completeCheckout.mockReset();
  fixture.completeCheckout.mockResolvedValue({
    outcome: "completed",
    intentId: INTENT,
    subscriptionId: "s1",
    planCode: "starter",
  });
});

describe("GET /api/billing/sumit/return", () => {
  it("happy: reads the mixed-case og-* keys, completes the intent, lands on ?checkout=success", async () => {
    const response = await get(RETURN);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/home/plan?checkout=success",
    );
    expect(fixture.completeCheckout).toHaveBeenCalledWith(expect.anything(), {
      intentId: INTENT,
      sumitPaymentId: "2376907759",
      sumitCustomerId: "2376907140",
    });
  });

  it("a replay completes the same way — core answers 'replayed' and the page says success", async () => {
    fixture.completeCheckout.mockResolvedValue({
      outcome: "replayed",
      intentId: INTENT,
      subscriptionId: "s1",
      planCode: "starter",
    });
    const response = await get(RETURN);
    expect(response.headers.get("location")).toContain("checkout=success");
  });

  it("no session: NOTHING completes; the browser goes through /login with this very URL as next", async () => {
    fixture.user = null;
    const response = await get(RETURN);
    expect(fixture.completeCheckout).not.toHaveBeenCalled();
    expect(fixture.getCheckoutIntent).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
    const next = new URL(RETURN);
    expect(response.headers.get("location")).toBe(
      `http://localhost:3000/login?next=${encodeURIComponent(next.pathname + next.search)}`,
    );
    // And what it wrote is exactly what the login page will honour.
    expect(safeNextPath(next.pathname + next.search)).toBe(next.pathname + next.search);
  });

  it("a session that is NOT the intent's account is a 403 and completes nothing", async () => {
    fixture.user = { id: "22222222-2222-4222-8222-222222222222" };
    const response = await get(RETURN);
    expect(response.status).toBe(403);
    expect(fixture.completeCheckout).not.toHaveBeenCalled();
  });

  it("a refusal with nothing verified to have moved (Sumit does not know the payment) lands on ?checkout=failed with no stack in the body", async () => {
    fixture.completeCheckout.mockRejectedValue(
      new core.CheckoutVerificationError("payment_not_found", "2376907759"),
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await get(RETURN);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/home/plan?checkout=failed",
    );
    expect(await response.text()).toBe("");
    expect(errors.mock.calls.some((c) => String(c[0]).includes("payment_not_found"))).toBe(true);
    errors.mockRestore();
  });

  it("a refusal AFTER a valid payment (a price that no longer matches) lands on ?checkout=refused — the line that says do not pay again", async () => {
    const payment = {
      id: 2376907759,
      customerId: 2376907140,
      date: new Date("2026-09-21T03:12:21Z"),
      valid: true,
      status: "000",
      statusDescription: "",
      amountAgorot: 14900,
      externalIdentifier: INTENT,
      documentId: 1,
      paymentMethod: null,
    };
    fixture.completeCheckout.mockRejectedValue(
      new core.CheckoutVerificationError("amount_mismatch", "paid 14900, intent 15000", payment),
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await get(RETURN);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/home/plan?checkout=refused",
    );
    expect(errors.mock.calls.some((c) => String(c[0]).includes("amount_mismatch"))).toBe(true);
    errors.mockRestore();
  });

  it("any other exception also lands on failed, logged", async () => {
    fixture.completeCheckout.mockRejectedValue(new Error("pooler dropped the connection"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await get(RETURN);
    expect(response.headers.get("location")).toContain("checkout=failed");
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("missing or malformed params never reach core", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const url of [
      "http://localhost:3000/api/billing/sumit/return",
      `http://localhost:3000/api/billing/sumit/return?OG-PaymentID=1&OG-CustomerID=2`,
      `http://localhost:3000/api/billing/sumit/return?OG-ExternalIdentifier=not-a-uuid&OG-PaymentID=1&OG-CustomerID=2`,
      `http://localhost:3000/api/billing/sumit/return?OG-ExternalIdentifier=${INTENT}&OG-PaymentID=abc&OG-CustomerID=2`,
    ]) {
      const response = await get(url);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toContain("checkout=failed");
    }
    expect(fixture.completeCheckout).not.toHaveBeenCalled();
    expect(fixture.getCheckoutIntent).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("an unknown intent lands on failed without calling completeCheckout", async () => {
    fixture.getCheckoutIntent.mockResolvedValue(undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await get(RETURN);
    expect(response.headers.get("location")).toContain("checkout=failed");
    expect(fixture.completeCheckout).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("rate-limits one address to 10 a minute", async () => {
    for (let i = 0; i < 10; i++) expect((await get(RETURN, "198.51.100.9")).status).toBe(303);
    const eleventh = await get(RETURN, "198.51.100.9");
    expect(eleventh.status).toBe(429);
    // Another address is unaffected.
    expect((await get(RETURN, "198.51.100.10")).status).toBe(303);
  });
});
