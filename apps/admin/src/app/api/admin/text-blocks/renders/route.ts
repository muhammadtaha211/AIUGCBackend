import { NextResponse } from "next/server";
import { ContentPolicyError, createTextBlockRender, getDb } from "@aiugc/core";
import { coreErrorResponse, INVALID_BODY, jsonError, requireAdmin } from "@/lib/api";
import { createTextBlockRenderSchema } from "@/lib/text-blocks";

/**
 * Render a גוש טקסט: the clip once, with its sound, under the chosen text.
 * createTextBlockRender is the choke point (admin-owned business only in
 * phase 1, the render rules, the content-policy gate) and enqueues the
 * worker's render_video; the page polls the row until it is released.
 */
export async function POST(request: Request) {
  const db = getDb();
  const auth = await requireAdmin(db);
  if ("response" in auth) return auth.response;

  try {
    const body = createTextBlockRenderSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);

    const render = await createTextBlockRender(db, body.data);
    return NextResponse.json({ renderId: render.id });
  } catch (err) {
    if (err instanceof ContentPolicyError) {
      return jsonError(422, "הטקסט או השאלון לא עברו את בדיקת התוכן.");
    }
    const message = err instanceof Error ? err.message : "";
    if (/admin-only in phase 1/.test(message)) {
      return jsonError(400, "בשלב הזה אפשר ליצור גוש טקסט רק לעסק של מנהל.");
    }
    if (/is not active|never finished uploading/.test(message)) {
      return jsonError(400, "הקליפ הזה לא זמין — בחרו קליפ פעיל.");
    }
    if (/is not a text block|different business/.test(message)) {
      return jsonError(400, INVALID_BODY);
    }
    return coreErrorResponse(err);
  }
}
