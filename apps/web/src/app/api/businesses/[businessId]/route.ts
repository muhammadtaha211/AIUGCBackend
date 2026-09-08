import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema, setQuestionnaire } from "@aiugc/core";
import { coreErrorResponse, jsonError, requireBusiness, requireUser } from "@/lib/api";
import { businessPatchRequestSchema, INVALID_QUESTIONNAIRE } from "@/lib/settings";

/**
 * One business as /home/settings edits it. GET returns the name and the stored
 * questionnaire; PATCH replaces the questionnaire and renames when `name` is
 * sent. Both run the ownership gate. The questionnaire write goes through
 * core's setQuestionnaire like the onboarding route and the CLI — with the
 * body's demo_notes stripped first (businessPatchRequestSchema), so the
 * customer's answered moments survive a resave.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ businessId: string }> },
) {
  const { businessId } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const owned = await requireBusiness(db, businessId, auth.userId);
    if ("response" in owned) return owned.response;

    const { id, name, questionnaire } = owned.business;
    return NextResponse.json({ id, name, questionnaire });
  } catch (err) {
    return coreErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ businessId: string }> },
) {
  const { businessId } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const owned = await requireBusiness(db, businessId, auth.userId);
    if ("response" in owned) return owned.response;

    const body = businessPatchRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_QUESTIONNAIRE);

    // Returned with the stored demo_notes re-attached — the response is the
    // row as it now reads, not an echo of the request.
    const questionnaire = await setQuestionnaire(db, businessId, body.data.questionnaire);

    let name = owned.business.name;
    if (body.data.name !== undefined && body.data.name !== name) {
      await db
        .update(schema.businesses)
        .set({ name: body.data.name })
        .where(eq(schema.businesses.id, businessId));
      name = body.data.name;
    }

    return NextResponse.json({ ok: true, id: businessId, name, questionnaire });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
