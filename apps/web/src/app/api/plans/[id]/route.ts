import { NextResponse } from "next/server";
import { getDb, updatePlanSteps } from "@aiugc/core";
import {
  coreErrorResponse,
  INVALID_BODY,
  jsonError,
  requirePlan,
  requireUser,
} from "@/lib/api";
import { planStepsRequestSchema, stepPlanResponse } from "@/lib/service-a";

/**
 * Replace a plan's steps with the picker's selection. The client sends the
 * full ordered array, but chronology is a property of the format, not a client
 * convention: core re-derives timestamp/actionType/duration from sourceIndex,
 * re-sorts by timestamp, and mirrors the picker's filter (an unreadable state
 * is rejected whoever selected it). Editing clears approval by construction —
 * an unapproved row mutates in place, an approved one forks a fresh unapproved
 * row — so the response's planId/approvedAt are the wizard's new truth.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const found = await requirePlan(db, id, auth.userId);
    if ("response" in found) return found.response;

    const body = planStepsRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);

    const plan = await updatePlanSteps(db, { planId: id, steps: body.data.steps });
    return NextResponse.json(stepPlanResponse(plan));
  } catch (err) {
    return coreErrorResponse(err);
  }
}
