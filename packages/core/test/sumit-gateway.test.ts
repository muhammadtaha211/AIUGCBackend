import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../src/config";
import { isProductionDatabaseUrl } from "../src/jobs/queue";
import {
  CLOCK_SKEW_MS,
  HttpSumitClient,
  RECONCILE_POLL_MS,
  SumitApiError,
  SumitGateway,
  type SumitClient,
  type SumitPayment,
} from "../src/gateways/sumit";
import { DryRunGateway, getBillingGateway, NotConfiguredGateway } from "../src/pipelines/billing";

/**
 * The Sumit client and gateway against a mocked fetch — the shapes here are
 * the ones MEASURED on the founder's test business on 2026-09-21
 * (facts/sumit-payment-page-saves-the-card.md): a Credentials object in the
 * body, an HTTP 200 envelope with Status 0/1/2, a decline as ValidPayment
 * false with a status code, no merchant reference on the charge. Nothing here
 * reaches the network.
 */

const ENV_KEYS = [
  "SUMIT_COMPANY_ID",
  "SUMIT_API_KEY",
  "SUMIT_CHECKOUT_PAGES",
  "DRY_RUN",
  "DATABASE_URL",
];
const saved: Record<string, string | undefined> = {};

function setEnv(values: Record<string, string | undefined>) {
  for (const key of ENV_KEYS) {
    if (key in values) {
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = values[key];
    }
  }
  resetEnvCache();
}

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  setEnv({
    SUMIT_COMPANY_ID: "2372324601",
    SUMIT_API_KEY: "test-key-never-logged",
    DRY_RUN: undefined,
    DATABASE_URL: "postgresql://postgres:pw@localhost:5432/postgres",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetEnvCache();
});

