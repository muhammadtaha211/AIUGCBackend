import { NextResponse } from "next/server";
import { getDb, getStorage } from "@aiugc/core";
import { coreErrorResponse, requireRender, requireUser, SIGNED_URL_TTL_SECONDS } from "@/lib/api";

/**
 * Poll a render. Status passes through core's states; the video (and thumb)
 * are signed only once the founder released it — the QC gate stays hard.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  try {
    const db = getDb();
    const found = await requireRender(db, id, auth.userId);
    if ("response" in found) return found.response;
    const { render } = found;

    const body: { status: string; videoUrl?: string; thumbUrl?: string; failureReason?: string } = {
      status: render.status,
    };
    if (render.status === "released") {
      const storage = getStorage();
      if (render.filePath) {
        body.videoUrl = await storage.signedUrl(render.filePath, SIGNED_URL_TTL_SECONDS);
      }
      if (render.thumbPath) {
        body.thumbUrl = await storage.signedUrl(render.thumbPath, SIGNED_URL_TTL_SECONDS);
      }
    }
    if (render.status === "failed") {
      body.failureReason = "יצירת הסרטון נכשלה — נסו שוב.";
    }
    return NextResponse.json(body);
  } catch (err) {
    return coreErrorResponse(err);
  }
}
