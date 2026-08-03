import { NextResponse } from "next/server";
import { addPersona, getDb } from "@aiugc/core";
import { coreErrorResponse, INVALID_BODY, jsonError, requireAdmin } from "@/lib/api";
import { createPersonaSchema } from "@/lib/admin";

/** Founder-only: add a persona to the bank (name + pinned voice + gender). */
export async function POST(request: Request) {
  const db = getDb();
  const auth = await requireAdmin(db);
  if ("response" in auth) return auth.response;

  try {
    const body = createPersonaSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);
    const persona = await addPersona(db, {
      name: body.data.name,
      voiceId: body.data.voiceId,
      gender: body.data.gender,
    });
    return NextResponse.json({ personaId: persona.id });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
