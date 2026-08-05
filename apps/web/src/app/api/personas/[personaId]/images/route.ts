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
        catalogPath: personaImages.catalogPath,
        kind: personaImages.kind,
        retired: personaImages.retired,
        label: personaImages.label,
      })
      .from(personaImages)
      .where(eq(personaImages.personaId, personaId))
      .orderBy(personaImages.createdAt);

    // Catalog copies serve from a stable PUBLIC URL (cacheable, no storage
    // round-trip). Pre-backfill rows fall back to signing, in parallel.
    const storage = getStorage();
    const images = await Promise.all(
      backgroundImages(rows).map(async (row) => ({
        id: row.id,
        label: row.label ?? undefined,
        imageUrl: row.catalogPath
          ? storage.publicUrl(row.catalogPath)
          : await storage.signedUrl(row.filePath, SIGNED_URL_TTL_SECONDS),
      })),
    );
    return NextResponse.json({ images });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
