import { NextResponse } from "next/server";
import { getDb, updatePersona } from "@aiugc/core";
import { coreErrorResponse, INVALID_BODY, jsonError, NOT_FOUND, requireAdmin } from "@/lib/api";
import { isUuid, personaPatchSchema } from "@/lib/admin";

/**
 * Edit a persona's name, voice id or gender — any subset per PATCH. The
 * missing-row check lives in core (updatePersona throws "not found", which
 * coreErrorResponse maps to the Hebrew 404), not here.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ personaId: string }> },
) {
  const { personaId } = await params;
  const db = getDb();
  const auth = await requireAdmin(db);
  if ("response" in auth) return auth.response;

  try {
    if (!isUuid(personaId)) return jsonError(404, NOT_FOUND);
    const body = personaPatchSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);
    await updatePersona(db, personaId, body.data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
