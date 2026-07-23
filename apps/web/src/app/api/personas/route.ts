import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, getStorage, schema } from "@aiugc/core";
import { coreErrorResponse, requireUser, SIGNED_URL_TTL_SECONDS } from "@/lib/api";

/**
 * The persona catalog for the picker: active personas with their default
 * reference image, signed. A persona without images is not renderable and is
 * excluded (the inner join does that).
 */
export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const { personas, personaImages } = schema;
    const rows = await db
      .select({ id: personas.id, name: personas.name, filePath: personaImages.filePath })
      .from(personas)
      .innerJoin(
        personaImages,
        and(eq(personaImages.personaId, personas.id), eq(personaImages.isDefault, true)),
      )
      .where(eq(personas.active, true))
      .orderBy(personas.createdAt);

    const storage = getStorage();
    const result = [];
    for (const row of rows) {
      result.push({
        id: row.id,
        name: row.name,
        imageUrl: await storage.signedUrl(row.filePath, SIGNED_URL_TTL_SECONDS),
      });
    }
    return NextResponse.json({ personas: result });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
