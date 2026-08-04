import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@aiugc/core";
import { coreErrorResponse, INVALID_BODY, jsonError, NOT_FOUND, requireAdmin } from "@/lib/api";
import { isUuid } from "@/lib/admin";
import { hookPatchSchema } from "@/lib/hooks";

/**
 * One clip action per PATCH: active toggle (retire mechanism — variant params
 * reference clip ids, so rows are never deleted), safe-area update, or persona
 * (re)assignment (null = back to generic).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const auth = await requireAdmin(db);
  if ("response" in auth) return auth.response;

  try {
    if (!isUuid(id)) return jsonError(404, NOT_FOUND);
    const rows = await db
      .select({ id: schema.hookClips.id })
      .from(schema.hookClips)
      .where(eq(schema.hookClips.id, id))
      .limit(1);
    if (!rows[0]) return jsonError(404, NOT_FOUND);

    const body = hookPatchSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);
    const patch = body.data;

    await db
      .update(schema.hookClips)
      .set({
        ...(patch.active !== undefined ? { active: patch.active } : {}),
        ...(patch.textSafeArea !== undefined ? { textSafeArea: patch.textSafeArea } : {}),
        ...(patch.personaId !== undefined ? { personaId: patch.personaId } : {}),
      })
      .where(eq(schema.hookClips.id, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
