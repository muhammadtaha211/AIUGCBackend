import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getConfigValue } from "../appConfig";
import { creditCostsSchema } from "../config";
import type { Db } from "../db";
import {
  audioRenders,
  businesses,
  composites,
  demos,
  events,
  personaImages,
  sets,
  subscriptions,
  videoRenders,
} from "../db/schema";
import { enqueue } from "../jobs/queue";
import {
  lipsyncExpressivenessSchema,
  type LipsyncExpressiveness,
} from "../providers/lipsync";
import { creditBalance, debitRender } from "./credits";
import { isAdminOwned } from "./businesses";

/**
 * A Set is a parameter grid over one demo + one questionnaire — the
 * combinatorial reuse that IS the product. V0 axes: hook clip x hook line.
 * Captions/audio are held constant per set (they derive from the demo).
 */
export const setGridSchema = z.object({
  hookClipIds: z.array(z.string().uuid()).min(1),
  hookLineScriptIds: z.array(z.string().uuid()).min(1),
  mode: z.enum(["silent", "voiced"]),
  /** Required for silent mode: the benefit_captions script. */
  captionScriptId: z.string().uuid().optional(),
  /** Required for voiced mode: an APPROVED audio render. */
  audioRenderId: z.string().uuid().optional(),
});

export type SetGrid = z.infer<typeof setGridSchema>;

export interface VariantParams {
  hookClipId: string;
  hookLineScriptId: string;
  mode: "silent" | "voiced";
  captionScriptId?: string;
  audioRenderId?: string;
  /** Service B: resolves to the persona's default reference image at render time. */
  personaId?: string;
  /** Explicit persona reference image — overrides the persona's default. */
  personaImageId?: string;
  /** Approved product-in-hand composite — takes precedence as the lipsync source. */
  compositeId?: string;
  /** Service B: HeyGen `motion_prompt` — overrides `app_config.lipsync_motion_prompt`. */
  motionPrompt?: string;
  /** Service B: HeyGen `expressiveness` — overrides `app_config.lipsync_expressiveness`. */
  expressiveness?: LipsyncExpressiveness;
  /** The clip Remotion composes: the stored HeyGen output (lipsync.mp4). */
  lipsyncPath?: string;
}

export async function createSet(
  db: Db,
  opts: { businessId: string; demoId: string; grid: SetGrid; parentVariantId?: string },
) {
  const grid = setGridSchema.parse(opts.grid);

  const demoRows = await db.select().from(demos).where(eq(demos.id, opts.demoId)).limit(1);
  if (demoRows[0]?.status !== "ready") throw new Error("demo is not ready");

  if (grid.mode === "voiced") {
    if (!grid.audioRenderId) throw new Error("voiced mode requires audioRenderId");
    const audio = await db
      .select()
      .from(audioRenders)
      .where(eq(audioRenders.id, grid.audioRenderId))
      .limit(1);
    // The hard gate: never render video on unapproved audio.
    if (!audio[0]?.approvedAt)
      throw new Error("audio must be approved before rendering (hard gate)");
  } else if (!grid.captionScriptId) {
    throw new Error("silent mode requires captionScriptId");
  }

  const cells: VariantParams[] = grid.hookClipIds.flatMap((hookClipId) =>
    grid.hookLineScriptIds.map((hookLineScriptId) => ({
      hookClipId,
      hookLineScriptId,
      mode: grid.mode,
      captionScriptId: grid.captionScriptId,
      audioRenderId: grid.audioRenderId,
    })),
  );

  const { watermarked, chargeCredits } = await enforceQuota(db, opts.businessId, cells.length, "a");

  const setRows = await db
    .insert(sets)
    .values({
      businessId: opts.businessId,
      demoId: opts.demoId,
      service: "a",
      grid,
      parentVariantId: opts.parentVariantId,
    })
    .returning();
  const set = setRows[0]!;

  const costs = await getConfigValue(db, "credit_costs", creditCostsSchema);
  const renders = [];
  for (const params of cells) {
    const inserted = await db
      .insert(videoRenders)
      .values({
        setId: set.id,
        businessId: opts.businessId,
        service: "a",
        params,
        watermarked,
      })
      .returning();
    const render = inserted[0]!;
    renders.push(render);
    if (chargeCredits) {
      await debitRender(db, {
        businessId: opts.businessId,
        videoRenderId: render.id,
        cost: costs.a_render,
      });
    }
    await enqueue(db, {
      type: "render_video",
      idempotencyKey: `render:${render.id}`,
      payload: { videoRenderId: render.id },
    });
  }
  return { set, renders };
}

/** Winner loop: star a variant — also the platform's format-performance data. */
export async function starVariant(db: Db, videoRenderId: string): Promise<void> {
  const rows = await db
    .select()
    .from(videoRenders)
    .where(eq(videoRenders.id, videoRenderId))
    .limit(1);
  const render = rows[0];
  if (!render) throw new Error(`render ${videoRenderId} not found`);
  await db
    .update(videoRenders)
    .set({ starredAt: new Date(), updatedAt: new Date() })
    .where(eq(videoRenders.id, videoRenderId));
  await db.insert(events).values({
    kind: "star",
    businessId: render.businessId,
    subjectType: "video_render",
    subjectId: videoRenderId,
    payload: render.params as Record<string, unknown>,
  });
}

/**
 * "More like this": one insert — a new Set holding the starred variant's
 * parameters and varying whichever axes the caller supplies.
 */
