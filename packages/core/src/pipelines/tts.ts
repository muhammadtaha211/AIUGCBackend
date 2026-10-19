import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getConfigValue, getConfigValueOr } from "../appConfig";
import { assertAccountBudget, assertBudget, recordUsage } from "../budget";
import { chunkWords, stripTagWords, wordsFromCharAlignment, type CaptionChunk } from "../captions";
import { getEnv } from "../config";
import type { Db } from "../db";
import { audioRenders, businesses, demos, personas, scripts, voiceRecordings } from "../db/schema";
import { PermanentError } from "../jobs/errors";
import { enqueue, type Job } from "../jobs/queue";
import type { JobContext, JobResult } from "../jobs/worker";
import type { Logger } from "../logger";
import { atempoStretch, measureDurationMs } from "../media/ffmpeg";
import { WORK_DIR } from "../paths";
import { llmCostAgorot } from "../pricing";
import { generateObject } from "../providers/anthropic";
import { synthesize } from "../providers/elevenlabs";
import { forcedAlign } from "../providers/whisperx";
import { renderPrompt } from "../prompts";
import { getStorage, storageKey } from "../storage";
import { applyPronunciationMap } from "./pronunciation";

/** The whole length fit: an inaudible stretch. Past it, the overrun is an ending. */
const MAX_STRETCH = 1.05;

/**
 * ~agorot per 1000 TTS characters: ElevenLabs bills $0.10/1k chars, at
 * USD/ILS 3.00 (founder-confirmed 2026-08) = 30 agorot. Was 20 — that
 * understated every `usage_events.cost_estimate_agorot` row by 1.5x.
 */
const TTS_COST_AGOROT_PER_1K_CHARS = 30;

/**
 * The account's free audio previews in the last 24h, against
 * audio_preview_daily_limit. One pool for both voices (decision 0118): a TTS
 * attempt is an audio row with a voice — every row before 0067 — and an
 * own-voice attempt is a voice_recordings row. The audio row an approved
 * recording becomes has no voice and made no paid call, so it is not counted.
 */
export async function audioPreviewsToday(
  db: Db,
  ownerUserId: string,
): Promise<{ used: number; limit: number }> {
  const limit = await getConfigValue(db, "audio_preview_daily_limit", z.number().int());
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const tts = await db
    .select({ count: sql<string>`count(*)` })
    .from(audioRenders)
    .innerJoin(scripts, eq(audioRenders.scriptId, scripts.id))
    .innerJoin(businesses, eq(scripts.businessId, businesses.id))
    .where(
      and(
        eq(businesses.ownerUserId, ownerUserId),
        gt(audioRenders.createdAt, since),
        isNotNull(audioRenders.voiceId),
      ),
    );
  const recorded = await db
    .select({ count: sql<string>`count(*)` })
    .from(voiceRecordings)
    .innerJoin(businesses, eq(voiceRecordings.businessId, businesses.id))
    .where(and(eq(businesses.ownerUserId, ownerUserId), gt(voiceRecordings.createdAt, since)));
  return {
    used: Number(tts[0]?.count ?? 0) + Number(recorded[0]?.count ?? 0),
    limit,
  };
}

/**
 * Create the audio-only preview (cheap, seconds). This is the hard gate:
 * video is never rendered on unapproved audio.
 */
export async function requestAudio(
  db: Db,
  opts: { scriptId: string; voiceId?: string },
): Promise<typeof audioRenders.$inferSelect> {
  const scriptRows = await db.select().from(scripts).where(eq(scripts.id, opts.scriptId)).limit(1);
  const script = scriptRows[0];
  if (!script) throw new Error(`script ${opts.scriptId} not found`);
  if (script.kind !== "vo_script" && script.kind !== "b_script") {
    throw new Error(`script kind ${script.kind} is not voiceable`);
  }

  let voiceId = opts.voiceId;
  if (!voiceId && script.personaId) {
    const personaRows = await db
      .select()
      .from(personas)
      .where(eq(personas.id, script.personaId))
      .limit(1);
    voiceId = personaRows[0]?.voiceId ?? undefined;
  }
  if (!voiceId) throw new Error("voiceId is required (no persona voice to derive it from)");

  // TTS is absorbed cost of sale — never debited — so the abuse ceilings live
  // here, at the entry point, where a breach is an immediate rejection rather
  // than a job that parks and spins the wizard forever.
  //
  // Both are keyed on the OWNER ACCOUNT. Business creation is self-serve and
  // unlimited, so the old per-business preview limit was farmable at 20 x N.
  const owner = (
    await db
      .select({ userId: businesses.ownerUserId })
      .from(businesses)
      .where(eq(businesses.id, script.businessId))
      .limit(1)
  )[0];
  if (!owner) throw new Error(`business ${script.businessId} not found`);

  // 1. Previews are free but rate-capped: a count of attempts.
  const { used, limit } = await audioPreviewsToday(db, owner.userId);
  if (used >= limit) {
    throw new Error(`daily audio preview limit reached (${limit}/24h for this account)`);
  }

  // 2. ...and shekel-capped: characters actually synthesized, which a long
  //     script can run up far faster than the attempt count would suggest.
  await assertAccountBudget(db, "tts_chars", script.businessId);

  const inserted = await db
    .insert(audioRenders)
    .values({ scriptId: script.id, voiceId, status: "queued" })
    .returning();
  const audioRender = inserted[0]!;

  await enqueue(db, {
    type: "synth_tts",
    idempotencyKey: `tts:${audioRender.id}`,
    payload: { audioRenderId: audioRender.id },
  });
  return audioRender;
}

