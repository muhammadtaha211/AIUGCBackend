import { NextResponse } from "next/server";
import { getDb, updateCutawayPlan } from "@aiugc/core";
import {
  coreErrorResponse,
  INVALID_BODY,
  jsonError,
  NOT_FOUND,
  requireBusiness,
  requireUser,
} from "@/lib/api";
import { cutawayPlanUpdateSchema, isUuid } from "@/lib/service-b";

/**
 * The window picker's save (vault 0121): every slot's start at once. Core
 * refuses a plan that is not this business's, a start that is not a moment of
 * the demo, a window outside the recording and two windows showing the same
 * footage; the slots' times are the server's and are never sent.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ businessId: string; planId: string }> },
) {
  const { businessId, planId } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const owned = await requireBusiness(db, businessId, auth.userId);
    if ("response" in owned) return owned.response;
    if (!isUuid(planId)) return jsonError(404, NOT_FOUND);

    const body = cutawayPlanUpdateSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);

    const plan = await updateCutawayPlan(db, { businessId, planId, starts: body.data.starts });
    return NextResponse.json(plan);
  } catch (err) {
    return coreErrorResponse(err);
  }
}
