import { z } from "zod";

/**
 * The account billing HTTP contract — the request bodies, pure zod so the
 * tests reach them directly and a client can share the shape.
 */

/** POST /api/account/subscription/change */
export const changePlanRequestSchema = z.object({
  planCode: z.string().trim().min(1).max(40),
});

/**
 * POST /api/account/checkout. `acceptedTerms` is a literal true, not a
 * boolean: a false is not "declined", it is a body the route must refuse
 * with a 400 — the checkbox is the whole point (founder, 2026-09-17).
 */
export const checkoutRequestSchema = z.object({
  planCode: z.string().trim().min(1).max(40),
  acceptedTerms: z.literal(true),
});

/**
 * POST /api/account/intro (the ₪5 offer, decision 0109). Only the checkbox:
 * the offer has one price and no plan. The checkout form also sends its
 * `planCode` ("intro", for the analytics step); zod drops it.
 */
export const introRequestSchema = z.object({
  acceptedTerms: z.literal(true),
});

/** POST /api/account/intro/continue — the plan to join on the saved card, and the checkbox. */
export const continueRequestSchema = z.object({
  planCode: z.string().trim().min(1).max(40),
  acceptedTerms: z.literal(true),
});

/**
 * The first hop of x-forwarded-for, or null. Vercel sets the header; the
 * first entry is the client as the edge saw it. Stored for the record, never
 * trusted for anything else.
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || null;
}

/* ---------- the Sumit hosted checkout (decision 0062) ---------- */

/**
 * SUMIT_CHECKOUT_PAGES: `{ "<plan code>": "<payment page URL>" }`. null when
 * unset or malformed — the route answers 503 either way, and a malformed value
 * is logged by the caller, not thrown through to the customer.
 */
export function parseCheckoutPages(raw: string | undefined): Record<string, string> | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const pages: Record<string, string> = {};
  for (const [code, value] of Object.entries(parsed)) {
    if (typeof value !== "string") return null;
    try {
      if (new URL(value).protocol !== "https:") return null;
    } catch {
      return null;
    }
    pages[code] = value;
  }
  return pages;
}

/**
 * SUMIT_INTRO_PAGE: the ₪5 offer's one payment-page URL, https only. null when
 * unset or malformed — the offer is then hidden and its route answers 503. A
 * key of its own rather than an "intro" entry in SUMIT_CHECKOUT_PAGES, because
 * one bad entry there nulls the whole map and every plan checkout with it.
 */
export function parseIntroPage(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

/**
 * The payment-page URL the customer is sent to. `externalidentifier` is the
 * intent id and comes back as og-externalidentifier — and, measured 2026-09-21,
 * as the payment's own ExternalIdentifier, which completeCheckout checks.
 * `customerexternalidentifier` is the account id (Sumit's help article names
 * the param; the value was NOT observed on the customer record afterwards —
 * the page matched the returning customer by email). name and emailaddress
 * prefill the page. Never a price: the Sumit product is fixed-price, and
 * never a secret: this URL travels through the customer's browser.
 */
export function checkoutRedirectUrl(
  page: string,
  params: { intentId: string; userId: string; name: string | null; email: string | null },
): string {
  const url = new URL(page);
  url.searchParams.set("externalidentifier", params.intentId);
  url.searchParams.set("customerexternalidentifier", params.userId);
  if (params.name) url.searchParams.set("name", params.name);
  if (params.email) url.searchParams.set("emailaddress", params.email);
  return url.toString();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUMIT_ID_RE = /^\d{1,20}$/;

export type SumitReturnParams = { intentId: string; paymentId: string; customerId: string };

/** First value per key, keyed lowercase — Sumit's casing is not ours to predict. */
function lowerKeys(params: URLSearchParams): Map<string, string> {
  const lower = new Map<string, string>();
  params.forEach((value, key) => {
    const k = key.toLowerCase();
    if (!lower.has(k)) lower.set(k, value);
  });
  return lower;
}

/**
 * Whether the URL carries a payment id at all, whatever its casing and even
 * when the rest of the query is unusable. Measured: the payment page redirects
 * ONLY after a payment it accepted, so a browser holding one of these has
 * almost certainly paid and must never be told to try again. Non-empty is the
 * whole test — a value too malformed for parseSumitReturnParams still says a
 * payment page sent this browser here.
 */
export function sumitPaymentIdParam(params: URLSearchParams): string | null {
  return lowerKeys(params).get("og-paymentid")?.trim() || null;
}

/**
 * The route path plus ONLY Sumit's own og-* parameters, in the order they
 * arrived. This is what a failure logs and records, so the founder can replay
 * the return once the cause is fixed; everything else on the query is dropped
 * rather than copied into a log line and a database row.
 */
export function sumitReturnPath(url: URL): string {
  const og = new URLSearchParams();
  url.searchParams.forEach((value, key) => {
    if (key.toLowerCase().startsWith("og-")) og.append(key, value);
  });
  const query = og.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}

/**
 * The three ids the return URL carries, or null when any is missing or
 * malformed. Keys are matched CASE-INSENSITIVELY: Sumit's help article writes
 * `og-customerid`, the page actually sends `OG-CustomerID` (measured
 * 2026-09-21), and URLSearchParams is case-sensitive. og-paymenttype and
 * og-documentnumber are ignored — nothing here trusts the URL beyond using
 * its ids to look things up server-to-server.
 */
export function parseSumitReturnParams(params: URLSearchParams): SumitReturnParams | null {
  const lower = lowerKeys(params);
  const intentId = lower.get("og-externalidentifier") ?? "";
  const paymentId = lower.get("og-paymentid") ?? "";
  const customerId = lower.get("og-customerid") ?? "";
  if (!UUID_RE.test(intentId) || !SUMIT_ID_RE.test(paymentId) || !SUMIT_ID_RE.test(customerId)) {
    return null;
  }
  return { intentId, paymentId, customerId };
}

/**
 * A per-process sliding-window counter keyed on the caller's address. A brake
 * for the unauthenticated return route, not an access control: on Vercel
 * each instance has its own map and a cold start empties it. What actually
 * protects the route is that every activation is gated on Sumit's own record
 * of the payment; this only bounds how fast someone can make us ask.
 */
export class IpRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  allow(ip: string, now = Date.now()): boolean {
    const recent = (this.hits.get(ip) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(ip, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(ip, recent);
    return true;
  }
}
