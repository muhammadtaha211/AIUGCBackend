import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@aiugc/core";
import { coreErrorResponse, INVALID_BODY, jsonError, NOT_FOUND, requireAdmin } from "@/lib/api";
import { isUuid } from "@/lib/admin";
import { PERSONA_WITHOUT_GENDER, textBlockPatchSchema } from "@/lib/text-blocks";

/**
 * One clip action per PATCH: active toggle (the retire mechanism — render
 * params reference clip ids, so rows are never deleted), safe-area update,
 * the block's colour, or the character. Assigning a character writes its
 * gender in the same UPDATE — the speaker is the character's (decision 0099
 * §3); null unassigns and leaves the gender as it was.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const auth = await requireAdmin(db);
  if ("response" in auth) return auth.response;

  try {
    if (!isUuid(id)) return jsonError(404, NOT_FOUND);
    const rows = await db
      .select({ id: schema.textBlockClips.id })
      .from(schema.textBlockClips)
      .where(eq(schema.textBlockClips.id, id))
      .limit(1);
    if (!rows[0]) return jsonError(404, NOT_FOUND);

    const body = textBlockPatchSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);
    const patch = body.data;
    let speakerGender: string | undefined;
    if (patch.personaId) {
      const persona = (
        await db
          .select({ gender: schema.personas.gender })
          .from(schema.personas)
          .where(eq(schema.personas.id, patch.personaId))
          .limit(1)
      )[0];
      if (!persona) return jsonError(400, "הדמות לא נמצאה.");
      if (persona.gender === null) return jsonError(400, PERSONA_WITHOUT_GENDER);
      speakerGender = persona.gender;
    }

    await db
      .update(schema.textBlockClips)
      .set({
        ...(patch.active !== undefined ? { active: patch.active } : {}),
        ...(patch.textSafeArea !== undefined ? { textSafeArea: patch.textSafeArea } : {}),
        ...(patch.textColor !== undefined ? { textColor: patch.textColor } : {}),
        ...(patch.personaId !== undefined ? { personaId: patch.personaId } : {}),
        ...(speakerGender !== undefined ? { speakerGender } : {}),
      })
      .where(eq(schema.textBlockClips.id, id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
