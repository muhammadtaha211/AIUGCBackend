import { NextResponse } from "next/server";
import { getDb, requestAudio } from "@aiugc/core";
import { coreErrorResponse, requireScript, requireUser } from "@/lib/api";

/**
 * Enqueue the audio-only preview (TTS runs on the worker; the client polls
 * GET /api/audio/[id]). Voice comes from the script's persona.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const found = await requireScript(db, id, auth.userId);
    if ("response" in found) return found.response;

    const audio = await requestAudio(db, { scriptId: id });
    return NextResponse.json({ audioId: audio.id });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
