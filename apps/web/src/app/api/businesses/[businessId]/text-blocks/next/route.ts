import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema, serveNextTextBlock, TextBlockStockEmptyError } from "@aiugc/core";
import {
  coreErrorResponse,
  INVALID_BODY,
  jsonError,
  NOT_FOUND,
  requireBusiness,
  requireUser,
} from "@/lib/api";
import { usableTextBlockClip } from "@/lib/persona-catalog";
import { textBlockNextRequestSchema, type TextBlockNextResponse } from "@/lib/service-c";

/**
 * The next גוש טקסט text for the C wizard's studio, one at a time (decision
 * 0099, R2): serveNextTextBlock serves the structure this business has gone
 * longest without seeing from its stored batch, and writes a new batch only
 * when none is left for this clip's speaker gender — so the LLM caps run
 * inside core, and only then. A text served from stock is free.
 *
 * The clip is held to the wizard's listing first (usableTextBlockClip), so a
 * clip the gallery would never offer is a plain 404 and never core's English.
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

    const body = textBlockNextRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);
    const { clipId } = body.data;

    const clipRows = await db
      .select({ id: schema.textBlockClips.id })
      .from(schema.textBlockClips)
      .innerJoin(schema.personas, eq(schema.personas.id, schema.textBlockClips.personaId))
      .where(and(eq(schema.textBlockClips.id, clipId), usableTextBlockClip))
      .limit(1);
    if (!clipRows[0]) return jsonError(404, NOT_FOUND);

    const script = await serveNextTextBlock(db, { businessId, clipId });
    return NextResponse.json({
      scriptId: script.id,
      text: script.text,
      skeleton: (script.params as { skeleton: string }).skeleton,
    } satisfies TextBlockNextResponse);
  } catch (err) {
    // A fresh batch with nothing servable in it, or one the model failed the
    // text check on twice: the request was fine and the next click may work.
    if (
      err instanceof TextBlockStockEmptyError ||
      (err instanceof Error && /failed the text check/.test(err.message))
    ) {
      return jsonError(502, "לא הצלחנו לכתוב טקסט כרגע. נסו שוב בעוד רגע.");
    }
    return coreErrorResponse(err);
  }
}
