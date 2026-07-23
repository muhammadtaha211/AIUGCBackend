import { NextResponse } from "next/server";
import { and, desc, eq, ne } from "drizzle-orm";
import { createBRender, getDb, getStorage, schema } from "@aiugc/core";
import {
  coreErrorResponse,
  INVALID_BODY,
  jsonError,
  requireBusiness,
  requireUser,
  SIGNED_URL_TTL_SECONDS,
} from "@/lib/api";
import { renderRequestSchema } from "@/lib/service-b";

/**
 * Create a Service B render. Core enforces the hard gates (approved audio,
 * approved composite takes precedence as the lipsync source); the route only
 * verifies the referenced rows belong to this business, then enqueues.
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

    const body = renderRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);
    const { scriptId, audioId, personaId, compositeId } = body.data;

    const scriptRows = await db
      .select()
      .from(schema.scripts)
      .where(eq(schema.scripts.id, scriptId))
      .limit(1);
    if (!scriptRows[0]) return jsonError(404, "התסריט לא נמצא.");
    if (scriptRows[0].businessId !== businessId) {
      return jsonError(403, "התסריט לא שייך לעסק הזה.");
    }

    const audioRows = await db
      .select()
      .from(schema.audioRenders)
      .where(eq(schema.audioRenders.id, audioId))
      .limit(1);
    if (!audioRows[0]) return jsonError(404, "האודיו לא נמצא.");
    if (audioRows[0].scriptId !== scriptId) {
      return jsonError(400, "האודיו לא שייך לתסריט הזה.");
    }

    if (compositeId) {
      const compositeRows = await db
        .select()
        .from(schema.composites)
        .where(eq(schema.composites.id, compositeId))
        .limit(1);
      if (!compositeRows[0]) return jsonError(404, "תמונת הדמות עם המוצר לא נמצאה.");
      if (compositeRows[0].businessId !== businessId) {
        return jsonError(403, "תמונת הדמות עם המוצר לא שייכת לעסק הזה.");
      }
    }

    const render = await createBRender(db, {
      businessId,
      audioRenderId: audioId,
      personaId,
      compositeId,
    });
    return NextResponse.json({ renderId: render.id });
  } catch (err) {
    return coreErrorResponse(err);
  }
}

/**
 * The homepage strip: newest 20 renders. Rejected rows stay internal (a
 * regenerated render replaces them), and thumbnails are signed only after
 * release — the customer never sees Service B output before the QC gate.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ businessId: string }> },
) {
  const { businessId } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const owned = await requireBusiness(db, businessId, auth.userId);
    if ("response" in owned) return owned.response;

    const { videoRenders } = schema;
    const rows = await db
      .select({
        id: videoRenders.id,
        status: videoRenders.status,
        createdAt: videoRenders.createdAt,
        thumbPath: videoRenders.thumbPath,
      })
      .from(videoRenders)
      .where(and(eq(videoRenders.businessId, businessId), ne(videoRenders.status, "rejected")))
      .orderBy(desc(videoRenders.createdAt))
      .limit(20);

    const storage = getStorage();
    const renders = [];
    for (const row of rows) {
      renders.push({
        id: row.id,
        status: row.status,
        createdAt: row.createdAt,
        thumbUrl:
          row.status === "released" && row.thumbPath
            ? await storage.signedUrl(row.thumbPath, SIGNED_URL_TTL_SECONDS)
            : undefined,
      });
    }
    return NextResponse.json({ renders });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
