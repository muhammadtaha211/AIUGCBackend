import { eq } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getConfigValue } from "../appConfig";
import { assertBudget, recordUsage } from "../budget";
import type { Db } from "../db";
import { composites, personaImages } from "../db/schema";
import { PermanentError } from "../jobs/errors";
import { assertPollDeadline } from "../jobs/poll";
import { enqueue, type Job } from "../jobs/queue";
import type { JobContext, JobResult } from "../jobs/worker";
import { WORK_DIR } from "../paths";
import { getImagegenProvider } from "../providers/imagegen";
import { getStorage, storageKey } from "../storage";
import { requireQuestionnaire } from "./businesses";

/**
 * Fixed prompt (locked format, like the hook bank): a natural UGC-style
 * product-in-hand shot. The persona comes from the reference images, the
 * product from the last image.
 */
const COMPOSITE_PROMPT =
  "The person from the reference photos holds the product from the last photo up to the camera, " +
  "as if filming themselves recommending it. Casual selfie framing, natural indoor lighting, " +
  "authentic UGC style, vertical 9:16. Keep the person's face and the product exactly as shown.";

/** Max persona reference images sent alongside the product photo. */
const MAX_REFERENCE_IMAGES = 3;

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
 * Job handler: persona reference images + product photo -> nano-banana ->
 * stored image. Submit checkpoints the provider job id BEFORE polling (same
 * as lipsync).
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
  const state = job.state as { providerJobId?: string; submittedAt?: number };
  const storage = getStorage();
  const localDir = path.join(WORK_DIR, "composite", compositeId);

  try {
    if (!state.providerJobId) {
      await assertBudget(ctx.db, "images");
      await ctx.db
        .update(composites)
        .set({ status: "generating" })
        .where(eq(composites.id, compositeId));

      // Persona identity: the persona's reference images.
      const images = await ctx.db
        .select()
        .from(personaImages)
        .where(eq(personaImages.personaId, composite.personaId))
        .limit(MAX_REFERENCE_IMAGES);
      if (images.length === 0) {
        throw new PermanentError(
          "persona has no reference images — add one with `aiugc persona add-image`",
        );
      }
      const referenceUrls: string[] = [];
      for (const image of images) {
        referenceUrls.push(await storage.signedUrl(image.filePath, 3600));
      }

      const { providerJobId } = await provider.submit({
        imageUrls: [...referenceUrls, await storage.signedUrl(composite.productImagePath, 3600)],
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
      const submittedAt = Date.now();
      await ctx.checkpoint({ providerJobId, submittedAt });
      return { kind: "reschedule", delayMs: 5_000, state: { providerJobId, submittedAt } };
    }

    const result = await provider.poll(state.providerJobId);
    if (result.status === "pending") {
      // submittedAt ?? now backfills state written before the deadline existed.
      const submittedAt = state.submittedAt ?? Date.now();
      await assertPollDeadline(ctx.db, ctx.log, { providerJobId: state.providerJobId, submittedAt });
      return { kind: "reschedule", delayMs: 10_000, state: { ...state, submittedAt } };
    }
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
