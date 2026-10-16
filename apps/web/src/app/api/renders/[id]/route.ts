import { NextResponse } from "next/server";
import {
  creditBalance,
  getDb,
  getJobProgress,
  getStorage,
  HEAVY_JOB_TYPES,
  pendingPostsByRender,
  type JobProgress,
} from "@aiugc/core";
import { coreErrorResponse, requireRender, requireUser, SIGNED_URL_TTL_SECONDS } from "@/lib/api";
import { renderDownloadFilename } from "@/lib/service-b-ui";
import { userPlatforms } from "@/lib/social";

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
      /** The same object signed as an attachment, so the browser saves it
       *  instead of navigating to it. Separate from videoUrl on purpose: a
       *  ?download= URL would make the <video> element's own request an
       *  attachment too. The storage adapter owns the mechanism — the player
       *  component never learns which backend it is on. */
      downloadUrl?: string;
      thumbUrl?: string;
      failureReason?: string;
      refunded?: boolean;
      /** Post-refund account balance — present only alongside refunded:true.
       *  The wizard pushes it into the sidebar's BalanceProvider on the
       *  terminal poll tick. Server-computed, never client arithmetic. */
      balance?: number;
      /** Render job progress (8d pattern) — queue position, elapsed, the
       *  renderMedia percent, and the heartbeat that tells "still working"
       *  from "nothing is processing this". */
      job?: JobProgress;
      /** The player's "תזמון פרסום" (social posting PR 3): released renders,
       *  for an account the switch allows — absent for everyone else, so a
       *  hidden account's player has no button and no trace. */
      scheduleHref?: string;
      /** Posts of this video still waiting (scheduled or publishing). */
      pendingPosts?: number;
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
        body.downloadUrl = await storage.signedUrl(render.filePath, SIGNED_URL_TTL_SECONDS, {
          download: renderDownloadFilename(render),
        });
      }
      if (render.thumbPath) {
        body.thumbUrl = await storage.signedUrl(render.thumbPath, SIGNED_URL_TTL_SECONDS);
      }
      // Best-effort: a failed switch read only hides the button.
      const platforms = render.filePath ? await userPlatforms(auth.userId).catch(() => []) : [];
      if (platforms.length > 0) {
        body.scheduleHref = `/schedule/${id}`;
        body.pendingPosts = (await pendingPostsByRender(db, [id], platforms)).get(id) ?? 0;
      }
    }
    if (render.status === "failed") {
      // Displayable by construction: a PermanentError's Hebrew customer
      // message or one of the fixed Hebrew strings. The fallback covers rows
      // failed before that invariant existed.
      body.failureReason = render.error ?? "יצירת הסרטון נכשלה — נסו שוב.";
      // refunded_at is written only in the same transaction as the refund row
      // (failRenderAndRefund) — the wizard's refund sentence hangs off this,
      // so the balance below is final the first time it is served. The poll
      // stops on this terminal tick, so the SUM runs at most a couple times.
      body.refunded = render.refundedAt !== null;
      if (body.refunded) body.balance = await creditBalance(db, auth.userId);
    }
    return NextResponse.json(body);
  } catch (err) {
    return coreErrorResponse(err);
  }
}
