import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, quoteBRender, schema } from "@aiugc/core";
import {
  coreErrorResponse,
  INVALID_BODY,
  jsonError,
  requireBusiness,
  requireUser,
} from "@/lib/api";
import { renderPreviewRequestSchema } from "@/lib/service-b";

/**
 * What the Service B render will cost, AFTER audio approval and BEFORE
 * anything is enqueued. The step that follows used to fire createBRender from
 * a mount effect, so navigating into it spent credits; this endpoint is what
 * lets that step become an explicit confirm instead.
 *
 * Advisory only — nothing here debits. The 402 at confirm stays the real gate.
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

    const body = renderPreviewRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);

    // The audio must belong to this business — scripts carry the ownership.
    const audioRows = await db
      .select({ audio: schema.audioRenders, businessId: schema.scripts.businessId })
      .from(schema.audioRenders)
      .innerJoin(schema.scripts, eq(schema.audioRenders.scriptId, schema.scripts.id))
      .where(eq(schema.audioRenders.id, body.data.audioId))
      .limit(1);
    if (!audioRows[0]) return jsonError(404, "האודיו לא נמצא.");
    if (audioRows[0].businessId !== businessId) {
      return jsonError(403, "האודיו לא שייך לעסק הזה.");
    }

    // The same function createBRender debits from.
    const quote = await quoteBRender(db, { businessId, audioRenderId: body.data.audioId });
    return NextResponse.json({
      voSeconds: (audioRows[0].audio.durationMs ?? 0) / 1000,
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
