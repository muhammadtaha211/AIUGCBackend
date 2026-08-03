import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, getStorage, schema } from "@aiugc/core";
import { coreErrorResponse, requireUser, SIGNED_URL_TTL_SECONDS } from "@/lib/api";

/**
 * The hook-clip bank for the picker: active clips with a signed, playable
 * preview URL. The bank is founder-curated and global (no per-business rows).
 */
export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const rows = await db
      .select({
        id: schema.hookClips.id,
        durationMs: schema.hookClips.durationMs,
        filePath: schema.hookClips.filePath,
      })
      .from(schema.hookClips)
      .where(eq(schema.hookClips.active, true))
      .orderBy(schema.hookClips.createdAt);

    const storage = getStorage();
    const hooks = [];
    for (const row of rows) {
      hooks.push({
        id: row.id,
        durationMs: row.durationMs,
        previewUrl: await storage.signedUrl(row.filePath, SIGNED_URL_TTL_SECONDS),
      });
    }
    return NextResponse.json({ hooks });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
