import { NextResponse } from "next/server";
import { getDb, getStorage, setDemoDescription } from "@aiugc/core";
import {
  coreErrorResponse,
  INVALID_BODY,
  jsonError,
  requireDemo,
  requireUser,
  SIGNED_URL_TTL_SECONDS,
} from "@/lib/api";
import { demoDescriptionRequestSchema } from "@/lib/service-a";

/** Poll demo ingest: status, the Hebrew reject reason, thumb when ready. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const found = await requireDemo(db, id, auth.userId);
    if ("response" in found) return found.response;
    const { demo } = found;

    const body: {
      status: string;
      /** The owning business — the wizard's URL-restore refuses a demo from a
       *  different business than the one selected (same user, wrong tenant). */
      businessId: string;
      /** The stored footage note. The wizard's URL-restore prefills its field
       *  from this — otherwise a restore + continue would PATCH "" over the
       *  saved note ("blank clears"). Safe beside the 2s ingest poll: the
       *  poll writes demo state only, never the locally-edited note field. */
      description?: string;
      rejectReason?: string;
      durationMs?: number;
      thumbUrl?: string;
    } = { status: demo.status, businessId: demo.businessId };
    if (demo.description) body.description = demo.description;
    if (demo.rejectReason) body.rejectReason = demo.rejectReason;
    if (demo.durationMs) body.durationMs = demo.durationMs;
    if (demo.status === "ready" && demo.thumbPath) {
      body.thumbUrl = await getStorage().signedUrl(demo.thumbPath, SIGNED_URL_TTL_SECONDS);
    }
    return NextResponse.json(body);
  } catch (err) {
    return coreErrorResponse(err);
  }
}

/**
 * The optional "what the footage shows" note (soft VO grounding). Stored on
 * the demos row; blank clears. The GET echoes it for the URL-restore prefill;
 * the wizard still edits it locally while ingest polls every 2s (the poll
 * never writes the note field).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const found = await requireDemo(db, id, auth.userId);
    if ("response" in found) return found.response;

    const body = demoDescriptionRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);

    await setDemoDescription(db, { demoId: id, description: body.data.description });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
