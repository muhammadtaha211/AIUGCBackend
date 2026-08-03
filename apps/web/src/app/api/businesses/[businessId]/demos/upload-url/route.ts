import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getStorage, getDb } from "@aiugc/core";
import {
  coreErrorResponse,
  INVALID_BODY,
  jsonError,
  requireBusiness,
  requireUser,
} from "@/lib/api";
import { demoFileError, demoUploadPath, uploadUrlRequestSchema } from "@/lib/service-a";

/**
 * Step 1 of the demo upload: hand the browser a signed upload target in the
 * raw bucket. Demo videos are far over Vercel's route body limit, so the
 * bytes go browser -> storage directly; a follow-up POST to ../demos
 * registers the uploaded object and queues ingest.
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

    const body = uploadUrlRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);
    const invalid = demoFileError(body.data);
    if (invalid) return jsonError(400, invalid);

    const uploadPath = demoUploadPath(businessId, randomUUID(), body.data.type);
    const uploadUrl = await getStorage().createSignedUploadUrl(uploadPath);
    return NextResponse.json({ uploadUrl, uploadPath });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
