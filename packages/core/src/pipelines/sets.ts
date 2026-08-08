import { eq } from "drizzle-orm";
import { z } from "zod";
import { getConfigValue, getConfigValueOr } from "../appConfig";
import { snapToWordGap, type CaptionChunk } from "../captions";
import type { Db } from "../db";
import {
  audioRenders,
  composites,
  demos,
  events,
  personaImages,
  sets,
  videoRenders,
} from "../db/schema";
import { textSafeAreaSchema, type SafeRect } from "../hook-geometry";
import { enqueue } from "../jobs/queue";
import {
  creditCostsSchema,
  quoteEndingReroll,
  quoteServiceA,
  quoteServiceB,
  type QuoteComponent,
} from "../pricing";
import { lipsyncExpressivenessSchema, type LipsyncExpressiveness } from "../providers/lipsync";
import { businessOwnerId, creditBalance, debitRender, InsufficientCreditsError } from "./credits";
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
  /** Voiced mode: the persona behind the voice — required for an avatar ending. */
  personaId: z.string().uuid().optional(),
  /** Customer-placed hook-line rect; absent = each clip's default safe area. */
  textSafeArea: textSafeAreaSchema.optional(),
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
  /** Service A voiced: what happens when the VO outlasts the demo (see createSet). */
  outroMode?: "none" | "freeze" | "avatar";
  /** Avatar ending: VO offset (ms) where the outro begins — snapped to a word gap. */
  voSliceMs?: number;
  /** Customer-placed hook-line rect; resolveHookTextSafeArea falls back to the clip's. */
  textSafeArea?: SafeRect;
}

export interface AOutroPlan {
  outroMode: "none" | "freeze" | "avatar";
  /** Avatar only: VO offset (ms) where the outro begins — snapped to a word gap. */
  voSliceMs?: number;
  remainderMs: number;
  demoDurationMs: number;
  voDurationMs: number;
}

/**
 * The conditional ending: the approved VO's exact duration against the demo.
 * VO plays from demo start, so the remainder is hook-independent. Shared by
 * createSet (the decision itself) and the wizard's advisory display (the
 * projected shape shown before enqueue — a long ending is chosen, never
 * discovered).
 */
export async function planAOutro(
  db: Db,
  opts: { demoId: string; audioRenderId: string },
): Promise<AOutroPlan> {
  const demoRows = await db.select().from(demos).where(eq(demos.id, opts.demoId)).limit(1);
  if (demoRows[0]?.status !== "ready") throw new Error("demo is not ready");
  const demoDurationMs = demoRows[0].durationMs ?? 0;

  const audioRows = await db
    .select()
    .from(audioRenders)
    .where(eq(audioRenders.id, opts.audioRenderId))
    .limit(1);
  const audio = audioRows[0];
  // The hard gate: never render video on unapproved audio.
  if (!audio?.approvedAt) throw new Error("audio must be approved before rendering (hard gate)");
  const voDurationMs = audio.durationMs ?? 0;

  const remainderMs = voDurationMs - demoDurationMs;
  const minSeconds = await getConfigValueOr(db, "a_outro_min_seconds", z.number(), 2);
  const base = { remainderMs, demoDurationMs, voDurationMs };
  if (remainderMs <= 0) return { outroMode: "none", ...base };
  if (remainderMs < minSeconds * 1000) return { outroMode: "freeze", ...base };
  return {
    outroMode: "avatar",
    voSliceMs: snapToWordGap((audio.wordTimestamps ?? []) as CaptionChunk[], demoDurationMs),
    ...base,
  };
}

