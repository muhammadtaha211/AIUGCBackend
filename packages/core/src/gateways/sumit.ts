import { z } from "zod";
import { getEnv } from "../config";
import { logger } from "../logger";
import type { BillingGateway } from "../pipelines/billing";

/**
 * Sumit — the payment stack (decision 0054: Sumit on Upay; our code calls
 * Sumit, never Upay). One typed function per endpoint the billing code uses,
 * and the BillingGateway adapter on top of them. Everything below was read
 * from the public OpenAPI spec (https://app.sumit.co.il/swagger/v1/swagger.json,
 * "SUMIT API - Full", openapi 3.1.1) and then MEASURED against the founder's
 * test business on 2026-09-21 (facts/sumit-payment-page-saves-the-card.md):
 *
 *   auth      a `Credentials: { CompanyID, APIKey }` object in the JSON body of
 *             every POST. No header. An empty body answers HTTP 200 with
 *             Status 1 "Missing Credentials (CompanyID/APIKey are missing)".
 *   errors    ALWAYS an HTTP 200 envelope `{ Status, UserErrorMessage,
 *             TechnicalErrorDetails, Data }` with Status 0 = Success,
 *             1 = BusinessError ("Payment not found", a missing field, a
 *             refused request), 2 = TechnicalError ("Nullable object must have
 *             a value."). A 200 with Status ≠ 0 is a failure; a non-200 HTTP
 *             status, a timeout or an unparseable body is a transport failure.
 *             A DECLINED card is Status 0 with `Payment.ValidPayment: false`
 *             and a `Payment.Status` code ("003" measured on the payment page;
 *             "000" is success).
 *   idempotency  /billing/payments/charge/ carries NO merchant reference.
 *             `Payment.ExternalIdentifier` exists on the response but is only
 *             set by the payment page / beginredirect. So a charge whose answer
 *             was lost cannot be looked up by our id: the gateway reconciles by
 *             /billing/payments/list/ (Date_From/Date_To required) on customer,
 *             amount and time — see SumitGateway.chargeRecurring.
 *   money     amounts are shekels with decimals (150.0000). Ours are agorot.
 *             The charge is sent with VATIncluded: true so the customer is
 *             charged EXACTLY amountAgorot / 100 whatever the organisation's
 *             VAT setting; today the founder is עוסק פטור and the document
 *             prints VAT 0 (measured), and at conversion (0046 §7) the caller
 *             passes the gross amount.
 *
 * Never logged: the API key, card data. The customer id and our own reference
 * are the only identifiers a log line carries.
 */

export const SUMIT_API_BASE = "https://api.sumit.co.il";
/** Reads. A charge gets CHARGE_TIMEOUT_MS: authorising through Upay, issuing the document and mailing it take longer. */
const TIMEOUT_MS = 15_000;
const CHARGE_TIMEOUT_MS = 30_000;

/**
 * Clock slack when looking for a charge whose answer was lost: a payment
 * Sumit dates up to this long BEFORE our attempt began still counts as ours
 * (two NTP-synced clocks, nothing more), and nothing older does. Wider is
 * not safer — see SumitGateway.
 */
export const CLOCK_SKEW_MS = 2 * 60 * 1000;
/**
 * AFTER a lost answer, how long to keep asking. A client-side abort cuts the
 * socket while Sumit is still authorising and issuing the document, so the
 * payment may reach the list only seconds later; three looks over ~20s catch
 * that without holding a web request past its limits.
 */
export const RECONCILE_POLL_MS = [0, 5_000, 15_000];

const envelopeSchema = z.object({
  Status: z.number(),
  UserErrorMessage: z.string().nullable().optional(),
  TechnicalErrorDetails: z.string().nullable().optional(),
  Data: z.unknown().nullable().optional(),
});

const paymentMethodSchema = z
  .object({
    ID: z.number().nullable().optional(),
    CreditCard_LastDigits: z.string().nullable().optional(),
    CreditCard_ExpirationMonth: z.number().nullable().optional(),
    CreditCard_ExpirationYear: z.number().nullable().optional(),
    CreditCard_Token: z.string().nullable().optional(),
    Type: z.number().nullable().optional(),
  })
  .passthrough();

