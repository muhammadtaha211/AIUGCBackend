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
      rejectReason?: string;
      durationMs?: number;
      thumbUrl?: string;
    } = { status: demo.status };
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
 * the demos row; blank clears. Deliberately NOT echoed by the polling GET —
 * the wizard edits it locally while ingest polls every 2s.
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
