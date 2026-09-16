import { NextResponse } from "next/server";
import { changePlan, getBillingGateway, getDb } from "@aiugc/core";
import { coreErrorResponse, INVALID_BODY, jsonError, requireUser } from "@/lib/api";
import { changePlanRequestSchema } from "@/lib/billing";

/**
 * Change plan: an upgrade charges the prorated difference now (through the
 * configured gateway — NotConfiguredGateway in production, which the error
 * mapper turns into the 503 "coming soon"), a downgrade or a last-day upgrade
 * is scheduled for the renewal, and re-choosing the current plan undoes a
 * pending change or cancel. All of that is core's decision (changePlan); this
 * route only parses and maps.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const body = changePlanRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);

    const result = await changePlan(getDb(), getBillingGateway(), {
      userId: auth.userId,
      toPlanCode: body.data.planCode,
    });
    if (result.kind === "charge_failed") {
      return jsonError(402, "החיוב לא אושר. בדקו את אמצעי התשלום ונסו שוב.");
    }
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
