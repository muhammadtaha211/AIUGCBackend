import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Hoisted so the classifier test can answer for Claude off the DRY_RUN path
// (content-policy-gate.test.ts's pattern). Under DRY_RUN nothing calls it.
const generateObject = vi.hoisted(() => vi.fn());
vi.mock("../src/providers/anthropic", () => ({
  generateObject,
  CLAUDE_MODEL: "claude-sonnet-5-5",
}));

import type { CaptionChunk } from "../src/captions";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import { buildHandlers } from "../src/handlers";
import { runLane } from "../src/jobs/worker";
import { logger } from "../src/logger";
import { RECORDING_NO_AUDIO } from "../src/media/ffmpeg";
import type { HeardWord } from "../src/own-voice";
import { getAudioWithScript } from "../src/pipelines/audio-script";
import { addPersona, addPersonaImage } from "../src/pipelines/bank";
import { createBusiness } from "../src/pipelines/businesses";
import { grantCredits } from "../src/pipelines/credits";
import { handleJanitor } from "../src/pipelines/janitor";
import {
  approveRecording,
  handleTranscribeRecording,
  isOwnedRecordingUploadPath,
  recordingUploadPath,
  registerRecording,
  reserveRecording,
  TranscriptCorrectionError,
} from "../src/pipelines/recordings";
import { createBRender, quoteBForDuration, quoteBRender } from "../src/pipelines/sets";
import { requestAudio } from "../src/pipelines/tts";
import { getStorage, setStorage } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import { tempStorage } from "./helpers/storage";

const exec = promisify(execFile);

/**
 * The customer's own voice (decision 0118), end to end under DRY_RUN: a real
 * recording through real ffmpeg, the Scribe stand-in, the transcript approval,
 * and the ordinary Service B chain after it — createBRender, lipsync,
 * render_video — to a released render. Plus the shared preview pool, the
 * refusals a customer reads, the content gate on what was heard, and the
 * janitor never reaching an approved file.
 */

const inputs = path.join(tmpdir(), "aiugc-recordings-inputs");
const input = (name: string) => path.join(inputs, name);

let db: Db;
let pg: { close(): Promise<void> };
let cleanupStorage: () => void;
let businessId: string;
let ownerUserId: string;
let personaId: string;
let personaImageId: string;

async function drainAll(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await runLane(db, { workerId: "test", handlers: buildHandlers(), drainAndExit: true });
    const queued = await db
      .select()
      .from(dbSchema.jobs)
      .where(sql`status = 'queued'`);
    if (queued.length === 0) return;
    await db.execute(
      sql`update jobs set run_at = now() - interval '1 second' where status = 'queued'`,
    );
  }
  throw new Error("queue did not drain");
}

/** Reserve a slot, upload a local file where the browser would have PUT it, register it. */
async function uploadAndRegister(file: string, ext: string) {
  const { uploadPath } = await reserveRecording(db, { businessId, ext });
  await getStorage().put("raw", uploadPath.slice("raw/".length), file);
  return registerRecording(db, { businessId, uploadPath });
}

async function recording(id: string) {
  return (
    await db.select().from(dbSchema.voiceRecordings).where(eq(dbSchema.voiceRecordings.id, id))
  )[0]!;
}

async function withClassifier<T>(fn: () => Promise<T>): Promise<T> {
  process.env.DRY_RUN = "";
  resetEnvCache();
  try {
    return await fn();
  } finally {
    process.env.DRY_RUN = "1";
    resetEnvCache();
  }
}

