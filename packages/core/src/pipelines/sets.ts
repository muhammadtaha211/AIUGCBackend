import { and, eq, inArray, isNull, like } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { getConfigValue, getConfigValueOr } from "../appConfig";
import { snapToWordGap, type CaptionChunk } from "../captions";
import type { Db } from "../db";
import {
  audioRenders,
  composites,
  creditLedger,
  demos,
  events,
  openerClips,
  personaImages,
  scripts,
  sets,
  videoRenders,
} from "../db/schema";
import { assertAccountBudget, assertBudget, AccountBudgetError } from "../budget";
import { hookEffectSchema, isHookAnimation, type HookEffect } from "../hook-effect";
import {
  CENTRED_HOOK_TEXT_RECT,
  resolveHookTextSafeArea,
  textSafeAreaSchema,
  type SafeRect,
} from "../hook-geometry";
import { hookTextError } from "../hook-text";
import { enqueue } from "../jobs/queue";
import { BudgetError } from "../jobs/errors";
import { logger } from "../logger";
import {
  creditCostsSchema,
  quoteEndingReroll,
  quoteServiceA,
  quoteServiceASteps,
  quoteServiceB,
  quoteServiceC,
  type QuoteComponent,
} from "../pricing";
import { lipsyncExpressivenessSchema, type LipsyncExpressiveness } from "../providers/lipsync";
import { businessOwnerId, creditBalance, debitRender, InsufficientCreditsError } from "./credits";
import { getBusiness, isAdminOwned } from "./businesses";
import { CONTENT_POLICY_CHECK_FAILED, contentPolicyCheck, ContentPolicyError } from "./copy";
import { resolveCutawaysForRender, type BCutaways } from "./cutaways";
import { getStepPlan } from "./demo-step-plans";

/**
 * A Set is a parameter grid over one demo + one questionnaire — the
 * combinatorial reuse that IS the product. V0 axes: hook clip x hook line.
 * Captions/audio are held constant per set (they derive from the demo).
 */
