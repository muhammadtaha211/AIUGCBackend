import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The PUBLIC POST /api/contact route: the honeypot, the per-IP cap, the zod
 * bounds and what actually reaches core.
 *
 * `@aiugc/core` is mocked with `importOriginal` spread and the handler is
 * imported with a top-level `await import` AFTER the mock, the same shape
 * account-routes.test.ts uses. Nothing mocks the Supabase client here — the
 * whole point of this route is that it never reads a session.
 */

const fixture = vi.hoisted(() => ({
  submitContactMessage: vi.fn(),
  countContactMessagesByIpSince: vi.fn(),
}));

vi.mock("@aiugc/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aiugc/core")>();
  return {
    ...actual,
    getDb: () => ({}),
    submitContactMessage: fixture.submitContactMessage,
    countContactMessagesByIpSince: fixture.countContactMessagesByIpSince,
  };
});

const { POST } = await import("../src/app/api/contact/route");
const { CONTACT_CAP_ERROR, CONTACT_DAILY_CAP_PER_IP, CONTACT_HONEYPOT_FIELD } =
  await import("../src/lib/feedback");
const { INVALID_BODY } = await import("../src/lib/api-errors");

const VALID = { name: "דנה", email: "dana@business.co.il", message: "שאלה על המסלולים" };

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/contact", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  fixture.submitContactMessage.mockReset();
  fixture.submitContactMessage.mockResolvedValue({ id: "row-1", createdAt: new Date() });
  fixture.countContactMessagesByIpSince.mockReset();
  fixture.countContactMessagesByIpSince.mockResolvedValue(0);
});

describe("POST /api/contact — the happy path", () => {
  it("writes the message with the FIRST hop of x-forwarded-for", async () => {
    const response = await post(VALID, { "x-forwarded-for": "203.0.113.7, 10.0.0.1" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(fixture.submitContactMessage).toHaveBeenCalledTimes(1);
    expect(fixture.submitContactMessage.mock.calls[0]![1]).toEqual({
      name: "דנה",
      email: "dana@business.co.il",
      message: "שאלה על המסלולים",
      ip: "203.0.113.7",
    });
  });

  it("stores null when the request carries no forwarded address, and skips the cap read", async () => {
    await post(VALID);

    expect(fixture.submitContactMessage.mock.calls[0]![1]).toMatchObject({ ip: null });
    // No address to count against, so the cap is not consulted at all — a
    // shared "null" bucket would let one unattributable request lock out the
    // rest.
    expect(fixture.countContactMessagesByIpSince).not.toHaveBeenCalled();
  });

  it("never reads a session — a signed-out request is the normal case, not a 401", async () => {
    const response = await post(VALID);
    expect(response.status).not.toBe(401);
    expect(response.status).toBe(200);
  });
});

describe("the honeypot", () => {
  it("answers 200 and writes nothing when the trap is filled", async () => {
    const response = await post({ ...VALID, [CONTACT_HONEYPOT_FIELD]: "http://spam.example" });

    // Indistinguishable from success on purpose: a bot that can tell it was
    // caught learns to leave the field alone next time.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(fixture.submitContactMessage).not.toHaveBeenCalled();
    // The trap short-circuits BEFORE the cap, so a flood of trapped requests
    // costs no database reads either.
    expect(fixture.countContactMessagesByIpSince).not.toHaveBeenCalled();
  });

  it("treats a whitespace-only trap as empty — a browser that autofills a space is a person", async () => {
    const response = await post({ ...VALID, [CONTACT_HONEYPOT_FIELD]: "   " });

    expect(response.status).toBe(200);
    expect(fixture.submitContactMessage).toHaveBeenCalledTimes(1);
  });
});

describe("the per-IP soft cap", () => {
  it("refuses in Hebrew at the cap and writes nothing", async () => {
    fixture.countContactMessagesByIpSince.mockResolvedValue(CONTACT_DAILY_CAP_PER_IP);
    const response = await post(VALID, { "x-forwarded-for": "203.0.113.7" });

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ ok: false, error: CONTACT_CAP_ERROR });
    expect(fixture.submitContactMessage).not.toHaveBeenCalled();
  });

  it("lets the last allowed message through", async () => {
    fixture.countContactMessagesByIpSince.mockResolvedValue(CONTACT_DAILY_CAP_PER_IP - 1);
    const response = await post(VALID, { "x-forwarded-for": "203.0.113.7" });

    expect(response.status).toBe(200);
    expect(fixture.submitContactMessage).toHaveBeenCalledTimes(1);
  });

  it("counts against the first hop and a 24-hour window", async () => {
    await post(VALID, { "x-forwarded-for": "203.0.113.7, 10.0.0.1" });

    const [, ip, since] = fixture.countContactMessagesByIpSince.mock.calls[0]!;
    expect(ip).toBe("203.0.113.7");
    expect(Date.now() - (since as Date).getTime()).toBeCloseTo(24 * 60 * 60 * 1000, -3);
  });
});

describe("validation", () => {
  it.each([
    ["a missing name", { ...VALID, name: undefined }],
    ["a whitespace-only name", { ...VALID, name: "   " }],
    ["a missing email", { ...VALID, email: undefined }],
    ["an address that is not one", { ...VALID, email: "not-an-address" }],
    ["a missing message", { ...VALID, message: undefined }],
    ["a whitespace-only message", { ...VALID, message: " \n " }],
    ["a name past the bound", { ...VALID, name: "א".repeat(81) }],
    ["a message past the bound", { ...VALID, message: "א".repeat(2001) }],
    ["a body that is not an object", "just a string"],
    ["no body at all", undefined],
  ])("answers 400 in Hebrew to %s", async (_label, body) => {
    const response = await post(body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: INVALID_BODY });
    expect(fixture.submitContactMessage).not.toHaveBeenCalled();
  });

  it("passes the trimmed values through", async () => {
    await post({ name: "  דנה  ", email: "  dana@business.co.il ", message: "  היי  " });

    expect(fixture.submitContactMessage.mock.calls[0]![1]).toMatchObject({
      name: "דנה",
      email: "dana@business.co.il",
      message: "היי",
    });
  });
});
