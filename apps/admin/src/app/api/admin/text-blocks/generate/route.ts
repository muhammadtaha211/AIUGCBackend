import { NextResponse } from "next/server";
import {
  AccountBudgetError,
  assertAccountBudget,
  assertBudget,
  BudgetError,
  generateTextBlocks,
  getDb,
  isAdminOwned,
} from "@aiugc/core";
import { coreErrorResponse, INVALID_BODY, jsonError, requireAdmin } from "@/lib/api";
import { generateTextBlocksSchema } from "@/lib/text-blocks";

/**
 * Generate the batch of גוש טקסט texts for a business over a clip: one per
 * skeleton that fits, in the clip's speaker gender. Synchronous — one or two
 * LLM calls — exactly like apps/web's hook-lines route, and metered the same
 * way: the per-account ceiling first (a no-op for an admin owner), then the
 * platform ceiling, which has no role bypass.
 */
export async function POST(request: Request) {
  const db = getDb();
  const auth = await requireAdmin(db);
  if ("response" in auth) return auth.response;

  try {
    const body = generateTextBlocksSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);
    const { businessId, clipId } = body.data;

    // Phase 1 is admin-only end to end: the same guard createTextBlockRender
    // applies, here before a customer's cap is metered or a script is planted
    // on a business that could never render it. The guard is the route's, not
    // generateTextBlocks', so phase 2's wizard can call the generator for the
    // customer's own business.
    if (!(await isAdminOwned(db, businessId))) {
      return jsonError(400, "בשלב הזה אפשר ליצור גוש טקסט רק לעסק של מנהל.");
    }

    await assertAccountBudget(db, "llm_tokens", businessId);
    await assertBudget(db, "llm_tokens");

    const batch = await generateTextBlocks(db, { businessId, clipId });
    return NextResponse.json({
      texts: batch.texts.map((row) => ({
        scriptId: row.id,
        skeleton: (row.params as { skeleton?: string }).skeleton ?? "",
        text: row.text,
      })),
      skipped: batch.skipped,
    });
  } catch (err) {
    if (err instanceof AccountBudgetError || err instanceof BudgetError) {
      return jsonError(429, "הגעתם לתקרת השימוש היומית — נסו שוב מאוחר יותר.");
    }
    const message = err instanceof Error ? err.message : "";
    if (/has no questionnaire yet/.test(message)) {
      return jsonError(400, "לעסק הזה אין עדיין שאלון — ממלאים אותו באפליקציה קודם.");
    }
    if (/failed the burn check/.test(message)) {
      return jsonError(502, "המודל החזיר טקסט שאי אפשר לצרוב, פעמיים — נסו שוב.");
    }
    return coreErrorResponse(err);
  }
}
