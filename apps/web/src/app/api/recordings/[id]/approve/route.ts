import { NextResponse } from "next/server";
import { approveRecording, getDb } from "@aiugc/core";
import { applyTranscriptCorrections, type HeardWord } from "@aiugc/core/own-voice";
import {
  coreErrorResponse,
  INVALID_BODY,
  jsonError,
  requireRecording,
  requireUser,
} from "@/lib/api";
import { recordingApproveSchema, type RecordingApproveResponse } from "@/lib/service-b";

/**
 * The own-voice audio gate (decision 0118, locked #5): the customer approves
 * the transcript they corrected — respelled or dropped words, never added.
 * Answers a correction that does not fit the recording with its Hebrew line
 * before core runs; core makes the ordinary script + approved audio pair and
 * derives the hook line. Charges nothing — the render step is the debit.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const found = await requireRecording(db, id, auth.userId);
    if ("response" in found) return found.response;
    const { recording } = found;

    const body = recordingApproveSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);
    if (recording.status === "ready" && recording.words) {
      const checked = applyTranscriptCorrections(recording.words as HeardWord[], body.data.kept);
      if (!checked.ok) return jsonError(400, checked.error);
    }

    const approved = await approveRecording(db, {
      recordingId: recording.id,
      businessId: recording.businessId,
      personaId: body.data.personaId,
      kept: body.data.kept,
    });
    return NextResponse.json(approved satisfies RecordingApproveResponse);
  } catch (err) {
    return coreErrorResponse(err);
  }
}
