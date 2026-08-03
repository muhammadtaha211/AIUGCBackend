import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, getStorage, schema } from "@aiugc/core";
import { coreErrorResponse, requireUser, SIGNED_URL_TTL_SECONDS } from "@/lib/api";
import { personaThumbnail } from "@/lib/service-b";

/**
 * The persona catalog for the picker: active personas with a signed card
 * thumbnail (kind='preview' preferred, then the default image, then newest).
 * A persona without stored images is not renderable and is excluded.
 */
export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const { personas, personaImages } = schema;
    const rows = await db
      .select({
        id: personas.id,
        name: personas.name,
        filePath: personaImages.filePath,
        kind: personaImages.kind,
        retired: personaImages.retired,
        isDefault: personaImages.isDefault,
        createdAt: personaImages.createdAt,
      })
      .from(personas)
      .innerJoin(personaImages, eq(personaImages.personaId, personas.id))
      .where(eq(personas.active, true))
      .orderBy(personas.createdAt);

    const byPersona = new Map<string, { name: string; images: (typeof rows)[number][] }>();
    for (const row of rows) {
      const entry = byPersona.get(row.id) ?? { name: row.name, images: [] };
      entry.images.push(row);
      byPersona.set(row.id, entry);
    }

    const storage = getStorage();
    const result = [];
    for (const [id, { name, images }] of byPersona) {
      const thumbnail = personaThumbnail(images);
      if (!thumbnail) continue;
      result.push({
        id,
        name,
        imageUrl: await storage.signedUrl(thumbnail.filePath, SIGNED_URL_TTL_SECONDS),
      });
    }
    return NextResponse.json({ personas: result });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
