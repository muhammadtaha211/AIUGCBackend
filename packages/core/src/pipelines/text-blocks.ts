import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { assertAccountBudget, assertBudget } from "../budget";
import type { Db } from "../db";
import { personas, scripts, textBlockClips, videoRenders } from "../db/schema";
import { textSafeAreaSchema, type SafeRect } from "../hook-geometry";
import { enqueue } from "../jobs/queue";
import {
  fittingTextBlockSkeletons,
  isTextBlockPlaceholder,
  normalizeTextBlockText,
  TEXT_BLOCK_SKELETON_IDS,
  textBlockTextError,
} from "../text-block";
import { getBusiness, isAdminOwned, questionnaireSchema } from "./businesses";
import { generateTextBlocks, getScript } from "./copy";
import { debitRender } from "./credits";
import { assertAffordable, assertContentPolicy, quoteTextBlockRender } from "./sets";

/**
 * Service C, גוש טקסט (decisions 0089–0091, 0099): a bank clip played once,
 * start to finish, with its own sound, under one Hebrew text block. This file
 * is the customer wizard's core: serving texts one at a time from a stored
 * batch, and the render creation — the third debit site beside createSet and
 * createBRender, and the third content-policy choke point.
 */

/** What a Service C render pins in video_renders.params. */
export interface TextBlockRenderParams {
  textBlockClipId: string;
  scriptId: string;
  /**
   * The FINAL text, copied here at enqueue — never a pointer to the script
   * row, so a later edit cannot change what gets burned after the customer
   * confirmed (the same rule as Service B's hookText, vault 0017).
   */
  text: string;
  /** The box the customer placed, or the clip's own area — pinned at enqueue for the same reason. */
  textSafeArea: SafeRect;
}

type TextBlockClip = typeof textBlockClips.$inferSelect;

/**
 * The clip a customer may use: it exists, is active and finished uploading,
 * and — for any business that is not the founder's — belongs to an active
 * character, because the wizard only ever lists those (decision 0099 §2–3).
 * An admin-owned business may still use a clip the founder has not assigned.
 */
async function requireUsableClip(
  db: Db,
  clipId: string,
  businessId: string,
): Promise<TextBlockClip> {
  const row = (
    await db
      .select({ clip: textBlockClips, personaActive: personas.active })
      .from(textBlockClips)
      .leftJoin(personas, eq(personas.id, textBlockClips.personaId))
      .where(eq(textBlockClips.id, clipId))
      .limit(1)
  )[0];
  if (!row) throw new Error(`text block clip ${clipId} not found`);
  const { clip } = row;
  if (!clip.active) throw new Error(`text block clip ${clipId} is not active`);
  // A stranded "pending" placeholder (no "/") has no file to play.
  if (!clip.filePath.includes("/")) {
    throw new Error(`text block clip ${clipId} never finished uploading`);
  }
  if (!(clip.personaId && row.personaActive) && !(await isAdminOwned(db, businessId))) {
    throw new Error(`text block clip ${clipId} belongs to no active character`);
  }
  return clip;
}

/** A refill batch came back with nothing the wizard may show (every entry a placeholder). */
export class TextBlockStockEmptyError extends Error {
  constructor(businessId: string) {
    super(`no servable text block for business ${businessId} after a fresh batch`);
    this.name = "TextBlockStockEmptyError";
  }
}

type ScriptRow = typeof scripts.$inferSelect;

/**
 * The next text the customer's wizard shows — the founder's ruling for phase 2
 * (decision 0099, R2): one model call writes every fitting structure, and the
 * wizard shows the stored texts one at a time.
 *
 * - **The stock** is this business's unseen text_block rows in this clip's
 *   speaker gender, written against the questionnaire as it stands now, for a
 *   skeleton that still fits, and not a placeholder. Edited rows are never
 *   stock: an edit is the customer's own copy of a text already shown.
 * - **An empty stock** buys one new batch (generateTextBlocks — both LLM caps
 *   first, so a text served from stock never touches the caps).
 * - **The pick** is the structure this business has gone longest without
 *   seeing (never seen first), across visits: `max(shown_at)` per skeleton
 *   over every text_block row the business was ever served. Ties fall to bank
 *   order, then to the older row.
 * - **Serving** stamps `shown_at`, which is what "seen" means.
 *
 * Two tabs serving at once can show one row twice; harmless, and not guarded.
 */
