import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import {
  businessOwnerId,
  createSet,
  creditBalance,
  getDb,
  isAdminOwned,
  schema,
} from "@aiugc/core";
import {
  coreErrorResponse,
  INVALID_BODY,
  jsonError,
  requireBusiness,
  requireDemo,
  requirePlan,
  requireUser,
} from "@/lib/api";
import { aStepsRenderRequestSchema, type AStepsCreateResponse } from "@/lib/service-a";

/**
 * Create a steps-format Service A render: a silent 1×1 set (one hook clip x
 * one hook line) composed from an APPROVED step plan, pinned by id — never
 * "latest", so a fork mid-flow cannot switch what renders. Core re-enforces
 * the hard gates (demo ready, plan approved + belonging to this demo); the
 * route verifies the referenced rows belong to this business so a foreign id
 * gets its proper 403/404 instead of an unmapped 500.
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

    const body = aStepsRenderRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);
    const { demoId, stepPlanId, hookClipId, hookLineScriptId, textSafeArea } = body.data;

    const demoFound = await requireDemo(db, demoId, auth.userId);
    if ("response" in demoFound) return demoFound.response;
    if (demoFound.demo.businessId !== businessId) {
      return jsonError(403, "הסרטון לא שייך לעסק הזה.");
    }

    // Ownership resolves through the plan's own demo; a plan pinned to a
    // DIFFERENT demo than the one in the body is a malformed request (the
    // wizard pins both together), not a state the customer can fix.
    const planFound = await requirePlan(db, stepPlanId, auth.userId);
    if ("response" in planFound) return planFound.response;
    if (planFound.plan.demoId !== demoId) return jsonError(400, INVALID_BODY);

    const hookLineRows = await db
      .select()
      .from(schema.scripts)
      .where(eq(schema.scripts.id, hookLineScriptId))
      .limit(1);
    if (!hookLineRows[0]) return jsonError(404, "משפט הפתיחה לא נמצא.");
    if (hookLineRows[0].businessId !== businessId) {
      return jsonError(403, "משפט הפתיחה לא שייך לעסק הזה.");
    }

    // Existence AND active — hook clips are the founder's shared bank, not
    // owned rows, and retirement is active=false, never deletion (renders
    // reference clip ids). A clip retired mid-session would otherwise debit
    // and ship in a paid ad; the gallery only serves active clips, so to the
    // customer a retired one is simply gone — 404, pick another.
    const hookRows = await db
      .select({ id: schema.hookClips.id })
      .from(schema.hookClips)
      .where(and(eq(schema.hookClips.id, hookClipId), eq(schema.hookClips.active, true)))
      .limit(1);
    if (!hookRows[0]) return jsonError(404, "הפתיח לא נמצא.");

    const { renders } = await createSet(db, {
      businessId,
      demoId,
      grid: {
        hookClipIds: [hookClipId],
        hookLineScriptIds: [hookLineScriptId],
        mode: "silent",
        format: "steps",
        stepPlanId,
        textSafeArea,
      },
    });
    // The post-debit balance, re-queried after the commit (exact under
    // concurrent ledger movement; the quote is not in hand here) — the wizard
    // pushes it into the sidebar's BalanceProvider, which is the whole
    // balance-freshness design: a push at the moment of the spend, never a
    // router.refresh() that would re-run the wizard page's server gate.
    const balance = (await isAdminOwned(db, businessId))
      ? null
      : await creditBalance(db, await businessOwnerId(db, businessId));
    return NextResponse.json({ renderId: renders[0]!.id, balance } satisfies AStepsCreateResponse);
  } catch (err) {
    return coreErrorResponse(err);
  }
}
