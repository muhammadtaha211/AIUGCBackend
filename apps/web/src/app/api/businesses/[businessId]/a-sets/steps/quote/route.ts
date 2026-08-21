import { NextResponse } from "next/server";
import { getDb, quoteStepsASet } from "@aiugc/core";
import { coreErrorResponse, requireBusiness, requireUser } from "@/lib/api";

/**
 * The steps-format price, before the render step's confirm. A flat
 * (a_steps_credits) that depends on nothing but config — served fresh so the
 * displayed integer and the debited integer come from one function
 * (quoteStepsASet, the same call createSet charges with). Advisory only —
 * nothing here blocks the render.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ businessId: string }> },
) {
  const { businessId } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const owned = await requireBusiness(db, businessId, auth.userId);
    if ("response" in owned) return owned.response;

    const quote = await quoteStepsASet(db, businessId);
    return NextResponse.json({
      // null = admin bypass: nothing is charged, so nothing is shown.
      quote: quote.chargeable
        ? {
            credits: quote.creditsPerRender,
            balance: quote.balance,
            shortfall: Math.max(0, quote.creditsPerRender - quote.balance),
          }
        : null,
    });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
