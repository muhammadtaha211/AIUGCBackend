import { NextResponse } from "next/server";
import { getDb, quoteStepsASet, quoteTotal } from "@aiugc/core";
import { coreErrorResponse, jsonError, requireBusiness, requireDemo, requireUser } from "@/lib/api";

/**
 * The steps-format price, before the render step's confirm. Served fresh so
 * the displayed integer and the debited integer come from one function
 * (quoteStepsASet, the same call createSet charges with). Advisory only —
 * nothing here blocks the render.
 *
 * `?demoId=` is what the price now depends on: a_steps_credits buys the render
 * and a_demo_analysis_credits buys the analysis ONCE per demo, on the first
 * render of it that is actually paid for (migration 0039). So the render step
 * passes the demo it is about to render and gets that demo's real price, and
 * the upload step passes NOTHING and gets the price of a demo that does not
 * exist yet — which is what "a new recording costs extra" means, and the only
 * place that number may come from.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ businessId: string }> },
) {
  const { businessId } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const owned = await requireBusiness(db, businessId, auth.userId);
    if ("response" in owned) return owned.response;

    const demoId = new URL(request.url).searchParams.get("demoId");
    // Ownership, same as the create route: a foreign demo id must get its
    // proper 403/404 and must never reach the predicate.
    if (demoId !== null) {
      const found = await requireDemo(db, demoId, auth.userId);
      if ("response" in found) return found.response;
      if (found.demo.businessId !== businessId) {
        return jsonError(403, "הסרטון לא שייך לעסק הזה.");
      }
    }

    const quote = await quoteStepsASet(db, businessId, demoId);
    // The wizard confirms a 1x1 grid, so one cell is the whole set — and the
    // once-per-set analysis lands on it.
    const credits = quoteTotal(quote, 1);
    return NextResponse.json({
      // null = admin bypass: nothing is charged, so nothing is shown.
      quote: quote.chargeable
        ? {
            credits,
            render: quote.creditsPerRender,
            // 0 = this demo has already been paid for once; the customer sees
            // the plain number and no breakdown.
            analysis: quote.analysisCreditsOncePerSet,
            balance: quote.balance,
            shortfall: Math.max(0, credits - quote.balance),
          }
        : null,
    });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
