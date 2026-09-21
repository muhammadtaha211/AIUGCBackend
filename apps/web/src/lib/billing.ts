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

/**
 * The three ids the return URL carries, or null when any is missing or
 * malformed. Keys are matched CASE-INSENSITIVELY: Sumit's help article writes
 * `og-customerid`, the page actually sends `OG-CustomerID` (measured
 * 2026-09-21), and URLSearchParams is case-sensitive. og-paymenttype and
 * og-documentnumber are ignored — nothing here trusts the URL beyond using
 * its ids to look things up server-to-server.
 */
export function parseSumitReturnParams(params: URLSearchParams): SumitReturnParams | null {
  const lower = new Map<string, string>();
  params.forEach((value, key) => {
    const k = key.toLowerCase();
    if (!lower.has(k)) lower.set(k, value);
  });
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
