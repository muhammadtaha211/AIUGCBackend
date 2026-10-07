import { eq } from "drizzle-orm";
import type { Db } from "../db";
import { textBlockClips, videoRenders } from "../db/schema";
import type { SafeRect } from "../hook-geometry";
import { enqueue } from "../jobs/queue";
import { normalizeTextBlockText, textBlockTextError } from "../text-block";
import { isAdminOwned } from "./businesses";
import { getScript } from "./copy";
import { assertContentPolicy } from "./sets";

/**
 * Service C, גוש טקסט (decisions 0089–0091): a bank clip played once, start to
 * finish, with its own sound, under one Hebrew text block. This is the render
 * creation — the third choke point beside createSet and createBRender — and
 * the one function phase 2's customer wizard will call too.
 */

/** What a Service C render pins in video_renders.params. */
export interface TextBlockRenderParams {
  textBlockClipId: string;
  scriptId: string;
  /**
   * The FINAL text, copied here at enqueue — never a pointer to the script
   * row, so a later edit cannot change what gets burned after the founder
   * confirmed (the same rule as Service B's hookText, vault 0017).
   */
  text: string;
  /** The clip's rect at enqueue, for the same reason. */
  textSafeArea: SafeRect;
}

export async function createTextBlockRender(
  db: Db,
  opts: { businessId: string; clipId: string; scriptId: string },
) {
  // Phase 1 is admin-only and has no credit key, so a render for a business
  // that is not the founder's would be a free one with no debit behind it.
  // Refused by construction rather than left to the admin UI; phase 2 replaces
  // this line with the quote and the debit.
  if (!(await isAdminOwned(db, opts.businessId))) {
    throw new Error("גוש טקסט renders are admin-only in phase 1: the business must be admin-owned");
  }

  const clip = (
    await db.select().from(textBlockClips).where(eq(textBlockClips.id, opts.clipId)).limit(1)
  )[0];
  if (!clip) throw new Error(`text block clip ${opts.clipId} not found`);
  if (!clip.active) throw new Error(`text block clip ${opts.clipId} is not active`);
  // A stranded "pending" placeholder (no "/") has no file to play.
  if (!clip.filePath.includes("/")) {
    throw new Error(`text block clip ${opts.clipId} never finished uploading`);
  }

  const script = await getScript(db, opts.scriptId);
  if (script.kind !== "text_block") {
    throw new Error(`script ${opts.scriptId} is not a text block (kind: ${script.kind})`);
  }
  if (script.businessId !== opts.businessId) {
    throw new Error(`script ${opts.scriptId} belongs to a different business`);
  }
  // Re-checked here, not only at generation and edit: the render is where a
  // bad character or an over-long text would otherwise burn.
  const text = normalizeTextBlockText(script.text);
  const problem = textBlockTextError(text);
  if (problem) throw new Error(problem);

  // Same gate as the other two creators, with the one text that reaches the
  // screen. Returns at once for an admin-owned business, so in phase 1 it
  // never runs — but it is wired, and phase 2 inherits it.
  await assertContentPolicy(db, opts.businessId, [{ label: "גוש הטקסט שייצרב על המסך", text }]);

  const params: TextBlockRenderParams = {
    textBlockClipId: clip.id,
    scriptId: script.id,
    text,
    textSafeArea: clip.textSafeArea as SafeRect,
  };
  // Render and job together, like the other two creators: nothing is debited
  // in phase 1, so the envelope holds only the row and its job.
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(videoRenders)
      .values({ businessId: opts.businessId, service: "c", params, watermarked: false })
      .returning();
    const render = inserted[0]!;
    await enqueue(tx as Db, {
      type: "render_video",
      idempotencyKey: `render:${render.id}`,
      payload: { videoRenderId: render.id },
    });
    return render;
  });
}
