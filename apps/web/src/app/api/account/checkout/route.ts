import { NextResponse } from "next/server";
import { getDb, recordTermsAcceptance } from "@aiugc/core";
import { UPDATED as TERMS_VERSION } from "@/app/(legal)/legal";
import { coreErrorResponse, INVALID_BODY, jsonError, requireUser } from "@/lib/api";
import { PAYMENTS_SOON } from "@/lib/api-errors";
import { checkoutRequestSchema, clientIp } from "@/lib/billing";

/**
 * Checkout is a deliberate dead end until the gateway adapter exists
 * (founder, 2026-09-17): the terms acceptance is recorded for real — who,
 * which dated version of the text, from where — and then the customer is told
 * online payment is coming. A body without `acceptedTerms: true` is a 400
 * before anything is written; the checkbox is the point.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const body = checkoutRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);

    await recordTermsAcceptance(getDb(), {
      userId: auth.userId,
      termsVersion: TERMS_VERSION,
      context: "checkout",
      ip: clientIp(request.headers),
      userAgent: request.headers.get("user-agent"),
    });
    return jsonError(503, PAYMENTS_SOON);
  } catch (err) {
    return coreErrorResponse(err);
  }
}
