import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { assertAccountBudget, recordUsage } from "../budget";
import { chunkWords } from "../captions";
import type { Db } from "../db";
import { audioRenders, businesses, personas, scripts, voiceRecordings } from "../db/schema";
import { BudgetError, PermanentError } from "../jobs/errors";
import { enqueue, isLastAttempt, type Job } from "../jobs/queue";
import type { JobContext, JobResult } from "../jobs/worker";
import { logger } from "../logger";
import {
  assertRecordingHasAudio,
  cutAndEncodeRecording,
  decodeRecording,
  measureDurationMs,
  normalizeRecordingLoudness,
} from "../media/ffmpeg";
import {
  applyTranscriptCorrections,
  cleanHeardText,
  RECORDING_FAILED,
  RECORDING_MAX_APPROVALS,
  RECORDING_MAX_SECONDS,
  RECORDING_NO_SPEECH,
  recordingFileError,
  recordingLengthError,
  recordingType,
  spokenLengthError,
  TRANSCRIPT_TOO_MANY_APPROVALS,
  type HeardWord,
  type KeptWord,
} from "../own-voice";
import { WORK_DIR } from "../paths";
import { STT_COST_AGOROT_PER_HOUR, transcribe, type SttResult } from "../providers/elevenlabs";
import { getStorage, storageKey } from "../storage";
import { deriveHookTextWithVersion } from "./copy";
import { audioPreviewsToday } from "./tts";

/**
 * The customer's own voice (Service B, decision 0118). A recording lives in
 * voice_recordings from its upload until its transcript is approved:
 *
 *   register  -> transcribe_recording job -> ready (words on the stored file)
 *   approve   -> an ordinary b_script row (the corrected transcript) plus an
 *                ordinary audio_renders row, born approved, with its own copy
 *                of the mp3
 *
 * so the render route, createBRender, lipsync, buildServiceBProps and Remotion
 * read the same shape an AI-voice render gives them. Nothing is rewritten after
 * insert and nothing repoints audio_renders.script_id.
 */

/**
 * The stored file is the normalised recording cut from LEAD before the first
 * word Scribe heard to TAIL after the last (the founder's ruling of
 * 2026-10-19, in place of a silence threshold): no button click, no room
 * noise, no trailing silence billed, and the hook animation's clock (the
 * mp3's t=0) sits LEAD before the first word. Amendment 4: step 0's
 * Scribe-against-ElevenLabs word-start number decides whether LEAD is wide
 * enough — it rides in this one constant. Measured 2026-10-19 on 140 Hebrew
 * words: Scribe's starts run late by p95 140 ms (median 60, max 320), past the
 * founder's 100 ms line, so LEAD is the p95 plus 50 ms, as he ruled
 * (facts/scribe-hebrew-word-times-against-elevenlabs-2026-10-19).
 */
export const RECORDING_LEAD_MS = 190;
export const RECORDING_TAIL_MS = 150;
/**
 * The stored TTS level, measured on three b_script renders on 2026-10-19
 * (-20.50, -20.28, -19.11 LUFS; true peaks -2.0 to -2.5 dBTP):
 * facts/tts-mp3-format-and-loudness-2026-10-19.
 */
export const RECORDING_TARGET_LUFS = -20;
/** One second past the cap: enough to refuse a 91 s file with its length. */
const DECODE_LIMIT_MS = (RECORDING_MAX_SECONDS + 1) * 1000;
export const RECORDING_PEAK_DB = -2;

const UPLOAD_PATH =
  /^raw\/([0-9a-f-]{36})\/recording\/[0-9a-f-]{36}\/upload\.(mp3|m4a|aac|ogg|wav|webm|mp4|mov)$/;

/** Where the browser PUTs a recording: raw/<biz>/recording/<uploadId>/upload.<ext>. */
export function recordingUploadPath(businessId: string, uploadId: string, ext: string): string {
  return `raw/${storageKey({ businessId, entity: "recording", id: uploadId, filename: `upload.${ext}` })}`;
}

/** Register only paths this route could have minted, under this business. */
export function isOwnedRecordingUploadPath(businessId: string, uploadPath: string): boolean {
  return UPLOAD_PATH.exec(uploadPath)?.[1] === businessId;
}

/**
 * Step 1 of an upload: one slot of the shared daily pool and the path the
 * browser will PUT to, together. The count and the insert run in one
 * transaction under a per-owner advisory lock, so parallel requests cannot all
 * read "under the cap". The row exists from here, so a recording counts when it
 * is requested (as a TTS preview does), the cap refuses BEFORE the customer
 * uploads anything, and an upload abandoned before step 2 is still swept by
 * the janitor on the raw window.
 */
