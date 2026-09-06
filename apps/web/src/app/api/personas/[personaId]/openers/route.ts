import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, getStorage, schema } from "@aiugc/core";
import type { SafeRect } from "@aiugc/core/hook-geometry";
import {
  coreErrorResponse,
  jsonError,
  NOT_FOUND,
  requireUser,
  SIGNED_URL_TTL_SECONDS,
} from "@/lib/api";
import { isUuid, personaOpeners } from "@/lib/service-b";

/**
 * The effect step's cards: the active opener clips made from the persona's
 * selfie — the same row the catalog card shows (personaSelfie), so the
 * opener, the card and the render agree on one image. Signed preview URLs,
 * oldest first, with reveal_at_ms and the text safe area that seeds the
 * placement editor. Catalog data like /api/personas: any signed-in user may
 * read the clips of an active persona.
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
    const { personas, personaImages, openerClips } = schema;
    const personaRows = await db
      .select({ id: personas.id })
      .from(personas)
      .where(and(eq(personas.id, personaId), eq(personas.active, true)))
      .limit(1);
    if (!personaRows[0]) return jsonError(404, NOT_FOUND);

    const images = await db
      .select({
        id: personaImages.id,
        kind: personaImages.kind,
        filePath: personaImages.filePath,
        retired: personaImages.retired,
        isDefault: personaImages.isDefault,
        createdAt: personaImages.createdAt,
      })
      .from(personaImages)
      .where(eq(personaImages.personaId, personaId));

    // Every clip of every image of this persona; personaOpeners keeps the
    // selfie's active ones. The join is the persona scope — clips carry no
    // persona_id of their own.
    const clips = await db
      .select({
        id: openerClips.id,
        personaImageId: openerClips.personaImageId,
        effect: openerClips.effect,
        label: openerClips.label,
        filePath: openerClips.filePath,
        revealAtMs: openerClips.revealAtMs,
        textSafeArea: openerClips.textSafeArea,
        active: openerClips.active,
      })
      .from(openerClips)
      .innerJoin(personaImages, eq(personaImages.id, openerClips.personaImageId))
      .where(eq(personaImages.personaId, personaId))
      .orderBy(openerClips.createdAt);

    const storage = getStorage();
    const openers = [];
    for (const clip of personaOpeners(images, clips)) {
      openers.push({
        id: clip.id,
        effect: clip.effect,
        label: clip.label,
        previewUrl: await storage.signedUrl(clip.filePath, SIGNED_URL_TTL_SECONDS),
        revealAtMs: clip.revealAtMs,
        textSafeArea: clip.textSafeArea as SafeRect,
      });
    }
    return NextResponse.json({ openers });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
