import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { generateVoScript, getDb, schema } from "@aiugc/core";
import {
  coreErrorResponse,
  INVALID_BODY,
  jsonError,
  requireBusiness,
  requireUser,
} from "@/lib/api";
import { voScriptRequestSchema } from "@/lib/service-a";

/**
 * Generate the Service A voiceover script: word budget from the demo length,
 * voice (and the avatar-outro face) from the persona. Synchronous — one LLM
 * call — and edits go through POST /api/scripts/[id]/text.
 */
export async function POST(
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

    const body = voScriptRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);

    const demoRows = await db
      .select({ businessId: schema.demos.businessId })
      .from(schema.demos)
      .where(eq(schema.demos.id, body.data.demoId))
      .limit(1);
    if (!demoRows[0]) return jsonError(404, "הסרטון לא נמצא.");
    if (demoRows[0].businessId !== businessId) {
      return jsonError(403, "הסרטון לא שייך לעסק הזה.");
    }

    const script = await generateVoScript(db, {
      businessId,
      demoId: body.data.demoId,
      selectedAdvantages: body.data.selectedAdvantages,
      personaId: body.data.personaId,
    });
    const { wordBudget } = script.params as { wordBudget?: number };
    return NextResponse.json({ scriptId: script.id, text: script.text, wordBudget });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
