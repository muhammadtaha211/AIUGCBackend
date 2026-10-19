import { NextResponse } from "next/server";
import { getDb, isOwnedRecordingUploadPath, registerRecording } from "@aiugc/core";
import {
  coreErrorResponse,
  INVALID_BODY,
  jsonError,
  requireBusiness,
  requireUser,
} from "@/lib/api";
import { recordingRegisterSchema } from "@/lib/service-b";

/**
 * Step 2 of an own-voice upload (decision 0118): the browser finished its
 * direct upload — queue the transcription. Only a path this business's own
 * upload-url route minted is accepted (its row exists from step 1, which also
 * took the daily-pool slot); registering the same upload twice returns the
 * same recording.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ businessId: string }> },
) {
  const { businessId } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const owned = await requireBusiness(db, businessId, auth.userId);
    if ("response" in owned) return owned.response;

    const body = recordingRegisterSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);
    if (!isOwnedRecordingUploadPath(businessId, body.data.uploadPath)) {
      return jsonError(400, INVALID_BODY);
    }

    const recording = await registerRecording(db, {
      businessId,
      uploadPath: body.data.uploadPath,
    });
    return NextResponse.json({ recordingId: recording.id });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
