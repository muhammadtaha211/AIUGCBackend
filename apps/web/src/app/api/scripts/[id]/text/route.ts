import { NextResponse } from "next/server";
import { assertWithinWordBudget, getDb, updateScriptText } from "@aiugc/core";
import { coreErrorResponse, INVALID_BODY, jsonError, requireScript, requireUser } from "@/lib/api";
import { scriptTextSchema } from "@/lib/service-b";

/**
 * "Write it myself" / post-generation edit. Scripts are immutable rows — the
 * edit creates a NEW row and the response carries its id. The word-budget
 * validator runs first so an oversized script never reaches TTS.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const found = await requireScript(db, id, auth.userId);
    if ("response" in found) return found.response;

    const body = scriptTextSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);

    // The budget is a hard cap only for avatar scripts (lipsync frame
    // ceiling). A Service A VO may run long on purpose — the overshoot
    // becomes a freeze/avatar ending, chosen in the shape display.
    const { wordBudget } = found.script.params as { wordBudget?: number };
    if (found.script.kind === "b_script" && wordBudget) {
      assertWithinWordBudget(body.data.text, wordBudget);
    }

    const edited = await updateScriptText(db, id, body.data.text);
    return NextResponse.json({ scriptId: edited.id, text: edited.text });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
