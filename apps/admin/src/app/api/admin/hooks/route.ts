import { NextResponse } from "next/server";
import { getDb, getStorage, schema } from "@aiugc/core";
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
      })
      .returning({ id: schema.hookClips.id });
    return NextResponse.json({ hookId: inserted[0]!.id });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
