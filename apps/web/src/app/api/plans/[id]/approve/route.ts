import { NextResponse } from "next/server";
import { approvePlan, getDb } from "@aiugc/core";
import { coreErrorResponse, requirePlan, requireUser } from "@/lib/api";
import { stepPlanResponse } from "@/lib/service-a";

/**
 * The gate: steps-format renders require demo_step_plans.approvedAt, and this
 * is the only place a customer sets it. Idempotent — re-approving returns the
 * original approval time.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const found = await requirePlan(db, id, auth.userId);
    if ("response" in found) return found.response;

    const plan = await approvePlan(db, id);
    return NextResponse.json(stepPlanResponse(plan));
  } catch (err) {
    return coreErrorResponse(err);
  }
}
