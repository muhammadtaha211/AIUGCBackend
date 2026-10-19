import { NextResponse } from "next/server";
import { getDb, getStorage, reserveRecording } from "@aiugc/core";
import { recordingFileError, recordingType } from "@aiugc/core/own-voice";
import {
  coreErrorResponse,
  INVALID_BODY,
  jsonError,
  requireBusiness,
  requireUser,
} from "@/lib/api";
import { recordingUploadUrlSchema, type RecordingUploadUrlResponse } from "@/lib/service-b";

/**
 * Step 1 of an own-voice upload (decision 0118): a signed upload target in the
 * raw bucket, so the bytes go browser -> storage and never through a route
 * body, as a demo's do. The file's type is settled HERE, once: the browser
 * PUTs with the returned contentType, whatever its File.type said (a WhatsApp
 * .opus often says nothing). A follow-up POST to ../recordings queues its
 * transcription. The slot of the shared daily pool is taken here.
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

    const body = recordingUploadUrlSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);
    const invalid = recordingFileError(body.data);
    if (invalid) return jsonError(400, invalid);
    const type = recordingType(body.data)!;

    // The daily pool is spent here, before a byte is uploaded (429 at the
    // cap), and the row this creates is what the janitor sweeps if the
    // browser never registers the upload.
    const { uploadPath } = await reserveRecording(db, { businessId, ext: type.ext });
    const uploadUrl = await getStorage().createSignedUploadUrl(uploadPath);
    return NextResponse.json({
      uploadUrl,
      uploadPath,
      contentType: type.contentType,
    } satisfies RecordingUploadUrlResponse);
  } catch (err) {
    return coreErrorResponse(err);
  }
}
