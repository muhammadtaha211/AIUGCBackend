import { eq } from "drizzle-orm";
import type { Db } from "../db";
import { events, videoRenders } from "../db/schema";
import { enqueue } from "../jobs/queue";

/**
 * Founder QC-release gate for Service B: finished renders land here before the
 * customer ever sees them (RLS hides qc_pending/rejected rows). Invisible
 * latency — renders are async anyway. auto_release_b in app_config flips this
 * off without a rebuild.
 */
export async function listQcQueue(db: Db) {
  return db.select().from(videoRenders).where(eq(videoRenders.status, "qc_pending"));
}

export async function releaseRender(db: Db, videoRenderId: string): Promise<void> {
  const render = await loadQcPending(db, videoRenderId);
  await db
    .update(videoRenders)
    .set({ status: "released", releasedAt: new Date(), updatedAt: new Date() })
    .where(eq(videoRenders.id, videoRenderId));
  await db.insert(events).values({
    kind: "qc_release",
    businessId: render.businessId,
    subjectType: "video_render",
    subjectId: videoRenderId,
  });
}

/**
 * Reject and (by default) regenerate: a fresh render row with the same params,
 * no additional debit — the customer is never double-charged for our QC.
 */
export async function rejectRender(
  db: Db,
  videoRenderId: string,
  reason: string,
  opts: { regenerate?: boolean } = {},
): Promise<{ regeneratedRenderId?: string }> {
  const render = await loadQcPending(db, videoRenderId);
  await db
    .update(videoRenders)
    .set({ status: "rejected", rejectedReason: reason, updatedAt: new Date() })
    .where(eq(videoRenders.id, videoRenderId));
  await db.insert(events).values({
    kind: "qc_reject",
    businessId: render.businessId,
    subjectType: "video_render",
    subjectId: videoRenderId,
    payload: { reason },
  });

  if (opts.regenerate === false) return {};

  // The seed exists so a retry is a DIFFERENT take — carrying it over would
  // reproduce the rejected video byte-for-byte at full GPU cost. The two path
  // keys would otherwise point at the rejected render's files, and upscaleError
  // is that render's failure, not this one's.
  const retryParams = { ...(render.params as Record<string, unknown>) };
  delete retryParams.seed;
  delete retryParams.lipsyncPlatePath;
  delete retryParams.lipsyncPath;
  delete retryParams.upscaleError;

  const inserted = await db
    .insert(videoRenders)
    .values({
      setId: render.setId,
      businessId: render.businessId,
      service: render.service,
      params: retryParams,
      watermarked: render.watermarked,
    })
    .returning();
  const regenerated = inserted[0]!;
  await enqueue(db, {
    type: render.service === "b" ? "lipsync" : "render_video",
    idempotencyKey: `${render.service === "b" ? "lipsync" : "render"}:${regenerated.id}`,
    payload: { videoRenderId: regenerated.id },
  });
  return { regeneratedRenderId: regenerated.id };
}

async function loadQcPending(db: Db, videoRenderId: string) {
  const rows = await db
    .select()
    .from(videoRenders)
    .where(eq(videoRenders.id, videoRenderId))
    .limit(1);
  const render = rows[0];
  if (!render) throw new Error(`render ${videoRenderId} not found`);
  if (render.status !== "qc_pending") {
    throw new Error(`render is not awaiting QC (status: ${render.status})`);
  }
  return render;
}
