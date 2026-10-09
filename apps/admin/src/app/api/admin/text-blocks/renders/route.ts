import { NextResponse } from "next/server";
import { ContentPolicyError, createTextBlockRender, getDb, isAdminOwned } from "@aiugc/core";
import { coreErrorResponse, INVALID_BODY, jsonError, requireAdmin } from "@/lib/api";
import { createTextBlockRenderSchema } from "@/lib/text-blocks";

/**
 * Render a גוש טקסט: the clip once, with its sound, under the chosen text.
 * createTextBlockRender is the choke point (the render rules, the quote and
 * the debit, the content-policy gate) and enqueues the worker's render_video;
 * the page polls the row until it is released.
 */
export async function POST(request: Request) {
  const db = getDb();
  const auth = await requireAdmin(db);
  if ("response" in auth) return auth.response;

  try {
    const body = createTextBlockRenderSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);

    // createTextBlockRender debits a customer-owned business since phase 2
    // (decision 0099). The admin console never spends a customer's credits, so
    // it keeps the studio to the founder's own businesses, as the generate
    // route does.
    if (!(await isAdminOwned(db, body.data.businessId))) {
      return jsonError(400, "בשלב הזה אפשר ליצור גוש טקסט רק לעסק של מנהל.");
    }

    const render = await createTextBlockRender(db, body.data);
    return NextResponse.json({ renderId: render.id });
  } catch (err) {
    if (err instanceof ContentPolicyError) {
      return jsonError(422, "הטקסט או השאלון לא עברו את בדיקת התוכן.");
    }
    const message = err instanceof Error ? err.message : "";
    if (/is not active|never finished uploading/.test(message)) {
      return jsonError(400, "הקליפ הזה לא זמין — בחרו קליפ פעיל.");
    }
    if (/was written for a (female|male) speaker/.test(message)) {
      return jsonError(
        400,
        "הטקסט נכתב בקול של דובר/ת אחר/ת — בחרו קליפ עם אותו מגדר, או צרו טקסטים מחדש.",
      );
    }
    if (/is not a text block|different business/.test(message)) {
      return jsonError(400, INVALID_BODY);
    }
    return coreErrorResponse(err);
  }
}
