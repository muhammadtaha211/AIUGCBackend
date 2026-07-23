import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { generateBScript, getDb, schema } from "@aiugc/core";
import {
  coreErrorResponse,
  INVALID_BODY,
  jsonError,
  requireBusiness,
  requireUser,
} from "@/lib/api";
import { scriptRequestSchema } from "@/lib/service-b";

/**
 * Generate the avatar script (Part 2): pointers + questionnaire + persona +
 * word budget through core's generateBScript. The structure skeleton is not
 * part of the HTTP contract — the server picks a random active one from the
 * founder-curated bank. Generation is synchronous (one LLM call), so the
 * response carries the finished script.
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

    const body = scriptRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);

    const activeStructures = await db
      .select({ id: schema.structures.id })
      .from(schema.structures)
      .where(eq(schema.structures.active, true));
    const structure = activeStructures[Math.floor(Math.random() * activeStructures.length)];
    if (!structure) {
      return jsonError(500, "אין כרגע תבנית תסריט זמינה — נסו שוב מאוחר יותר.");
    }

    const script = await generateBScript(db, {
      businessId,
      personaId: body.data.personaId,
      structureId: structure.id,
      pointers: body.data.pointers,
      durationPreset: body.data.durationPreset,
    });
    const { wordBudget } = script.params as { wordBudget?: number };
    return NextResponse.json({ scriptId: script.id, text: script.text, wordBudget });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
