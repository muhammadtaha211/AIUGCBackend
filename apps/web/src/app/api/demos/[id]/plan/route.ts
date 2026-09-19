import { NextResponse } from "next/server";
import {
  assertAccountBudget,
  getDb,
  getJobProgress,
  getLatestStepPlan,
  requestDemoPlan,
} from "@aiugc/core";
import { coreErrorResponse, jsonError, NOT_FOUND, requireDemo, requireUser } from "@/lib/api";
import { stepPlanResponse } from "@/lib/service-a";
import { isActivePlanStatus } from "@/lib/service-a-ui";

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
    // One clock for the whole body: requestedElapsedMs and the job payload
    // below describe the same instant. getJobProgress takes its own `now`
    // internally (core, unchanged here), but it is this same process a
    // round-trip later, not the browser's clock a poll later.
    const now = new Date();
    // While generating, ride the job's progress along (8d pattern, the demo
    // GET's minimal form): a dead plan job otherwise leaves the row pending
    // forever and the wizard spinning with it. The bare key is exact — every
    // retry is a NEW plan row. No aheadOfTypes: core exports no light-lane
    // type list, and the wait view says nothing when `ahead` is undefined.
    const body = stepPlanResponse(plan, now) as ReturnType<typeof stepPlanResponse> & {
      job?: Awaited<ReturnType<typeof getJobProgress>>;
    };
    if (isActivePlanStatus(plan.status)) {
      body.job = await getJobProgress(db, { idempotencyKey: `plan:${plan.id}` });
    }
    return NextResponse.json(body);
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