beforeAll(async () => {
  process.env.DRY_RUN = "1";
  resetEnvCache();
  mkdirSync(inputs, { recursive: true });
  // A "voice": 1.5 s of silence, then 8 s of tone — as Chrome's recorder makes it.
  await exec("ffmpeg", [
    ...["-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=8,volume=-15dB,adelay=1500:all=1"],
    ...["-c:a", "libopus", input("take.webm")],
  ]);
  await exec("ffmpeg", [
    ...["-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=2.4"],
    ...["-c:a", "libmp3lame", input("short.mp3")],
  ]);
  await exec("ffmpeg", [
    ...["-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=91.2"],
    ...["-c:a", "libopus", input("long.ogg")],
  ]);
  await exec("ffmpeg", [
    ...["-y", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=30:duration=4"],
    ...["-c:v", "libx264", "-pix_fmt", "yuv420p", input("mute.mp4")],
  ]);
  // Ten minutes in under 1 MB: what the decode bound exists for.
  await exec("ffmpeg", [
    ...["-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "600"],
    ...["-c:a", "libopus", "-b:a", "6k", input("ten-minutes.ogg")],
  ]);

  const testDb = await createTestDb();
  db = testDb.db;
  pg = testDb.pg;
  const ts = tempStorage();
  setStorage(ts.storage);
  cleanupStorage = ts.cleanup;
  // A customer, not an admin: the content gate and the debit both run.
  const business = await createBusiness(db, { ownerEmail: "owner@example.com", name: "הסטודיו" });
  businessId = business.id;
  ownerUserId = business.ownerUserId;
  await grantCredits(db, { userId: ownerUserId, credits: 1000, note: "test" });
  await db
    .update(dbSchema.appConfig)
    .set({ value: 1000 })
    .where(eq(dbSchema.appConfig.key, "audio_preview_daily_limit"));
  const persona = await addPersona(db, { name: "נועה", voiceId: "voice_noa" });
  personaId = persona.id;
  const image = await addPersonaImage(db, {
    personaId,
    filePath: input("mute.mp4"), // any real file — the selfie is never decoded under DRY_RUN
    kind: "selfie",
  });
  personaImageId = image.id;
}, 120_000);

afterEach(() => generateObject.mockReset());

afterAll(async () => {
  await pg.close();
  cleanupStorage();
  delete process.env.DRY_RUN;
  resetEnvCache();
});

describe("upload paths", () => {
  it("mints raw/<biz>/recording/<id>/upload.<ext> and owns only its own", () => {
    const p = recordingUploadPath(businessId, "11111111-1111-4111-8111-111111111111", "webm");
    expect(p).toBe(`raw/${businessId}/recording/11111111-1111-4111-8111-111111111111/upload.webm`);
    expect(isOwnedRecordingUploadPath(businessId, p)).toBe(true);
    expect(isOwnedRecordingUploadPath(crypto.randomUUID(), p)).toBe(false);
    expect(isOwnedRecordingUploadPath(businessId, p.replace("upload.webm", "upload.exe"))).toBe(
      false,
    );
    expect(isOwnedRecordingUploadPath(businessId, p.replace("recording", "demo"))).toBe(false);
  });
});

describe("the own-voice chain", () => {
  it("records -> transcribes -> approves -> renders, keyless", async () => {
    const rec = await uploadAndRegister(input("take.webm"), "webm");
    // A second register of the same upload is the same row and one job.
    expect((await registerRecording(db, { businessId, uploadPath: rec.rawPath! })).id).toBe(rec.id);
    await drainAll();

    const ready = await recording(rec.id);
    expect(ready.status).toBe("ready");
    expect(ready.error).toBeNull();
    expect(ready.sourceMs).toBeGreaterThanOrEqual(9400);
    expect(ready.sourceMs).toBeLessThanOrEqual(9600);
    expect(ready.filePath).toBe(`renders/${businessId}/recording/${rec.id}/audio.mp3`);
    const words = ready.words as HeardWord[];
    expect(words.length).toBeGreaterThan(8);
    expect(words.map((w) => w.text)).toContain("אממ");
    // Words sit on the stored file's clock, inside its length.
    expect(words[0]!.startMs).toBeLessThanOrEqual(100);
    expect(words[words.length - 1]!.endMs).toBeLessThanOrEqual(ready.durationMs!);

    // One usage row for the one Scribe call, in seconds of audio.
    const usage = await db
      .select()
      .from(dbSchema.usageEvents)
      .where(eq(dbSchema.usageEvents.kind, "stt_seconds"));
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ provider: "elevenlabs", businessId, quantity: 10 });
    // Everything heard, uncleaned — what the content gate reads.
    expect(ready.heardText).toBe(words.map((w) => w.text).join(" "));

    // The quote the transcript step shows is the render's quote.
    const quote = await quoteBForDuration(db, { businessId, durationMs: ready.durationMs! });

    // Respell the first word, drop the filler.
    const filler = words.findIndex((w) => w.text === "אממ");
    const kept = words
      .map((w, i) => ({ i, text: i === 0 ? "הי," : w.text }))
      .filter((k) => k.i !== filler);
    const approved = await approveRecording(db, {
      recordingId: rec.id,
      businessId,
      personaId,
      kept,
    });
    expect(approved.text.startsWith("הי, ")).toBe(true);
    expect(approved.text).not.toContain("אממ");
    // DRY_RUN's hook extractor takes the first five words of what it is given.
    expect(approved.hookText).toBe(approved.text.split(" ").slice(0, 5).join(" "));

    const script = (
      await db.select().from(dbSchema.scripts).where(eq(dbSchema.scripts.id, approved.scriptId))
    )[0]!;
    expect(script).toMatchObject({
      kind: "b_script",
      text: approved.text,
      personaId,
      promptVersion: null,
      userEdited: false,
      structureId: null,
    });
    expect(script.params).toMatchObject({
      source: "recording",
      recordingId: rec.id,
      hookText: approved.hookText,
      hookTextDerived: true,
    });
    expect((script.params as { heardText: string }).heardText).toContain("אממ");

    const audio = (
      await db
        .select()
        .from(dbSchema.audioRenders)
        .where(eq(dbSchema.audioRenders.id, approved.audioId))
    )[0]!;
    expect(audio).toMatchObject({
      scriptId: script.id,
      voiceId: null,
      status: "ready",
      durationMs: ready.durationMs,
      renderedText: approved.text,
      alignmentSource: "scribe",
    });
    expect(audio.approvedAt).not.toBeNull();
    // Its own copy of the mp3, not the recording's file.
    expect(audio.filePath).toBe(`renders/${businessId}/audio/${audio.id}/audio.mp3`);
    // The captions: the respelled word, no filler, every word at its heard time.
    const captioned = (audio.wordTimestamps as CaptionChunk[]).flatMap((c) => c.words);
    expect(captioned).toEqual(
      kept.map((k) => ({ word: k.text, startMs: words[k.i]!.startMs, endMs: words[k.i]!.endMs })),
    );
    // The pointer tripwire stays a passing assertion.
    expect((await getAudioWithScript(db, audio.id))!.pointerMoved).toBe(false);
    expect((await quoteBRender(db, { businessId, audioRenderId: audio.id })).creditsPerRender).toBe(
      quote.creditsPerRender,
    );

    // Then the ordinary Service B chain, unchanged.
    const render = await createBRender(db, {
      businessId,
      audioRenderId: audio.id,
      personaId,
      personaImageId,
      hookEffect: "zoom",
      hookText: approved.hookText!,
    });
    await drainAll();
    const done = (
      await db.select().from(dbSchema.videoRenders).where(eq(dbSchema.videoRenders.id, render.id))
    )[0]!;
    expect(done.status).toBe("released");
    expect(done.filePath).not.toBeNull();
  }, 120_000);

  it("the same approval again is the pair it already made; past ten pairs, record again", async () => {
    const rec = await uploadAndRegister(input("take.webm"), "webm");
    await drainAll();
    const words = (await recording(rec.id)).words as HeardWord[];
    const all = words.map((w, i) => ({ i, text: w.text }));
    const first = await approveRecording(db, {
      recordingId: rec.id,
      businessId,
      personaId,
      kept: all,
    });
    const again = await approveRecording(db, {
      recordingId: rec.id,
      businessId,
      personaId,
      kept: all,
    });
    expect(again).toEqual(first);
    // Nine more distinct corrections make ten pairs; the eleventh is refused.
    for (let n = 1; n <= 9; n++) {
      await approveRecording(db, {
        recordingId: rec.id,
        businessId,
        personaId,
        kept: all.slice(n),
      });
    }
    await expect(
      approveRecording(db, { recordingId: rec.id, businessId, personaId, kept: all.slice(10) }),
    ).rejects.toBeInstanceOf(TranscriptCorrectionError);
    // ...but the same approval as an earlier one still answers.
    await expect(
      approveRecording(db, { recordingId: rec.id, businessId, personaId, kept: all }),
    ).resolves.toEqual(first);
  }, 60_000);

  it("a retried job reuses the checkpointed words and never pays Scribe twice", async () => {
    const { uploadPath, recordingId } = await reserveRecording(db, { businessId, ext: "webm" });
    await getStorage().put("raw", uploadPath.slice("raw/".length), input("take.webm"));
    const saved = {
      words: [
        { text: "אחת", startMs: 600, endMs: 1100 },
        { text: "שתיים", startMs: 1300, endMs: 2000 },
        { text: "שלוש", startMs: 2200, endMs: 4800 },
      ],
      audioDurationSecs: 9.5,
    };
    const usageBefore = await db
      .select()
      .from(dbSchema.usageEvents)
      .where(eq(dbSchema.usageEvents.kind, "stt_seconds"));
    const checkpoints: unknown[] = [];
    await handleTranscribeRecording(
      {
        id: crypto.randomUUID(),
        payload: { recordingId },
        state: { stt: saved, usageRecorded: true },
      } as never,
      { db, log: logger, checkpoint: async (s) => void checkpoints.push(s) },
    );
    const done = await recording(recordingId);
    expect(done.status).toBe("ready");
    // The saved words, on the cut file's clock: cut from 600 - 190 = 410 ms.
    expect((done.words as HeardWord[]).map((w) => [w.text, w.startMs])).toEqual([
      ["אחת", 190],
      ["שתיים", 890],
      ["שלוש", 1790],
    ]);
    expect(done.heardText).toBe("אחת שתיים שלוש");
    expect(checkpoints).toEqual([]);
    const usageAfter = await db
      .select()
      .from(dbSchema.usageEvents)
      .where(eq(dbSchema.usageEvents.kind, "stt_seconds"));
    expect(usageAfter).toHaveLength(usageBefore.length);
  }, 60_000);

  it("a second approval makes a new pair and rewrites nothing", async () => {
    const rec = await uploadAndRegister(input("take.webm"), "webm");
    await drainAll();
    const words = (await recording(rec.id)).words as HeardWord[];
    const kept = words.map((w, i) => ({ i, text: w.text }));
    const first = await approveRecording(db, { recordingId: rec.id, businessId, personaId, kept });
    const second = await approveRecording(db, {
      recordingId: rec.id,
      businessId,
      personaId,
      kept: kept.slice(1),
    });
    expect(second.scriptId).not.toBe(first.scriptId);
    expect(second.audioId).not.toBe(first.audioId);
    const firstScript = (
      await db.select().from(dbSchema.scripts).where(eq(dbSchema.scripts.id, first.scriptId))
    )[0]!;
    expect(firstScript.text).toBe(first.text);
  }, 60_000);

  it("refuses a correction that adds, and anything but a ready recording of this business", async () => {
    const rec = await uploadAndRegister(input("take.webm"), "webm");
    await expect(
      approveRecording(db, {
        recordingId: rec.id,
        businessId,
        personaId,
        kept: [{ i: 0, text: "א" }],
      }),
    ).rejects.toThrow(/not ready/);
    await drainAll();
    const words = (await recording(rec.id)).words as HeardWord[];
    await expect(
      approveRecording(db, {
        recordingId: rec.id,
        businessId,
        personaId,
        kept: [{ i: words.length, text: "עוד" }],
      }),
    ).rejects.toBeInstanceOf(TranscriptCorrectionError);
    await expect(
      approveRecording(db, {
        recordingId: rec.id,
        businessId: crypto.randomUUID(),
        personaId,
        kept: [{ i: 0, text: words[0]!.text }],
      }),
    ).rejects.toThrow(/not found/);
  }, 60_000);
});

