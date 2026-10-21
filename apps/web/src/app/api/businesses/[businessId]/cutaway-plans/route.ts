import { NextResponse } from "next/server";
import { draftCutawayPlan, getDb } from "@aiugc/core";
import {
  coreErrorResponse,
  INVALID_BODY,
  jsonError,
  requireBusiness,
  requireUser,
} from "@/lib/api";
import { cutawayPlanRequestSchema } from "@/lib/service-b";

/**
 * The demo cutaway draft (vault 0121, 0122): the slots laid out from the
 * approved audio — from where the script first names the product, after the
 * script's own hook text — each placed in the demo in order. Free — no model
 * call — and idempotent per (audio, analysis, structure, the script's hook
 * text): a second visit returns the stored plan with the customer's edits.
 * Core checks the audio, the demo and its analysis all belong to this business
 * (requireDemo would check only the user).
 */
export async function POST(
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

    const body = cutawayPlanRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);

    const plan = await draftCutawayPlan(db, {
      businessId,
      audioRenderId: body.data.audioId,
      demoId: body.data.demoId,
    });
    return NextResponse.json(plan);
  } catch (err) {
    return coreErrorResponse(err);
  }
}
