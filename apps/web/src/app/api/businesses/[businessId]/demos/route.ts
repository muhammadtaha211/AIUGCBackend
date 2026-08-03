import { NextResponse } from "next/server";
import { getDb, registerUploadedDemo } from "@aiugc/core";
import {
  coreErrorResponse,
  INVALID_BODY,
  jsonError,
  requireBusiness,
  requireUser,
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
