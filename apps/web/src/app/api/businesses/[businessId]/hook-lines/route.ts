import { NextResponse } from "next/server";
import {
  assertAccountBudget,
  assertBudget,
  generateHookLines,
  getDb,
  HOOK_LINE_FRAMES,
} from "@aiugc/core";
import {
  coreErrorResponse,
  INVALID_BODY,
  jsonError,
  requireBusiness,
  requireUser,
} from "@/lib/api";
import { hookLinesRequestSchema } from "@/lib/service-a";

/**
 * Generate hook-line options from the questionnaire (Service A). Synchronous —
 * one LLM call — and the customer picks one of the returned options.
 *
 * One call returns all ten frames; the wizard shows five at a time and the
 * first reroll is a free half-swap. `avoid` carries the lines already written
 * this session so a paid reroll doesn't circle back to the same phrasings.
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

    // Synchronous Anthropic call below, no queue to absorb abuse — the
    // per-account ceiling first (fast, typed rejection), then the platform
    // ceiling (AUTHZ-12: this route had neither).
    await assertAccountBudget(db, "llm_tokens", businessId);
    await assertBudget(db, "llm_tokens");

    // Both fields are optional, so an empty body is a valid request.
    const body = hookLinesRequestSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return jsonError(400, INVALID_BODY);

    const rows = await generateHookLines(db, {
      businessId,
      n: HOOK_LINE_FRAMES,
      avoid: body.data.avoid,
      personaId: body.data.personaId,
    });
    return NextResponse.json({
      options: rows.map((row) => ({
        scriptId: row.id,
        text: row.text,
        angle: (row.params as { angle?: string }).angle ?? "",
      })),
    });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
