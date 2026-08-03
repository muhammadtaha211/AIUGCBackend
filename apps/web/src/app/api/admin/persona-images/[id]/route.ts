import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema, setDefaultPersonaImage, setPersonaImageRetired } from "@aiugc/core";
import { coreErrorResponse, INVALID_BODY, jsonError, NOT_FOUND, requireAdmin } from "@/lib/api";
import { imagePatchSchema } from "@/lib/admin";
import { isUuid } from "@/lib/service-b";

/**
 * One image action per PATCH: label edit, kind toggle, retire/un-retire
 * (soft delete — hard deletes are forbidden), or make-default. Default-move
 * and the cannot-retire-the-default guard live in core, not here.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const auth = await requireAdmin(db);
  if ("response" in auth) return auth.response;

  try {
    if (!isUuid(id)) return jsonError(404, NOT_FOUND);
    const rows = await db
      .select({ id: schema.personaImages.id })
      .from(schema.personaImages)
      .where(eq(schema.personaImages.id, id))
      .limit(1);
    if (!rows[0]) return jsonError(404, NOT_FOUND);

    const body = imagePatchSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);
    const patch = body.data;

    if (patch.label !== undefined) {
      await db
        .update(schema.personaImages)
        .set({ label: patch.label === "" ? null : patch.label })
        .where(eq(schema.personaImages.id, id));
    }
    if (patch.kind !== undefined) {
      await db
        .update(schema.personaImages)
        .set({ kind: patch.kind })
        .where(eq(schema.personaImages.id, id));
    }
    if (patch.retired !== undefined) await setPersonaImageRetired(db, id, patch.retired);
    if (patch.makeDefault) await setDefaultPersonaImage(db, id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
