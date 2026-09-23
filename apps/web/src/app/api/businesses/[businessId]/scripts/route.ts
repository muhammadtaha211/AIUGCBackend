import { NextResponse } from "next/server";
import {
  assertAccountBudget,
  assertBudget,
  generateBScript,
  getDb,
  pickStructureForBusiness,
} from "@aiugc/core";
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
 * part of the HTTP contract — the server rotates the founder-curated bank,
 * least-recently-used first, so consecutive regenerations get new skeletons.
 * Generation is synchronous (one LLM call), so the response carries the
 * finished script — and the DRAFT on-screen hook text the same call emitted
 * (b_script v9+), which seeds the effect step.
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

    // Synchronous Anthropic call below (plus a possible second one if the
    // model's hook_text misses a cap, hookTextOrDerived) — no queue to absorb
    // abuse. Per-account ceiling first, then the platform ceiling (AUTHZ-12:
    // this route had neither).
    await assertAccountBudget(db, "llm_tokens", businessId);
    await assertBudget(db, "llm_tokens");

    const body = scriptRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);

    const structureId = await pickStructureForBusiness(db, businessId);
    if (!structureId) {
      return jsonError(500, "אין כרגע תבנית תסריט זמינה — נסו שוב מאוחר יותר.");
    }

    const script = await generateBScript(db, {
      businessId,
      personaId: body.data.personaId,
      structureId,
      pointers: body.data.pointers,
      durationPreset: body.data.durationPreset,
    });
    const { wordBudget, hookText } = script.params as { wordBudget?: number; hookText?: string };
    return NextResponse.json({ scriptId: script.id, text: script.text, wordBudget, hookText });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
