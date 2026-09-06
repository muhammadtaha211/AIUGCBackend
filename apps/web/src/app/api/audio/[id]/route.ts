import { NextResponse } from "next/server";
import { getDb, getStorage, recordAudioScriptPointerMove } from "@aiugc/core";
import { coreErrorResponse, requireAudio, requireUser, SIGNED_URL_TTL_SECONDS } from "@/lib/api";

/**
 * Poll the audio preview: status, signed mp3 when ready, and the script that
 * will actually be spoken.
 *
 * The script is resolved through audio_renders.script_id — the same pointer the
 * render reads — and never from a client-supplied id. The TTS length fit can
 * repoint it mid-job (packages/core/src/pipelines/tts.ts), so wizard state is
 * not a trustworthy account of what the customer is about to approve.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const found = await requireAudio(db, id, auth.userId);
    if ("response" in found) return found.response;
    const { audio, script, pointerMoved } = found;

    // Once the length-fit regeneration is deleted, nothing writes
    // audio_renders.script_id after insert and this branch should never run
    // again. It is not dead code — it is the assertion that stays true. If a
    // row ever shows up in `events` for this kind, something started moving the
    // pointer, and the customer was shown a script they did not write.
    if (pointerMoved) {
      await recordAudioScriptPointerMove(db, {
        audioRenderId: audio.id,
        businessId: script.businessId,
        toScriptId: script.id,
        audioCreatedAt: audio.createdAt,
        scriptCreatedAt: script.createdAt,
        actorUserId: auth.userId,
      });
    }

    const { wordBudget, hookText } = script.params as { wordBudget?: number; hookText?: string };
    const body: {
      status: string;
      scriptId: string;
      text: string;
      wordBudget?: number;
      hookText?: string;
      scriptChanged: boolean;
      audioUrl?: string;
      durationMs?: number;
    } = {
      status: audio.status,
      scriptId: script.id,
      text: script.text,
      wordBudget,
      // The resolved script's draft hook text: a wizard that adopts this
      // script must also adopt the seed its effect step shows.
      hookText,
      scriptChanged: pointerMoved,
    };
    if (audio.status === "ready" && audio.filePath) {
      body.audioUrl = await getStorage().signedUrl(audio.filePath, SIGNED_URL_TTL_SECONDS);
      // The measured TTS duration — Service A's exact ending advisory.
      body.durationMs = audio.durationMs ?? undefined;
    }
    return NextResponse.json(body);
  } catch (err) {
    return coreErrorResponse(err);
  }
}