export async function moreLikeThis(
  db: Db,
  opts: { variantId: string; hookClipIds?: string[]; hookLineScriptIds?: string[] },
) {
  const rows = await db
    .select()
    .from(videoRenders)
    .where(eq(videoRenders.id, opts.variantId))
    .limit(1);
  const variant = rows[0];
  if (!variant?.setId) throw new Error(`variant ${opts.variantId} not found or has no set`);
  const setRows = await db.select().from(sets).where(eq(sets.id, variant.setId)).limit(1);
  const parentSet = setRows[0]!;
  if (!parentSet.demoId) throw new Error("parent set has no demo");

  const held = variant.params as VariantParams;
  return createSet(db, {
    businessId: variant.businessId,
    demoId: parentSet.demoId,
    parentVariantId: opts.variantId,
    grid: {
      hookClipIds: opts.hookClipIds ?? [held.hookClipId],
      hookLineScriptIds: opts.hookLineScriptIds ?? [held.hookLineScriptId],
      mode: held.mode,
      captionScriptId: held.captionScriptId,
      audioRenderId: held.audioRenderId,
    },
  });
}

/**
 * Service B render: lip-sync first, then assembly; lands in the QC queue.
 * The lipsync source is always image+audio: an approved product-in-hand
 * composite takes precedence, then an explicit persona image, then the
 * persona's default reference image (resolved at render time).
 */
export async function createBRender(
  db: Db,
  opts: {
    businessId: string;
    audioRenderId: string;
    personaId?: string;
    personaImageId?: string;
    compositeId?: string;
    /** HeyGen motion_prompt for this render — overrides the app_config default. */
    motionPrompt?: string;
    /** HeyGen expressiveness (low|medium|high) — overrides the app_config default. */
    expressiveness?: string;
  },
) {
  const audio = await db
    .select()
    .from(audioRenders)
    .where(eq(audioRenders.id, opts.audioRenderId))
    .limit(1);
  if (!audio[0]?.approvedAt) throw new Error("audio must be approved before rendering (hard gate)");

  if (!opts.personaId && !opts.personaImageId && !opts.compositeId) {
    throw new Error("a personaId, personaImageId, or compositeId is required");
  }
  if (opts.compositeId) {
    const composite = await db
      .select()
      .from(composites)
      .where(eq(composites.id, opts.compositeId))
      .limit(1);
    if (!composite[0]) throw new Error(`composite ${opts.compositeId} not found`);
    // The hard gate, same as audio: never lipsync an unapproved composite.
    if (!composite[0].approvedAt) {
      throw new Error("composite must be approved before rendering (hard gate)");
    }
  }
  if (opts.personaImageId) {
    const image = await db
      .select()
      .from(personaImages)
      .where(eq(personaImages.id, opts.personaImageId))
      .limit(1);
    if (!image[0]) throw new Error(`persona image ${opts.personaImageId} not found`);
    if (opts.personaId && image[0].personaId !== opts.personaId) {
      throw new Error(`persona image ${opts.personaImageId} belongs to a different persona`);
    }
  }

  // Fail a typo'd tier here, not as a HeyGen 400 after the render is queued.
  const expressiveness =
    opts.expressiveness === undefined
      ? undefined
      : lipsyncExpressivenessSchema.parse(opts.expressiveness);

  const { watermarked, chargeCredits } = await enforceQuota(db, opts.businessId, 1, "b");
  const costs = await getConfigValue(db, "credit_costs", creditCostsSchema);

  const inserted = await db
    .insert(videoRenders)
    .values({
      businessId: opts.businessId,
      service: "b",
      params: {
        audioRenderId: opts.audioRenderId,
        personaId: opts.personaId,
        personaImageId: opts.personaImageId,
        compositeId: opts.compositeId,
        motionPrompt: opts.motionPrompt,
        expressiveness,
      },
      watermarked,
    })
    .returning();
  const render = inserted[0]!;
  if (chargeCredits) {
    await debitRender(db, {
      businessId: opts.businessId,
      videoRenderId: render.id,
      cost: costs.b_render,
    });
  }
  await enqueue(db, {
    type: "lipsync",
    idempotencyKey: `lipsync:${render.id}`,
    payload: { videoRenderId: render.id },
  });
  return render;
}

/**
 * Quota policy: admin-owned businesses (the founder's CLI use) bypass credits
 * and watermarks. Subscribed businesses spend credits. Businesses with no live
 * subscription get exactly ONE watermarked sample render, ever.
 */
async function enforceQuota(
  db: Db,
  businessId: string,
  cellCount: number,
  service: "a" | "b",
): Promise<{ watermarked: boolean; chargeCredits: boolean }> {
  if (await isAdminOwned(db, businessId)) return { watermarked: false, chargeCredits: false };

  const liveSub = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.businessId, businessId),
        inArray(subscriptions.status, ["active", "past_due"]),
      ),
    )
    .limit(1);

  if (!liveSub[0]) {
    const business = (
      await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1)
    )[0]!;
    if (business.sampleUsedAt) {
      throw new Error("the free watermarked sample was already used — a subscription is required");
    }
    if (cellCount !== 1 || service !== "a") {
      throw new Error("without a subscription only a single Service A sample render is allowed");
    }
    await db
      .update(businesses)
      .set({ sampleUsedAt: new Date() })
      .where(eq(businesses.id, businessId));
    return { watermarked: true, chargeCredits: false };
  }

  const costs = await getConfigValue(db, "credit_costs", creditCostsSchema);
  const total = cellCount * (service === "a" ? costs.a_render : costs.b_render);
  const balance = await creditBalance(db, businessId);
  if (balance < total) {
    throw new Error(`insufficient credits: need ${total}, balance is ${balance}`);
  }
  return { watermarked: false, chargeCredits: true };
}
