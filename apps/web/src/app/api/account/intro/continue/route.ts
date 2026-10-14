import { NextResponse } from "next/server";
import { continueFromTrial, getBillingGateway, getDb } from "@aiugc/core";
import { UPDATED as TERMS_VERSION } from "@/app/(legal)/legal";
import { coreErrorResponse, INVALID_BODY, jsonError, requireUser } from "@/lib/api";
import { clientIp, continueRequestSchema } from "@/lib/billing";
import { CONTINUE_DECLINED_LINE, CONTINUE_ORPHANED } from "@/lib/plans-ui";

/**
 * Continue from the ₪5 intro trial (decision 0109): charge the card Sumit saved
 * at the ₪5 payment for an ordinary first month of the chosen plan. The
 * checkbox is required, as at checkout (0056). All of it is core's
 * continueFromTrial; this route parses and maps, and every answer is a body
 * the page can tell apart without reading the status:
 *
 *   200 { outcome: "activated" }   the month is live
 *   200 { outcome: "pending" }     the charge's answer was lost; the attempt
 *                                  stays open and both purchase paths are shut
 *                                  until reconcile_continue settles it — the
 *                                  page says do not try again
 *   402                            declined: the line, and the page offers the
 *                                  hosted checkout with another card
 *   409                            a refusal before any charge, or a charge on
 *                                  an account that joined a plan meanwhile
 *   503                            no gateway configured — nothing written
 *
 * A timeout or a 5xx reaches the page with no body, and the page reads it as
 * pending, never as "try again".
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const body = continueRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);

    const result = await continueFromTrial(getDb(), getBillingGateway(), {
      userId: auth.userId,
      planCode: body.data.planCode,
      termsVersion: TERMS_VERSION,
      ip: clientIp(request.headers),
      userAgent: request.headers.get("user-agent"),
    });
    switch (result.outcome) {
      case "activated":
        return NextResponse.json({ outcome: "activated", planCode: result.planCode });
      case "pending":
        return NextResponse.json({ outcome: "pending" });
      case "declined":
        return jsonError(402, CONTINUE_DECLINED_LINE);
      case "orphaned":
        return jsonError(409, CONTINUE_ORPHANED);
    }
  } catch (err) {
    return coreErrorResponse(err);
  }
}
