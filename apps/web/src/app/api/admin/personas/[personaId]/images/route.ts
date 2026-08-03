import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { addPersonaImage, getDb, schema } from "@aiugc/core";
import { coreErrorResponse, INVALID_BODY, jsonError, NOT_FOUND, requireAdmin } from "@/lib/api";
import { referenceImageError, imageDimensions } from "@/lib/admin";
import { isUuid } from "@/lib/service-b";

/**
 * Reference-image upload. Multipart form: "image" (the client sends a
 * center-cropped 1080x1920 JPEG, but the bytes are re-validated here — never
 * trust the client). Stored through the extended addPersonaImage, which keeps
 * the storage.put()/contentTypeForKey path — no temp files.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ personaId: string }> },
) {
  const { personaId } = await params;
  const db = getDb();
  const auth = await requireAdmin(db);
  if ("response" in auth) return auth.response;

  try {
    if (!isUuid(personaId)) return jsonError(404, NOT_FOUND);
    const personaRows = await db
      .select({ id: schema.personas.id })
      .from(schema.personas)
      .where(eq(schema.personas.id, personaId))
      .limit(1);
    if (!personaRows[0]) return jsonError(404, NOT_FOUND);

    const form = await request.formData().catch(() => null);
    const image = form?.get("image");
    if (!(image instanceof File)) return jsonError(400, INVALID_BODY);

    const bytes = Buffer.from(await image.arrayBuffer());
    const invalid = referenceImageError(bytes);
    if (invalid) return jsonError(400, invalid);

    const added = await addPersonaImage(db, {
      personaId,
      bytes,
      extension: imageDimensions(bytes)!.extension,
    });
    return NextResponse.json({ imageId: added.id });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
