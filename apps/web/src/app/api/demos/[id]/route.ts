import { NextResponse } from "next/server";
import {
  getDb,
  getJobProgress,
  getLatestDemoAnalysis,
  getStorage,
  setDemoDescription,
  setDemoName,
  type JobProgress,
} from "@aiugc/core";
import {
  coreErrorResponse,
  INVALID_BODY,
  jsonError,
  requireDemo,
  requireUser,
  SIGNED_URL_TTL_SECONDS,
} from "@/lib/api";
import { demoPatchRequestSchema } from "@/lib/service-a";
import { isIngestingDemoStatus } from "@/lib/service-a-ui";

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
      /** When it was uploaded. The plan editor's header names it, the same way
       *  the library row does; the wizard ignores it. */
      createdAt: string;
      /** The stored footage note. The wizard's URL-restore prefills its field
       *  from this — otherwise a restore + continue would PATCH "" over the
       *  saved note ("blank clears"). Safe beside the 2s ingest poll: the
       *  poll writes demo state only, never the locally-edited note field. */
      description?: string;
      /** The customer's name for the recording (decision 0125). The restore
       *  prefills the name field from it, for the same reason as the note. */
      name?: string;
      rejectReason?: string;
      durationMs?: number;
      thumbUrl?: string;
      /** Ingest pipeline progress (8d) — the poll's way to tell "still
       *  working" from "nothing is processing this" (a dead worker keeps
       *  this GET healthy forever, so HTTP failures can't carry it). */
      ingest?: JobProgress;
      /** Newest analysis status once ready — feeds the ready card's
       *  "runs on in the background" line. "missing" = no row yet. */
      analysis?: { status: string };
    } = {
      status: demo.status,
      businessId: demo.businessId,
      createdAt: demo.createdAt.toISOString(),
    };
    if (demo.description) body.description = demo.description;
    if (demo.name) body.name = demo.name;
    if (demo.rejectReason) body.rejectReason = demo.rejectReason;
    if (demo.durationMs) body.durationMs = demo.durationMs;
    if (isIngestingDemoStatus(demo.status)) {
      body.ingest = await getJobProgress(db, { idempotencyKey: `ingest:${id}` });
    }
    if (demo.status === "ready") {
      if (demo.thumbPath) {
        body.thumbUrl = await getStorage().signedUrl(demo.thumbPath, SIGNED_URL_TTL_SECONDS);
      }
      const analysis = await getLatestDemoAnalysis(db, id);
      body.analysis = { status: analysis?.status ?? "missing" };
    }
    return NextResponse.json(body);
  } catch (err) {
    return coreErrorResponse(err);
  }
}

/**
 * The optional "what the footage shows" note (soft VO grounding) and the
 * optional name (decision 0125), each saved only when its key is sent. Stored
 * on the demos row; blank clears. The GET echoes both for the URL-restore
 * prefill; the wizard still edits them locally while ingest polls every 2s
 * (the poll never writes either field).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const found = await requireDemo(db, id, auth.userId);
    if ("response" in found) return found.response;

    const body = demoPatchRequestSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return jsonError(400, INVALID_BODY);

    if (body.data.description !== undefined) {
      await setDemoDescription(db, { demoId: id, description: body.data.description });
    }
    if (body.data.name !== undefined) {
      await setDemoName(db, { demoId: id, name: body.data.name });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return coreErrorResponse(err);
  }
}
