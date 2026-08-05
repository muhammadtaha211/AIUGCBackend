import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb, getStorage, registerUploadedDemo, schema } from "@aiugc/core";
import {
  coreErrorResponse,
  INVALID_BODY,
  jsonError,
  requireBusiness,
  requireUser,
  SIGNED_URL_TTL_SECONDS,
} from "@/lib/api";
import { isOwnedDemoUploadPath, registerDemoRequestSchema } from "@/lib/service-a";

/**
 * Step 2 of the demo upload: the browser finished its direct upload — register
 * the object as a demo row and queue ingest (probe -> 8-60s gates -> normalize).
 * Only paths this business's own upload-url route minted are accepted.
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

    const body = registerDemoRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);
    if (!isOwnedDemoUploadPath(businessId, body.data.uploadPath)) {
      return jsonError(400, INVALID_BODY);
    }

    const demo = await registerUploadedDemo(db, { businessId, rawPath: body.data.uploadPath });
    return NextResponse.json({ demoId: demo.id });
  } catch (err) {
    return coreErrorResponse(err);
  }
}

/**
 * This business's demos, newest first — the wizard's reuse picker (ready only,
 * filtered client-side) and the /home/demos library (all statuses). Thumbs are
 * signed short-lived, same shape the /api/demos/[id] poll returns.
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

    const { demos: demosTable } = schema;
    const rows = await db
      .select({
        id: demosTable.id,
        status: demosTable.status,
        rejectReason: demosTable.rejectReason,
        description: demosTable.description,
        durationMs: demosTable.durationMs,
        thumbPath: demosTable.thumbPath,
        createdAt: demosTable.createdAt,
      })
      .from(demosTable)
      .where(eq(demosTable.businessId, businessId))
      .orderBy(desc(demosTable.createdAt));

    const storage = getStorage();
    const demos = [];
    for (const row of rows) {
      demos.push({
        id: row.id,
        status: row.status,
        rejectReason: row.rejectReason ?? undefined,
        description: row.description ?? undefined,
        durationMs: row.durationMs ?? undefined,
        createdAt: row.createdAt,
        thumbUrl: row.thumbPath
          ? await storage.signedUrl(row.thumbPath, SIGNED_URL_TTL_SECONDS)
          : undefined,
      });
    }
    return NextResponse.json({ demos });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
