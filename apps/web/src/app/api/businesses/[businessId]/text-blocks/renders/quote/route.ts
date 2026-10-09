import { NextResponse } from "next/server";
import { getDb, quoteTextBlockRender, quoteTotal } from "@aiugc/core";
import { coreErrorResponse, requireBusiness, requireUser } from "@/lib/api";

/**
 * The גוש טקסט price, before the render step's confirm (decision 0099). Served
 * fresh so the displayed integer and the debited integer come from one
 * function (quoteTextBlockRender, the same call createTextBlockRender charges
 * with). Advisory only — nothing here blocks the render. Mirrors the A steps
 * quote route; a flat, so there is no breakdown to show.
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

    const quote = await quoteTextBlockRender(db, businessId);
    const credits = quoteTotal(quote, 1);
    return NextResponse.json({
      // null = admin bypass: nothing is charged, so nothing is shown.
      quote: quote.chargeable
        ? { credits, balance: quote.balance, shortfall: Math.max(0, credits - quote.balance) }
        : null,
    });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
