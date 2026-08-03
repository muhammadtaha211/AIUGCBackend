import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { createSet, getDb, schema } from "@aiugc/core";
import {
  coreErrorResponse,
  INVALID_BODY,
  jsonError,
  requireBusiness,
  requireDemo,
  requireUser,
} from "@/lib/api";
import { aRenderRequestSchema } from "@/lib/service-a";

/**
 * Create a Service A render: a single-variant set (one hook clip x one hook
 * line, voiced). Core enforces the hard gates (demo ready, approved audio,
 * persona for an avatar ending) and computes the conditional ending; the
 * route only verifies the referenced rows belong to this business.
 * The variant grid stays CLI-only.
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

    const body = aRenderRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);
    const { demoId, hookClipId, hookLineScriptId, audioId, personaId } = body.data;

    const demoFound = await requireDemo(db, demoId, auth.userId);
    if ("response" in demoFound) return demoFound.response;
    if (demoFound.demo.businessId !== businessId) {
      return jsonError(403, "הסרטון לא שייך לעסק הזה.");
    }

    const hookLineRows = await db
      .select()
      .from(schema.scripts)
      .where(eq(schema.scripts.id, hookLineScriptId))
      .limit(1);
    if (!hookLineRows[0]) return jsonError(404, "משפט הפתיחה לא נמצא.");
    if (hookLineRows[0].businessId !== businessId) {
      return jsonError(403, "משפט הפתיחה לא שייך לעסק הזה.");
    }

    const audioRows = await db
      .select({ audio: schema.audioRenders, businessId: schema.scripts.businessId })
      .from(schema.audioRenders)
      .innerJoin(schema.scripts, eq(schema.audioRenders.scriptId, schema.scripts.id))
      .where(eq(schema.audioRenders.id, audioId))
      .limit(1);
    if (!audioRows[0]) return jsonError(404, "האודיו לא נמצא.");
    if (audioRows[0].businessId !== businessId) {
      return jsonError(403, "האודיו לא שייך לעסק הזה.");
    }

    const { renders } = await createSet(db, {
      businessId,
      demoId,
      grid: {
        hookClipIds: [hookClipId],
        hookLineScriptIds: [hookLineScriptId],
        mode: "voiced",
        audioRenderId: audioId,
        personaId,
      },
    });
    return NextResponse.json({ renderId: renders[0]!.id });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