function envelope(data: unknown, status = 0, message: string | null = null) {
  return new Response(
    JSON.stringify({
      Data: data,
      Status: status,
      UserErrorMessage: message,
      TechnicalErrorDetails: null,
    }),
    { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
  );
}

/** A Sumit payment as /billing/payments/get/ returned it on 2026-09-21 (ids changed). */
function rawPayment(over: Record<string, unknown> = {}) {
  return {
    ID: 2376907759,
    CustomerID: 2376907140,
    Date: "2026-09-21T06:12:21+03:00",
    ValidPayment: true,
    Status: "000",
    StatusDescription: " (קוד 000)",
    Amount: 150.0,
    Currency: 0,
    PaymentMethod: {
      ID: 2376907758,
      CustomerID: null,
      CreditCard_Number: null,
      CreditCard_LastDigits: "0772",
      CreditCard_ExpirationMonth: 5,
      CreditCard_ExpirationYear: 2031,
      CreditCard_CVV: null,
      CreditCard_Token: "63c7aeff-4a3c-4f41-a2ff-9161fca8fae5",
      Type: 1,
    },
    AuthNumber: "0898318",
    ExternalIdentifier: "2b7c5a41-9e10-4a53-a7a8-0c1c1a9f52d1",
    DocumentID: 2376907762,
    ...over,
  };
}

describe("HttpSumitClient", () => {
  it("posts Credentials in the body, never in a header, and maps the payment", async () => {
    const fetchMock = vi.fn(async () => envelope({ Payment: rawPayment() }));
    vi.stubGlobal("fetch", fetchMock);

    const payment = await new HttpSumitClient().getPayment("2376907759");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.sumit.co.il/billing/payments/get/");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.Credentials).toEqual({ CompanyID: 2372324601, APIKey: "test-key-never-logged" });
    expect(body.PaymentID).toBe(2376907759);
    expect(JSON.stringify(init.headers)).not.toContain("test-key-never-logged");

    expect(payment).toEqual({
      id: 2376907759,
      customerId: 2376907140,
      date: new Date("2026-09-21T06:12:21+03:00"),
      valid: true,
      status: "000",
      statusDescription: " (קוד 000)",
      amountAgorot: 15000,
      externalIdentifier: "2b7c5a41-9e10-4a53-a7a8-0c1c1a9f52d1",
      documentId: 2376907762,
      paymentMethod: {
        id: 2376907758,
        lastDigits: "0772",
        expirationMonth: 5,
        expirationYear: 2031,
        token: "63c7aeff-4a3c-4f41-a2ff-9161fca8fae5",
      },
    });
  });

  it("a 200 with Status 1 is a business error; 'Payment not found' becomes null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => envelope(null, 1, "Payment not found")),
    );
    expect(await new HttpSumitClient().getPayment("1")).toBeNull();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => envelope(null, 1, "Customer: יש להזין ערך בשדה Customer")),
    );
    await expect(new HttpSumitClient().getPaymentMethod("9")).rejects.toMatchObject({
      name: "SumitApiError",
      kind: "business",
    });
  });

  it("Status 2, a non-200 and a thrown fetch are technical/transport failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => envelope(null, 2, "Nullable object must have a value.")),
    );
    await expect(new HttpSumitClient().getPaymentMethod("9")).rejects.toMatchObject({
      kind: "technical",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("gateway timeout", { status: 504 })),
    );
    await expect(new HttpSumitClient().getPaymentMethod("9")).rejects.toMatchObject({
      kind: "transport",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("The operation was aborted");
      }),
    );
    await expect(new HttpSumitClient().getPaymentMethod("9")).rejects.toMatchObject({
      kind: "transport",
    });
  });

  it("charge: the saved default card, one NAME-searched item at the exact amount, VAT included", async () => {
    const fetchMock = vi.fn(async () => envelope({ Payment: rawPayment() }));
    vi.stubGlobal("fetch", fetchMock);

    await new HttpSumitClient().charge({
      customerId: "2376907140",
      amountAgorot: 15000,
      description: "תבנית — מסלול התחלה, חידוש חודשי",
      reference: "attempt-1",
    });

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.sumit.co.il/billing/payments/charge/");
    const body = JSON.parse(init.body as string);
    expect(body.Customer).toEqual({ ID: 2376907140 });
    expect(body.PaymentMethod).toBeUndefined();
    expect(body.SingleUseToken).toBeUndefined();
    expect(body.Items).toEqual([
      {
        Item: { Name: "תבנית — מסלול התחלה, חידוש חודשי", SearchMode: "Name" },
        Quantity: 1,
        UnitPrice: 150,
        Description: "תבנית — מסלול התחלה, חידוש חודשי",
      },
    ]);
    expect(body.VATIncluded).toBe(true);
    expect(body.SendDocumentByEmail).toBe(true);
    expect(body.DocumentDescription).toBe("תבנית — מסלול התחלה, חידוש חודשי");
  });

  it("setPaymentMethod sends the token WITH its expiry (the measured requirement)", async () => {
    const fetchMock = vi.fn(async () =>
      envelope({ CustomerID: 2376907140, PaymentMethod: rawPayment().PaymentMethod }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const method = await new HttpSumitClient().setPaymentMethod("2376907140", {
      token: "63c7aeff-4a3c-4f41-a2ff-9161fca8fae5",
      expirationMonth: 5,
      expirationYear: 2031,
    });
    const body = JSON.parse(
      (fetchMock.mock.calls[0]! as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body.PaymentMethod).toEqual({
      CreditCard_Token: "63c7aeff-4a3c-4f41-a2ff-9161fca8fae5",
      CreditCard_ExpirationMonth: 5,
      CreditCard_ExpirationYear: 2031,
      Type: "CreditCard",
    });
    expect(method?.lastDigits).toBe("0772");
  });

  it("listPayments sends both dates as ISO-8601 Z (measured: Sumit honours the offset) and maps an empty list", async () => {
    const fetchMock = vi.fn(async () => envelope({ Payments: null, HasNextPage: false }));
    vi.stubGlobal("fetch", fetchMock);
    const from = new Date("2026-09-21T03:00:00Z");
    const to = new Date("2026-09-21T03:16:00Z");
    expect(await new HttpSumitClient().listPayments(from, to)).toEqual([]);
    const body = JSON.parse(
      (fetchMock.mock.calls[0]! as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body.Date_From).toBe("2026-09-21T03:00:00.000Z");
    expect(body.Date_To).toBe("2026-09-21T03:16:00.000Z");
  });

  it("the timeout covers the body read, not only the headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        // Headers arrive at once; the body never does unless the signal aborts it.
        const stream = new ReadableStream({
          start(controller) {
            init.signal?.addEventListener("abort", () => controller.error(new Error("aborted")));
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    vi.useFakeTimers();
    try {
      const pending = new HttpSumitClient().getPayment("1");
      const settled = pending.then(
        () => "resolved",
        (err: unknown) => (err instanceof SumitApiError ? err.kind : "other"),
      );
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await settled).toBe("transport");
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * A fake client with scripted answers and a call log. `list` receives the
 * ordinal of the list call (0.. = the post-failure polls) and defaults to
 * "nothing there".
 */
function fakeClient(script: {
  charge?: () => Promise<SumitPayment | null>;
  list?: (call: number) => Promise<SumitPayment[]>;
}) {
  const calls: string[] = [];
  let lists = 0;
  const client: SumitClient = {
    async getPayment() {
      throw new Error("not scripted");
    },
    async getPaymentMethod() {
      throw new Error("not scripted");
    },
    async setPaymentMethod() {
      throw new Error("not scripted");
    },
    async charge() {
      calls.push("charge");
      if (!script.charge) throw new Error("not scripted");
      return script.charge();
    },
    async listPayments() {
      calls.push("list");
      return script.list ? script.list(lists++) : [];
    },
  };
  return { client, calls };
}

/** A gateway on a fixed clock whose sleeps are recorded, never awaited for real. */
function gateway(client: SumitClient) {
  const slept: number[] = [];
  const g = new SumitGateway(client, {
    now: () => NOW,
    sleep: async (ms) => {
      slept.push(ms);
    },
  });
  return { g, slept };
}

function payment(over: Partial<SumitPayment> = {}): SumitPayment {
  return {
    id: 2376907759,
    customerId: 2376907140,
    date: new Date("2026-09-21T03:12:21Z"),
    valid: true,
    status: "000",
    statusDescription: " (קוד 000)",
    amountAgorot: 15000,
    externalIdentifier: null,
    documentId: 2376907762,
    paymentMethod: null,
    ...over,
  };
}

const NOW = new Date("2026-09-21T03:15:00Z");
const INPUT = {
  recurringRef: "2376907140",
  amountAgorot: 15000,
  description: "תבנית — מסלול התחלה, חידוש חודשי",
};

describe("SumitGateway.chargeRecurring", () => {
  it("a valid payment is ok with Sumit's payment id as the event id — one call, no list", async () => {
    const { client, calls } = fakeClient({ charge: async () => payment() });
    const { g, slept } = gateway(client);
    const result = await g.chargeRecurring(INPUT);
    expect(result).toEqual({ ok: true, gatewayEventId: "2376907759" });
    expect(calls).toEqual(["charge"]);
    expect(slept).toEqual([]);
  });

  it("a decline is ok:false under the declined payment's own id, with the code, and no reconcile", async () => {
    const { client, calls } = fakeClient({
      charge: async () =>
        payment({ id: 2376907143, valid: false, status: "003", statusDescription: " (קוד 003)" }),
    });
    const result = await gateway(client).g.chargeRecurring(INPUT);
    expect(result).toEqual({ ok: false, gatewayEventId: "2376907143", error: "(קוד 003)" });
    expect(calls).toEqual(["charge"]);
  });

  it("a lost answer whose payment appears on the second poll is ok with THAT id — never a second charge", async () => {
    const { client, calls } = fakeClient({
      charge: async () => {
        throw new SumitApiError("transport", "/billing/payments/charge/", "HTTP 504");
      },
      list: async (call) =>
        call < 1
          ? [
              // Another customer, same amount: ignored.
              payment({ id: 1, customerId: 999 }),
              // This customer, wrong amount: ignored.
              payment({ id: 2, amountAgorot: 30000 }),
              // This customer, right amount, but declined: ignored.
              payment({ id: 3, valid: false, status: "003" }),
            ]
          : [payment({ id: 4, date: new Date(NOW.getTime() + 3_000) })],
    });
    const { g, slept } = gateway(client);
    const result = await g.chargeRecurring(INPUT);
    expect(result).toEqual({ ok: true, gatewayEventId: "4" });
    expect(calls).toEqual(["charge", "list", "list"]);
    expect(slept).toEqual([RECONCILE_POLL_MS[1]]);
  });

  it("Status 0 with no Payment in it is a lost answer too: reconciled, not reported as a decline", async () => {
    const { client, calls } = fakeClient({
      charge: async () => null,
      list: async () => [payment({ id: 6, date: new Date(NOW.getTime() + 1_000) })],
    });
    const result = await gateway(client).g.chargeRecurring(INPUT);
    expect(result).toEqual({ ok: true, gatewayEventId: "6" });
    expect(calls).toEqual(["charge", "list"]);
  });

  it("the reconcile look is NARROW: a payment-page payment, one older than the clock skew, an undated one, other amounts, customers and declines are all ignored", async () => {
    // The starter checkout an hour ago (₪150, carrying its intent id) and
    // the starter renewal three minutes ago (₪150, an API charge) are NOT this
    // ₪150 day-0 upgrade's payment — matching either would grant the upgrade
    // for nothing.
    const { client } = fakeClient({
      charge: async () => {
        throw new SumitApiError("transport", "/billing/payments/charge/", "HTTP 504");
      },
      list: async () => [
        payment({ id: 1, externalIdentifier: "2b7c5a41-9e10-4a53-a7a8-0c1c1a9f52d1" }),
        payment({ id: 2, date: new Date(NOW.getTime() - CLOCK_SKEW_MS - 60_000) }),
        payment({ id: 3, date: null }),
        payment({ id: 4, amountAgorot: 30000 }),
        payment({ id: 5, customerId: 999 }),
        payment({ id: 6, valid: false, status: "003" }),
      ],
    });
    const { g, slept } = gateway(client);
    const result = await g.chargeRecurring(INPUT);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("unconfirmed");
    expect(result.gatewayEventId).toMatch(/^sumit_unconfirmed_/);
    expect(slept).toEqual(RECONCILE_POLL_MS.slice(1));
  });

  it("a payment dated inside the clock skew before the attempt began still counts as ours", async () => {
    const { client } = fakeClient({
      charge: async () => {
        throw new SumitApiError(
          "technical",
          "/billing/payments/charge/",
          "Nullable object must have a value.",
        );
      },
      list: async () => [payment({ id: 7, date: new Date(NOW.getTime() - CLOCK_SKEW_MS + 1) })],
    });
    const result = await gateway(client).g.chargeRecurring(INPUT);
    expect(result).toEqual({ ok: true, gatewayEventId: "7" });
  });

  it("a lost answer with no matching payment after every poll is ok:false 'unconfirmed' — dunning retries", async () => {
    const { client, calls } = fakeClient({
      charge: async () => {
        throw new SumitApiError("transport", "/billing/payments/charge/", "request failed");
      },
    });
    const { g, slept } = gateway(client);
    const result = await g.chargeRecurring(INPUT);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("unconfirmed");
    expect(result.gatewayEventId).toMatch(/^sumit_unconfirmed_/);
    expect(calls).toEqual(["charge", "list", "list", "list"]);
    expect(slept).toEqual(RECONCILE_POLL_MS.slice(1));
  });

  it("a refusal (Status 1) is an answer: Sumit's message, no list read, never 'unconfirmed'", async () => {
    const { client, calls } = fakeClient({
      charge: async () => {
        throw new SumitApiError("business", "/billing/payments/charge/", "no payment method");
      },
      list: async () => [payment({ id: 9 })],
    });
    const result = await gateway(client).g.chargeRecurring(INPUT);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("no payment method");
    expect(result.gatewayEventId).toMatch(/^sumit_refused_/);
    expect(calls).toEqual(["charge"]);
  });

  it("when the reconcile list fails after a lost answer the result is still 'unconfirmed', never a throw", async () => {
    const { client, calls } = fakeClient({
      charge: async () => {
        throw new SumitApiError("transport", "/billing/payments/charge/", "request failed");
      },
      list: async () => {
        throw new SumitApiError("transport", "/billing/payments/list/", "request failed");
      },
    });
    const result = await gateway(client).g.chargeRecurring(INPUT);
    expect(result).toMatchObject({ ok: false, error: "unconfirmed" });
    expect(calls).toEqual(["charge", "list", "list", "list"]);
  });
});

describe("getBillingGateway", () => {
  it("SUMIT_* present and not DRY_RUN -> SumitGateway", () => {
    expect(getBillingGateway()).toBeInstanceOf(SumitGateway);
    expect(getBillingGateway().name).toBe("sumit");
  });

  it("nothing configured -> NotConfiguredGateway (today's behaviour)", () => {
    setEnv({ SUMIT_COMPANY_ID: undefined, SUMIT_API_KEY: undefined });
    expect(getBillingGateway()).toBeInstanceOf(NotConfiguredGateway);
  });

  it("DRY_RUN off production -> DryRunGateway, even with SUMIT_* set", () => {
    setEnv({ DRY_RUN: "1" });
    expect(getBillingGateway()).toBeInstanceOf(DryRunGateway);
  });

  it("DRY_RUN against the production project REFUSES, naming apps/web/.env.local", () => {
    setEnv({
      DRY_RUN: "1",
      DATABASE_URL:
        "postgresql://postgres.hyaqydcmwbnbaiqqufow:pw@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
    });
    expect(() => getBillingGateway()).toThrow(/apps\/web\/\.env\.local/);
    expect(() => getBillingGateway()).toThrow(/hyaqydcmwbnbaiqqufow/);
  });
});

describe("isProductionDatabaseUrl (the guard's predicate, shared with the job claim)", () => {
  it("finds the ref in the pooler username and in a direct host, and nowhere else", () => {
    expect(
      isProductionDatabaseUrl(
        "postgresql://postgres.hyaqydcmwbnbaiqqufow:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
      ),
    ).toBe(true);
    expect(
      isProductionDatabaseUrl(
        "postgresql://postgres:pw@db.hyaqydcmwbnbaiqqufow.supabase.co:5432/postgres",
      ),
    ).toBe(true);
    expect(isProductionDatabaseUrl("postgresql://postgres:pw@localhost:5432/postgres")).toBe(false);
    expect(isProductionDatabaseUrl(undefined)).toBe(false);
  });
});