export async function createSet(
  db: Db,
  opts: { businessId: string; demoId: string; grid: SetGrid; parentVariantId?: string },
) {
  const grid = setGridSchema.parse(opts.grid);

  const demoRows = await db.select().from(demos).where(eq(demos.id, opts.demoId)).limit(1);
  const demo = demoRows[0];
  if (demo?.status !== "ready") throw new Error("demo is not ready");

  let outro: Pick<VariantParams, "outroMode" | "voSliceMs"> = {};
  if (grid.mode === "voiced") {
    if (!grid.audioRenderId) throw new Error("voiced mode requires audioRenderId");
    const plan = await planAOutro(db, { demoId: opts.demoId, audioRenderId: grid.audioRenderId });
    if (plan.outroMode === "avatar" && !grid.personaId) {
      throw new Error(
        "the voiceover outlasts the demo enough for an avatar ending — pass personaId",
      );
    }
    outro = { outroMode: plan.outroMode, voSliceMs: plan.voSliceMs };
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
      personaId: grid.personaId,
      textSafeArea: grid.textSafeArea,
      ...outro,
    })),
  );

  // Voiced sets are priced from the ending; silent sets have no VO to price
  // from, so they fall back to the assembly flat + demo seconds.
  const quote = grid.audioRenderId
    ? await quoteASet(db, {
        businessId: opts.businessId,
        demoId: opts.demoId,
        audioRenderId: grid.audioRenderId,
      })
    : await quoteSilentASet(db, { businessId: opts.businessId, demo });
  assertAffordable(quote, cells.length);

  // One transaction: the set, its renders, their debits and their jobs commit
  // together or not at all. A job can never see a render row that isn't there,
  // and a debit can never outlive the render it paid for.
  return db.transaction(async (tx) => {
    const setRows = await tx
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

    const renders = [];
    for (const params of cells) {
      const inserted = await tx
        .insert(videoRenders)
        .values({ setId: set.id, businessId: opts.businessId, service: "a", params })
        .returning();
      const render = inserted[0]!;
      renders.push(render);
      // Per render, never per set — refunds key on the render id.
      if (quote.chargeable) {
        await debitRender(tx as Db, {
          businessId: opts.businessId,
          videoRenderId: render.id,
          cost: quote.creditsPerRender,
        });
      }
      // Avatar ending: lip-sync the VO tail first; handleLipsync chains render_video.
      if (params.outroMode === "avatar") {
        await enqueue(tx as Db, {
          type: "lipsync",
          idempotencyKey: `lipsync:${render.id}`,
          payload: { videoRenderId: render.id },
        });
      } else {
        await enqueue(tx as Db, {
          type: "render_video",
          idempotencyKey: `render:${render.id}`,
          payload: { videoRenderId: render.id },
        });
      }
    }
    return { set, renders };
  });
}

/** Silent Service A: no VO, so no ending — assembly flat + demo seconds only. */
async function quoteSilentASet(
  db: Db,
  opts: { businessId: string; demo: typeof demos.$inferSelect },
): Promise<RenderQuote> {
  const { chargeable, costs, balance } = await quoteContext(db, opts.businessId);
  const quote = quoteServiceA({
    demoSeconds: (opts.demo.durationMs ?? 0) / 1000,
    outroMode: "none",
    outroSeconds: 0,
    costs,
  });
  return { creditsPerRender: quote.credits, components: quote.components, chargeable, balance };
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
      personaId: held.personaId,
      textSafeArea: held.textSafeArea,
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
    // New renders only — QC regeneration reuses old params without this check.
    if (image[0].retired) throw new Error(`persona image ${opts.personaImageId} is retired`);
  }

  // Fail a typo'd tier here, not as a HeyGen 400 after the render is queued.
  const expressiveness =
    opts.expressiveness === undefined
      ? undefined
      : lipsyncExpressivenessSchema.parse(opts.expressiveness);

  const quote = await quoteBRender(db, {
    businessId: opts.businessId,
    audioRenderId: opts.audioRenderId,
  });
  assertAffordable(quote, 1);

  // Same all-or-nothing envelope as createSet: render, debit and job together.
  return db.transaction(async (tx) => {
    const inserted = await tx
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
      })
      .returning();
    const render = inserted[0]!;
    if (quote.chargeable) {
      await debitRender(tx as Db, {
        businessId: opts.businessId,
        videoRenderId: render.id,
        cost: quote.creditsPerRender,
      });
    }
    await enqueue(tx as Db, {
      type: "lipsync",
      idempotencyKey: `lipsync:${render.id}`,
      payload: { videoRenderId: render.id },
    });
    return render;
  });
}

/**
 * What a render will cost and whether this account can pay for it — computed
 * WITHOUT touching the ledger, so the advisory step and the confirm that
 * follows it quote the same integer from the same function call.
 *
 * `chargeable: false` is the admin bypass: the founder's own businesses run
 * outreach samples on the production pipeline for free and un-watermarked.
 */
export interface RenderQuote {
  /** Per render. A Set of N cells costs N x this. */
  creditsPerRender: number;
  /** Named parts behind the integer, so the UI can explain it without recomputing. */
  components: QuoteComponent[];
  /** false = admin-owned; nothing is debited and nothing is watermarked. */
  chargeable: boolean;
  balance: number;
}

/** Total for a Set; 0 when the account is on the admin bypass. */
function quoteTotal(quote: RenderQuote, cellCount: number): number {
  return quote.chargeable ? quote.creditsPerRender * cellCount : 0;
}

function shortfallOf(quote: RenderQuote, cellCount: number): number {
  return Math.max(0, quoteTotal(quote, cellCount) - quote.balance);
}

