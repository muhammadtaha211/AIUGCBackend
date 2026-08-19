import { eq } from "drizzle-orm";
import path from "node:path";
import { getEnv } from "../config";
import type { Db } from "../db";
import { demos } from "../db/schema";
import { enqueue, type Job } from "../jobs/queue";
import { PermanentError } from "../jobs/errors";
import type { JobContext, JobResult } from "../jobs/worker";
import { normalizeVideo, probe, thumbnail } from "../media/ffmpeg";
import { WORK_DIR } from "../paths";
import { getStorage, storageKey } from "../storage";

// Up to 3 minutes: step-plan demos are one continuous screen recording that
// the analysis pass mines for states — the render uses ~15-20s of it.
const MIN_DURATION_MS = 8_000;
const MAX_DURATION_MS = 180_000;

/** Register uploaded footage and queue probing/normalization. */
export async function createDemo(
  db: Db,
  opts: { businessId: string; filePath: string },
): Promise<typeof demos.$inferSelect> {
  const inserted = await db
    .insert(demos)
    .values({ businessId: opts.businessId, status: "uploaded" })
    .returning();
  const demo = inserted[0]!;

  const rawPath = await getStorage().put(
    "raw",
    storageKey({
      businessId: opts.businessId,
      entity: "demo",
      id: demo.id,
      filename: path.basename(opts.filePath),
    }),
    opts.filePath,
  );
  await db.update(demos).set({ rawPath, updatedAt: new Date() }).where(eq(demos.id, demo.id));

  await enqueue(db, {
    type: "ingest_demo",
    idempotencyKey: `ingest:${demo.id}`,
    payload: { demoId: demo.id },
  });
  return { ...demo, rawPath };
}

/**
 * Register footage the browser uploaded straight to storage (signed upload
 * URL — demo bytes never pass through a route handler) and queue ingest.
 * The caller has already verified that rawPath belongs to this business.
 */
export async function registerUploadedDemo(
  db: Db,
  opts: { businessId: string; rawPath: string },
): Promise<typeof demos.$inferSelect> {
  const inserted = await db
    .insert(demos)
    .values({ businessId: opts.businessId, status: "uploaded", rawPath: opts.rawPath })
    .returning();
  const demo = inserted[0]!;
  await enqueue(db, {
    type: "ingest_demo",
    idempotencyKey: `ingest:${demo.id}`,
    payload: { demoId: demo.id },
  });
  return demo;
}

/**
 * The optional "what the footage shows" note — soft grounding for the VO
 * script. Once per demo, editable while the customer is on the upload step;
 * every script generated from this demo afterwards inherits it. Blank clears.
 * The cap matches the request schema — user-authored text interpolated into
 * the vo_script prompt, so it is bounded on every write path, CLI included.
 */
export const MAX_DEMO_DESCRIPTION_CHARS = 500;

export async function setDemoDescription(
  db: Db,
  opts: { demoId: string; description: string },
): Promise<void> {
  const rows = await db.select().from(demos).where(eq(demos.id, opts.demoId)).limit(1);
  if (!rows[0]) throw new Error(`demo ${opts.demoId} not found`);
  await db
    .update(demos)
    .set({
      description: opts.description.trim().slice(0, MAX_DEMO_DESCRIPTION_CHARS) || null,
      updatedAt: new Date(),
    })
    .where(eq(demos.id, opts.demoId));
}

/**
 * Every ready demo gets analyzed once — the wizard's plan step needs the state
 * inventory, and starting at ingest hides the minutes of analysis latency. The
 * analyze_demo handler lands with the step-plan pipeline; until a worker knows
 * the type, the job just waits in the queue (lanes claim registered types only).
 */
async function enqueueAnalysis(db: Db, demoId: string): Promise<void> {
  await enqueue(db, {
    type: "analyze_demo",
    idempotencyKey: `analyze:${demoId}`,
    payload: { demoId },
  });
}

/** Job handler: probe -> sanity checks -> normalize -> thumbnail -> ready. */
export async function handleIngestDemo(job: Job, ctx: JobContext): Promise<JobResult> {
  const { demoId } = job.payload as { demoId: string };
  const rows = await ctx.db.select().from(demos).where(eq(demos.id, demoId)).limit(1);
  const demo = rows[0];
  if (!demo?.rawPath) throw new PermanentError(`demo ${demoId} not found or has no raw file`);

  try {
    if (getEnv().DRY_RUN) {
      // Fake a valid vertical 20s phone clip so the rest of the pipeline runs.
      await ctx.db
        .update(demos)
        .set({
          status: "ready",
          probe: {
            width: 1080,
            height: 1920,
            fps: 30,
            durationMs: 20_000,
            hasAudio: true,
            dryRun: true,
          },
          durationMs: 20_000,
          normalizedPath: demo.rawPath,
          updatedAt: new Date(),
        })
        .where(eq(demos.id, demoId));
      await enqueueAnalysis(ctx.db, demoId);
      return { kind: "done" };
    }

    await ctx.db
      .update(demos)
      .set({ status: "probing", updatedAt: new Date() })
      .where(eq(demos.id, demoId));

    const storage = getStorage();
    const localRaw = path.join(WORK_DIR, "ingest", demoId, "raw.mp4");
    await storage.download(demo.rawPath, localRaw);

    const info = await probe(localRaw);
    // Lo-fi is intentional — sanity checks only, each with a human-readable reason.
    if (info.height <= info.width) {
      throw new PermanentError("הסרטון אופקי — צריך וידאו אנכי (9:16)");
    }
    if (info.durationMs < MIN_DURATION_MS || info.durationMs > MAX_DURATION_MS) {
      throw new PermanentError("אורך הסרטון חייב להיות בין 8 שניות ל-3 דקות");
    }

    await ctx.db
      .update(demos)
      .set({ status: "normalizing", probe: info, updatedAt: new Date() })
      .where(eq(demos.id, demoId));

    const localNormalized = path.join(WORK_DIR, "ingest", demoId, "normalized.mp4");
    const localThumb = path.join(WORK_DIR, "ingest", demoId, "thumb.jpg");
    await normalizeVideo(localRaw, localNormalized);
    await thumbnail(localNormalized, localThumb);

    const keyBase = { businessId: demo.businessId, entity: "demo" as const, id: demoId };
    const normalizedPath = await storage.put(
      "assets",
      storageKey({ ...keyBase, filename: "normalized.mp4" }),
      localNormalized,
    );
    const thumbPath = await storage.put(
      "assets",
      storageKey({ ...keyBase, filename: "thumb.jpg" }),
      localThumb,
    );

    await ctx.db
      .update(demos)
      .set({
        status: "ready",
        durationMs: info.durationMs,
        normalizedPath,
        thumbPath,
        updatedAt: new Date(),
      })
      .where(eq(demos.id, demoId));
    await enqueueAnalysis(ctx.db, demoId);
    return { kind: "done" };
  } catch (err) {
    if (err instanceof PermanentError) {
      await ctx.db
        .update(demos)
        .set({ status: "rejected", rejectReason: err.message, updatedAt: new Date() })
        .where(eq(demos.id, demoId));
    }
    throw err;
  }
}
