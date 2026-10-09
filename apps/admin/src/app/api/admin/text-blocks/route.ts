import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, getStorage, requestTextBlockClipNormalize, schema } from "@aiugc/core";
import { coreErrorResponse, INVALID_BODY, jsonError, requireAdmin } from "@/lib/api";
import {
  isTextBlockUploadPath,
  PERSONA_WITHOUT_GENDER,
  registerTextBlockSchema,
  textBlockMetadataError,
} from "@/lib/text-blocks";

/**
 * Step 2 of the גוש טקסט clip upload: the browser finished its direct upload —
 * register the object as a text_block_clips row, with the character, the text
 * area and the colour the founder set. The speaker gender is the character's,
 * copied here (decision 0099 §3). Duration/dimensions are client readings (see
 * src/lib/text-blocks.ts on why the server only bounds-checks).
 */
export async function POST(request: Request) {
  const db = getDb();
  const auth = await requireAdmin(db);
  if ("response" in auth) return auth.response;

  try {
    const body = registerTextBlockSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);
    if (!isTextBlockUploadPath(body.data.uploadPath)) return jsonError(400, INVALID_BODY);
    const invalid = textBlockMetadataError(body.data);
    if (invalid) return jsonError(400, invalid);
    const persona = (
      await db
        .select({ gender: schema.personas.gender })
        .from(schema.personas)
        .where(eq(schema.personas.id, body.data.personaId))
        .limit(1)
    )[0];
    if (!persona) return jsonError(400, "הדמות לא נמצאה.");
    if (persona.gender === null) return jsonError(400, PERSONA_WITHOUT_GENDER);

    // A row pointing at a missing object would fail every render that picks
    // it — confirm the browser upload actually landed.
    try {
      await getStorage().signedUrl(body.data.uploadPath, 60);
    } catch {
      return jsonError(400, "הקובץ לא נמצא באחסון — ההעלאה לא הושלמה, נסו שוב.");
    }

    const inserted = await db
      .insert(schema.textBlockClips)
      .values({
        filePath: body.data.uploadPath,
        durationMs: body.data.durationMs,
        personaId: body.data.personaId,
        speakerGender: persona.gender,
        textSafeArea: body.data.textSafeArea,
        // Absent = omitted from the insert, so the column default (white) applies.
        textColor: body.data.textColor,
      })
      .returning({ id: schema.textBlockClips.id });

    // The browser cannot read a frame rate and Vercel has no ffmpeg, so the
    // worker probes the stored object and re-encodes it if it is not 30fps
    // (keeping the audio). Best effort, exactly like the hook register: the
    // row is committed, and failing here would have the founder upload the
    // clip a second time.
    try {
      await requestTextBlockClipNormalize(db, inserted[0]!.id);
    } catch {
      // swallowed by design — see above
    }
    return NextResponse.json({ clipId: inserted[0]!.id });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