describe("refusals the customer reads", () => {
  it("a 2 s file, a 91 s file and a video with no sound fail in Hebrew, with the length", async () => {
    const short = await uploadAndRegister(input("short.mp3"), "mp3");
    const long = await uploadAndRegister(input("long.ogg"), "ogg");
    const mute = await uploadAndRegister(input("mute.mp4"), "mp4");
    const hours = await uploadAndRegister(input("ten-minutes.ogg"), "ogg");
    await drainAll();
    // Refused from its header, before a byte of it was decoded.
    expect(await recording(hours.id)).toMatchObject({
      status: "failed",
      error: "ההקלטה באורך 600 שניות. אפשר מ־3 עד 90 שניות.",
      sourceMs: null,
    });
    expect(await recording(short.id)).toMatchObject({
      status: "failed",
      error: "ההקלטה באורך 2 שניות. אפשר מ־3 עד 90 שניות.",
    });
    expect(await recording(long.id)).toMatchObject({
      status: "failed",
      error: "ההקלטה באורך 91 שניות. אפשר מ־3 עד 90 שניות.",
    });
    expect(await recording(mute.id)).toMatchObject({ status: "failed", error: RECORDING_NO_AUDIO });
    // None of them reached Scribe.
    const usage = await db
      .select()
      .from(dbSchema.usageEvents)
      .where(
        sql`kind = 'stt_seconds' and job_id in (select id from jobs where payload->>'recordingId' in (${short.id}, ${long.id}, ${mute.id}))`,
      );
    expect(usage).toHaveLength(0);
  }, 120_000);
});

