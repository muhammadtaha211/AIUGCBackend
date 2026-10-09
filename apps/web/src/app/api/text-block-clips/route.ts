import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, getStorage, schema } from "@aiugc/core";
import type { SafeRect } from "@aiugc/core/hook-geometry";
import type { HookTextColor } from "@aiugc/core/hook-text-color";
import {
  coreErrorResponse,
  jsonError,
  NOT_FOUND,
  requireUser,
  SIGNED_URL_TTL_SECONDS,
} from "@/lib/api";
import { usableTextBlockClip } from "@/lib/persona-catalog";
import { isUuid } from "@/lib/service-b";

/**
 * One character's גוש טקסט clips for the C wizard's gallery (decision 0099 §4),
 * with a signed, playable preview URL. Mirrors GET /api/hooks?personaId=: the
 * bank is founder-curated and global, and the wizard shows one character's
 * clips at a time — the usable ones only (usableTextBlockClip), so an unknown
 * or inactive character gets an empty list. There is no listing without a
 * character: a clip no character owns is listed to no customer.
 *
 * The clip's area rides along to seed the placement editor, and its text
 * colour so the preview draws the block the render burns (read-only: the
 * founder sets it in admin, decision 0073).
 */
export async function GET(request: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const personaId = new URL(request.url).searchParams.get("personaId");
  if (!personaId || !isUuid(personaId)) return jsonError(404, NOT_FOUND);

  try {
    const db = getDb();
    const { textBlockClips, personas } = schema;
    const rows = await db
      .select({
        id: textBlockClips.id,
        durationMs: textBlockClips.durationMs,
        filePath: textBlockClips.filePath,
        textSafeArea: textBlockClips.textSafeArea,
        textColor: textBlockClips.textColor,
      })
      .from(textBlockClips)
      .innerJoin(personas, eq(personas.id, textBlockClips.personaId))
      .where(and(eq(textBlockClips.personaId, personaId), usableTextBlockClip))
      .orderBy(textBlockClips.createdAt);

    const storage = getStorage();
    const clips = await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        durationMs: row.durationMs,
        previewUrl: await storage.signedUrl(row.filePath, SIGNED_URL_TTL_SECONDS),
        textSafeArea: row.textSafeArea as SafeRect,
        textColor: row.textColor as HookTextColor,
      })),
    );
    return NextResponse.json({ clips });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