/** The hard audio gate — render jobs refuse audio without approved_at. */
export async function approveAudio(db: Db, audioRenderId: string): Promise<void> {
  const rows = await db
    .select()
    .from(audioRenders)
    .where(eq(audioRenders.id, audioRenderId))
    .limit(1);
  const audioRender = rows[0];
  if (!audioRender) throw new Error(`audio render ${audioRenderId} not found`);
  if (audioRender.status !== "ready") {
    throw new Error(`audio render is not ready yet (status: ${audioRender.status})`);
  }
  await db
    .update(audioRenders)
    .set({ approvedAt: new Date() })
    .where(eq(audioRenders.id, audioRenderId));
}

// ---------------------------------------------------------------------------
// ElevenLabs v3 audio tags — a TTS-time transform, exactly like the
// pronunciation map: the stored script row stays clean plain Hebrew, tags live
// only in the text we send (and therefore in rendered_text).
// Off unless app_config.tts_enhance is true.
// ---------------------------------------------------------------------------

const enhanceOutput = z.object({ enhanced: z.string() });

/** The text minus bracketed tags — what the voice actually says. */
export function stripAudioTags(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The spoken words alone: tags and punctuation dropped. */
function wordSequence(text: string): string[] {
  return stripAudioTags(text)
    .replace(/[.,!?…:;"'׳״()\-–—]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * The fail-open check: enhancement may only introduce tags and punctuation.
 * Any change to the Hebrew words themselves (edited, dropped, reordered) means
 * the enhancement is discarded and the original is synthesized.
 */
export function sameWordSequence(original: string, enhanced: string): boolean {
  const before = wordSequence(original);
  const after = wordSequence(enhanced);
  return before.length === after.length && before.every((w, i) => w === after[i]);
}

/**
 * Add v3 audio tags to a script before synthesis. Never throws and never blocks
 * a render: on any failure — API error, budget cap, or a model that rewrote the
 * Hebrew — the original text comes back unchanged.
 */
async function enhanceWithAudioTags(
  db: Db,
  opts: { businessId: string; text: string; log: Logger },
): Promise<string> {
  // DRY_RUN: no API call, but a real tag so tag-stripping and caption logic run.
  if (getEnv().DRY_RUN) return `[excited] ${opts.text}`;

  try {
    await assertBudget(db, "llm_tokens");
    const { text: prompt } = renderPrompt("tts_enhance", { script: opts.text });
    const { object, usage } = await generateObject({ prompt, schema: enhanceOutput });
    await recordUsage(db, {
      provider: "anthropic",
      kind: "llm_tokens",
      quantity: usage.inputTokens + usage.outputTokens,
      costEstimateAgorot: llmCostAgorot(usage.inputTokens, usage.outputTokens),
      businessId: opts.businessId,
    });

    if (!sameWordSequence(opts.text, object.enhanced)) {
      opts.log.warn("tts enhance changed the Hebrew words — synthesizing the original");
      return opts.text;
    }
    return object.enhanced;
  } catch (err) {
    opts.log.warn({ err }, "tts enhance failed — synthesizing the original");
    return opts.text;
  }
}

/**
 * Job handler: audio tags -> pronunciation map -> TTS -> length fit
 * (atempo <=5%) -> word alignment -> karaoke chunks.
 *
 * The script this synthesizes is the script the customer approved: nothing here
 * ever repoints audio_renders.script_id.
 */
export async function handleSynthTts(job: Job, ctx: JobContext): Promise<JobResult> {
  const { audioRenderId } = job.payload as { audioRenderId: string };
  const arRows = await ctx.db
    .select()
    .from(audioRenders)
    .where(eq(audioRenders.id, audioRenderId))
    .limit(1);
  const audioRender = arRows[0];
  if (!audioRender) throw new PermanentError(`audio render ${audioRenderId} not found`);
  // An approved own-voice recording (0067) has no voice and is born ready;
  // nothing enqueues synth_tts for one. Refuse rather than synthesize.
  const voiceId = audioRender.voiceId;
  if (!voiceId)
    throw new PermanentError(`audio render ${audioRenderId} has no voice to synthesize`);

  try {
    await ctx.db
      .update(audioRenders)
      .set({ status: "generating" })
      .where(eq(audioRenders.id, audioRenderId));

    const scriptId = audioRender.scriptId;
    const enhance = await getConfigValueOr(ctx.db, "tts_enhance", z.boolean(), false);
    const stability = await getConfigValueOr(ctx.db, "tts_stability", z.number(), undefined);

    const scriptRows = await ctx.db.select().from(scripts).where(eq(scripts.id, scriptId)).limit(1);
    const script = scriptRows[0]!;

    await assertBudget(ctx.db, "tts_chars");
    const tagged = enhance
      ? await enhanceWithAudioTags(ctx.db, {
          businessId: script.businessId,
          text: script.text,
          log: ctx.log,
        })
      : script.text;
    const { rendered } = await applyPronunciationMap(ctx.db, script.businessId, tagged);
    const tts = await synthesize({ text: rendered, voiceId, stability });
    await recordUsage(ctx.db, {
      provider: "elevenlabs",
      kind: "tts_chars",
      quantity: rendered.length,
      costEstimateAgorot: Math.ceil((rendered.length / 1000) * TTS_COST_AGOROT_PER_1K_CHARS),
      jobId: job.id,
      businessId: script.businessId,
    });

    // Measure the generated audio.
    const localDir = path.join(WORK_DIR, "tts", audioRenderId);
    mkdirSync(localDir, { recursive: true });
    let localAudio = path.join(localDir, "audio.mp3");
    writeFileSync(localAudio, tts.audio);
    let durationMs = tts.charAlignment
      ? tts.charAlignment.endTimesMs[tts.charAlignment.endTimesMs.length - 1]!
      : await measureDurationMs(localAudio);

    // Length fit against the linked demo (voiced Service A only).
    let stretchRatio = 1.0;
    const demoDurationMs = script.demoId
      ? (await ctx.db.select().from(demos).where(eq(demos.id, script.demoId)).limit(1))[0]
          ?.durationMs
      : undefined;

    if (demoDurationMs && durationMs > demoDurationMs) {
      const ratio = durationMs / demoDurationMs;
      // Past MAX_STRETCH the overrun stands at its natural length: it is an
      // ENDING, not a defect. planAOutro resolves it into a freeze or an
      // avatar per variant and the advisory prices it before the customer
      // confirms — so nothing is corrected upstream of that decision.
      if (ratio <= MAX_STRETCH) {
        // Inaudible atempo stretch to fit.
        stretchRatio = ratio;
        if (!getEnv().DRY_RUN) {
          const stretched = path.join(localDir, "audio-fit.mp3");
          await atempoStretch(localAudio, stretched, ratio);
          localAudio = stretched;
        }
        const scale = 1 / ratio;
        if (tts.charAlignment) {
          tts.charAlignment.startTimesMs = tts.charAlignment.startTimesMs.map((t) =>
            Math.round(t * scale),
          );
          tts.charAlignment.endTimesMs = tts.charAlignment.endTimesMs.map((t) =>
            Math.round(t * scale),
          );
        }
        durationMs = Math.round(durationMs * scale);
      }
    }

    // Word timestamps: ElevenLabs alignment, else WhisperX forced alignment.
    let chunks: CaptionChunk[];
    let alignmentSource: "elevenlabs" | "whisperx";
    // Alignment covers the SENT text, so tag tokens are dropped before
    // chunking; forced alignment is given the spoken text for the same reason.
    if (tts.charAlignment) {
      chunks = chunkWords(stripTagWords(wordsFromCharAlignment(tts.charAlignment)));
      alignmentSource = "elevenlabs";
    } else {
      chunks = chunkWords(await forcedAlign(localAudio, stripAudioTags(rendered)));
      alignmentSource = "whisperx";
    }

    const filePath = await getStorage().put(
      "renders",
      storageKey({
        businessId: script.businessId,
        entity: "audio",
        id: audioRenderId,
        filename: "audio.mp3",
      }),
      localAudio,
    );

    await ctx.db
      .update(audioRenders)
      .set({
        status: "ready",
        filePath,
        durationMs,
        renderedText: rendered,
        wordTimestamps: chunks,
        alignmentSource,
        stretchRatio,
      })
      .where(eq(audioRenders.id, audioRenderId));
    return { kind: "done" };
  } catch (err) {
    if (err instanceof PermanentError) {
      await ctx.db
        .update(audioRenders)
        .set({ status: "failed", error: err.message })
        .where(eq(audioRenders.id, audioRenderId));
    }
    throw err;
  }
}

export function readAudioFileSync(localPath: string): Buffer {
  return readFileSync(localPath);
}
