import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import {
  businessOwnerId,
  createTextBlockRender,
  creditBalance,
  getDb,
  isAdminOwned,
  schema,
  textBlockTextError,
} from "@aiugc/core";
import {
  coreErrorResponse,
  INVALID_BODY,
  jsonError,
  NOT_FOUND,
  requireBusiness,
  requireUser,
} from "@/lib/api";
import { usableTextBlockClip } from "@/lib/persona-catalog";
import { textBlockRenderRequestSchema, type TextBlockRenderCreateResponse } from "@/lib/service-c";

/**
 * Create a גוש טקסט render (decision 0099): the clip once, with its sound,
 * under the customer's text in the box they placed. createTextBlockRender is
 * the choke point — the quote, the content-policy gate, the debit and the job
 * in one transaction, the third debit site beside createSet and createBRender.
 *
 * Every refusal core would throw in English before the quote is checked here
 * first and answered in Hebrew, B's route's stance: core's messages have no
 * pattern in coreErrorMapping and would reach the customer as a generic 500.
 * What is left for core — the 402, the 422 and the caps — maps there.
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

    const body = textBlockRenderRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);
    const { clipId, scriptId, textSafeArea } = body.data;

    const clipRows = await db
      .select({ speakerGender: schema.textBlockClips.speakerGender })
      .from(schema.textBlockClips)
      .innerJoin(schema.personas, eq(schema.personas.id, schema.textBlockClips.personaId))
      .where(and(eq(schema.textBlockClips.id, clipId), usableTextBlockClip))
      .limit(1);
    if (!clipRows[0]) return jsonError(404, NOT_FOUND);

    const scriptRows = await db
      .select()
      .from(schema.scripts)
      .where(eq(schema.scripts.id, scriptId))
      .limit(1);
    const script = scriptRows[0];
    if (!script) return jsonError(404, "התסריט לא נמצא.");
    if (script.businessId !== businessId) return jsonError(403, "התסריט לא שייך לעסק הזה.");
    if (script.kind !== "text_block") return jsonError(400, INVALID_BODY);
    // Hebrew first person is gendered (0090 §6) — core's rule, word for word:
    // a text with no recorded gender passes.
    const scriptGender = (script.params as { speakerGender?: string }).speakerGender;
    if (scriptGender && scriptGender !== clipRows[0].speakerGender) {
      return jsonError(400, "הטקסט נכתב בקול של דמות אחרת — קבלו טקסט חדש לדמות הזאת.");
    }
    const textProblem = textBlockTextError(script.text);
    if (textProblem) return jsonError(400, textProblem);

    const render = await createTextBlockRender(db, { businessId, clipId, scriptId, textSafeArea });
    // The post-debit balance, re-queried after the commit — the wizard pushes
    // it into the sidebar's BalanceProvider, mirroring B's render route.
    const balance = (await isAdminOwned(db, businessId))
      ? null
      : await creditBalance(db, await businessOwnerId(db, businessId));
    return NextResponse.json({
      renderId: render.id,
      balance,
    } satisfies TextBlockRenderCreateResponse);
  } catch (err) {
    return coreErrorResponse(err);
  }
}
