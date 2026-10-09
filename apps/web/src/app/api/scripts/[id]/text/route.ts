import { NextResponse } from "next/server";
import {
  assertAccountBudget,
  assertBScriptWordCeiling,
  deriveHookText,
  getDb,
  normalizeTextBlockText,
  textBlockTextError,
  updateScriptText,
} from "@aiugc/core";
import { coreErrorResponse, INVALID_BODY, jsonError, requireScript, requireUser } from "@/lib/api";
import { scriptTextSchema } from "@/lib/service-b";

/**
 * "Write it myself" / post-generation edit. Scripts are immutable rows — the
 * edit creates a NEW row and the response carries its id. The only length
 * check left is the runaway-cost guard, and only on avatar scripts.
 *
 * A b_script also gets its draft on-screen hook text re-derived from the
 * edited text (one more LLM call, under the llm_tokens cap) so the one new
 * row holds both — the same merge `aiugc script edit` does. Hook-line and
 * VO-script rows (Service A) carry no hook text and skip it.
 *
 * A text_block (the גוש טקסט wizard's studio, decision 0099) is held to the
 * render rules only — the character set and the cap, textBlockTextError, the
 * check admin's edit route runs — and stored normalized, so what is saved is
 * what burns. No content rule and no dash rule: the edit is free (0091 §11).
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

    // No length cap on an avatar edit any more: the word budget is what the
    // prompt writes TO, not a wall the customer hits. HeyGen generates to the
    // audio's length (docs/04-integrations.md §HeyGen), serviceBTimeline lays
    // out off the measured audio, and quoteBRender charges per audio second —
    // so a longer script is a longer ad the customer pays for, not a failure.
    // What remains is the runaway-cost guard. Still b_script-only: hook-line
    // edits (Service A's studio step) come through this same route.
    const isBScript = found.script.kind === "b_script";
    if (isBScript) {
      assertBScriptWordCeiling(body.data.text);
      // deriveHookText below is a synchronous Anthropic call under the
      // platform cap only (copy.ts) — no per-account ceiling until now
      // (AUTHZ-12 sweep).
      await assertAccountBudget(db, "llm_tokens", found.script.businessId);
    }

    let text = body.data.text;
    if (found.script.kind === "text_block") {
      text = normalizeTextBlockText(text);
      const problem = textBlockTextError(text);
      if (problem) return jsonError(400, problem);
    }

    const merge = isBScript
      ? {
          hookText: await deriveHookText(db, {
            businessId: found.script.businessId,
            text: body.data.text,
          }),
        }
      : undefined;
    const edited = await updateScriptText(db, id, text, merge);
    return NextResponse.json({ scriptId: edited.id, text: edited.text, hookText: merge?.hookText });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
