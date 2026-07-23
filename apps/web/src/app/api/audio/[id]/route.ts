import { NextResponse } from "next/server";
import { getDb, getStorage } from "@aiugc/core";
import { coreErrorResponse, requireAudio, requireUser, SIGNED_URL_TTL_SECONDS } from "@/lib/api";

/** Poll the audio preview: status, signed mp3 when ready. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const found = await requireAudio(db, id, auth.userId);
    if ("response" in found) return found.response;
    const { audio } = found;

    const body: { status: string; audioUrl?: string } = { status: audio.status };
    if (audio.status === "ready" && audio.filePath) {
      body.audioUrl = await getStorage().signedUrl(audio.filePath, SIGNED_URL_TTL_SECONDS);
    }
    return NextResponse.json(body);
  } catch (err) {
    return coreErrorResponse(err);
  }
}
