import { NextResponse } from "next/server";
import { getDb, getStorage, requestHookClipNormalize, schema } from "@aiugc/core";
import { coreErrorResponse, INVALID_BODY, jsonError, requireAdmin } from "@/lib/api";
import { hookMetadataError, isHookUploadPath, registerHookSchema } from "@/lib/hooks";

/**
 * Step 2 of the hook-clip upload: the browser finished its direct upload —
 * register the object as a hook_clips row. Duration/dimensions are client
 * readings (see src/lib/hooks.ts on why the server only bounds-checks them).
 */
export async function POST(request: Request) {
  const db = getDb();
  const auth = await requireAdmin(db);
  if ("response" in auth) return auth.response;

  try {
    const body = registerHookSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);
    if (!isHookUploadPath(body.data.uploadPath)) return jsonError(400, INVALID_BODY);
    const invalid = hookMetadataError(body.data);
    if (invalid) return jsonError(400, invalid);

    // A row pointing at a missing object would break the wizard's hook picker
    // for every customer — confirm the browser upload actually landed.
    try {
      await getStorage().signedUrl(body.data.uploadPath, 60);
    } catch {
      return jsonError(400, "הקובץ לא נמצא באחסון — ההעלאה לא הושלמה, נסו שוב.");
    }

    const inserted = await db
      .insert(schema.hookClips)
      .values({
        filePath: body.data.uploadPath,
        durationMs: body.data.durationMs,
        textSafeArea: body.data.textSafeArea,
        tags: body.data.tags,
        personaId: body.data.personaId,
        sourceClipId: body.data.sourceClipId,
        // Absent = omitted from the insert, so the column default (white) applies.
        textColor: body.data.textColor,
      })
      .returning({ id: schema.hookClips.id });

    // The browser cannot read a frame rate and Vercel has no ffmpeg, so the
    // worker probes the stored object and re-encodes it if it is not 30fps.
    // Best effort on purpose: the row is already committed, and failing the
    // request here would have the founder upload the whole clip a second time
    // and leave two active rows in the customer's picker. `aiugc bank
    // normalize-hooks` is the backstop for a clip whose job never ran.
    try {
      await requestHookClipNormalize(db, inserted[0]!.id);
    } catch {
      // swallowed by design — see above
    }
    return NextResponse.json({ hookId: inserted[0]!.id });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