export const setGridSchema = z.object({
  hookClipIds: z.array(z.string().uuid()).min(1),
  hookLineScriptIds: z.array(z.string().uuid()).min(1),
  mode: z.enum(["silent", "voiced"]),
  /**
   * "steps" = the step-plan format (silent, no captions, no VO, no outro);
   * "full" = the older demo-with-captions format, CLI-reachable only. Absent
   * resolves from stepPlanId so pre-existing grids and callers stay valid —
   * the wizard always passes "steps" explicitly.
   */
  format: z.enum(["steps", "full"]).optional(),
  /** Steps format: the APPROVED demo_step_plans row the render composes. */
  stepPlanId: z.string().uuid().optional(),
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
  /** Absent on pre-steps rows = "full". renders.ts dispatches on this. */
  format?: "steps" | "full";
  /** Steps format: the approved plan this render composes (pinned by id). */
  stepPlanId?: string;
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
  /**
   * Service B: the silence handleLipsync prepended to the VO before submit,
   * pinned there so the composition assumes the value HeyGen actually saw —
   * never the current app_config row.
   */
  leadInMs?: number;
  /** Service A voiced: what happens when the VO outlasts the demo (see createSet). */
  outroMode?: "none" | "freeze" | "avatar";
  /** Avatar ending: VO offset (ms) where the outro begins — snapped to a word gap. */
  voSliceMs?: number;
  /** Customer-placed hook-line rect; resolveHookTextSafeArea falls back to the clip's. */
  textSafeArea?: SafeRect;
  /** Service B: the founder-made opener clip played in front of the talking head — RETIRED (vault 0023), CLI-only. */
  openerClipId?: string;
  /**
   * Service B: the hook animation the composition performs on the one HeyGen
   * clip (vault 0023). A NAME only — the numbers behind it live in
   * `buildServiceBProps`, so a retune never has to rewrite stored rows.
   * Absent = no animation, which is also what every pre-2026-09-06 row means.
   */
  hookEffect?: HookEffect;
  /**
   * Service B: the FINAL on-screen hook text, copied here at enqueue — never a
   * pointer to the script row, so a later re-derivation or edit cannot change
   * what gets burned after the customer confirmed (vault 0017). Present with a
   * hook animation or an opener, never on its own.
   */
  hookText?: string;
  /** Service B: where hookText burns — the customer's rect, else the opener's or CENTRED_HOOK_TEXT_RECT. */
  hookTextSafeArea?: SafeRect;
  /**
   * Service B demo cutaways (vault 0121): the plan's windows, COPIED here at
   * enqueue — never a pointer (vault 0017), so an edit after the confirm cannot
   * change a paid render, and QC regeneration replays them with the rest. VO
   * time; the render adds captionOffsetMs. Absent = the head-only ad. The demo
   * is linked here and nowhere else: a B render never gets a set_id, which
   * would mark the demo paid and waive Service A's analysis charge (0048).
   */
  cutaways?: BCutaways;
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

/**
 * The one automated gate between a customer's own words and a finished video.
 *
 * Nothing else looks at this text. Service A never touches HeyGen — no
 * lip-sync, no provider moderation anywhere in its path — and it bypasses QC
 * unconditionally (`renders.ts:491-492`); Service B releases without QC too,
 * because `auto_release_b` is permanently true (vault 0036). So no human and no
 * provider sees a Service A or Service B ad before the customer does.
 *
 * Wired 2026-09-11. Vault 0042 supersedes 0041, which decided not to wire it —
 * on a census of six accounts that were all the founder's own, and which named
 * its own expiry: the first signup by someone who is not the founder.
 *
 * Called after every free gate and before the transaction that debits, so a
 * refused render never charges, and a malformed or unaffordable request never
 * pays for a classifier call.
 *
 * The classifier call itself is metered — per-account, then platform — BEFORE
 * it spends (INP-01, security audit phase 4): it makes a real paid Anthropic
 * call, and a flagged verdict throws pre-debit, so an unmetered classifier was
 * a repeatable free spend. Both checks sit ahead of the try/catch below and on
 * their own throw normally; they are never at risk of being read as "the
 * classifier failed" by the catch.
 *
 * FAILS OPEN, deliberately and as a trade-off worth stating: a classifier that
 * errors — Anthropic down, a timeout, output that will not parse — records that
 * it did not run and lets the render through. A classifier outage must not take
 * the product down, and the exposure it guards is small. The cost is that the
 * gate is exactly as available as Anthropic is. A budget refusal is NOT such an
 * error and must never be read as one: the catch below rethrows
 * AccountBudgetError/BudgetError before its fail-open branch, defense-in-depth
 * against a future change inside contentPolicyCheck/callClaude that throws one
 * from within the try — today neither does, so the two checks above are what
 * actually fire.
 */
export async function assertContentPolicy(
  db: Db,
  businessId: string,
  extra: { label: string; text?: string | null }[],
): Promise<void> {
  // The same bypass as credits, watermarks and the per-account cap
  // (`budget.ts:85-87`): the founder's own businesses render cold-outreach
  // samples in volume, and the gate is for strangers. First, so an admin path
  // does not even read the questionnaire.
  if (await isAdminOwned(db, businessId)) return;

  // The questionnaire is on both paths, so it is read here rather than twice at
  // the call sites. Not requireQuestionnaire: an absent questionnaire is not
  // this gate's error to throw.
  const business = await getBusiness(db, businessId);
  const parts = [
    {
      label: "שאלון העסק",
      text: business.questionnaire ? JSON.stringify(business.questionnaire, null, 2) : undefined,
    },
    ...extra,
  ];

  // prompts/content_policy/v1.md takes ONE variable, `{{text}}`, described as
  // "advertiser-provided content (questionnaire and/or ad script, Hebrew)" — so
  // the input is one labelled blob, not a structure.
  const text = parts
    .map((p) => ({ label: p.label, text: p.text?.trim() }))
    .filter((p): p is { label: string; text: string } => Boolean(p.text))
    .map((p) => `${p.label}:\n${p.text}`)
    .join("\n\n");
  if (!text) return;

  // INP-01: the classifier is a real paid call, and a flagged verdict throws
  // BEFORE the debit transaction — so an unmetered classifier was a repeatable
  // free spend. Metered here, per-account then platform, same order AUTHZ-12
  // used at its four routes, and OUTSIDE the try/catch: a budget refusal is a
  // refusal, never a reason to let the render through.
  await assertAccountBudget(db, "llm_tokens", businessId);
  await assertBudget(db, "llm_tokens");

  let verdict: Awaited<ReturnType<typeof contentPolicyCheck>>;
  try {
    verdict = await contentPolicyCheck(db, { businessId, text });
  } catch (err) {
    // Never swallow a budget refusal into "check failed, let it through" —
    // see the defense-in-depth note above the function.
    if (err instanceof AccountBudgetError || err instanceof BudgetError) throw err;
    await db.insert(events).values({
      kind: CONTENT_POLICY_CHECK_FAILED,
      businessId,
      payload: { error: err instanceof Error ? err.message : String(err) },
    });
    logger.warn({ err, businessId }, "content policy check failed — letting the render through");
    return;
  }
  // contentPolicyCheck writes the `content_policy_flag` event itself
  // (`copy.ts:706-710`); refusing is this function's half.
  if (verdict.flagged) throw new ContentPolicyError(verdict.category, verdict.reason);
}

/** The text behind a set of script ids, in the order the ids were given. */
async function scriptTexts(db: Db, ids: string[]): Promise<string[]> {
  const wanted = ids.filter(Boolean);
  if (wanted.length === 0) return [];
  const rows = await db
    .select({ id: scripts.id, text: scripts.text })
    .from(scripts)
    .where(inArray(scripts.id, wanted));
  const byId = new Map(rows.map((r) => [r.id, r.text]));
  return wanted.map((id) => byId.get(id)).filter((t): t is string => Boolean(t));
}

export async function createSet(
  db: Db,
  opts: { businessId: string; demoId: string; grid: SetGrid; parentVariantId?: string },
) {
  const grid = setGridSchema.parse(opts.grid);
  // Absent format on a grid with a stepPlanId means steps; absent on anything
  // else means full — every pre-steps row and caller keeps its old meaning.
  const format = grid.format ?? (grid.stepPlanId ? "steps" : "full");
  // Refuse the contradictory grid rather than store a half-ignored field.
  if (format === "full" && grid.stepPlanId) {
    throw new Error('full format does not take a stepPlanId — pass format "steps" or drop it');
  }

  const demoRows = await db.select().from(demos).where(eq(demos.id, opts.demoId)).limit(1);
  const demo = demoRows[0];
  if (demo?.status !== "ready") throw new Error("demo is not ready");

  let outro: Pick<VariantParams, "outroMode" | "voSliceMs"> = {};
  if (format === "steps") {
    // Steps is silent by definition: no VO, no outro, no captions requirement.
    if (grid.mode === "voiced")
      throw new Error("steps format is silent — voiced mode does not apply");
    if (!grid.stepPlanId) throw new Error("steps format requires stepPlanId");
    const plan = await getStepPlan(db, grid.stepPlanId);
    if (!plan) throw new Error(`step plan ${grid.stepPlanId} not found`);
    if (plan.demoId !== opts.demoId) {
      throw new Error(`step plan ${grid.stepPlanId} belongs to a different demo`);
    }
    // The hard gate, same as audio: never render against an unapproved plan.
    if (plan.status !== "ready" || !plan.approvedAt) {
      throw new Error("step plan must be approved before rendering (hard gate)");
    }
  } else if (grid.mode === "voiced") {
    if (!grid.audioRenderId) throw new Error("voiced mode requires audioRenderId");
    const plan = await planAOutro(db, { demoId: opts.demoId, audioRenderId: grid.audioRenderId });
    if (plan.outroMode === "avatar" && !grid.personaId) {
      throw new Error(
        "the voiceover outlasts the demo enough for an avatar ending — pass personaId",
      );
    }
    // Pre-debit, like the credits check below: an in-handler rejection would
    // mean the customer paid, waited, and got a refund instead of a video.
    if (plan.outroMode === "avatar") {
      await assertAccountBudget(db, "gpu_seconds", opts.businessId);
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
      format,
      stepPlanId: grid.stepPlanId,
      captionScriptId: grid.captionScriptId,
      audioRenderId: grid.audioRenderId,
      personaId: grid.personaId,
      textSafeArea: grid.textSafeArea,
      ...outro,
    })),
  );

  // Steps is a flat (near-constant marginal cost); voiced full-format sets are
  // priced from the ending; silent full-format sets have no VO to price from,
  // so they fall back to the assembly flat + demo seconds.
  const quote =
    format === "steps"
      ? await quoteStepsASet(db, opts.businessId, opts.demoId)
      : grid.audioRenderId
        ? await quoteASet(db, {
            businessId: opts.businessId,
            demoId: opts.demoId,
            audioRenderId: grid.audioRenderId,
          })
        : await quoteSilentASet(db, { businessId: opts.businessId, demo });
  assertAffordable(quote, cells.length);

  // Customer-supplied text, checked before anything is charged. The hook lines
  // are the customer's own words: the hook studio lets them edit a line and
  // burn it onto the video, and an edit writes a NEW `scripts` row
  // (copy.ts:745-767), so these ids carry the FINAL text.
  await assertContentPolicy(db, opts.businessId, [
    {
      label: "משפטי הפתיחה שייצרבו על המסך",
      text: (await scriptTexts(db, grid.hookLineScriptIds)).join("\n"),
    },
    {
      label: "תסריט הכיתובים",
      text: (await scriptTexts(db, grid.captionScriptId ? [grid.captionScriptId] : []))[0],
    },
  ]);

  // One transaction: the set, its renders, their debits and their jobs commit
  // together or not at all. A job can never see a render row that isn't there,
  // and a debit can never outlive the render it paid for.
  return db.transaction(async (tx) => {
    // The analysis part, decided HERE and not from the advisory quote above:
    // two confirms racing on one demo would both have read "first" outside the
    // transaction. The lock serializes them, and the loser's re-read — taken
    // after the lock is granted, so it sees the winner's committed debit —
    // comes back "already paid". `quote` supplies the PRICE; the lock decides
    // whether this set owes it.
    let analysisCredits = 0;
    if (format === "steps" && quote.chargeable) {
      await tx.select({ id: demos.id }).from(demos).where(eq(demos.id, opts.demoId)).for("update");
      if (!(await demoHasPaidRender(tx as Db, opts.demoId))) {
        analysisCredits = quote.analysisCreditsOncePerSet;
      }
    }

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
    for (const [index, params] of cells.entries()) {
      const inserted = await tx
        .insert(videoRenders)
        .values({ setId: set.id, businessId: opts.businessId, service: "a", params })
        .returning();
      const render = inserted[0]!;
      renders.push(render);
      // Per render, never per set — refunds key on the render id. The
      // once-per-set analysis rides on the FIRST cell: still one row per
      // render, that one simply larger, so a refund of any cell gives back
      // exactly what that cell took.
      if (quote.chargeable) {
        await debitRender(tx as Db, {
          businessId: opts.businessId,
          videoRenderId: render.id,
          cost: quote.creditsPerRender + (index === 0 ? analysisCredits : 0),
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

/**
 * Has this demo ever cost the customer money? THE predicate behind
 * `a_demo_analysis_credits` — the analysis is charged once per demo, on the
 * first render of it that is actually paid for.
 *
 * A fact about the LEDGER, not about a wizard run: a demo analysed yesterday,
 * abandoned and reused today reads exactly like one uploaded and rendered
 * straight through. "Paid" = a `debit_render` row against a render of this
 * demo with no `refund_failed` row on the same ref — the same pairing
 * `refundRenderIfNeeded` writes and the 0016 unique indexes make one-to-one.
 * Deliberately NOT `video_renders.refunded_at`: the routes read that column
 * because it marks the render the CUSTOMER is looking at, and when a refund
 * lands on an ancestor (QC regeneration) the row that actually gave the money
 * back keeps a null `refunded_at`. For "did this demo ever keep money", only
 * the ledger is truthful.
 *
 * Service B renders have no set and so no demo; the joins drop them.
 */
export async function demoHasPaidRender(db: Db, demoId: string): Promise<boolean> {
  const refund = alias(creditLedger, "refund");
  const rows = await db
    .select({ id: creditLedger.id })
    .from(creditLedger)
    .innerJoin(videoRenders, eq(videoRenders.id, creditLedger.refId))
    .innerJoin(sets, eq(sets.id, videoRenders.setId))
    .leftJoin(refund, and(eq(refund.refId, creditLedger.refId), eq(refund.reason, "refund_failed")))
    .where(and(eq(sets.demoId, demoId), eq(creditLedger.reason, "debit_render"), isNull(refund.id)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Steps format: the per-render flat, plus the demo analysis when this set will
 * be the first paid render of its demo. Two settled quotes off ONE costs
 * snapshot, differenced — the same idiom (and the same reason) as
 * `quoteASet`'s `outroCredits`: components are summed and ceiled once, so a
 * component is not a price, and the number the customer is shown for the
 * analysis has to be the number the ledger moves.
 */
export async function quoteStepsASet(
  db: Db,
  businessId: string,
  /**
   * `null` = a demo that does not exist yet — what a NEW recording will cost,
   * which is the upload step's question. Not optional: a caller that forgets
   * the demo would otherwise silently quote the cheap price for a demo that
   * owes an analysis, or the dear one for a demo that has already paid.
   */
  demoId: string | null,
): Promise<RenderQuote> {
  const { chargeable, costs, balance } = await quoteContext(db, businessId);
  // A demo that does not exist has no paid render, by definition.
  const firstPaidRenderOfDemo = demoId === null || !(await demoHasPaidRender(db, demoId));
  const perRender = quoteServiceASteps({ costs, firstPaidRenderOfDemo: false });
  const quote = quoteServiceASteps({ costs, firstPaidRenderOfDemo });
  return {
    creditsPerRender: perRender.credits,
    analysisCreditsOncePerSet: quote.credits - perRender.credits,
    components: quote.components,
    chargeable,
    balance,
  };
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
  return {
    creditsPerRender: quote.credits,
    analysisCreditsOncePerSet: 0,
    components: quote.components,
    chargeable,
    balance,
  };
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
      // Absent on pre-steps variants: createSet resolves absent to "full".
      format: held.format,
      stepPlanId: held.stepPlanId,
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
    /** Opener clip (opener_clips.id); must belong to the render's source image. RETIRED (vault 0023). */
    openerClipId?: string;
    /**
     * The hook animation the composition performs (vault 0023): "none" |
     * "zoom" | "focus" | "whip". Typed as a bare string, like `expressiveness`
     * above, so the CLI can pass raw text and be refused HERE — pre-debit —
     * rather than writing a name nothing downstream recognises.
     */
    hookEffect?: string;
    /** The FINAL on-screen hook text — required with a hook animation or an opener, refused with neither. */
    hookText?: string;
    /** Customer-placed rect for hookText; absent = the opener's, else CENTRED_HOOK_TEXT_RECT. */
    hookTextSafeArea?: SafeRect;
    /** Demo cutaways (vault 0121): the cutaway_plans row whose windows this render copies. */
    cutawayPlanId?: string;
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
  // The persona image the lip-sync will animate: an explicit image, else the
  // persona's default. A composite is neither — it is its own file — and
  // takes precedence in handleLipsync, so no image is resolved for it here.
  let sourceImage: typeof personaImages.$inferSelect | undefined;
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
    sourceImage = image[0];
  } else if (!opts.compositeId && opts.personaId) {
    // Same predicates handleLipsync resolves the default with.
    sourceImage = (
      await db
        .select()
        .from(personaImages)
        .where(
          and(
            eq(personaImages.personaId, opts.personaId),
            eq(personaImages.isDefault, true),
            eq(personaImages.retired, false),
            like(personaImages.filePath, "%/%"),
          ),
        )
        .limit(1)
    )[0];
    // A default resolved here must be a selfie — the Service B render source
    // (vault 0017). While the catalog shows a persona's selfie on its card,
    // is_default may still point at the standing image, and a standing image
    // would render a standing talking head under a selfie card. An explicit
    // personaImageId (founder/CLI) and a composite bypass this on purpose. A
    // persona with no default at all still fails in handleLipsync, as before.
    if (sourceImage && sourceImage.kind !== "selfie") {
      throw new Error(
        "תמונת ברירת המחדל של הדמות אינה סלפי — יש להגדיר תמונת סלפי כברירת מחדל לפני יצירת סרטון",
      );
    }
  }

  // Fail a typo'd effect name here, pre-debit: an unknown name would be stored,
  // read back as "no animation" at render time, and ship a hookless ad with
  // nothing anywhere saying why.
  const hookEffect =
    opts.hookEffect === undefined ? undefined : hookEffectSchema.parse(opts.hookEffect);
  const animation = isHookAnimation(hookEffect) ? hookEffect : undefined;
  // A hook animation is performed ON the one clip; an opener is a clip in
  // front of it. renderServiceB refuses the pair — but only at render time,
  // after HeyGen has been billed, so refuse it here instead.
  if (animation !== undefined && opts.openerClipId !== undefined) {
    throw new Error("a hook animation and an opener clip are exclusive");
  }
  // The hook text comes with the thing it burns over, and never alone: an
  // animation or an opener with nothing to say is not an effect, and a line
  // with neither has no lifetime the timeline can give it.
  const hookSource = animation ?? opts.openerClipId;
  if ((hookSource === undefined) !== (opts.hookText === undefined)) {
    throw new Error(
      hookSource !== undefined
        ? "hookText is required with a hook animation or an opener clip"
        : "hookText needs a hook animation or an opener clip to burn over",
    );
  }

  let opener: typeof openerClips.$inferSelect | undefined;
  let hookText: string | undefined;
  let hookTextSafeArea: SafeRect | undefined;
  if (opts.hookText !== undefined) {
    const problem = hookTextError(opts.hookText);
    if (problem) throw new Error(problem);
    hookText = opts.hookText.trim();
  }
  const placedRect =
    opts.hookTextSafeArea === undefined
      ? undefined
      : textSafeAreaSchema.parse(opts.hookTextSafeArea);
  if (animation !== undefined) {
    // No clip underneath to inherit a rect from: the centred rect every mock
    // the founder judged burned in, unless he/the customer moved it.
    hookTextSafeArea = resolveHookTextSafeArea(placedRect, CENTRED_HOOK_TEXT_RECT);
  }
  if (opts.openerClipId !== undefined) {
    opener = (
      await db.select().from(openerClips).where(eq(openerClips.id, opts.openerClipId)).limit(1)
    )[0];
    if (!opener) throw new Error(`opener clip ${opts.openerClipId} not found`);
    if (!opener.active) throw new Error(`opener clip ${opts.openerClipId} is not active`);
    // An opener was made from ONE selfie and ends on that frame; it must be
    // cut against a talking head animated from the same image. A composite is
    // what handleLipsync animates whenever one is named — even next to an
    // explicit persona image — so it can never carry an opener.
    if (opts.compositeId) {
      throw new Error("an opener clip needs a persona image source, not a composite");
    }
    if (!sourceImage) throw new Error("an opener clip needs the persona's default image to exist");
    if (opener.personaImageId !== sourceImage.id) {
      throw new Error(`opener clip ${opts.openerClipId} belongs to a different persona image`);
    }
    hookTextSafeArea = resolveHookTextSafeArea(placedRect, opener.textSafeArea as SafeRect);
  }

  // Cutaways: cheap reads, so before the GPU budget, the quote and the paid
  // content-policy call — a stale or foreign plan costs nothing to refuse. The
  // opener (retired, CLI-only) is a clip in front of the head; cutaways cut
  // away from it mid-ad, and the two were never designed together.
  let cutaways: BCutaways | undefined;
  if (opts.cutawayPlanId !== undefined) {
    if (opts.openerClipId !== undefined) {
      throw new Error("demo cutaways and an opener clip are exclusive");
    }
    // Null: no clip left after the final hook text (vault 0122) — today's ad.
    cutaways =
      (await resolveCutawaysForRender(db, {
        businessId: opts.businessId,
        planId: opts.cutawayPlanId,
        audioRenderId: opts.audioRenderId,
        hookText,
      })) ?? undefined;
  }

  // Fail a typo'd tier here, not as a HeyGen 400 after the render is queued.
  const expressiveness =
    opts.expressiveness === undefined
      ? undefined
      : lipsyncExpressivenessSchema.parse(opts.expressiveness);

  // Pre-debit, like the credits check below: an in-handler rejection would
  // mean the customer paid, waited, and got a refund instead of a video.
  await assertAccountBudget(db, "gpu_seconds", opts.businessId);
  const quote = await quoteBRender(db, {
    businessId: opts.businessId,
    audioRenderId: opts.audioRenderId,
  });
  assertAffordable(quote, 1);

  // Same gate, different inputs: Service B's on-screen text is the hookText
  // copied into params at enqueue (vault 0017), and its spoken text is the
  // approved script behind the audio render.
  await assertContentPolicy(db, opts.businessId, [
    { label: "הטקסט שייצרב על המסך", text: hookText },
    {
      label: "תסריט הדמות",
      text: (await scriptTexts(db, audio[0].scriptId ? [audio[0].scriptId] : []))[0],
    },
  ]);

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
          // With an opener the resolved image is pinned: the clip was made
          // from exactly that selfie, so a default that moves between enqueue
          // and the lipsync job must not change what HeyGen animates.
          personaImageId: opts.personaImageId ?? (opener ? sourceImage!.id : undefined),
          compositeId: opts.compositeId,
          motionPrompt: opts.motionPrompt,
          expressiveness,
          openerClipId: opts.openerClipId,
          // Stored only when it is an animation, so an absent key means "no
          // animation" for a pre-2026-09-06 row and a "none" render alike.
          hookEffect: animation,
          hookText,
          hookTextSafeArea,
          // Only with the option on, so a head-only render's params stay
          // exactly what they were before cutaways existed.
          ...(cutaways ? { cutaways } : {}),
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
  /**
   * Charged ONCE for the whole SET, not per cell — it rides on the FIRST
   * cell's debit, so that one ledger row is larger and every sibling is the
   * bare `creditsPerRender`. Today this is only the demo analysis on a steps
   * set's first paid render of its demo; 0 everywhere else, including on the
   * admin bypass, where `quoteTotal` zeroes the whole thing anyway.
   */
  analysisCreditsOncePerSet: number;
  /** Named parts behind the integer, so the UI can explain it without recomputing. */
  components: QuoteComponent[];
  /** false = admin-owned; nothing is debited and nothing is watermarked. */
  chargeable: boolean;
  balance: number;
}

/**
 * Total for a Set; 0 when the account is on the admin bypass. Exported so the
 * web tier displays the number it will be charged instead of adding the parts
 * up itself — the once-per-set part is exactly the kind of arithmetic that
 * drifts when two places do it.
 */
export function quoteTotal(quote: RenderQuote, cellCount: number): number {
  return quote.chargeable
    ? quote.creditsPerRender * cellCount + quote.analysisCreditsOncePerSet
    : 0;
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
    analysisCreditsOncePerSet: 0,
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
 * through createSet like everything else. createSet, createBRender and
 * createTextBlockRender (pipelines/text-blocks.ts, Service C) are the only
 * three debit sites — one per format, each a whole new render — and adding
 * another is how ledgers start lying.
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
  return {
    creditsPerRender: quote.credits,
    analysisCreditsOncePerSet: 0,
    components: quote.components,
    chargeable,
    balance,
  };
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
  return {
    creditsPerRender: quote.credits,
    analysisCreditsOncePerSet: 0,
    components: quote.components,
    chargeable,
    balance,
  };
}

/**
 * Price a Service C (גוש טקסט) render: one flat (quoteServiceC). The texts
 * that went into it were free (decision 0099 planning default).
 */
export async function quoteTextBlockRender(db: Db, businessId: string): Promise<RenderQuote> {
  const { chargeable, costs, balance } = await quoteContext(db, businessId);
  const quote = quoteServiceC({ costs });
  return {
    creditsPerRender: quote.credits,
    analysisCreditsOncePerSet: 0,
    components: quote.components,
    chargeable,
    balance,
  };
}

/**
 * The pre-flight refusal: fail before a single row is written, so an
 * unaffordable confirm leaves no orphan set, render, or job behind. The
 * authoritative check is still the one inside debitRender's transaction —
 * this one only makes the common case clean.
 */
export function assertAffordable(quote: RenderQuote, cellCount: number): void {
  if (shortfallOf(quote, cellCount) > 0) {
    throw new InsufficientCreditsError(quoteTotal(quote, cellCount), quote.balance);
  }
}
