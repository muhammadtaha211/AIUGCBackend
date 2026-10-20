import { inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import { buildHandlers } from "../src/handlers";
import { TransientError } from "../src/jobs/errors";
import { DEFAULT_POLL_DEADLINE_SECONDS } from "../src/jobs/poll";
import { recoverExpiredLeases } from "../src/jobs/queue";
import { runLane } from "../src/jobs/worker";
import {
  addOpenerClip,
  addPersona,
  addPersonaImage,
  setPersonaImageRetired,
} from "../src/pipelines/bank";
import { createBusiness } from "../src/pipelines/businesses";
import { draftCutawayPlan } from "../src/pipelines/cutaways";
import { rejectRender } from "../src/pipelines/qc";
import { CENTRED_HOOK_TEXT_RECT } from "../src/hook-geometry";
import { createBRender, quoteBRender, type VariantParams } from "../src/pipelines/sets";
import { approveAudio, requestAudio } from "../src/pipelines/tts";
import {
  MAX_LIPSYNC_SECONDS,
  setLipsyncProvider,
  type LipsyncSubmitInput,
} from "../src/providers/lipsync";
import { setStorage } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import { tempStorage } from "./helpers/storage";

/**
 * The Service B video chain after HeyGen: lipsync (submit ▶ poll…) →
 * render_video, with no upscale stage in between. Covers what the deleted
 * upscale suite used to pin: the QC gate on the finished render and the
 * poll-deadline terminal path (which now fails the render outright — there is
 * no plate to fall back to).
 */

describe("lipsync chain (dry-run, real DB + jobs + storage)", () => {
  let db: Db;
  let pg: { close(): Promise<void> };
  let cleanupStorage: () => void;
  let storageRoot: string;
  let businessId: string;

  /** One pass over everything currently runnable (a single poll hop). */
  async function lanePass(): Promise<void> {
    await runLane(db, { workerId: "test", handlers: buildHandlers(), drainAndExit: true });
  }

  /** Fast-forward rescheduled jobs so the next lanePass picks them up. */
  async function makeRunnable(): Promise<void> {
    await db.execute(
      sql`update jobs set run_at = now() - interval '1 second' where status = 'queued'`,
    );
  }

  /** Drain the queue, fast-forwarding rescheduled (polling) and retried jobs. */
  async function drainAll(): Promise<void> {
    for (let i = 0; i < 12; i++) {
      await lanePass();
      const queued = await db
        .select()
        .from(dbSchema.jobs)
        .where(sql`${dbSchema.jobs.status} = 'queued'`);
      if (queued.length === 0) return;
      await makeRunnable();
    }
    throw new Error("queue did not drain");
  }

  function tempFile(name: string): string {
    const dir = path.join(tmpdir(), "aiugc-lipsync-chain-inputs");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    writeFileSync(file, "fake bytes");
    return file;
  }

  const OPENER_RECT = { x: 60, y: 900, w: 960, h: 300 };

  /** A persona with a default SELFIE (the Service B render source) and approved audio. */
  async function selfiePersona(name = "נועה", voiceId = "voice_noa") {
    const persona = await addPersona(db, { name, voiceId });
    const image = await addPersonaImage(db, {
      personaId: persona.id,
      filePath: tempFile("persona.jpg"),
      kind: "selfie",
    });
    const script = (
      await db
        .insert(dbSchema.scripts)
        .values({
          businessId,
          personaId: persona.id,
          kind: "b_script",
          text: "ניסיתי מיליון דברים ושום דבר לא עבד עד שגיליתי את זה",
        })
        .returning()
    )[0]!;
    const audio = await requestAudio(db, { scriptId: script.id, voiceId });
    await drainAll();
    await approveAudio(db, audio.id);
    return { persona, image, audioId: audio.id };
  }

  async function openerFor(personaImageId: string, effect = "hand_cover") {
    return addOpenerClip(db, {
      personaImageId,
      effect,
      label: "כף יד",
      filePath: tempFile("opener.mp4"),
      durationMs: 2400,
      revealAtMs: 1600,
      textSafeArea: OPENER_RECT,
    });
  }

  /** A Service B render with approved audio, queued at the lipsync step. */
  async function queueBRender(extra?: {
    motionPrompt?: string;
    expressiveness?: string;
    withOpener?: boolean;
    hookEffect?: string;
  }): Promise<{ renderId: string; audioId: string }> {
    const { persona, image, audioId } = await selfiePersona();
    const { withOpener, hookEffect, ...rest } = extra ?? {};
    const opener = withOpener ? await openerFor(image.id) : undefined;
    const render = await createBRender(db, {
      businessId,
      audioRenderId: audioId,
      personaId: persona.id,
      ...(opener && { openerClipId: opener.id, hookText: "ניסיתי מיליון דברים" }),
      ...(hookEffect && hookEffect !== "none"
        ? { hookEffect, hookText: "ניסיתי מיליון דברים" }
        : { hookEffect }),
      ...rest,
    });
    return { renderId: render.id, audioId };
  }

  async function paramsOf(videoRenderId: string): Promise<VariantParams> {
    const rows = await db
      .select()
      .from(dbSchema.videoRenders)
      .where(sql`${dbSchema.videoRenders.id} = ${videoRenderId}`);
    return rows[0]!.params as VariantParams;
  }

  async function renderRow(videoRenderId: string) {
    const rows = await db
      .select()
      .from(dbSchema.videoRenders)
      .where(sql`${dbSchema.videoRenders.id} = ${videoRenderId}`);
    return rows[0]!;
  }

  async function lipsyncJob(videoRenderId: string) {
    const rows = await db
      .select()
      .from(dbSchema.jobs)
      .where(sql`${dbSchema.jobs.idempotencyKey} = ${`lipsync:${videoRenderId}`}`);
    return rows[0];
  }

  beforeAll(async () => {
    process.env.DRY_RUN = "1";
    resetEnvCache();
    const testDb = await createTestDb();
    db = testDb.db;
    pg = testDb.pg;
    const ts = tempStorage();
    setStorage(ts.storage);
    storageRoot = ts.root;
    cleanupStorage = ts.cleanup;
    const business = await createBusiness(db, {
      ownerEmail: "founder@example.com",
      name: "מסעדת הבית",
      ownerRole: "admin",
    });
    businessId = business.id;
    // Every render here requests its own audio preview for one owner, and the
    // file passed the seeded per-account cap when the opener tests landed —
    // 20/24h then, 50/24h under 0038, and 20/24h again since 0040. The cap
    // is an abuse ceiling, not what
    // this file tests.
    await db
      .update(dbSchema.appConfig)
      .set({ value: 1000 })
      .where(sql`${dbSchema.appConfig.key} = 'audio_preview_daily_limit'`);
  });

  beforeEach(async () => {
    // This file's baseline is the QC gate ON. Since 0031 the seeded value is
    // true (it encodes the standing founder instruction, CLAUDE.md decision #8),
    // so the gate has to be asked for — decision #8 keeps the machinery in the
    // tree precisely so its off-position stays working, and these are the tests
    // that prove it. The one test that wants auto-release sets true itself.
    await db
      .update(dbSchema.appConfig)
      .set({ value: false })
      .where(sql`${dbSchema.appConfig.key} = 'auto_release_b'`);
  });

  afterEach(async () => {
    setLipsyncProvider(undefined);
    // Restore every app_config row a test touches, so no test depends on
    // which tests ran before it. auto_release_b is owned by beforeEach above.
    // Opt-in knobs: absent is the default state, so restore means delete.
    await db
      .delete(dbSchema.appConfig)
      .where(
        sql`${dbSchema.appConfig.key} in ('lipsync_motion_prompt', 'lipsync_expressiveness', 'lipsync_lead_in_ms')`,
      );
  });

  async function gpuUsageRows() {
    return db
      .select()
      .from(dbSchema.usageEvents)
      .where(sql`${dbSchema.usageEvents.kind} = 'gpu_seconds'`);
  }

  async function audioDurationMs(audioId: string): Promise<number> {
    const rows = await db
      .select()
      .from(dbSchema.audioRenders)
      .where(sql`${dbSchema.audioRenders.id} = ${audioId}`);
    return rows[0]!.durationMs!;
  }

  afterAll(async () => {
    setStorage(undefined);
    cleanupStorage();
    await pg.close();
  });

  it("stores the HeyGen clip as lipsync.mp4 and hands it straight to render_video", async () => {
    const { renderId } = await queueBRender();
    await drainAll();

    const params = await paramsOf(renderId);
    expect(params.lipsyncPath).toMatch(/^renders\/.*\/lipsync\.mp4$/);
    // The upscale-era keys are gone, not just empty.
    expect(params).not.toHaveProperty("lipsyncPlatePath");
    expect(params).not.toHaveProperty("upscaleError");
    expect(params).not.toHaveProperty("seed");

    const upscaleJobs = await db
      .select()
      .from(dbSchema.jobs)
      .where(sql`${dbSchema.jobs.type} = 'upscale'`);
    expect(upscaleJobs).toHaveLength(0);

    // With auto_release_b off, Service B lands in the founder QC queue.
    expect((await renderRow(renderId)).status).toBe("qc_pending");
  });

  it("auto_release_b releases a finished render (no degraded-upscale hold left)", async () => {
    await db
      .update(dbSchema.appConfig)
      .set({ value: true })
      .where(sql`${dbSchema.appConfig.key} = 'auto_release_b'`);

    const { renderId } = await queueBRender();
    await drainAll();

    const row = await renderRow(renderId);
    expect(row.status).toBe("released");
    expect(row.releasedAt).not.toBeNull();
  });

  it("submits signed urls and the pinned resolution — no prompt, frames, or seed in the input", async () => {
    const submits: LipsyncSubmitInput[] = [];
    setLipsyncProvider({
      async submit(input) {
        submits.push(input);
        return { providerJobId: "job_1" };
      },
      async poll() {
        return { status: "done", videoUrl: "dryrun://lipsync/job_1.mp4" };
      },
    });

    const { renderId } = await queueBRender();
    await drainAll();

    expect(submits).toHaveLength(1);
    expect(Object.keys(submits[0]!).sort()).toEqual(["audioUrl", "imageUrl", "resolution"]);
    expect(submits[0]!.imageUrl).toContain("persona_image"); // the signed reference image
    expect(submits[0]!.resolution).toBe("1080p"); // the code default, no app_config row
    expect((await paramsOf(renderId)).lipsyncPath).toMatch(/lipsync\.mp4$/);
  });

  it("submits the lead-in-padded VO, pins leadInMs before submit, and bills the padded length", async () => {
    const submits: LipsyncSubmitInput[] = [];
    setLipsyncProvider({
      async submit(input) {
        submits.push(input);
        return { providerJobId: "job_pad" };
      },
      async poll() {
        return { status: "done", videoUrl: "dryrun://lipsync/job_pad.mp4" };
      },
    });
    const usageBefore = (await gpuUsageRows()).length;

    const { renderId, audioId } = await queueBRender();
    await drainAll();

    // The padded copy under the render's audio key — never the approved mp3.
    expect(submits).toHaveLength(1);
    expect(submits[0]!.audioUrl).toContain(`audio/${renderId}/vo-padded.mp3`);
    // The code default, no app_config row.
    expect((await paramsOf(renderId)).leadInMs).toBe(800);
    // HeyGen generates and bills the padded length; the quote stayed unpadded.
    const usage = (await gpuUsageRows()).slice(usageBefore);
    expect(usage).toHaveLength(1);
    expect(usage[0]!.quantity).toBe(Math.ceil(((await audioDurationMs(audioId)) + 800) / 1000));
  });

  it("app_config lipsync_lead_in_ms sets the pad, and a later change does not move a pinned render", async () => {
    await db.insert(dbSchema.appConfig).values({ key: "lipsync_lead_in_ms", value: 500 });
    setLipsyncProvider({
      async submit() {
        return { providerJobId: "job_pin" };
      },
      async poll() {
        return { status: "pending" };
      },
    });

    const { renderId } = await queueBRender();
    await lanePass(); // submit hop only — the job is now polling
    expect((await paramsOf(renderId)).leadInMs).toBe(500);

    await db
      .update(dbSchema.appConfig)
      .set({ value: 1200 })
      .where(sql`${dbSchema.appConfig.key} = 'lipsync_lead_in_ms'`);
    setLipsyncProvider({
      async submit() {
        throw new Error("a pinned render must not resubmit");
      },
      async poll() {
        return { status: "done", videoUrl: "dryrun://lipsync/job_pin.mp4" };
      },
    });
    await makeRunnable();
    await drainAll();
    expect((await paramsOf(renderId)).leadInMs).toBe(500);
  });

  it("a submit retried after the pin was written reuses the pinned lead-in, not the current config", async () => {
    await db.insert(dbSchema.appConfig).values({ key: "lipsync_lead_in_ms", value: 500 });
    let attempts = 0;
    const submits: LipsyncSubmitInput[] = [];
    setLipsyncProvider({
      async submit(input) {
        attempts++;
        // The pin and the padded upload have already happened when HeyGen
        // answers — this is the crash-between-merge-and-checkpoint window.
        if (attempts === 1) throw new TransientError("heygen 503");
        submits.push(input);
        return { providerJobId: "job_retry" };
      },
      async poll() {
        return { status: "done", videoUrl: "dryrun://lipsync/job_retry.mp4" };
      },
    });
    const usageBefore = (await gpuUsageRows()).length;

    const { renderId, audioId } = await queueBRender();
    await lanePass(); // submit hop 1: pinned, padded, then the provider failed
    expect(attempts).toBe(1);
    expect((await paramsOf(renderId)).leadInMs).toBe(500);

    await db
      .update(dbSchema.appConfig)
      .set({ value: 1200 })
      .where(sql`${dbSchema.appConfig.key} = 'lipsync_lead_in_ms'`);
    await drainAll(); // the retried submit hop, then poll and render

    expect(attempts).toBe(2);
    expect(submits[0]!.audioUrl).toContain(`audio/${renderId}/vo-padded.mp3`);
    expect((await paramsOf(renderId)).leadInMs).toBe(500);
    const usage = (await gpuUsageRows()).slice(usageBefore);
    expect(usage).toHaveLength(1);
    expect(usage[0]!.quantity).toBe(Math.ceil(((await audioDurationMs(audioId)) + 500) / 1000));
  });

  it("the runaway guard counts the padded length", async () => {
    setLipsyncProvider({
      async submit() {
        throw new Error("submit must not be called past the runaway guard");
      },
      async poll() {
        return { status: "pending" };
      },
    });
    const { renderId, audioId } = await queueBRender();
    // Under the guard unpadded, over it with the 800ms lead-in.
    await db
      .update(dbSchema.audioRenders)
      .set({ durationMs: MAX_LIPSYNC_SECONDS * 1000 - 500 })
      .where(sql`${dbSchema.audioRenders.id} = ${audioId}`);
    await drainAll();
    expect((await lipsyncJob(renderId))!.lastError).toMatch(/runaway-cost guard/);
    expect((await renderRow(renderId)).status).toBe("failed");
  });

  it("render-b --motion-prompt / --expressiveness reach the submit input", async () => {
    const submits: LipsyncSubmitInput[] = [];
    setLipsyncProvider({
      async submit(input) {
        submits.push(input);
        return { providerJobId: "job_mp" };
      },
      async poll() {
        return { status: "done", videoUrl: "dryrun://lipsync/job_mp.mp4" };
      },
    });

    await queueBRender({ motionPrompt: "מחוות ידיים טבעיות", expressiveness: "high" });
    await drainAll();

    expect(submits).toHaveLength(1);
    expect(submits[0]!.motionPrompt).toBe("מחוות ידיים טבעיות");
    expect(submits[0]!.expressiveness).toBe("high");
  });

  it("app_config is the fallback and the render param overrides it", async () => {
    await db.insert(dbSchema.appConfig).values([
      { key: "lipsync_motion_prompt", value: "ברירת מחדל מהקונפיג" },
      { key: "lipsync_expressiveness", value: "medium" },
    ]);
    const submits: LipsyncSubmitInput[] = [];
    setLipsyncProvider({
      async submit(input) {
        submits.push(input);
        return { providerJobId: `job_${submits.length}` };
      },
      async poll() {
        return { status: "done", videoUrl: "dryrun://lipsync/job.mp4" };
      },
    });

    await queueBRender(); // no render param → the config rows apply
    await drainAll();
    await queueBRender({ motionPrompt: "הפרמטר גובר", expressiveness: "low" });
    await drainAll();

    expect(submits).toHaveLength(2);
    expect(submits[0]!.motionPrompt).toBe("ברירת מחדל מהקונפיג");
    expect(submits[0]!.expressiveness).toBe("medium");
    expect(submits[1]!.motionPrompt).toBe("הפרמטר גובר");
    expect(submits[1]!.expressiveness).toBe("low");
  });

  it("an invalid expressiveness fails at createBRender, before anything is queued", async () => {
    await expect(queueBRender({ expressiveness: "extreme" })).rejects.toThrow();
  });

  it("audio over MAX_LIPSYNC_SECONDS fails permanently before any submit", async () => {
    setLipsyncProvider({
      async submit() {
        throw new Error("submit must not be called past the runaway guard");
      },
      async poll() {
        return { status: "pending" };
      },
    });

    const { renderId, audioId } = await queueBRender();
    await db
      .update(dbSchema.audioRenders)
      .set({ durationMs: (MAX_LIPSYNC_SECONDS + 1) * 1000 })
      .where(sql`${dbSchema.audioRenders.id} = ${audioId}`);
    await drainAll();

    const job = (await lipsyncJob(renderId))!;
    expect(job.status).toBe("failed");
    expect(job.errorClass).toBe("permanent");
    // The diagnostic (real seconds vs the guard) stays on the job; the
    // customer-facing column gets the Hebrew customerMessage.
    expect(job.lastError).toMatch(/runaway-cost guard/);

    const render = await renderRow(renderId);
    expect(render.status).toBe("failed");
    expect(render.error).toMatch(/חורג מהמגבלה/);
  });

  it("a poll that never completes fails at the deadline — no plate fallback left", async () => {
    setLipsyncProvider({
      async submit() {
        return { providerJobId: "stuck_1" };
      },
      async poll() {
        return { status: "pending" };
      },
    });

    const { renderId } = await queueBRender();
    await lanePass(); // submit checkpoints providerJobId + submittedAt
    let job = (await lipsyncJob(renderId))!;
    const state = job.state as { providerJobId?: string; submittedAt?: number };
    expect(state.providerJobId).toBe("stuck_1");

    await db
      .update(dbSchema.jobs)
      .set({
        state: { ...state, submittedAt: Date.now() - (DEFAULT_POLL_DEADLINE_SECONDS + 60) * 1000 },
      })
      .where(sql`${dbSchema.jobs.id} = ${job.id}`);
    await makeRunnable();
    await lanePass();

    job = (await lipsyncJob(renderId))!;
    expect(job.status).toBe("failed");
    expect(job.errorClass).toBe("permanent");
    expect(job.lastError).toMatch(/לא הסתיים בזמן/);
    expect((await renderRow(renderId)).status).toBe("failed");
  });

  it("rejects an explicit persona image that is missing or belongs to another persona", async () => {
    const noa = await addPersona(db, { name: "נועה השנייה", voiceId: "voice_noa" });
    const yael = await addPersona(db, { name: "יעל", voiceId: "voice_yael" });
    const yaelImage = await addPersonaImage(db, {
      personaId: yael.id,
      filePath: tempFile("yael.jpg"),
    });
    const script = (
      await db
        .insert(dbSchema.scripts)
        .values({ businessId, personaId: yael.id, kind: "b_script", text: "טקסט לבדיקה" })
        .returning()
    )[0]!;
    const audio = await requestAudio(db, { scriptId: script.id, voiceId: "voice_yael" });
    await drainAll();
    await approveAudio(db, audio.id);

    await expect(
      createBRender(db, { businessId, audioRenderId: audio.id, personaImageId: randomUUID() }),
    ).rejects.toThrow(/not found/);
    await expect(
      createBRender(db, {
        businessId,
        audioRenderId: audio.id,
        personaId: noa.id,
        personaImageId: yaelImage.id,
      }),
    ).rejects.toThrow(/different persona/);

    // A retired image is refused for NEW renders (QC regeneration is exempt —
    // it reuses old params without re-running createBRender).
    const retiredImage = await addPersonaImage(db, {
      personaId: yael.id,
      filePath: tempFile("yael-old.jpg"),
    });
    await setPersonaImageRetired(db, retiredImage.id, true);
    await expect(
      createBRender(db, { businessId, audioRenderId: audio.id, personaImageId: retiredImage.id }),
    ).rejects.toThrow(/is retired/);

    // The matching pair goes through, carrying the explicit image for lipsync.
    const render = await createBRender(db, {
      businessId,
      audioRenderId: audio.id,
      personaId: yael.id,
      personaImageId: yaelImage.id,
    });
    expect((render.params as VariantParams).personaImageId).toBe(yaelImage.id);
    await drainAll(); // leave the queue empty for the tests after this one
  });

  it("a QC regeneration strips the clip path; a different take needs a script or audio change", async () => {
    const { renderId } = await queueBRender({ withOpener: true });
    await drainAll();
    const params = await paramsOf(renderId);
    expect(params.lipsyncPath).toBeDefined();
    expect(params.openerClipId).toBeDefined();

    const { regeneratedRenderId } = await rejectRender(db, renderId, "עיניים מוזרות");
    expect(regeneratedRenderId).toBeDefined();

    const retry = await paramsOf(regeneratedRenderId!);
    // HeyGen is non-deterministic — the retry is a legitimate re-roll of the
    // take; what must NOT carry over is the rejected render's stored clip path.
    expect(retry.lipsyncPath).toBeUndefined();
    expect(retry.audioRenderId).toBe(params.audioRenderId);
    expect(retry.personaId).toBe(params.personaId);
    // The opener, its FINAL hook text, the rect and the pinned lead-in all
    // survive: the re-roll composes the same ad around a new take.
    expect(retry.openerClipId).toBe(params.openerClipId);
    expect(retry.hookText).toBe(params.hookText);
    expect(retry.hookTextSafeArea).toEqual(params.hookTextSafeArea);
    expect(retry.personaImageId).toBe(params.personaImageId);
    expect(retry.leadInMs).toBe(params.leadInMs);
  });

  it("renders the opener under DRY_RUN: the props echo carries the clip, the hook text and the timeline", async () => {
    const { renderId } = await queueBRender({ withOpener: true });
    await drainAll();

    const row = await renderRow(renderId);
    expect(row.status).toBe("qc_pending");
    const props = readFileSync(path.join(storageRoot, row.filePath!), "utf8");
    expect(props).toContain('"kind":"service_b"');
    expect(props).toMatch(/"openerPath":"[^"]*opener(-tagged)?\.mp4"/);
    expect(props).toContain('"hookText":"ניסיתי מיליון דברים"');
    // jsonb hands the rect back with its keys reordered, so parse it out.
    const rect = /"hookTextSafeArea":(\{[^}]*\})/.exec(props)?.[1];
    expect(rect && JSON.parse(rect)).toEqual(OPENER_RECT);
    // 3 words read in 1600ms and the reveal is at 1600 into the clip, so the
    // text leaves on the cut; 800ms lead-in → clip from 550, VO 250ms after.
    expect(props).toContain(
      '"timeline":{"hookTextMs":1600,"revealAbsMs":1600,"lipsyncStartFromMs":550,"captionOffsetMs":1850,',
    );
    // No camera motion any more (vault 0120 §2), so nothing seeds one; and the
    // B-roll placeholder is gone with it (cutaways are their own prop, 0121).
    // DRY_RUN measures no colour, so the talking head carries no grade.
    expect(props).not.toContain("cameraSeed");
    expect(props).not.toContain("brollPaths");
    expect(props).not.toContain("cutaways");
    expect(props).not.toContain("talkingHeadGrade");
    expect(props).not.toContain("talkingHeadAlign");
  });

  it("a render lip-synced before the lead-in existed lays out from 0 with the VO from 0", async () => {
    const { renderId } = await queueBRender();
    await lanePass(); // submit hop: pinned and padded like any render today
    // A pre-lead-in row carries no leadInMs at all — strip it before the
    // poll and render hops, which are what a legacy row goes through.
    await db.execute(
      sql`update video_renders set params = params - 'leadInMs' where id = ${renderId}`,
    );
    await drainAll();

    const row = await renderRow(renderId);
    const props = readFileSync(path.join(storageRoot, row.filePath!), "utf8");
    expect(props).toContain(
      '"timeline":{"hookTextMs":0,"revealAbsMs":0,"lipsyncStartFromMs":0,"captionOffsetMs":0,',
    );
  });

  it("an opener is refused next to a composite, even with a matching explicit image", async () => {
    const { persona, image, audioId } = await selfiePersona();
    const opener = await openerFor(image.id);
    // handleLipsync animates a named composite before any persona image, so
    // the opener's selfie would never be what the talking head shows.
    const composite = (
      await db
        .insert(dbSchema.composites)
        .values({
          businessId,
          personaId: persona.id,
          status: "ready",
          outputPath: "assets/composite/x/out.png",
          approvedAt: new Date(),
        })
        .returning()
    )[0]!;
    await expect(
      createBRender(db, {
        businessId,
        audioRenderId: audioId,
        personaId: persona.id,
        personaImageId: image.id,
        compositeId: composite.id,
        openerClipId: opener.id,
        hookText: "ניסיתי מיליון דברים",
      }),
    ).rejects.toThrow(/not a composite/);
  });

  it("a persona whose default is not a selfie is refused; an explicit image bypasses the guard", async () => {
    const persona = await addPersona(db, { name: "רותם", voiceId: "voice_rotem" });
    // kind absent = "background": the standing image, which is the default.
    const standing = await addPersonaImage(db, {
      personaId: persona.id,
      filePath: tempFile("standing.jpg"),
    });
    const script = (
      await db
        .insert(dbSchema.scripts)
        .values({ businessId, personaId: persona.id, kind: "b_script", text: "טקסט לבדיקה" })
        .returning()
    )[0]!;
    const audio = await requestAudio(db, { scriptId: script.id, voiceId: "voice_rotem" });
    await drainAll();
    await approveAudio(db, audio.id);

    await expect(
      createBRender(db, { businessId, audioRenderId: audio.id, personaId: persona.id }),
    ).rejects.toThrow(/סלפי/);

    const render = await createBRender(db, {
      businessId,
      audioRenderId: audio.id,
      personaId: persona.id,
      personaImageId: standing.id,
    });
    expect((render.params as VariantParams).personaImageId).toBe(standing.id);
    await drainAll();
  });

  it("a hook animation or an opener needs hookText, and hookText needs one of them", async () => {
    const { persona, image, audioId } = await selfiePersona();
    const opener = await openerFor(image.id);
    const base = { businessId, audioRenderId: audioId, personaId: persona.id };
    await expect(createBRender(db, { ...base, openerClipId: opener.id })).rejects.toThrow(
      /hookText is required/,
    );
    await expect(createBRender(db, { ...base, hookEffect: "zoom" })).rejects.toThrow(
      /hookText is required/,
    );
    await expect(createBRender(db, { ...base, hookText: "ניסיתי מיליון דברים" })).rejects.toThrow(
      /hookText needs a hook animation or an opener/,
    );
    // "none" is not a thing to burn text over.
    await expect(
      createBRender(db, { ...base, hookEffect: "none", hookText: "ניסיתי מיליון דברים" }),
    ).rejects.toThrow(/hookText needs a hook animation or an opener/);
  });

  it("refuses an unknown effect name and an effect stacked on an opener — both pre-debit", async () => {
    const { persona, image, audioId } = await selfiePersona();
    const opener = await openerFor(image.id);
    const base = {
      businessId,
      audioRenderId: audioId,
      personaId: persona.id,
      hookText: "ניסיתי מיליון דברים",
    };
    // The two the founder did not pick are names this build does not know.
    for (const hookEffect of ["beats", "textReveal", "ZOOM", ""]) {
      await expect(createBRender(db, { ...base, hookEffect })).rejects.toThrow();
    }
    await expect(
      createBRender(db, { ...base, hookEffect: "zoom", openerClipId: opener.id }),
    ).rejects.toThrow(/exclusive/);
  });

  it("stores the effect NAME and the centred rect, and renders the animation under DRY_RUN", async () => {
    const { renderId } = await queueBRender({ hookEffect: "zoom" });
    const params = await paramsOf(renderId);
    expect(params.hookEffect).toBe("zoom");
    expect(params.hookText).toBe("ניסיתי מיליון דברים");
    // No clip underneath to inherit a rect from — the centred one.
    expect(params.hookTextSafeArea).toEqual(CENTRED_HOOK_TEXT_RECT);
    // A name, never the numbers: a retune must not have to rewrite rows.
    expect(JSON.stringify(params)).not.toContain("1.35");

    await drainAll();
    const props = readFileSync(
      path.join(storageRoot, (await renderRow(renderId)).filePath!),
      "utf8",
    );
    expect(props).not.toContain("openerPath");
    // The tuned numbers appear at RENDER time, and the pull-back lands
    // HOOK_LANDS_AFTER_SPEECH_MS after speech onset (captionOffsetMs 250).
    expect(props).toContain('"hookZoom":{"from":1.35,"to":1.42,"durationMs":450,"atMs":650');
    expect(props).toMatch(/"sfxPath":"[^"]*hook-zoom-whoosh\.wav"/);
    // The line leaves at the caption handoff, not at a read-time clamp.
    expect(props).toContain('"revealAbsMs":0,"lipsyncStartFromMs":550,"captionOffsetMs":250');
  });

  it("derives focus and whip from the gap too — focus lands with the zoom, whip is gap-free", async () => {
    const focus = await queueBRender({ hookEffect: "focus" });
    await drainAll();
    const focusProps = readFileSync(
      path.join(storageRoot, (await renderRow(focus.renderId)).filePath!),
      "utf8",
    );
    // captionOffsetMs 250 + 400 = 650 = where the pull ends. The judged 850ms
    // pull does not fit in 650ms of run-up, so it takes what there is and the
    // hold collapses to 0 — the LANDING is what was judged, not the run-up.
    expect(focusProps).toContain('"hookFocus":{"blurPx":20,"holdMs":0,"durationMs":650}');
    expect(focusProps).not.toContain("sfxPath");

    const whip = await queueBRender({ hookEffect: "whip" });
    await drainAll();
    const whipProps = readFileSync(
      path.join(storageRoot, (await renderRow(whip.renderId)).filePath!),
      "utf8",
    );
    // The whip runs from frame 0 and is over before speech at any gap, so it
    // carries the judged literals unchanged.
    expect(whipProps).toContain('"hookWhip":{"fromX":140,"durationMs":420,"blurPx":20');
    expect(whipProps).toMatch(/"sfxPath":"[^"]*hook-whip-swish\.wav"/);
  });

  it("a 'none' render is exactly today's plain talking head — no line, no animation", async () => {
    const { renderId } = await queueBRender({ hookEffect: "none" });
    const params = await paramsOf(renderId);
    expect(params.hookEffect).toBeUndefined();
    expect(params.hookText).toBeUndefined();
    await drainAll();
    const props = readFileSync(
      path.join(storageRoot, (await renderRow(renderId)).filePath!),
      "utf8",
    );
    // Quoted keys: a bare "hookText" would match the timeline's hookTextMs.
    for (const absent of [
      '"hookZoom"',
      '"hookFocus"',
      '"hookWhip"',
      '"hookText"',
      '"openerPath"',
    ]) {
      expect(props).not.toContain(absent);
    }
    expect(props).toContain('"hookTextMs":0');
  });

  /**
   * Demo cutaways (vault 0121): a voice long enough for the layout (40 words,
   * ~18 s under DRY_RUN's 2.2 words/s alignment) and a ready, analysed demo
   * whose normalized file is in storage, so the render hop downloads it.
   */
  async function cutawayRender(extra: { hookEffect?: string } = {}) {
    const persona = await addPersona(db, { name: "דנה", voiceId: "voice_dana" });
    await addPersonaImage(db, {
      personaId: persona.id,
      filePath: tempFile("dana.jpg"),
      kind: "selfie",
    });
    const words = Array.from({ length: 40 }, (_, i) => `מילה${i}`).join(" ");
    const script = (
      await db
        .insert(dbSchema.scripts)
        .values({ businessId, personaId: persona.id, kind: "b_script", text: words })
        .returning()
    )[0]!;
    const audio = await requestAudio(db, { scriptId: script.id, voiceId: "voice_dana" });
    await drainAll();
    await approveAudio(db, audio.id);

    const demoKey = await setStorageFile(`${businessId}/demo/cutaway/normalized.mp4`);
    const demo = (
      await db
        .insert(dbSchema.demos)
        .values({ businessId, status: "ready", normalizedPath: demoKey, durationMs: 62_000 })
        .returning()
    )[0]!;
    const states = Array.from({ length: 30 }, (_, i) => ({
      timestampMs: 600 + i * 2000,
      screenName: `מסך ${i}`,
      visibleText: [],
      action: `step ${i}`,
      actionType: "tap",
      screenKind: "product",
      sameStateAsPrevious: false,
      legibility: "high",
      salienceNote: null,
      thumbPath: `assets/x/${i}.jpg`,
    }));
    await db
      .insert(dbSchema.demoAnalyses)
      .values({ demoId: demo.id, status: "ready", timeline: states });
    const hookText =
      extra.hookEffect && extra.hookEffect !== "none" ? "מילה0 מילה1 מילה2" : undefined;
    const plan = await draftCutawayPlan(db, {
      businessId,
      audioRenderId: audio.id,
      demoId: demo.id,
      hookText,
    });
    const base = { businessId, audioRenderId: audio.id, personaId: persona.id };
    const render = await createBRender(db, {
      ...base,
      ...(hookText ? { hookEffect: extra.hookEffect, hookText } : {}),
      cutawayPlanId: plan.planId,
    });
    return { render, plan, demoId: demo.id, base, audioId: audio.id };
  }

  async function setStorageFile(key: string): Promise<string> {
    const { getStorage } = await import("../src/storage");
    return getStorage().put("assets", key, tempFile("normalized.mp4"));
  }

  it("cutaways ride the whole chain keyless: copied onto params, echoed to the composition before the captions", async () => {
    const { render, plan, demoId } = await cutawayRender({ hookEffect: "zoom" });
    const params = await paramsOf(render.id);
    expect(params.cutaways).toEqual({
      structure: "alternate",
      planId: plan.planId,
      demoId,
      analysisId: expect.any(String),
      slots: plan.slots.map(({ fromMs, toMs, demoStartMs }) => ({ fromMs, toMs, demoStartMs })),
    });
    // The demo is linked on params alone: never a set, which would mark it paid
    // and waive Service A's analysis charge (decision 0048).
    expect(render.setId).toBeNull();

    await drainAll();
    const props = readFileSync(
      path.join(storageRoot, (await renderRow(render.id)).filePath!),
      "utf8",
    );
    expect(props).toMatch(/"cutaways":\{"demoPath":"[^"]*demo\.mp4","slots":\[\{"fromMs":/);
    // Still inside the echo's prefix, after the hook animation, before the captions.
    expect(props).toContain('"captions":[{"text":');
    expect(props.indexOf('"hookZoom"')).toBeLessThan(props.indexOf('"cutaways"'));
    expect(props.indexOf('"cutaways"')).toBeLessThan(props.indexOf('"captions"'));
    expect(props).not.toContain("cameraSeed");
  });

  it("a demo file gone from storage drops the cutaways and still ships the head-only ad", async () => {
    const { render } = await cutawayRender();
    const { getStorage } = await import("../src/storage");
    const demo = (
      await db
        .select()
        .from(dbSchema.demos)
        .where(sql`${dbSchema.demos.id} = ${(await paramsOf(render.id)).cutaways!.demoId}`)
    )[0]!;
    await getStorage().remove(demo.normalizedPath!);
    await drainAll();
    const row = await renderRow(render.id);
    expect(row.status).toBe("qc_pending");
    const props = readFileSync(path.join(storageRoot, row.filePath!), "utf8");
    expect(props).not.toContain('"cutaways"');
    const degraded = await db
      .select()
      .from(dbSchema.events)
      .where(
        sql`${dbSchema.events.kind} = 'cutaway_render_degraded' and ${dbSchema.events.subjectId} = ${render.id}`,
      );
    expect(degraded).toHaveLength(1);
  });

  it("a cutaway render is quoted and debited exactly like the head-only one, and a QC re-roll keeps its cutaways", async () => {
    const { render, base, audioId } = await cutawayRender();
    const quote = await quoteBRender(db, { businessId, audioRenderId: audioId });
    const headOnly = await createBRender(db, base);
    const debits = await db
      .select()
      .from(dbSchema.creditLedger)
      .where(inArray(dbSchema.creditLedger.refId, [render.id, headOnly.id]));
    // The founder's business is admin-owned: neither is charged, and neither
    // more than the other — the quote has no cutaway term.
    expect(debits).toHaveLength(0);
    expect(quote.creditsPerRender).toBeGreaterThan(0);
    expect((await paramsOf(headOnly.id)).cutaways).toBeUndefined();

    await drainAll();
    const { regeneratedRenderId } = await rejectRender(db, render.id, "רגע לא טוב");
    const retry = await paramsOf(regeneratedRenderId!);
    expect(retry.cutaways).toEqual((await paramsOf(render.id)).cutaways);
  });

  it("validates the opener: it exists, is active, and was made from the render's source image", async () => {
    const { persona, image, audioId } = await selfiePersona();
    const other = await selfiePersona("יעל", "voice_yael");
    const base = { businessId, audioRenderId: audioId, personaId: persona.id, hookText: "רגע אחד" };

    await expect(createBRender(db, { ...base, openerClipId: randomUUID() })).rejects.toThrow(
      /not found/,
    );

    const foreign = await openerFor(other.image.id);
    await expect(createBRender(db, { ...base, openerClipId: foreign.id })).rejects.toThrow(
      /different persona image/,
    );

    const mine = await openerFor(image.id);
    // Re-registering the pair supersedes: the old row stays, inactive.
    const replacement = await openerFor(image.id);
    expect(replacement.id).not.toBe(mine.id);
    await expect(createBRender(db, { ...base, openerClipId: mine.id })).rejects.toThrow(
      /not active/,
    );

    // The opener's own registration refuses a non-selfie image.
    const standing = await addPersonaImage(db, {
      personaId: persona.id,
      filePath: tempFile("standing2.jpg"),
    });
    await expect(openerFor(standing.id)).rejects.toThrow(/not a selfie/);
  });

  it("copies the FINAL hook text and the resolved rect into params, and pins the source image", async () => {
    const { persona, image, audioId } = await selfiePersona();
    const opener = await openerFor(image.id);

    const render = await createBRender(db, {
      businessId,
      audioRenderId: audioId,
      personaId: persona.id,
      openerClipId: opener.id,
      hookText: "  ניסיתי מיליון דברים  ",
    });
    const params = render.params as VariantParams;
    expect(params.openerClipId).toBe(opener.id);
    expect(params.hookText).toBe("ניסיתי מיליון דברים");
    // No customer rect: the opener's registered safe area is what burns.
    expect(params.hookTextSafeArea).toEqual(OPENER_RECT);
    // The resolved default is pinned — a default that moves later must not
    // change what HeyGen animates against this opener.
    expect(params.personaImageId).toBe(image.id);

    // A customer-placed rect wins over the clip's.
    const moved = await createBRender(db, {
      businessId,
      audioRenderId: audioId,
      personaId: persona.id,
      openerClipId: opener.id,
      hookText: "ניסיתי מיליון דברים",
      hookTextSafeArea: { x: 100, y: 1000, w: 880, h: 200 },
    });
    expect((moved.params as VariantParams).hookTextSafeArea).toEqual({
      x: 100,
      y: 1000,
      w: 880,
      h: 200,
    });

    // Over the caps: refused, never trimmed.
    await expect(
      createBRender(db, {
        businessId,
        audioRenderId: audioId,
        personaId: persona.id,
        openerClipId: opener.id,
        hookText: "אחת שתיים שלוש ארבע חמש שש שבע שמונה תשע",
      }),
    ).rejects.toThrow(/9 words/);
    await drainAll();
  });

  it("a reclaimed lipsync job polls its providerJobId instead of resubmitting", async () => {
    // The regeneration test above leaves its re-roll's lipsync job queued —
    // consume it on the default dry-run provider before counting submits.
    await drainAll();

    let submits = 0;
    setLipsyncProvider({
      async submit() {
        submits++;
        return { providerJobId: `resume_${submits}` };
      },
      async poll() {
        return { status: "done" as const, videoUrl: "dryrun://clip" };
      },
    });

    const { renderId } = await queueBRender();
    await lanePass(); // submit hop: checkpoint persisted providerJobId, job rescheduled
    expect(submits).toBe(1);

    // The worker dies mid-poll hop: the job sits at `running` past the lease.
    const job = (await lipsyncJob(renderId))!;
    await db.execute(
      sql`update jobs set status = 'running', locked_by = 'died-mid-poll',
        locked_at = now() - interval '31 minutes' where id = ${job.id}`,
    );

    expect(await recoverExpiredLeases(db)).toBe(1);
    await makeRunnable();
    await drainAll();

    // The checkpoint made the reclaim safe: it resumed polling — one GPU spend.
    expect(submits).toBe(1);
    expect((await renderRow(renderId)).status).toBe("qc_pending");
  });
});
