import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/billing/sumit/return — the leg of the hosted checkout the browser
 * arrives on from Sumit. Core is mocked at the function boundary
 * (completeCheckout is pinned on PGlite in packages/core); these cases pin
 * the HTTP layer: the case-insensitive og-* parsing, the intent + session
 * binding (no session → /login with this URL as next, nothing completed; a
 * foreign session → 403), where each outcome lands, and that a refusal
 * renders one redirect and no stack.
 *
 * The landing rule these cases are really about (defect
 * sumit-return-failure-invited-a-second-payment): ?checkout=failed — the only
 * line that says "try again" — is reachable ONLY when Sumit positively
 * answered that the payment is not valid. Every other failure after a browser
 * arrived carrying a payment id lands on ?checkout=unconfirmed and is
 * recorded, because the payment page only redirects here after a payment it
 * accepted.
 */

const fixture = vi.hoisted(() => ({
  user: null as { id: string } | null,
  getCheckoutIntent: vi.fn(),
  completeCheckout: vi.fn(),
  recordUnconfirmed: vi.fn(),
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
    recordUnconfirmedCheckoutReturn: fixture.recordUnconfirmed,
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
const UNCONFIRMED = "http://localhost:3000/home/plan?checkout=unconfirmed";
const FAILED = "http://localhost:3000/home/plan?checkout=failed";
/** What a failure logs and records: the route path and Sumit's own parameters, nothing else. */
const RETURN_PATH = new URL(RETURN).pathname + new URL(RETURN).search;
const IDS = { intentId: INTENT, sumitPaymentId: "2376907759", sumitCustomerId: "2376907140" };

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
  fixture.recordUnconfirmed.mockReset();
  fixture.recordUnconfirmed.mockResolvedValue(undefined);
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
    expect(fixture.recordUnconfirmed).not.toHaveBeenCalled();
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
    expect(fixture.recordUnconfirmed).not.toHaveBeenCalled();
  });

  it("payment_not_found is not a decline — a wrong key or the wrong org answers it after a REAL payment — so it lands unconfirmed and is recorded", async () => {
    fixture.completeCheckout.mockRejectedValue(
      new core.CheckoutVerificationError("payment_not_found", "2376907759"),
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await get(RETURN);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(UNCONFIRMED);
    expect(await response.text()).toBe("");
    expect(fixture.recordUnconfirmed).toHaveBeenCalledWith(expect.anything(), {
      ...IDS,
      reason: "payment_not_found",
      detail: "checkout verification failed: payment_not_found (2376907759)",
      returnPath: RETURN_PATH,
    });
    expect(errors.mock.calls.some((c) => String(c[0]).includes("payment_not_found"))).toBe(true);
    errors.mockRestore();
  });

  it("Sumit positively answering that the payment is NOT valid is the one landing that invites another attempt — and records nothing", async () => {
    fixture.completeCheckout.mockRejectedValue(
      new core.CheckoutVerificationError("payment_invalid", "003"),
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await get(RETURN);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(FAILED);
    expect(await response.text()).toBe("");
    expect(fixture.recordUnconfirmed).not.toHaveBeenCalled();
    expect(errors.mock.calls.some((c) => String(c[0]).includes("payment_invalid"))).toBe(true);
    errors.mockRestore();
  });

  it("Sumit could not be ASKED — the 2026-09-21 incident, credentials Sumit refused — lands unconfirmed and is recorded with the ids", async () => {
    fixture.completeCheckout.mockRejectedValue(
      new core.SumitApiError("business", "/billing/payments/get/", "Invalid Credentials"),
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await get(RETURN);
    expect(response.headers.get("location")).toBe(UNCONFIRMED);
    expect(fixture.recordUnconfirmed).toHaveBeenCalledWith(expect.anything(), {
      ...IDS,
      reason: "sumit_business",
      detail: "sumit /billing/payments/get/: Invalid Credentials",
      returnPath: RETURN_PATH,
    });
    errors.mockRestore();
  });

  it("a Sumit timeout or TechnicalError lands the same way — only the recorded reason differs", async () => {
    // Which Status a malformed credential draws is UNVERIFIED (only the ABSENT
    // case is measured, facts/sumit-payment-page-saves-the-card.md), and this
    // is why it does not matter: every SumitApiError kind lands unconfirmed.
    for (const kind of ["technical", "transport"] as const) {
      fixture.recordUnconfirmed.mockClear();
      fixture.completeCheckout.mockRejectedValue(
        new core.SumitApiError(kind, "/billing/payments/get/", "request failed"),
      );
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const response = await get(RETURN);
      expect(response.headers.get("location")).toBe(UNCONFIRMED);
      expect(fixture.recordUnconfirmed).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ reason: `sumit_${kind}` }),
      );
      errors.mockRestore();
    }
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
    // Core already recorded it as checkout_refused; the route adds nothing.
    expect(fixture.recordUnconfirmed).not.toHaveBeenCalled();
    expect(errors.mock.calls.some((c) => String(c[0]).includes("amount_mismatch"))).toBe(true);
    errors.mockRestore();
  });

  it("a database error lands unconfirmed and is recorded — a customer who paid is never told to pay again because our pooler dropped", async () => {
    fixture.completeCheckout.mockRejectedValue(new Error("pooler dropped the connection"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await get(RETURN);
    expect(response.headers.get("location")).toBe(UNCONFIRMED);
    expect(fixture.recordUnconfirmed).toHaveBeenCalledWith(expect.anything(), {
      ...IDS,
      reason: "unexpected_error",
      detail: "pooler dropped the connection",
      returnPath: RETURN_PATH,
    });
    errors.mockRestore();
  });

  it("the failure log line carries the intent, payment and customer ids and the replayable return path", async () => {
    fixture.completeCheckout.mockRejectedValue(new Error("pooler dropped the connection"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await get(RETURN);
    const line = errors.mock.calls
      .map((c) => String(c[0]))
      .find((l) => l.includes("could not confirm the payment"));
    expect(line).toBeDefined();
    for (const id of [INTENT, "2376907759", "2376907140", RETURN_PATH]) {
      expect(line).toContain(id);
    }
    errors.mockRestore();
  });

  it("the recorded return path holds Sumit's og-* parameters and nothing else", async () => {
    fixture.completeCheckout.mockRejectedValue(new Error("pooler dropped the connection"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await get(`${RETURN}&utm_source=mail&session=whatever`);
    expect(fixture.recordUnconfirmed).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ returnPath: RETURN_PATH }),
    );
    errors.mockRestore();
  });

  it("a recorder that throws is logged and changes nothing the customer sees", async () => {
    fixture.completeCheckout.mockRejectedValue(new Error("pooler dropped the connection"));
    fixture.recordUnconfirmed.mockRejectedValue(new Error("gateway_events insert failed"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await get(RETURN);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(UNCONFIRMED);
    expect(errors.mock.calls.some((c) => String(c[0]).includes("could not record"))).toBe(true);
    errors.mockRestore();
  });

  it("malformed params: a payment id of any casing still means a payment page sent this browser, so it lands unconfirmed — and nothing is written", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const base = "http://localhost:3000/api/billing/sumit/return";
    for (const url of [
      `${base}?OG-PaymentID=1&OG-CustomerID=2`,
      `${base}?OG-ExternalIdentifier=not-a-uuid&OG-PaymentID=1&OG-CustomerID=2`,
      `${base}?OG-ExternalIdentifier=${INTENT}&OG-PaymentID=abc&OG-CustomerID=2`,
      `${base}?og-paymentid=2376907759`,
    ]) {
      const response = await get(url);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(UNCONFIRMED);
    }
    // No payment id at all: nobody paid on this URL, and "try again" is honest.
    for (const url of [
      base,
      `${base}?OG-ExternalIdentifier=${INTENT}&OG-CustomerID=2`,
      `${base}?OG-PaymentID=&OG-CustomerID=2`,
    ]) {
      expect((await get(url)).headers.get("location")).toBe(FAILED);
    }
    // Unauthenticated either way: the database is never touched.
    expect(fixture.completeCheckout).not.toHaveBeenCalled();
    expect(fixture.getCheckoutIntent).not.toHaveBeenCalled();
    expect(fixture.recordUnconfirmed).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("an unknown intent lands unconfirmed, completes nothing and records nothing — the ownership check never ran", async () => {
    fixture.getCheckoutIntent.mockResolvedValue(undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await get(RETURN);
    expect(response.headers.get("location")).toBe(UNCONFIRMED);
    expect(fixture.completeCheckout).not.toHaveBeenCalled();
    expect(fixture.recordUnconfirmed).not.toHaveBeenCalled();
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
