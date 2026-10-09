import { and, eq, exists, isNotNull, like, sql } from "drizzle-orm";
import { getDb, getStorage, schema } from "@aiugc/core";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/api";
import { personaThumbnail, type CatalogService } from "@/lib/service-b";
import type { Persona } from "@/lib/service-b-ui";

/**
 * The persona catalog for the pickers: active personas with their card
 * thumbnail and blur placeholder. Which thumbnail — and which personas — is
 * the service's call (personaThumbnail):
 *
 * - "a": personas that own at least one ACTIVE hook clip, with a portrait
 *   thumbnail. The hook bank is a persona × clip matrix and the gallery lists
 *   one persona's column, so a persona with an empty column would dead-end
 *   the customer on an empty gallery.
 * - "b": personas with a voice and a usable selfie (personaSelfie), and that
 *   selfie IS the thumbnail — the card shows the exact image the render
 *   animates, and its id rides along as `personaImageId` so the wizard can
 *   send it back. A persona without a selfie is dropped the same way a persona
 *   without any stored image is dropped: no thumbnail, no card. The voice is
 *   optional since 0055 (a character for גוש טקסט alone has none), and a
 *   voiceless persona is never in B's picker, selfie or not (decision 0099, R1).
 * - "c": personas that own at least one usable גוש טקסט clip
 *   (usableTextBlockClip), with A's portrait thumbnail — the same reason as
 *   "a": the clip gallery lists one character's clips, so a character with
 *   none would dead-end the customer (decision 0099 §4).
 *
 * The ONE query path for every surface that shows the catalog — the
 * /api/personas route and the server pages that inline it into first paint
 * (/home preload hints, the wizard shells). Callers handle auth; reads use the
 * service role like every route (personas are founder catalog data any
 * signed-in user may see — 0002/0007 declare the same in RLS).
 */
export async function loadPersonaCatalog(service: CatalogService): Promise<Persona[]> {
  const db = getDb();
  const { personas, personaImages, hookClips, textBlockClips } = schema;
  const active = eq(personas.active, true);
  const hasHookClips = exists(
    db
      .select({ one: sql`1` })
      .from(hookClips)
      .where(and(eq(hookClips.personaId, personas.id), eq(hookClips.active, true))),
  );
  const hasTextBlockClips = exists(
    db
      .select({ one: sql`1` })
      .from(textBlockClips)
      .where(usableTextBlockClip),
  );
  const where = {
    a: and(active, hasHookClips),
    b: and(active, isNotNull(personas.voiceId)),
    c: and(active, hasTextBlockClips),
  }[service];
  const rows = await db
    .select({
      id: personas.id,
      name: personas.name,
      gender: personas.gender,
      imageId: personaImages.id,
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
    .where(where)
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
      const thumbnail = personaThumbnail(images, service);
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
        ...(service === "b" ? { personaImageId: thumbnail.imageId } : {}),
      }));
    }),
  );
}

/**
 * A גוש טקסט clip a customer may see and use (decision 0099 §4): active,
 * finished uploading (a stranded "pending" row has no "/"), and of an ACTIVE
 * character — core's requireUsableClip rule for a customer business. The "c"
 * catalog lists a character exactly when it owns one, and the clip listing,
 * the next-text route and the render route accept exactly these, so the
 * picker never offers a character whose gallery is empty or a clip a later
 * step refuses. Names `personas`, so the query must have it in scope (the
 * catalog's outer row, or a join on the clip's persona_id).
 */
export const usableTextBlockClip = and(
  eq(schema.textBlockClips.personaId, schema.personas.id),
  eq(schema.textBlockClips.active, true),
  like(schema.textBlockClips.filePath, "%/%"),
  eq(schema.personas.active, true),
);

/**
 * Only stable URLs are worth cross-page preloading: a signed fallback URL is
 * minted per render, so the wizard would request a different token and the
 * preloaded bytes would be dead weight.
 */
export function isStableCatalogUrl(imageUrl: string): boolean {
  return imageUrl.includes("/object/public/");
}
