import { NextResponse } from "next/server";
import {
  getDb,
  getJobProgress,
  getStorage,
  HEAVY_JOB_TYPES,
  type JobProgress,
} from "@aiugc/core";
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

    const body: {
      status: string;
      videoUrl?: string;
      thumbUrl?: string;
      failureReason?: string;
      refunded?: boolean;
      /** Render job progress (8d pattern) — queue position, elapsed, the
       *  renderMedia percent, and the heartbeat that tells "still working"
       *  from "nothing is processing this". */
      job?: JobProgress;
    } = {
      status: render.status,
    };
    if (render.status === "queued" || render.status === "rendering") {
      body.job = await getJobProgress(db, {
        idempotencyKey: `render:${id}`,
        aheadOfTypes: HEAVY_JOB_TYPES,
      });
    }
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
      // Displayable by construction: a PermanentError's Hebrew customer
      // message or one of the fixed Hebrew strings. The fallback covers rows
      // failed before that invariant existed.
      body.failureReason = render.error ?? "יצירת הסרטון נכשלה — נסו שוב.";
      // refunded_at is written only in the same transaction as the refund row
      // (failRenderAndRefund) — the wizard's refund sentence hangs off this.
      body.refunded = render.refundedAt !== null;
    }
    return NextResponse.json(body);
  } catch (err) {
    return coreErrorResponse(err);
  }
}