const paymentSchema = z
  .object({
    ID: z.number(),
    CustomerID: z.number(),
    Date: z.string().nullable().optional(),
    ValidPayment: z.boolean(),
    Status: z.string().nullable().optional(),
    StatusDescription: z.string().nullable().optional(),
    Amount: z.number(),
    ExternalIdentifier: z.string().nullable().optional(),
    DocumentID: z.number().nullable().optional(),
    PaymentMethod: paymentMethodSchema.nullable().optional(),
  })
  .passthrough();

/** What the billing code keeps of a saved card: ids and the last four, never a number, CVV or owner id. */
export type SumitPaymentMethod = {
  id: number | null;
  lastDigits: string | null;
  expirationMonth: number | null;
  expirationYear: number | null;
  /** Sumit's own card token — an opaque reference, not card data. */
  token: string | null;
};

export type SumitPayment = {
  id: number;
  customerId: number;
  date: Date | null;
  valid: boolean;
  status: string | null;
  statusDescription: string | null;
  amountAgorot: number;
  externalIdentifier: string | null;
  documentId: number | null;
  paymentMethod: SumitPaymentMethod | null;
};

function toPaymentMethod(raw: z.infer<typeof paymentMethodSchema>): SumitPaymentMethod {
  return {
    id: raw.ID ?? null,
    lastDigits: raw.CreditCard_LastDigits ?? null,
    expirationMonth: raw.CreditCard_ExpirationMonth ?? null,
    expirationYear: raw.CreditCard_ExpirationYear ?? null,
    token: raw.CreditCard_Token ?? null,
  };
}

function toPayment(raw: z.infer<typeof paymentSchema>): SumitPayment {
  return {
    id: raw.ID,
    customerId: raw.CustomerID,
    date: raw.Date ? new Date(raw.Date) : null,
    valid: raw.ValidPayment,
    status: raw.Status ?? null,
    statusDescription: raw.StatusDescription ?? null,
    amountAgorot: Math.round(raw.Amount * 100),
    externalIdentifier: raw.ExternalIdentifier ?? null,
    documentId: raw.DocumentID ?? null,
    paymentMethod: raw.PaymentMethod ? toPaymentMethod(raw.PaymentMethod) : null,
  };
}

/**
 * `business` — Sumit answered and refused (Status 1); nothing was charged as
 * far as Sumit is willing to say. `technical` — Sumit answered Status 2, which
 * says nothing about whether the work happened. `transport` — no usable answer
 * at all (timeout, non-200, unparseable). The gateway reconciles on the last
 * two; the pipeline treats the first as a plain refusal.
 */
export class SumitApiError extends Error {
  readonly kind: "business" | "technical" | "transport";
  readonly endpoint: string;

  constructor(kind: SumitApiError["kind"], endpoint: string, message: string) {
    super(`sumit ${endpoint}: ${message}`);
    this.name = "SumitApiError";
    this.kind = kind;
    this.endpoint = endpoint;
  }
}

/** The subset of the API the billing code calls, as an interface so tests hand in a fake. */
export interface SumitClient {
  /** null when Sumit says "Payment not found". */
  getPayment(paymentId: string): Promise<SumitPayment | null>;
  listPayments(from: Date, to: Date): Promise<SumitPayment[]>;
  /** The customer's DEFAULT saved payment method, or null when there is none. */
  getPaymentMethod(customerId: string): Promise<SumitPaymentMethod | null>;
  /** Make a card the customer's default, by Sumit's own token plus its expiry. */
  setPaymentMethod(
    customerId: string,
    card: { token: string; expirationMonth: number; expirationYear: number },
  ): Promise<SumitPaymentMethod | null>;
  /** Charge the customer's default saved card. A decline is a payment with valid=false, not a throw. */
  charge(input: {
    customerId: string;
    amountAgorot: number;
    description: string;
    /** Logged beside the endpoint so the attempt can be found in the worker log. */
    reference: string;
  }): Promise<SumitPayment | null>;
}