describe("the shared preview pool", () => {
  it("counts TTS attempts and recordings together, never an approval's audio row", async () => {
    const { db: poolDb, pg: poolPg } = await createTestDb();
    const saved = db;
    db = poolDb;
    try {
      const biz = await createBusiness(db, { ownerEmail: "pool@example.com", name: "בריכה" });
      const savedBiz = businessId;
      businessId = biz.id;
      await db
        .update(dbSchema.appConfig)
        .set({ value: 2 })
        .where(eq(dbSchema.appConfig.key, "audio_preview_daily_limit"));
      const persona = await addPersona(db, { name: "דנה", voiceId: "voice_dana" });
      const script = (
        await db
          .insert(dbSchema.scripts)
          .values({ businessId, personaId: persona.id, kind: "b_script", text: "שלום לכם" })
          .returning()
      )[0]!;
      // One TTS attempt...
      await requestAudio(db, { scriptId: script.id });
      // ...and one recording fill the pool of 2. The next reservation is
      // refused before anything is uploaded.
      const rec = await uploadAndRegister(input("take.webm"), "webm");
      await expect(reserveRecording(db, { businessId, ext: "webm" })).rejects.toThrow(
        /daily recording limit reached/,
      );
      await expect(requestAudio(db, { scriptId: script.id })).rejects.toThrow(
        /daily audio preview limit reached/,
      );
      // An approval's audio row (no voice) is not a third attempt: raise the
      // pool to 3, approve, and one more attempt still fits.
      await db
        .update(dbSchema.appConfig)
        .set({ value: 3 })
        .where(eq(dbSchema.appConfig.key, "audio_preview_daily_limit"));
      await drainAll();
      const words = (await recording(rec.id)).words as HeardWord[];
      await approveRecording(db, {
        recordingId: rec.id,
        businessId,
        personaId: persona.id,
        kept: words.map((w, i) => ({ i, text: w.text })),
      });
      await expect(requestAudio(db, { scriptId: script.id })).resolves.toBeDefined();
      businessId = savedBiz;
    } finally {
      db = saved;
      await poolPg.close();
    }
  }, 120_000);
});

