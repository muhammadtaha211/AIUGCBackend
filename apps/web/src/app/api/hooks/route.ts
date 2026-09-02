import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, getStorage, schema } from "@aiugc/core";
import type { SafeRect } from "@aiugc/core/hook-geometry";
import { coreErrorResponse, requireUser, SIGNED_URL_TTL_SECONDS } from "@/lib/api";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The hook-clip bank for the picker: active clips with a signed, playable
 * preview URL. The bank is founder-curated and global (no per-business rows),
 * and it is a persona × clip MATRIX — every clip belongs to one persona, and
 * the wizard shows one persona's column at a time. ?personaId= returns
 * exactly that column: only rows whose persona_id is that persona, never the
 * generic (persona_id IS NULL) source performers, which are the founder's
 * swap inputs and not something a customer picks.
 *
 * Without ?personaId= the generic rows come back alone. That is the legacy,
 * CLI-shaped bank listing — no shipped customer flow requests it any more.
 * The clip's default safe area rides along to seed the wizard's placement
 * editor.
 */
export async function GET(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const personaId = new URL(request.url).searchParams.get("personaId");

  try {
    const db = getDb();
    const generic = isNull(schema.hookClips.personaId);
    const rows = await db
      .select({
        id: schema.hookClips.id,
        durationMs: schema.hookClips.durationMs,
        filePath: schema.hookClips.filePath,
        textSafeArea: schema.hookClips.textSafeArea,
        personaId: schema.hookClips.personaId,
      })
      .from(schema.hookClips)
      .where(
        and(
          eq(schema.hookClips.active, true),
          personaId && UUID_RE.test(personaId)
            ? eq(schema.hookClips.personaId, personaId)
            : generic,
        ),
      )
      .orderBy(schema.hookClips.createdAt);

    const storage = getStorage();
    const hooks = [];
    for (const row of rows) {
      hooks.push({
        id: row.id,
        durationMs: row.durationMs,
        previewUrl: await storage.signedUrl(row.filePath, SIGNED_URL_TTL_SECONDS),
        textSafeArea: row.textSafeArea as SafeRect,
        personaId: row.personaId ?? undefined,
      });
    }
    return NextResponse.json({ hooks });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