async function quoteContext(db: Db, businessId: string) {
  const chargeable = !(await isAdminOwned(db, businessId));
  const costs = await getConfigValue(db, "credit_costs", creditCostsSchema);
  const balance = chargeable ? await creditBalance(db, await businessOwnerId(db, businessId)) : 0;
  return { chargeable, costs, balance };
}

/**
 * Price a Service A render. The ending drives most of the number, so this runs
 * planAOutro — the same call createSet makes — rather than guessing: if the
 * advisory says "freeze", the quote shows zero outro credits, always.
 *
 * `outroCredits` is what the ending ADDS, as the difference between two settled
 * quotes. It is deliberately not the outro component: components are summed,
 * clamped to the minimum and ceiled ONCE, so a 2.1-credit component can be a
 * 2-credit delta, or 0 when `a_minimum_credits` is what decided the price.
 * Both quotes come from this one call, off one `costs` snapshot and one plan,
 * so no caller can difference two numbers that disagree about either.
 */
export async function quoteASet(
  db: Db,
  opts: { businessId: string; demoId: string; audioRenderId: string },
): Promise<RenderQuote & { outroCredits: number }> {
  const { chargeable, costs, balance } = await quoteContext(db, opts.businessId);
  const plan = await planAOutro(db, { demoId: opts.demoId, audioRenderId: opts.audioRenderId });
  const demoSeconds = plan.demoDurationMs / 1000;
  const quote = quoteServiceA({
    demoSeconds,
    outroMode: plan.outroMode,
    outroSeconds: Math.max(0, plan.remainderMs) / 1000,
    costs,
  });
  const withoutEnding = quoteServiceA({ demoSeconds, outroMode: "none", outroSeconds: 0, costs });
  return {
    creditsPerRender: quote.credits,
    components: quote.components,
    outroCredits: quote.credits - withoutEnding.credits,
    chargeable,
    balance,
  };
}

/**
 * Price a re-roll of an existing avatar ending: the GPU runs again on the same
 * VO tail and nothing else does, so only those seconds are billed.
 *
 * Pricing primitive only — there is deliberately NO debit helper here. A
 * re-roll produces a new video_renders row, so when the remix UI lands it goes
 * through createSet like everything else. createSet and createBRender are the
 * only two debit sites and adding a third is how ledgers start lying.
 */
export async function quoteRerollForRender(
  db: Db,
  opts: { videoRenderId: string },
): Promise<RenderQuote> {
  const render = (
    await db.select().from(videoRenders).where(eq(videoRenders.id, opts.videoRenderId)).limit(1)
  )[0];
  if (!render) throw new Error(`video render ${opts.videoRenderId} not found`);

  const params = render.params as VariantParams;
  if (params.outroMode !== "avatar" || params.voSliceMs === undefined) {
    throw new Error("only an avatar ending can be re-rolled");
  }
  const audio = (
    await db.select().from(audioRenders).where(eq(audioRenders.id, params.audioRenderId!)).limit(1)
  )[0];
  if (!audio?.durationMs) throw new Error("the render's audio has no duration");

  const { chargeable, costs, balance } = await quoteContext(db, render.businessId);
  const quote = quoteEndingReroll({
    sliceSeconds: (audio.durationMs - params.voSliceMs) / 1000,
    costs,
  });
  return { creditsPerRender: quote.credits, components: quote.components, chargeable, balance };
}

/** Price a Service B render from the approved VO's measured length. */
export async function quoteBRender(
  db: Db,
  opts: { businessId: string; audioRenderId: string },
): Promise<RenderQuote> {
  const { chargeable, costs, balance } = await quoteContext(db, opts.businessId);
  const audio = (
    await db.select().from(audioRenders).where(eq(audioRenders.id, opts.audioRenderId)).limit(1)
  )[0];
  if (!audio) throw new Error(`audio render ${opts.audioRenderId} not found`);
  const quote = quoteServiceB({ durationMs: audio.durationMs ?? 0, costs });
  return { creditsPerRender: quote.credits, components: quote.components, chargeable, balance };
}

/**
 * The pre-flight refusal: fail before a single row is written, so an
 * unaffordable confirm leaves no orphan set, render, or job behind. The
 * authoritative check is still the one inside debitRender's transaction —
 * this one only makes the common case clean.
 */
function assertAffordable(quote: RenderQuote, cellCount: number): void {
  if (shortfallOf(quote, cellCount) > 0) {
    throw new InsufficientCreditsError(quoteTotal(quote, cellCount), quote.balance);
  }
}
