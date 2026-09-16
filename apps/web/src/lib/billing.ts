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
