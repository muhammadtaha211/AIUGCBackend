import { NextResponse } from "next/server";
import { getDb, getStorage, quoteBForDuration } from "@aiugc/core";
import { RECORDING_FAILED } from "@aiugc/core/own-voice";
import {
  coreErrorResponse,
  requireRecording,
  requireUser,
  SIGNED_URL_TTL_SECONDS,
} from "@/lib/api";
import type { RecordingPollResponse } from "@/lib/service-b";

/**
 * The transcript step's poll (decision 0118). Once the recording is ready it
 * carries what the customer checks before approving: the processed file (the
 * one HeyGen will lip-sync), Scribe's words on it, and the price of a render
 * this long — the same quote the render step shows, read the same way.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const found = await requireRecording(db, id, auth.userId);
    if ("response" in found) return found.response;
    const { recording } = found;

    const body: RecordingPollResponse = { status: recording.status };
    if (recording.status === "failed") body.error = recording.error ?? RECORDING_FAILED;
    if (recording.status === "ready" && recording.filePath && recording.durationMs !== null) {
      body.durationMs = recording.durationMs;
      body.audioUrl = await getStorage().signedUrl(recording.filePath, SIGNED_URL_TTL_SECONDS);
      body.words = (recording.words ?? []) as RecordingPollResponse["words"];
      const quote = await quoteBForDuration(db, {
        businessId: recording.businessId,
        durationMs: recording.durationMs,
      });
      body.quote = quote.chargeable
        ? {
            credits: quote.creditsPerRender,
            balance: quote.balance,
            shortfall: Math.max(0, quote.creditsPerRender - quote.balance),
          }
        : null;
    }
    return NextResponse.json(body);
  } catch (err) {
    return coreErrorResponse(err);
  }
}
