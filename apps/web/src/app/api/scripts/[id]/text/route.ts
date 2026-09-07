import { NextResponse } from "next/server";
import { assertWithinWordBudget, deriveHookText, getDb, updateScriptText } from "@aiugc/core";
import { coreErrorResponse, INVALID_BODY, jsonError, requireScript, requireUser } from "@/lib/api";
import { scriptTextSchema } from "@/lib/service-b";

/**
 * "Write it myself" / post-generation edit. Scripts are immutable rows — the
 * edit creates a NEW row and the response carries its id. The word-budget
 * validator runs first so an oversized script never reaches TTS.
 *
 * A b_script also gets its draft on-screen hook text re-derived from the
 * edited text (one more LLM call, under the llm_tokens cap) so the one new
 * row holds both — the same merge `aiugc script edit` does. Hook-line and
 * VO-script rows (Service A) carry no hook text and skip it.
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

    // The budget is a hard cap only for avatar (b_script) edits, to keep the
    // render inside the customer's chosen duration preset (15s/30s) — HeyGen
    // itself has no lipsync frame ceiling; it generates to the audio's length
    // (docs/04-integrations.md §HeyGen). Service A's voiced `vo_script`
    // format, where an overshoot became a freeze/avatar ending, is retired
    // (vault 0020); vo_script edits carry no such cap.
    const { wordBudget } = found.script.params as { wordBudget?: number };
    const isBScript = found.script.kind === "b_script";
    if (isBScript && wordBudget) {
      assertWithinWordBudget(body.data.text, wordBudget);
    }

    const merge = isBScript
      ? {
          hookText: await deriveHookText(db, {
            businessId: found.script.businessId,
            text: body.data.text,
          }),
        }
      : undefined;
    const edited = await updateScriptText(db, id, body.data.text, merge);
    return NextResponse.json({ scriptId: edited.id, text: edited.text, hookText: merge?.hookText });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
