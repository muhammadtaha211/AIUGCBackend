import { eq } from "drizzle-orm";
import { getDb, getStorage, schema } from "@aiugc/core";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/api";
import { personaThumbnail } from "@/lib/service-b";
import type { Persona } from "@/lib/service-b-ui";

/**
 * The persona catalog for the pickers: active personas with their card
 * thumbnail (kind='preview' preferred, then the default image, then newest)
 * and blur placeholder. A persona without stored images is not renderable and
 * is excluded.
 *
 * The ONE query path for every surface that shows the catalog — the
 * /api/personas route and the server pages that inline it into first paint
 * (/home preload hints, the wizard shells). Callers handle auth; reads use the
 * service role like every route (personas are founder catalog data any
 * signed-in user may see — 0002/0007 declare the same in RLS).
 */
export async function loadPersonaCatalog(): Promise<Persona[]> {
  const db = getDb();
  const { personas, personaImages } = schema;
  const rows = await db
    .select({
      id: personas.id,
      name: personas.name,
      gender: personas.gender,
      filePath: personaImages.filePath,
      catalogPath: personaImages.catalogPath,
      blurDataUrl: personaImages.blurDataUrl,
      kind: personaImages.kind,
      retired: personaImages.retired,
      isDefault: personaImages.isDefault,
      createdAt: personaImages.createdAt,
    })
    .from(personas)
    .innerJoin(personaImages, eq(personaImages.personaId, personas.id))
    .where(eq(personas.active, true))
    .orderBy(personas.createdAt);

  const byPersona = new Map<
    string,
    { name: string; gender: string | null; images: (typeof rows)[number][] }
  >();
  for (const row of rows) {
    const entry = byPersona.get(row.id) ?? { name: row.name, gender: row.gender, images: [] };
    entry.images.push(row);
    byPersona.set(row.id, entry);
  }

  // Catalog copies serve from a stable PUBLIC URL (cacheable, no storage
  // round-trip). Pre-backfill rows fall back to signing, in parallel.
  const storage = getStorage();
  return Promise.all(
    [...byPersona].flatMap(([id, { name, gender, images }]) => {
      const thumbnail = personaThumbnail(images);
      if (!thumbnail) return [];
      const url = thumbnail.catalogPath
        ? Promise.resolve(storage.publicUrl(thumbnail.catalogPath))
        : storage.signedUrl(thumbnail.filePath, SIGNED_URL_TTL_SECONDS);
      return url.then((imageUrl) => ({
        id,
        name,
        gender,
        imageUrl,
        blurDataUrl: thumbnail.blurDataUrl,
      }));
    }),
  );
}

/**
 * Only stable URLs are worth cross-page preloading: a signed fallback URL is
 * minted per render, so the wizard would request a different token and the
 * preloaded bytes would be dead weight.
 */
export function isStableCatalogUrl(imageUrl: string): boolean {
  return imageUrl.includes("/object/public/");
}
