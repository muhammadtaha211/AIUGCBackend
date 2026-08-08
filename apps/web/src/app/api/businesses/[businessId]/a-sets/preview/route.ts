import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, planAOutro, quoteASet, schema } from "@aiugc/core";
import {
  coreErrorResponse,
  INVALID_BODY,
  jsonError,
  requireBusiness,
  requireDemo,
  requireUser,
} from "@/lib/api";
import { aPreviewRequestSchema } from "@/lib/service-a";

/**
 * The advisory composition shape, AFTER audio approval and BEFORE enqueue:
 * the same planAOutro decision createSet will make, so a long ending is
 * chosen, never discovered. Advisory only — nothing here blocks the render.
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

    const body = aPreviewRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);

    const demoFound = await requireDemo(db, body.data.demoId, auth.userId);
    if ("response" in demoFound) return demoFound.response;
    if (demoFound.demo.businessId !== businessId) {
      return jsonError(403, "הסרטון לא שייך לעסק הזה.");
    }

    const hookRows = await db
      .select({ durationMs: schema.hookClips.durationMs })
      .from(schema.hookClips)
      .where(eq(schema.hookClips.id, body.data.hookClipId))
      .limit(1);
    if (!hookRows[0]) return jsonError(404, "הפתיח לא נמצא.");

    const plan = await planAOutro(db, {
      demoId: body.data.demoId,
      audioRenderId: body.data.audioId,
    });
    // The SAME function createSet debits from — the displayed integer and the
    // charged integer are one call, so they cannot drift.
    const quote = await quoteASet(db, {
      businessId,
      demoId: body.data.demoId,
      audioRenderId: body.data.audioId,
    });
    return NextResponse.json({
      hookSeconds: hookRows[0].durationMs / 1000,
      demoSeconds: plan.demoDurationMs / 1000,
      voSeconds: plan.voDurationMs / 1000,
      outroMode: plan.outroMode,
      outroSeconds: Math.max(0, plan.remainderMs) / 1000,
      // What the ending adds, already differenced server-side against the same
      // render without it. null = admin bypass, same rule as `quote` below.
      outroCredits: quote.chargeable ? quote.outroCredits : null,
      // null = admin bypass: nothing is charged, so nothing is shown.
      quote: quote.chargeable
        ? {
            credits: quote.creditsPerRender,
            balance: quote.balance,
            shortfall: Math.max(0, quote.creditsPerRender - quote.balance),
          }
        : null,
    });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
