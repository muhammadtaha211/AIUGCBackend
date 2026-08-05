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
import { DEMO_PAGE_SIZE } from "@/lib/service-a-ui";

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
 * This business's demos, newest first. Two callers, two shapes:
 * - `?page=N` (1-based): the wizard's reuse picker — ready demos only,
 *   DEMO_PAGE_SIZE per page plus the ready total, and only the page's
 *   thumbnails get signed (signing is the expensive part).
 * - no query: the /home/demos library — every row, every thumb signed.
 * Thumbs are signed short-lived, same shape the /api/demos/[id] poll returns.
 */
export async function GET(
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

    const page = Number(new URL(request.url).searchParams.get("page"));
    const paged = Number.isInteger(page) && page >= 1;
    const ready = paged ? rows.filter((row) => row.status === "ready") : rows;
    const pageRows = paged
      ? ready.slice((page - 1) * DEMO_PAGE_SIZE, page * DEMO_PAGE_SIZE)
      : ready;

    const storage = getStorage();
    const demos = await Promise.all(
      pageRows.map(async (row) => ({
        id: row.id,
        status: row.status,
        rejectReason: row.rejectReason ?? undefined,
        description: row.description ?? undefined,
        durationMs: row.durationMs ?? undefined,
        createdAt: row.createdAt,
        thumbUrl: row.thumbPath
          ? await storage.signedUrl(row.thumbPath, SIGNED_URL_TTL_SECONDS)
          : undefined,
      })),
    );
    return NextResponse.json(paged ? { demos, total: ready.length } : { demos });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