export class HttpSumitClient implements SumitClient {
  private credentials(): { CompanyID: number; APIKey: string } {
    const env = getEnv();
    if (!env.SUMIT_COMPANY_ID || !env.SUMIT_API_KEY) {
      throw new Error("SUMIT_COMPANY_ID / SUMIT_API_KEY are not set");
    }
    return { CompanyID: Number(env.SUMIT_COMPANY_ID), APIKey: env.SUMIT_API_KEY };
  }

  /**
   * One POST, one envelope. Throws SumitApiError; returns Data on Status 0.
   * `reference` is ours (an intent id, an attempt id, a customer id) and is
   * the only thing besides the endpoint that reaches the log.
   */
  private async post(
    endpoint: string,
    body: Record<string, unknown>,
    reference: string,
    timeoutMs = TIMEOUT_MS,
  ) {
    const url = `${SUMIT_API_BASE}${endpoint}`;
    logger.info({ endpoint, reference }, "sumit request");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // The timer covers the body read too: headers can arrive promptly and the
    // body then stall, and a charge waiting on undici's default body timeout
    // would hold the renewal job (or the return route's row lock) for minutes.
    let json: unknown;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ Credentials: this.credentials(), ...body }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new SumitApiError("transport", endpoint, `HTTP ${response.status}`);
      }
      json = await response.json().catch(() => null);
    } catch (err) {
      if (err instanceof SumitApiError) throw err;
      throw new SumitApiError("transport", endpoint, `request failed: ${String(err)}`);
    } finally {
      clearTimeout(timer);
    }
    const parsed = envelopeSchema.safeParse(json);
    if (!parsed.success) {
      throw new SumitApiError("transport", endpoint, "unparseable response body");
    }
    const envelope = parsed.data;
    if (envelope.Status !== 0) {
      const message = envelope.UserErrorMessage ?? envelope.TechnicalErrorDetails ?? "no message";
      logger.warn({ endpoint, reference, status: envelope.Status, message }, "sumit refused");
      throw new SumitApiError(envelope.Status === 1 ? "business" : "technical", endpoint, message);
    }
    return envelope.Data;
  }

  async getPayment(paymentId: string): Promise<SumitPayment | null> {
    let data: unknown;
    try {
      data = await this.post("/billing/payments/get/", { PaymentID: Number(paymentId) }, paymentId);
    } catch (err) {
      if (
        err instanceof SumitApiError &&
        err.kind === "business" &&
        /not found/i.test(err.message)
      ) {
        return null;
      }
      throw err;
    }
    const raw = z.object({ Payment: paymentSchema.nullable().optional() }).parse(data);
    return raw.Payment ? toPayment(raw.Payment) : null;
  }

  async listPayments(from: Date, to: Date): Promise<SumitPayment[]> {
    // ISO-8601 with the Z suffix. Measured 2026-09-21 (facts/sumit-payments-
    // list-honours-utc-offsets.md): Sumit reads the offset — a five-minute Z
    // window around a payment it reports as 06:12:21+03:00 lists it, and the
    // same wall-clock window sent as Z does not. Declined payments are listed
    // too (ValidPayment false), and the list is company-wide: the caller
    // filters. One page; paging (HasNextPage/StartIndex) is not read.
    const data = await this.post(
      "/billing/payments/list/",
      { Date_From: from.toISOString(), Date_To: to.toISOString() },
      `${from.toISOString()}..${to.toISOString()}`,
    );
    const raw = z.object({ Payments: z.array(paymentSchema).nullable().optional() }).parse(data);
    return (raw.Payments ?? []).map(toPayment);
  }

  async getPaymentMethod(customerId: string): Promise<SumitPaymentMethod | null> {
    const data = await this.post(
      "/billing/paymentmethods/getforcustomer/",
      { Customer: { ID: Number(customerId) } },
      customerId,
    );
    const raw = z.object({ PaymentMethod: paymentMethodSchema.nullable().optional() }).parse(data);
    return raw.PaymentMethod ? toPaymentMethod(raw.PaymentMethod) : null;
  }

  async setPaymentMethod(
    customerId: string,
    card: { token: string; expirationMonth: number; expirationYear: number },
  ): Promise<SumitPaymentMethod | null> {
    // Measured 2026-09-21: the token alone is refused ("Missing
    // CreditCard_ExpirationMonth/CreditCard_ExpirationYear") and the method id
    // alone answers TechnicalError; token + expiry is what takes. Nothing here
    // is card data we hold — both values come from Sumit's own payments/get.
    const data = await this.post(
      "/billing/paymentmethods/setforcustomer/",
      {
        Customer: { ID: Number(customerId) },
        PaymentMethod: {
          CreditCard_Token: card.token,
          CreditCard_ExpirationMonth: card.expirationMonth,
          CreditCard_ExpirationYear: card.expirationYear,
          Type: "CreditCard",
        },
      },
      customerId,
    );
    const raw = z.object({ PaymentMethod: paymentMethodSchema.nullable().optional() }).parse(data);
    return raw.PaymentMethod ? toPaymentMethod(raw.PaymentMethod) : null;
  }

  async charge(input: {
    customerId: string;
    amountAgorot: number;
    description: string;
    reference: string;
  }): Promise<SumitPayment | null> {
    // PaymentMethod omitted = "use the customer payment method" (the saved
    // default). Items[].Item found by NAME so a description string becomes at
    // most one catalogue item, and UnitPrice — not the item's list price — is
    // what the line charges. SendDocumentByEmail: the auto-issued document
    // (קבלה today, 0046 §1) goes to the customer's address on the Sumit card.
    const data = await this.post(
      "/billing/payments/charge/",
      {
        Customer: { ID: Number(input.customerId) },
        Items: [
          {
            Item: { Name: input.description, SearchMode: "Name" },
            Quantity: 1,
            UnitPrice: input.amountAgorot / 100,
            Description: input.description,
          },
        ],
        VATIncluded: true,
        DocumentDescription: input.description,
        SendDocumentByEmail: true,
      },
      input.reference,
      CHARGE_TIMEOUT_MS,
    );
    const raw = z.object({ Payment: paymentSchema.nullable().optional() }).parse(data);
    return raw.Payment ? toPayment(raw.Payment) : null;
  }
}

