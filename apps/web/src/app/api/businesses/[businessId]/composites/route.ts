import { NextResponse } from "next/server";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createComposite, getDb, schema } from "@aiugc/core";
import {
  coreErrorResponse,
  INVALID_BODY,
  jsonError,
  NOT_FOUND,
  requireBusiness,
  requireUser,
} from "@/lib/api";
import { canUseComposites, isUuid, PHOTO_EXTENSIONS, photoError } from "@/lib/service-b";

/**
 * Product photo upload -> queued persona-holding-product composite.
 * Multipart form: "photo" (the image file) + "personaId". Physical-product
 * businesses only — same gate core enforces, checked here before storing.
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
    if (!canUseComposites(owned.business.questionnaire)) {
      return jsonError(400, "תמונת דמות עם המוצר זמינה רק לעסקים עם מוצר פיזי.");
    }

    const form = await request.formData().catch(() => null);
    const photo = form?.get("photo");
    const personaId = form?.get("personaId");
    if (!form || !(photo instanceof File) || typeof personaId !== "string" || !isUuid(personaId)) {
      return jsonError(400, INVALID_BODY);
    }
    const invalidPhoto = photoError(photo);
    if (invalidPhoto) return jsonError(400, invalidPhoto);

    const personaRows = await db
      .select({ id: schema.personas.id })
      .from(schema.personas)
      .where(eq(schema.personas.id, personaId))
      .limit(1);
    if (!personaRows[0]) return jsonError(404, NOT_FOUND);

    // Core takes a local file path; buffer the upload to a temp file it can
    // store under the storageKey conventions.
    const dir = mkdtempSync(path.join(tmpdir(), "aiugc-upload-"));
    try {
      const localFile = path.join(dir, `product${PHOTO_EXTENSIONS[photo.type]}`);
      writeFileSync(localFile, Buffer.from(await photo.arrayBuffer()));
      const composite = await createComposite(db, {
        businessId,
        personaId,
        productImageFile: localFile,
      });
      return NextResponse.json({ compositeId: composite.id });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch (err) {
    return coreErrorResponse(err);
  }
}
