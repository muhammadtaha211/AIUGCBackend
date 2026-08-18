import { NextResponse } from "next/server";
import { assertAccountBudget, getDb, getLatestStepPlan, requestDemoPlan } from "@aiugc/core";
import { coreErrorResponse, jsonError, NOT_FOUND, requireDemo, requireUser } from "@/lib/api";
import { stepPlanResponse } from "@/lib/service-a";

/** Poll the demo's newest step plan (any status — the wizard re-attaches to it). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const found = await requireDemo(db, id, auth.userId);
    if ("response" in found) return found.response;

    const plan = await getLatestStepPlan(db, id);
    if (!plan) return jsonError(404, NOT_FOUND);
    return NextResponse.json(stepPlanResponse(plan));
  } catch (err) {
    return coreErrorResponse(err);
  }
}

/**
 * Generate (or regenerate) a step plan — a NEW plan row + queued job every
 * time; approved plans that renders reference are never mutated. 1-2 paid
 * Claude calls per press, so the per-account LLM ceiling is checked here at
 * the entry, before anything is enqueued (requestDemoPlan itself is not
 * spend-capped — CLI callers are the admin-bypassed founder).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const found = await requireDemo(db, id, auth.userId);
    if ("response" in found) return found.response;

    await assertAccountBudget(db, "llm_tokens", found.demo.businessId);
    const { planId, jobId } = await requestDemoPlan(db, id);
    return NextResponse.json({ planId, jobId });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
