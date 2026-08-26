import { NextResponse } from "next/server";
import { getDb, getStorage } from "@aiugc/core";
import {
  coreErrorResponse,
  jsonError,
  requireDemo,
  requireUser,
  SIGNED_URL_TTL_SECONDS,
} from "@/lib/api";

/**
 * Sign the demo's normalized video for in-wizard clip previews (plan step:
 * play a step, hover/tap-preview an inventory state). One file serves every
 * preview — a "clip" is a seek window into it, so the client fetches this
 * once per mount and seeks. No other route signs normalized_path; the worker
 * pipelines download it server-side.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const found = await requireDemo(db, id, auth.userId);
    if ("response" in found) return found.response;
    const { demo } = found;

    if (demo.status !== "ready" || !demo.normalizedPath) {
      return jsonError(409, "הסרטון עדיין לא מוכן לצפייה.");
    }
    const body: { videoUrl: string; durationMs?: number } = {
      videoUrl: await getStorage().signedUrl(demo.normalizedPath, SIGNED_URL_TTL_SECONDS),
    };
    if (demo.durationMs) body.durationMs = demo.durationMs;
    return NextResponse.json(body);
  } catch (err) {
    return coreErrorResponse(err);
  }
}