export async function serveNextTextBlock(
  db: Db,
  opts: { businessId: string; clipId: string },
): Promise<ScriptRow> {
  const clip = await requireUsableClip(db, opts.clipId, opts.businessId);
  const business = await getBusiness(db, opts.businessId);
  if (!business.questionnaire) {
    throw new Error(`business ${opts.businessId} has no questionnaire yet — fill it first`);
  }
  const fitting = new Set<string>(
    fittingTextBlockSkeletons(questionnaireSchema.parse(business.questionnaire)),
  );
  const stamp = business.questionnaireUpdatedAt?.toISOString() ?? null;

  const readStock = async () => {
    const rows = await db
      .select()
      .from(scripts)
      .where(
        and(
          eq(scripts.businessId, opts.businessId),
          eq(scripts.kind, "text_block"),
          eq(scripts.userEdited, false),
          isNull(scripts.shownAt),
          sql`${scripts.params} ->> 'speakerGender' = ${clip.speakerGender}`,
        ),
      );
    return rows.filter((row) => {
      const params = row.params as { skeleton?: string; questionnaireUpdatedAt?: string | null };
      return (
        (params.questionnaireUpdatedAt ?? null) === stamp &&
        fitting.has(params.skeleton ?? "") &&
        !isTextBlockPlaceholder(row.text)
      );
    });
  };

  let stock = await readStock();
  if (stock.length === 0) {
    await assertAccountBudget(db, "llm_tokens", opts.businessId);
    await assertBudget(db, "llm_tokens");
    await generateTextBlocks(db, opts);
    stock = await readStock();
    if (stock.length === 0) throw new TextBlockStockEmptyError(opts.businessId);
  }

  const seen = await db
    .select({
      skeleton: sql<string>`${scripts.params} ->> 'skeleton'`,
      lastShown: sql<string>`max(${scripts.shownAt})`,
    })
    .from(scripts)
    .where(
      and(
        eq(scripts.businessId, opts.businessId),
        eq(scripts.kind, "text_block"),
        isNotNull(scripts.shownAt),
      ),
    )
    .groupBy(sql`${scripts.params} ->> 'skeleton'`);
  // max() is a raw sql column: a Date or an ISO string depending on the driver; new Date() takes both.
  const lastShown = new Map(seen.map((row) => [row.skeleton, new Date(row.lastShown).getTime()]));
  const skeletonOf = (row: ScriptRow) => (row.params as { skeleton: string }).skeleton;
  const bankIndex = (row: ScriptRow) =>
    (TEXT_BLOCK_SKELETON_IDS as readonly string[]).indexOf(skeletonOf(row));
  stock.sort(
    (a, b) =>
      (lastShown.get(skeletonOf(a)) ?? -Infinity) - (lastShown.get(skeletonOf(b)) ?? -Infinity) ||
      bankIndex(a) - bankIndex(b) ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );

  const next = stock[0]!;
  const served = await db
    .update(scripts)
    .set({ shownAt: new Date() })
    .where(eq(scripts.id, next.id))
    .returning();
  return served[0]!;
}

export async function createTextBlockRender(
  db: Db,
  opts: { businessId: string; clipId: string; scriptId: string; textSafeArea?: SafeRect },
) {
  // The free gates first, in createBRender's order: nothing below the quote
  // costs anything, and a refusal here leaves no row behind.
  const clip = await requireUsableClip(db, opts.clipId, opts.businessId);

  const script = await getScript(db, opts.scriptId);
  if (script.kind !== "text_block") {
    throw new Error(`script ${opts.scriptId} is not a text block (kind: ${script.kind})`);
  }
  if (script.businessId !== opts.businessId) {
    throw new Error(`script ${opts.scriptId} belongs to a different business`);
  }
  // Hebrew first person is gendered (0090 §6): a text generated in one
  // speaker's voice must not burn over the other's clip. Any clip of the same
  // gender is fine — the texts never refer to the clip.
  const scriptGender = (script.params as { speakerGender?: string }).speakerGender;
  if (scriptGender && scriptGender !== clip.speakerGender) {
    throw new Error(
      `script ${opts.scriptId} was written for a ${scriptGender} speaker; the clip's speaker is ${clip.speakerGender}`,
    );
  }
  // Re-checked here, not only at generation and edit: the render is where a
  // bad character or an over-long text would otherwise burn. Render rules
  // only — the customer's edit carries no content rule (0091 §11).
  const text = normalizeTextBlockText(script.text);
  const problem = textBlockTextError(text);
  if (problem) throw new Error(problem);
  // The customer's box, or the clip's own area when none was placed. Inside the
  // frame, whole pixels; the colour is never the customer's (0073).
  const textSafeArea = textSafeAreaSchema.parse(opts.textSafeArea ?? clip.textSafeArea);

  // Pre-flight: an unaffordable confirm never pays for the classifier call.
  const quote = await quoteTextBlockRender(db, opts.businessId);
  assertAffordable(quote, 1);

  // The paid gate, after every free one and before the debit (0042): the
  // questionnaire plus the one text that reaches the screen. Returns at once
  // for an admin-owned business.
  await assertContentPolicy(db, opts.businessId, [{ label: "גוש הטקסט שייצרב על המסך", text }]);

  const params: TextBlockRenderParams = {
    textBlockClipId: clip.id,
    scriptId: script.id,
    text,
    textSafeArea,
  };
  // Render, debit and job in ONE transaction, like the other two creators:
  // debitRender re-reads the balance behind a row lock on the owner, and an
  // InsufficientCreditsError there rolls the render row back with it. A failed
  // render refunds through failRenderAndRefund (handler and reaper alike).
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(videoRenders)
      .values({ businessId: opts.businessId, service: "c", params, watermarked: false })
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
      type: "render_video",
      idempotencyKey: `render:${render.id}`,
      payload: { videoRenderId: render.id },
    });
    return render;
  });
}