export async function reserveRecording(
  db: Db,
  opts: { businessId: string; ext: string },
): Promise<{ recordingId: string; uploadPath: string }> {
  const owner = (
    await db
      .select({ userId: businesses.ownerUserId })
      .from(businesses)
      .where(eq(businesses.id, opts.businessId))
      .limit(1)
  )[0];
  if (!owner) throw new Error(`business ${opts.businessId} not found`);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${owner.userId}))`);
    const { used, limit } = await audioPreviewsToday(tx as unknown as Db, owner.userId);
    if (used >= limit) {
      throw new Error(`daily recording limit reached (${limit}/24h for this account)`);
    }
    const uploadPath = recordingUploadPath(opts.businessId, randomUUID(), opts.ext);
    const [row] = await tx
      .insert(voiceRecordings)
      .values({ businessId: opts.businessId, rawPath: uploadPath })
      .returning();
    return { recordingId: row!.id, uploadPath };
  });
}

/**
 * Step 2: the browser finished its PUT — queue the transcription. Idempotent:
 * a repeated register is the same row and the same job.
 */
export async function registerRecording(
  db: Db,
  opts: { businessId: string; uploadPath: string },
): Promise<typeof voiceRecordings.$inferSelect> {
  const row = (
    await db
      .select()
      .from(voiceRecordings)
      .where(eq(voiceRecordings.rawPath, opts.uploadPath))
      .limit(1)
  )[0];
  if (!row || row.businessId !== opts.businessId) throw new Error("recording not found");
  await enqueue(db, {
    type: "transcribe_recording",
    idempotencyKey: `transcribe:${row.id}`,
    payload: { recordingId: row.id },
  });
  return row;
}

/**
 * transcribe_recording (light lane): the upload becomes the stored file and
 * Scribe's words on it. Real ffmpeg runs under DRY_RUN too — the input is
 * always a real file the customer made — and only the Scribe call is stubbed.
 * A ready or failed row is a no-op, so a retry or a duplicate job is harmless.
 */
export async function handleTranscribeRecording(job: Job, ctx: JobContext): Promise<JobResult> {
  const { recordingId } = job.payload as { recordingId: string };
  const row = (
    await ctx.db.select().from(voiceRecordings).where(eq(voiceRecordings.id, recordingId)).limit(1)
  )[0];
  if (!row) throw new PermanentError(`recording ${recordingId} not found`);
  if (row.status === "ready" || row.status === "failed") return { kind: "done" };

  const dir = path.join(WORK_DIR, "recording", recordingId);
  try {
    await ctx.db
      .update(voiceRecordings)
      .set({ status: "generating" })
      .where(eq(voiceRecordings.id, recordingId));
    mkdirSync(dir, { recursive: true });

    // The bytes and the container, before anything decodes them.
    if (!row.rawPath) throw new PermanentError(`recording ${recordingId} has no upload left`);
    const raw = path.join(dir, path.basename(row.rawPath));
    await getStorage().download(row.rawPath, raw);
    const type = recordingType({ type: "", name: raw });
    const fileProblem = type
      ? recordingFileError({ type: type.contentType, size: statSync(raw).size })
      : undefined;
    if (!type || fileProblem) {
      throw new PermanentError(`recording refused at ${statSync(raw).size} bytes`, {
        customerMessage: fileProblem ?? RECORDING_FAILED,
      });
    }
    // An over-long file is refused from its header before any decode; the
    // decode itself stops one second past the cap in case the header lies.
    const { statedMs } = await assertRecordingHasAudio(raw);
    const statedProblem =
      statedMs !== undefined && statedMs > DECODE_LIMIT_MS
        ? recordingLengthError(statedMs)
        : undefined;
    if (statedProblem) {
      throw new PermanentError(`recording states ${statedMs} ms`, {
        customerMessage: statedProblem,
      });
    }

    // Decode, judge the length the customer made, bring it to the TTS level.
    const decoded = path.join(dir, "decoded.wav");
    await decodeRecording(raw, decoded, DECODE_LIMIT_MS);
    const sourceMs = await measureDurationMs(decoded);
    await ctx.db
      .update(voiceRecordings)
      .set({ sourceMs })
      .where(eq(voiceRecordings.id, recordingId));
    const lengthProblem = recordingLengthError(sourceMs);
    if (lengthProblem) {
      throw new PermanentError(`recording is ${sourceMs} ms`, { customerMessage: lengthProblem });
    }
    const normalized = path.join(dir, "normalized.wav");
    const loudness = await normalizeRecordingLoudness(decoded, normalized, {
      targetLufs: RECORDING_TARGET_LUFS,
      peakDb: RECORDING_PEAK_DB,
    });

    // What was said, and when. Checkpointed before anything else can fail, so
    // a retry reuses the words rather than paying Scribe again (and the usage
    // row is written once). The normalised file is deterministic, so the
    // saved words still fit it.
    const saved = (job.state ?? {}) as { stt?: SttResult; usageRecorded?: boolean };
    const stt = saved.stt ?? (await transcribe({ file: normalized, durationMs: sourceMs }));
    if (!saved.stt) await ctx.checkpoint({ stt });
    if (!saved.usageRecorded) {
      await recordUsage(ctx.db, {
        provider: "elevenlabs",
        kind: "stt_seconds",
        quantity: Math.ceil(stt.audioDurationSecs),
        costEstimateAgorot: Math.ceil((stt.audioDurationSecs / 3600) * STT_COST_AGOROT_PER_HOUR),
        jobId: job.id,
        businessId: row.businessId,
      });
      await ctx.checkpoint({ stt, usageRecorded: true });
    }
    const heard = stt.words
      .map((w) => ({ ...w, text: cleanHeardText(w.text) }))
      .filter((w) => w.text.length > 0);
    if (heard.length === 0) {
      throw new PermanentError("scribe heard no words", { customerMessage: RECORDING_NO_SPEECH });
    }

    // Cut to the speech, and move the words onto the stored file's clock.
    const fromMs = Math.max(0, heard[0]!.startMs - RECORDING_LEAD_MS);
    const toMs = Math.min(sourceMs, heard[heard.length - 1]!.endMs + RECORDING_TAIL_MS);
    const stored = path.join(dir, "audio.mp3");
    await cutAndEncodeRecording(normalized, stored, fromMs, toMs);
    const durationMs = await measureDurationMs(stored);
    const spokenProblem = spokenLengthError(durationMs);
    if (spokenProblem) {
      throw new PermanentError(`speech is ${durationMs} ms`, { customerMessage: spokenProblem });
    }
    const words: HeardWord[] = heard.map((w) => ({
      text: w.text,
      startMs: Math.max(0, w.startMs - fromMs),
      endMs: Math.min(durationMs, Math.max(0, w.endMs - fromMs)),
    }));

    const filePath = await getStorage().put(
      "renders",
      storageKey({
        businessId: row.businessId,
        entity: "recording",
        id: recordingId,
        filename: "audio.mp3",
      }),
      stored,
    );
    await ctx.db
      .update(voiceRecordings)
      .set({
        status: "ready",
        filePath,
        sourceMs,
        durationMs,
        words,
        heardText: stt.words.map((w) => w.text).join(" "),
        error: null,
      })
      .where(eq(voiceRecordings.id, recordingId));
    ctx.log.info(
      {
        recordingId,
        sourceMs,
        durationMs,
        words: words.length,
        firstWordMs: heard[0]!.startMs,
        inputLufs: loudness.inputLufs,
        gainDb: loudness.gainDb,
      },
      "recording transcribed",
    );
    return { kind: "done" };
  } catch (err) {
    // Only ever Hebrew on the row: a PermanentError's customerMessage, else
    // the generic line — never a provider's English diagnostic.
    const customer =
      err instanceof PermanentError
        ? (err.customerMessage ?? RECORDING_FAILED)
        : !(err instanceof BudgetError) && isLastAttempt(job)
          ? RECORDING_FAILED
          : undefined;
    if (customer) {
      await ctx.db
        .update(voiceRecordings)
        .set({ status: "failed", error: customer })
        .where(eq(voiceRecordings.id, recordingId));
    }
    throw err;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A correction that does not fit the recording — answered 400 in Hebrew. */
export class TranscriptCorrectionError extends Error {}

/**
 * Approve a recording's transcript (the audio gate, locked #5): validate the
 * corrections, derive the hook line from what will be captioned, and insert an
 * ordinary script + approved audio pair. Charges nothing. Every call makes a
 * NEW pair — a second approval after going back rewrites nothing.
 */
export async function approveRecording(
  db: Db,
  opts: { recordingId: string; businessId: string; personaId: string; kept: readonly KeptWord[] },
): Promise<{
  scriptId: string;
  audioId: string;
  text: string;
  hookText: string | null;
  durationMs: number;
}> {
  const rec = (
    await db.select().from(voiceRecordings).where(eq(voiceRecordings.id, opts.recordingId)).limit(1)
  )[0];
  if (!rec || rec.businessId !== opts.businessId) throw new Error("recording not found");
  if (rec.status !== "ready" || !rec.filePath || rec.durationMs === null || !rec.words) {
    throw new Error(`recording is not ready yet (status: ${rec.status})`);
  }
  const persona = (
    await db
      .select({ id: personas.id })
      .from(personas)
      .where(eq(personas.id, opts.personaId))
      .limit(1)
  )[0];
  if (!persona) throw new Error(`persona ${opts.personaId} not found`);

  const heard = rec.words as HeardWord[];
  const corrected = applyTranscriptCorrections(heard, opts.kept);
  if (!corrected.ok) throw new TranscriptCorrectionError(corrected.error);

  // The same approval again (a double tap, a back-and-forth with nothing
  // changed) is the pair it already made, not a new copy.
  const earlier = await db
    .select({ script: scripts, audioId: audioRenders.id })
    .from(scripts)
    .innerJoin(audioRenders, eq(audioRenders.scriptId, scripts.id))
    .where(
      and(
        eq(scripts.businessId, opts.businessId),
        sql`${scripts.params}->>'recordingId' = ${rec.id}`,
      ),
    );
  const same = earlier.find(
    (e) => e.script.personaId === opts.personaId && e.script.text === corrected.text,
  );
  if (same) {
    const params = same.script.params as { hookText?: string };
    return {
      scriptId: same.script.id,
      audioId: same.audioId,
      text: corrected.text,
      hookText: params.hookText ?? null,
      durationMs: rec.durationMs,
    };
  }
  // Every other approval is a new pair and a new copy; a scripted loop over
  // ever-different corrections stops here.
  if (earlier.length >= RECORDING_MAX_APPROVALS) {
    throw new TranscriptCorrectionError(TRANSCRIPT_TOO_MANY_APPROVALS);
  }

  // The hook line comes from what will be captioned (decision 0118, item 7).
  // Any failure — the account's llm cap, the extractor missing the caps —
  // leaves it empty for the customer to write (PLANNING DEFAULT).
  let hook: { hookText: string; promptVersion: string } | undefined;
  try {
    await assertAccountBudget(db, "llm_tokens", opts.businessId);
    hook = await deriveHookTextWithVersion(db, {
      businessId: opts.businessId,
      text: corrected.text,
    });
  } catch (err) {
    logger.warn({ err, recordingId: rec.id }, "own-voice hook line not derived; left empty");
  }

  // Each audio row owns its file (the janitor deletes per row), so the
  // approval gets its own copy rather than pointing at the recording's.
  // tmpdir, not WORK_DIR: this runs in a web route, where only /tmp is writable.
  const audioId = randomUUID();
  const local = path.join(tmpdir(), `aiugc-approve-${audioId}.mp3`);
  let filePath: string;
  try {
    await getStorage().download(rec.filePath, local);
    filePath = await getStorage().put(
      "renders",
      storageKey({
        businessId: opts.businessId,
        entity: "audio",
        id: audioId,
        filename: "audio.mp3",
      }),
      local,
    );
  } finally {
    rmSync(local, { force: true });
  }

  const pair = await db
    .transaction(async (tx) => {
      const [script] = await tx
        .insert(scripts)
        .values({
          businessId: opts.businessId,
          personaId: opts.personaId,
          kind: "b_script",
          text: corrected.text,
          // No prompt wrote this text: prompt_version NULL, never `<name>@vN`.
          // source = "recording" is the key that excludes these rows from any
          // count of model-written scripts.
          promptVersion: null,
          userEdited: false,
          params: {
            source: "recording",
            recordingId: rec.id,
            heardText: rec.heardText ?? heard.map((w) => w.text).join(" "),
            ...(hook
              ? {
                  hookText: hook.hookText,
                  hookTextDerived: true,
                  hookTextPromptVersion: hook.promptVersion,
                }
              : {}),
          },
        })
        .returning();
      const [audio] = await tx
        .insert(audioRenders)
        .values({
          id: audioId,
          scriptId: script!.id,
          voiceId: null,
          status: "ready",
          filePath,
          durationMs: rec.durationMs,
          renderedText: corrected.text,
          wordTimestamps: chunkWords(corrected.words),
          alignmentSource: "scribe",
          approvedAt: new Date(),
        })
        .returning();
      return { script: script!, audio: audio! };
    })
    .catch(async (err: unknown) => {
      await getStorage()
        .remove(filePath)
        .catch(() => {});
      throw err;
    });

  return {
    scriptId: pair.script.id,
    audioId: pair.audio.id,
    text: corrected.text,
    hookText: hook?.hookText ?? null,
    durationMs: rec.durationMs,
  };
}
