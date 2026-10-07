import { NextResponse } from "next/server";
import { getDb, getScript, updateScriptText } from "@aiugc/core";
import { normalizeTextBlockText, textBlockTextError } from "@aiugc/core/text-block";
import { coreErrorResponse, INVALID_BODY, jsonError, NOT_FOUND, requireAdmin } from "@/lib/api";
import { isUuid } from "@/lib/admin";
import { editTextBlockSchema } from "@/lib/text-blocks";

/**
 * Edit a גוש טקסט text. The edit is free (decision 0091 §11): no content rule,
 * only the render rules — the character set and the cap — so what is saved
 * can be burned. A new scripts row, like every edit (updateScriptText), so a
 * render pinned on the old row keeps its text.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const auth = await requireAdmin(db);
  if ("response" in auth) return auth.response;

  try {
    if (!isUuid(id)) return jsonError(404, NOT_FOUND);
    const body = editTextBlockSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);

    const original = await getScript(db, id);
    if (original.kind !== "text_block") return jsonError(404, NOT_FOUND);

    const text = normalizeTextBlockText(body.data.text);
    const problem = textBlockTextError(text);
    if (problem) return jsonError(400, problem);

    const edited = await updateScriptText(db, id, text);
    return NextResponse.json({ scriptId: edited.id, text: edited.text });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
