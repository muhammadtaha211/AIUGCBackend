import { NextResponse } from "next/server";
import { getDb, getStorage } from "@aiugc/core";
import { coreErrorResponse, requireDemo, requireUser, SIGNED_URL_TTL_SECONDS } from "@/lib/api";

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
