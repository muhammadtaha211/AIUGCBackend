import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import { buildHandlers } from "../src/handlers";
import { DEFAULT_POLL_DEADLINE_SECONDS } from "../src/jobs/poll";
import { runLane } from "../src/jobs/worker";
import { addPersona, addPersonaImage } from "../src/pipelines/bank";
import { createBusiness } from "../src/pipelines/businesses";
import { rejectRender } from "../src/pipelines/qc";
import { createBRender, type VariantParams } from "../src/pipelines/sets";
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

  /** A Service B render with approved audio, queued at the lipsync step. */
  async function queueBRender(): Promise<{ renderId: string; audioId: string }> {
    const persona = await addPersona(db, { name: "נועה", voiceId: "voice_noa" });
    await addPersonaImage(db, { personaId: persona.id, filePath: tempFile("persona.jpg") });
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
    const audio = await requestAudio(db, { scriptId: script.id, voiceId: "voice_noa" });
    await drainAll();
    await approveAudio(db, audio.id);
    const render = await createBRender(db, {
      businessId,
      audioRenderId: audio.id,
      personaId: persona.id,
    });
    return { renderId: render.id, audioId: audio.id };
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
    cleanupStorage = ts.cleanup;
    const business = await createBusiness(db, {
      ownerEmail: "founder@example.com",
      name: "מסעדת הבית",
      ownerRole: "admin",
    });
    businessId = business.id;
  });

  afterEach(async () => {
    setLipsyncProvider(undefined);
    // Restore every app_config row a test touches, so no test depends on
    // which tests ran before it.
    await db
      .update(dbSchema.appConfig)
      .set({ value: false })
      .where(sql`${dbSchema.appConfig.key} = 'auto_release_b'`);
  });

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

    // Service B still lands in the founder QC queue by default.
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
    expect(job.lastError).toMatch(/חורג מהמגבלה/);

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
    const { renderId } = await queueBRender();
    await drainAll();
    const params = await paramsOf(renderId);
    expect(params.lipsyncPath).toBeDefined();

    const { regeneratedRenderId } = await rejectRender(db, renderId, "עיניים מוזרות");
    expect(regeneratedRenderId).toBeDefined();

    const retry = await paramsOf(regeneratedRenderId!);
    // HeyGen is deterministic on identical inputs — the retry only re-renders;
    // what must NOT carry over is the rejected render's stored clip path.
    expect(retry.lipsyncPath).toBeUndefined();
    expect(retry.audioRenderId).toBe(params.audioRenderId);
    expect(retry.personaId).toBe(params.personaId);
  });
});
