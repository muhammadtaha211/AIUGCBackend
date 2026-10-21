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
 * One edit of the clips (vault 0122): the whole list after a move, an add, a
 * remove or a window change. Core refuses a plan that is not this business's,
 * a version that is not the row's, a clip off a spoken word, outside 4–6 s,
 * under the hook text or overlapping another, a start that is not a moment of
 * the demo, a window outside the recording, and two windows showing the same
 * footage — and never a long run of the character, which the wizard only notes.
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

    const plan = await updateCutawayPlan(db, { businessId, planId, ...body.data });
    return NextResponse.json(plan);
  } catch (err) {
    return coreErrorResponse(err);
  }
}