describe("the content gate hears what was said", () => {
  it("a dropped word still reaches the classifier", async () => {
    const rec = await uploadAndRegister(input("take.webm"), "webm");
    await drainAll();
    const words = (await recording(rec.id)).words as HeardWord[];
    const dropped = words.findIndex((w) => w.text === "המקום");
    const approved = await approveRecording(db, {
      recordingId: rec.id,
      businessId,
      personaId,
      kept: words.map((w, i) => ({ i, text: w.text })).filter((k) => k.i !== dropped),
    });
    expect(approved.text).not.toContain("המקום");
    generateObject.mockResolvedValue({
      object: { flagged: false, category: null, reason: null },
      usage: { inputTokens: 900, outputTokens: 12 },
    });
    await withClassifier(() =>
      createBRender(db, { businessId, audioRenderId: approved.audioId, personaId, personaImageId }),
    );
    expect(generateObject).toHaveBeenCalledTimes(1);
    const sent = JSON.stringify(generateObject.mock.calls[0]![0]);
    expect(sent).toContain("מה שנאמר בהקלטה");
    expect(sent).toContain("המקום");
  }, 60_000);
});

describe("retention", () => {
  it("sweeps a recording's upload and processed file on their windows, never an approved copy", async () => {
    const rec = await uploadAndRegister(input("take.webm"), "webm");
    await drainAll();
    const words = (await recording(rec.id)).words as HeardWord[];
    const approved = await approveRecording(db, {
      recordingId: rec.id,
      businessId,
      personaId,
      kept: words.map((w, i) => ({ i, text: w.text })),
    });
    const before = await recording(rec.id);
    await db
      .update(dbSchema.voiceRecordings)
      .set({ createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000) })
      .where(eq(dbSchema.voiceRecordings.id, rec.id));
    await handleJanitor({} as never, { db, log: logger, checkpoint: async () => {} });

    const after = await recording(rec.id);
    expect(after.rawPath).toBeNull();
    expect(after.filePath).toBeNull();
    const audio = (
      await db
        .select()
        .from(dbSchema.audioRenders)
        .where(eq(dbSchema.audioRenders.id, approved.audioId))
    )[0]!;
    expect(audio.filePath).not.toBeNull();
    // The approved copy is still downloadable; the recording's files are gone.
    const local = path.join(inputs, `kept-${audio.id}.mp3`);
    await getStorage().download(audio.filePath!, local);
    expect(existsSync(local)).toBe(true);
    await expect(
      getStorage().download(before.filePath!, path.join(inputs, "gone.mp3")),
    ).rejects.toThrow();
    await expect(
      getStorage().download(before.rawPath!, path.join(inputs, "gone.webm")),
    ).rejects.toThrow();
  }, 60_000);
});