let override: SumitClient | undefined;

/** Test hook, same shape as setLipsyncProvider. */
export function setSumitClient(client: SumitClient | undefined): void {
  override = client;
}

export function getSumitClient(): SumitClient {
  return override ?? new HttpSumitClient();
}

/** Whether the environment names a Sumit organisation at all. */
export function sumitConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.SUMIT_COMPANY_ID && env.SUMIT_API_KEY);
}

/**
 * The BillingGateway on Sumit. `recurringRef` is the Sumit CUSTOMER id — the
 * one the payment page created on the first purchase, whose default saved
 * card completeCheckout aligned to the card that paid.
 *
 * The answer to a charge can be lost — a timeout, a 5xx, a TechnicalError, a
 * Status 0 with no Payment in it — AFTER Sumit moved the money, and there is
 * no reference we control to look the charge up by (see the header). So
 * after a lost answer the gateway looks for its own payment through
 * /billing/payments/list/: this customer, exactly this amount, valid, an API
 * charge (no ExternalIdentifier — payment-page payments carry an intent id),
 * dated no earlier than CLOCK_SKEW_MS before the attempt began. The look is
 * repeated over RECONCILE_POLL_MS so a charge still being authorised when the
 * socket was cut has time to appear. Found → success with its id. Not found
 * → `ok: false, error: "unconfirmed"` → past_due and dunning.
 *
 * The look is deliberately NARROW, and there is no look before charging. A
 * Sumit payment record carries nothing that names our attempt, so "the same
 * customer and amount" is the whole match, and on the 0043 ladder that is a
 * coincidence waiting to happen: a day-0 upgrade starter → pro is ₪150, the
 * starter renewal an hour earlier is ₪150. A look-back wide enough to catch
 * a retry (days) would count that renewal as the upgrade's own payment and
 * grant the upgrade for nothing — silently, and on every such upgrade. The
 * narrow look leaves one residual the other way: a charge Sumit completes
 * but does not list within ~50 seconds is reported unconfirmed, goes to
 * dunning, and the retry charges again. That is a second receipt in the
 * customer's inbox and the founder's Sumit list — visible and refundable —
 * which is the right side to err on. Decision 0062 records this.
 *
 * A decline (Status 0, ValidPayment false) is an answer and is returned under
 * Sumit's own payment id without a look. A business refusal (Status 1) is an
 * answer too: nothing was charged as far as Sumit says, and no list is read.
 * Never `ok: false` blindly for the rest.
 */
