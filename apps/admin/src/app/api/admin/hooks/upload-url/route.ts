import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb, getStorage } from "@aiugc/core";
import { coreErrorResponse, INVALID_BODY, jsonError, requireAdmin } from "@/lib/api";
import { hookFileError, hookUploadPath, uploadUrlRequestSchema } from "@/lib/hooks";

/**
 * Step 1 of the hook-clip upload: hand the browser a signed upload target.
 * Video bytes never pass through a route handler (same flow as the customer
 * demo upload); a follow-up POST to ../hooks registers the uploaded object.
 */
export async function POST(request: Request) {
  const db = getDb();
  const auth = await requireAdmin(db);
  if ("response" in auth) return auth.response;

  try {
    const body = uploadUrlRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);
    const invalid = hookFileError(body.data);
    if (invalid) return jsonError(400, invalid);

    const uploadPath = hookUploadPath(randomUUID());
    const uploadUrl = await getStorage().createSignedUploadUrl(uploadPath);
    return NextResponse.json({ uploadUrl, uploadPath });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
