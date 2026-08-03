import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, getStorage, schema } from "@aiugc/core";
import {
  coreErrorResponse,
  jsonError,
  NOT_FOUND,
  requireUser,
  SIGNED_URL_TTL_SECONDS,
} from "@/lib/api";
import { backgroundImages, isUuid } from "@/lib/service-b";

/**
 * The background picker for one persona: stored kind='background' images,
 * signed, oldest first. Like /api/personas this is catalog data — any
 * signed-in user may read images of an active persona.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ personaId: string }> },
) {
  const { personaId } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    if (!isUuid(personaId)) return jsonError(404, NOT_FOUND);
    const db = getDb();
    const { personas, personaImages } = schema;
    const personaRows = await db
      .select({ id: personas.id })
      .from(personas)
      .where(and(eq(personas.id, personaId), eq(personas.active, true)))
      .limit(1);
    if (!personaRows[0]) return jsonError(404, NOT_FOUND);

    const rows = await db
      .select({
        id: personaImages.id,
        filePath: personaImages.filePath,
        kind: personaImages.kind,
        retired: personaImages.retired,
        label: personaImages.label,
      })
      .from(personaImages)
      .where(eq(personaImages.personaId, personaId))
      .orderBy(personaImages.createdAt);

    const storage = getStorage();
    const images = [];
    for (const row of backgroundImages(rows)) {
      images.push({
        id: row.id,
        label: row.label ?? undefined,
        imageUrl: await storage.signedUrl(row.filePath, SIGNED_URL_TTL_SECONDS),
      });
    }
    return NextResponse.json({ images });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