export class SumitGateway implements BillingGateway {
  name = "sumit";
  private readonly client: SumitClient;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    client: SumitClient = getSumitClient(),
    opts: { now?: () => Date; sleep?: (ms: number) => Promise<void> } = {},
  ) {
    this.client = client;
    this.now = opts.now ?? (() => new Date());
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async chargeRecurring(input: {
    recurringRef: string;
    amountAgorot: number;
    description: string;
  }) {
    const attemptId = crypto.randomUUID();
    const startedAt = this.now();

    let failure: Error;
    try {
      const payment = await this.client.charge({
        customerId: input.recurringRef,
        amountAgorot: input.amountAgorot,
        description: input.description,
        reference: attemptId,
      });
      if (payment?.valid) return { ok: true, gatewayEventId: String(payment.id) };
      if (payment) {
        // A decline is an answer: Sumit recorded the attempt under its own id.
        return {
          ok: false,
          gatewayEventId: String(payment.id),
          error: payment.statusDescription?.trim() || payment.status || "declined",
        };
      }
      // Status 0 with no Payment says nothing about the money: a lost answer.
      failure = new SumitApiError(
        "technical",
        "/billing/payments/charge/",
        "Status 0 without a Payment",
      );
    } catch (err) {
      failure = err instanceof Error ? err : new Error(String(err));
    }

    if (failure instanceof SumitApiError && failure.kind === "business") {
      logger.warn(
        { customerId: input.recurringRef, attemptId, error: failure.message },
        "sumit refused the charge",
      );
      return { ok: false, gatewayEventId: `sumit_refused_${attemptId}`, error: failure.message };
    }

    for (const delay of RECONCILE_POLL_MS) {
      if (delay > 0) await this.sleep(delay);
      const found = await this.findPayment(
        input.recurringRef,
        input.amountAgorot,
        new Date(startedAt.getTime() - CLOCK_SKEW_MS),
        new Date(this.now().getTime() + CLOCK_SKEW_MS),
      );
      if (found) {
        logger.warn(
          {
            customerId: input.recurringRef,
            attemptId,
            paymentId: found.id,
            error: failure.message,
          },
          "sumit charge answer lost but the payment exists — treating as success",
        );
        return { ok: true, gatewayEventId: String(found.id) };
      }
    }
    logger.warn(
      { customerId: input.recurringRef, attemptId, error: failure.message },
      "sumit charge unconfirmed",
    );
    return { ok: false, gatewayEventId: `sumit_unconfirmed_${attemptId}`, error: "unconfirmed" };
  }

  /**
   * The newest valid API charge of exactly this amount for this customer
   * dated inside [from, to], or null — also null when the list cannot be
   * read (logged; the caller keeps polling and ends unconfirmed).
   */
  private async findPayment(
    customerId: string,
    amountAgorot: number,
    from: Date,
    to: Date,
  ): Promise<SumitPayment | null> {
    let payments: SumitPayment[];
    try {
      payments = await this.client.listPayments(from, to);
    } catch (err) {
      logger.warn({ customerId, error: String(err) }, "sumit payments list failed");
      return null;
    }
    const matches = payments.filter(
      (p) =>
        String(p.customerId) === customerId &&
        p.valid &&
        p.amountAgorot === amountAgorot &&
        p.externalIdentifier === null &&
        p.date !== null &&
        p.date.getTime() >= from.getTime() &&
        p.date.getTime() <= to.getTime(),
    );
    matches.sort((a, b) => b.date!.getTime() - a.date!.getTime());
    return matches[0] ?? null;
  }
}
