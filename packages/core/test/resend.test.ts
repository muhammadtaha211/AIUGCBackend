import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../src/config";
import { EMAIL_FROM, EmailSendError, getEmailProvider } from "../src/providers/resend";

/**
 * The Resend wrapper (decision 0107): the request shape read on resend.com
 * 2026-10-12, and the three ways a send fails — retry later, never retry, or
 * Resend's day is spent.
 */
describe("providers/resend", () => {
  const saved = { ...process.env };
  const message = {
    to: "owner@test.local",
    subject: "נושא",
    text: "גוף",
    html: "<p>גוף</p>",
    idempotencyKey: "post-failure/u/connection_expired/p",
  };

  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test_not_a_real_key";
    process.env.DRY_RUN = "0";
    resetEnvCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...saved };
    resetEnvCache();
  });

  function stubFetch(status: number, body: unknown) {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    });
    return calls;
  }

  async function sendError(): Promise<EmailSendError> {
    try {
      await getEmailProvider()!.send(message);
    } catch (err) {
      if (err instanceof EmailSendError) return err;
      throw err;
    }
    throw new Error("expected a refusal");
  }

  it("posts to /emails with the key in the header, the idempotency key, and Tavnit's sender", async () => {
    const calls = stubFetch(200, { id: "49a3999c" });
    expect(await getEmailProvider()!.send(message)).toEqual({ id: "49a3999c" });
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_test_not_a_real_key");
    expect(headers["idempotency-key"]).toBe(message.idempotencyKey);
    expect(JSON.parse(init.body as string)).toEqual({
      from: EMAIL_FROM,
      to: ["owner@test.local"],
      subject: "נושא",
      text: "גוף",
      html: "<p>גוף</p>",
    });
    expect(EMAIL_FROM).toBe("תבנית <noreply@tavnit.ai>");
  });

  it("a spent day is its own refusal, never retried today", async () => {
    stubFetch(429, {
      name: "daily_quota_exceeded",
      message: "You have exceeded your daily email sending quota.",
    });
    const err = await sendError();
    expect(err).toMatchObject({
      status: 429,
      errorName: "daily_quota_exceeded",
      dailyQuota: true,
      retryable: false,
    });
  });

  it("a per-second 429 and a 5xx may succeed later", async () => {
    stubFetch(429, { name: "rate_limit_exceeded" });
    expect(await sendError()).toMatchObject({ retryable: true, dailyQuota: false });
    stubFetch(503, { name: "service_unavailable" });
    expect(await sendError()).toMatchObject({ retryable: true, dailyQuota: false });
  });

  it("a 4xx refusal never succeeds", async () => {
    stubFetch(422, { name: "validation_error", message: "Invalid `to` field." });
    expect(await sendError()).toMatchObject({ status: 422, retryable: false, dailyQuota: false });
    expect(await sendError()).toMatchObject({ accountFault: false });
  });

  it("a 401 or 403 is the account's fault — a key or a domain — never one message's", async () => {
    stubFetch(403, { name: "validation_error", message: "The tavnit.ai domain is not verified." });
    expect(await sendError()).toMatchObject({ status: 403, retryable: false, accountFault: true });
    stubFetch(401, {
      name: "restricted_api_key",
      message: "This API key is restricted to only send emails.",
    });
    expect(await sendError()).toMatchObject({ status: 401, accountFault: true });
  });

  it("a body that resets after the headers is a network fault too", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      text: async () => {
        throw new TypeError("terminated");
      },
    }));
    expect(await sendError()).toMatchObject({ status: null, retryable: true });
  });

  it("a network fault may succeed later", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    expect(await sendError()).toMatchObject({ status: null, retryable: true });
  });
});
