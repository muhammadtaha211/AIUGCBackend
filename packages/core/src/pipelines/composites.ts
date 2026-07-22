import { eq } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getConfigValue } from "../appConfig";
import { assertBudget, recordUsage } from "../budget";
import { getEnv } from "../config";
import type { Db } from "../db";
import { composites, personaClips } from "../db/schema";
import { PermanentError } from "../jobs/errors";
import { enqueue, type Job } from "../jobs/queue";
import type { JobContext, JobResult } from "../jobs/worker";
import { thumbnail } from "../media/ffmpeg";
import { WORK_DIR } from "../paths";
import { getImagegenProvider } from "../providers/imagegen";
import { getStorage, storageKey } from "../storage";
import { requireQuestionnaire } from "./businesses";

/**
 * Fixed prompt (locked format, like the hook bank): a natural UGC-style
 * product-in-hand shot. The persona comes from the reference stills, the
 * product from the last image.
 */
const COMPOSITE_PROMPT =
  "The person from the reference photos holds the product from the last photo up to the camera, " +
  "as if filming themselves recommending it. Casual selfie framing, natural indoor lighting, " +
  "authentic UGC style, vertical 9:16. Keep the person's face and the product exactly as shown.";

/** Max persona reference stills sent alongside the product photo. */
const MAX_REFERENCE_STILLS = 3;

/**
 * Register a product photo and queue composite generation. Physical products
 * only — the questionnaire category is the gate.
 */
export async function createComposite(
  db: Db,
  opts: { businessId: string; personaId: string; productImageFile: string },
): Promise<typeof composites.$inferSelect> {
  const questionnaire = await requireQuestionnaire(db, opts.businessId);
  if (questionnaire.category !== "physical_product") {
    throw new Error("composites are only available for physical products");
  }

  const inserted = await db
    .insert(composites)
    .values({ businessId: opts.businessId, personaId: opts.personaId })
    .returning();
  const composite = inserted[0]!;

  const productImagePath = await getStorage().put(
    "assets",
    storageKey({
      businessId: opts.businessId,
      entity: "composite",
      id: composite.id,
      filename: `product${path.extname(opts.productImageFile) || ".jpg"}`,
    }),
    opts.productImageFile,
  );
  await db.update(composites).set({ productImagePath }).where(eq(composites.id, composite.id));

  await enqueue(db, {
    type: "generate_composite",
    idempotencyKey: `composite:${composite.id}`,
    payload: { compositeId: composite.id },
  });
  return { ...composite, productImagePath };
}

/** The hard composite gate — lipsync refuses composites without approved_at. */
export async function approveComposite(db: Db, compositeId: string): Promise<void> {
  const rows = await db.select().from(composites).where(eq(composites.id, compositeId)).limit(1);
  const composite = rows[0];
  if (!composite) throw new Error(`composite ${compositeId} not found`);
  if (composite.status !== "ready") {
    throw new Error(`composite is not ready yet (status: ${composite.status})`);
  }
  await db.update(composites).set({ approvedAt: new Date() }).where(eq(composites.id, compositeId));
}

/**
 * Job handler: persona stills + product photo -> nano-banana -> stored image.
 * Submit checkpoints the provider job id BEFORE polling (same as lipsync).
 */
export async function handleGenerateComposite(job: Job, ctx: JobContext): Promise<JobResult> {
  const { compositeId } = job.payload as { compositeId: string };
  const rows = await ctx.db
    .select()
    .from(composites)
    .where(eq(composites.id, compositeId))
    .limit(1);
  const composite = rows[0];
  if (!composite?.productImagePath) {
    throw new PermanentError(`composite ${compositeId} not found or has no product image`);
  }

  const provider = getImagegenProvider();
  const state = job.state as { providerJobId?: string };
  const storage = getStorage();
  const localDir = path.join(WORK_DIR, "composite", compositeId);

  try {
    if (!state.providerJobId) {
      await assertBudget(ctx.db, "images");
      await ctx.db
        .update(composites)
        .set({ status: "generating" })
        .where(eq(composites.id, compositeId));

      // Persona identity: stills extracted from base clips (V0 has no
      // dedicated identity images).
      const clips = await ctx.db
        .select()
        .from(personaClips)
        .where(eq(personaClips.personaId, composite.personaId))
        .limit(MAX_REFERENCE_STILLS);
      if (clips.length === 0) {
        throw new PermanentError("persona has no clips to extract reference stills from");
      }

      mkdirSync(localDir, { recursive: true });
      const stillUrls: string[] = [];
      for (const [i, clip] of clips.entries()) {
        const localStill = path.join(localDir, `still-${i}.jpg`);
        if (getEnv().DRY_RUN) {
          writeFileSync(localStill, "DRY_RUN placeholder persona still");
        } else {
          const localClip = path.join(localDir, `clip-${i}.mp4`);
          await storage.download(clip.filePath, localClip);
          await thumbnail(localClip, localStill);
        }
        const stillPath = await storage.put(
          "assets",
          storageKey({
            businessId: composite.businessId,
            entity: "composite",
            id: compositeId,
            filename: `still-${i}.jpg`,
          }),
          localStill,
        );
        stillUrls.push(await storage.signedUrl(stillPath, 3600));
      }

      const { providerJobId } = await provider.submit({
        imageUrls: [...stillUrls, await storage.signedUrl(composite.productImagePath, 3600)],
        prompt: COMPOSITE_PROMPT,
      });
      const costAgorot = await getConfigValue(ctx.db, "imagegen_cost_agorot", z.number().int());
      await recordUsage(ctx.db, {
        provider: "fal",
        kind: "images",
        quantity: 1,
        costEstimateAgorot: costAgorot,
        jobId: job.id,
        businessId: composite.businessId,
      });
      await ctx.checkpoint({ providerJobId });
      return { kind: "reschedule", delayMs: 5_000, state: { providerJobId } };
    }

    const result = await provider.poll(state.providerJobId);
    if (result.status === "pending") return { kind: "reschedule", delayMs: 10_000 };
    if (result.status === "failed") {
      throw new PermanentError(`composite generation failed: ${result.reason}`);
    }

    mkdirSync(localDir, { recursive: true });
    const localOut = path.join(localDir, "composite.png");
    if (result.imageUrl.startsWith("dryrun://")) {
      writeFileSync(localOut, "DRY_RUN placeholder composite image");
    } else {
      const response = await fetch(result.imageUrl);
      if (!response.ok) throw new PermanentError(`composite download failed: ${response.status}`);
      writeFileSync(localOut, Buffer.from(await response.arrayBuffer()));
    }
    const outputPath = await storage.put(
      "assets",
      storageKey({
        businessId: composite.businessId,
        entity: "composite",
        id: compositeId,
        filename: "composite.png",
      }),
      localOut,
    );

    await ctx.db
      .update(composites)
      .set({ status: "ready", outputPath })
      .where(eq(composites.id, compositeId));
    return { kind: "done" };
  } catch (err) {
    if (err instanceof PermanentError) {
      await ctx.db
        .update(composites)
        .set({ status: "failed", error: err.message })
        .where(eq(composites.id, compositeId));
    }
    throw err;
  }
}
