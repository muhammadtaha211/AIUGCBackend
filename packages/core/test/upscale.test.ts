import { sql } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import { buildHandlers } from "../src/handlers";
import { PermanentError } from "../src/jobs/errors";
import { runLane } from "../src/jobs/worker";
import { addPersona, addPersonaImage } from "../src/pipelines/bank";
import { createBusiness } from "../src/pipelines/businesses";
import { rejectRender } from "../src/pipelines/qc";
import { upscaleFactorFor } from "../src/pipelines/renders";
import { createBRender, type VariantParams } from "../src/pipelines/sets";
import { approveAudio, requestAudio } from "../src/pipelines/tts";
import {
  setUpscaleProvider,
  type UpscaleProvider,
  type UpscaleSubmitInput,
} from "../src/providers/upscale";
import { setStorage } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import { tempStorage } from "./helpers/storage";

/**
 * The Topaz Starlight step between lipsync and assembly. The upscale is cheap
 * relative to the GPU render it sharpens, so its failure policy is the inverse
 * of lipsync's: resubmit freely, and never let it cost the customer the render.
 */

describe("upscaleFactorFor", () => {
  it("takes a 480p plate to 1080 wide", () => {
    expect(upscaleFactorFor(480)).toBe(2.25);
  });

  it("takes a 720p plate to 1080 wide", () => {
    expect(upscaleFactorFor(720)).toBe(1.5);
  });

  it("returns 1 (skip) for a plate already at the output width or wider", () => {
    expect(upscaleFactorFor(1080)).toBe(1);
    expect(upscaleFactorFor(1440)).toBe(1);
    expect(upscaleFactorFor(1920)).toBe(1);
  });

  it("floors the factor — output above 1080p costs 4x and gets scaled back down", () => {
    expect(upscaleFactorFor(640)).toBe(1.68); // 1.6875 → 1.68, not 1.69
    expect(upscaleFactorFor(576)).toBe(1.87); // 1.875 → 1.87, not 1.88
    expect(upscaleFactorFor(640) * 640).toBeLessThanOrEqual(1080);
    expect(upscaleFactorFor(576) * 576).toBeLessThanOrEqual(1080);
  });

  it("clamps at 4x (fal's maximum)", () => {
    expect(upscaleFactorFor(240)).toBe(4);
    expect(upscaleFactorFor(200)).toBe(4);
  });
});

describe("upscale pipeline (dry-run, real DB + jobs + storage)", () => {
  let db: Db;
  let pg: { close(): Promise<void> };
  let cleanupStorage: () => void;
  let businessId: string;

  /** Drain the queue, fast-forwarding rescheduled (polling) and retried jobs. */
  async function drainAll(): Promise<void> {
    for (let i = 0; i < 12; i++) {
      await runLane(db, { workerId: "test", handlers: buildHandlers(), drainAndExit: true });
      const queued = await db
        .select()
        .from(dbSchema.jobs)
        .where(sql`${dbSchema.jobs.status} = 'queued'`);
      if (queued.length === 0) return;
      await db.execute(
        sql`update jobs set run_at = now() - interval '1 second' where status = 'queued'`,
      );
    }
    throw new Error("queue did not drain");
  }

  function tempFile(name: string): string {
    const dir = path.join(tmpdir(), "aiugc-upscale-inputs");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    writeFileSync(file, "fake bytes");
    return file;
  }

  /** A Service B render with approved audio, queued at the lipsync step. */
  async function queueBRender(): Promise<string> {
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
    return render.id;
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

  async function upscaleJob(videoRenderId: string) {
    const rows = await db
      .select()
      .from(dbSchema.jobs)
      .where(sql`${dbSchema.jobs.idempotencyKey} = ${`upscale:${videoRenderId}`}`);
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
    setUpscaleProvider(undefined);
    // The fallback test flips auto_release_b on; restore the seed default so
    // no test depends on which tests ran before it.
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

  it("keeps both files: the plate and the upscaled clip Remotion composes", async () => {
    const renderId = await queueBRender();
    await drainAll();

    const params = await paramsOf(renderId);
    expect(params.lipsyncPlatePath).toMatch(/^renders\/.*lipsync-plate\.mp4$/);
    expect(params.lipsyncPath).toMatch(/^renders\/.*lipsync-upscaled\.mp4$/);
    expect(params.lipsyncPath).not.toBe(params.lipsyncPlatePath);
    expect(params.upscaleError).toBeUndefined();
    expect((await renderRow(renderId)).status).toBe("qc_pending");
  });

  it("generates the lipsync seed once and persists it before the submit", async () => {
    const renderId = await queueBRender();
    expect((await paramsOf(renderId)).seed).toBeUndefined();
    await drainAll();

    const seed = (await paramsOf(renderId)).seed;
    expect(typeof seed).toBe("number");
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(2_147_483_647);
    expect(Number.isInteger(seed)).toBe(true);
  });

  it("reuses a seed that is already on the render instead of overwriting it", async () => {
    const renderId = await queueBRender();
    const params = await paramsOf(renderId);
    await db
      .update(dbSchema.videoRenders)
      .set({ params: { ...params, seed: 4242 } })
      .where(sql`${dbSchema.videoRenders.id} = ${renderId}`);

    await drainAll();
    expect((await paramsOf(renderId)).seed).toBe(4242);
  });

  it("resubmits with a fresh signed url after a failed poll (provider job id cleared)", async () => {
    const submits: UpscaleSubmitInput[] = [];
    let polls = 0;
    const provider: UpscaleProvider = {
      async submit(input) {
        submits.push(input);
        return { providerJobId: `job_${submits.length}` };
      },
      async poll() {
        polls++;
        return polls === 1
          ? { status: "failed", reason: "input url expired" }
          : { status: "done", videoUrl: "dryrun://upscale/retried.mp4" };
      },
    };
    setUpscaleProvider(provider);

    const renderId = await queueBRender();
    // Run only as far as the first failed poll: lipsync submit -> lipsync poll ->
    // upscale submit -> upscale poll (failed) -> transient retry, one lane pass
    // per hop because each hop reschedules itself into the future.
    let failed = await upscaleJob(renderId);
    for (let i = 0; i < 6 && !failed?.attempts; i++) {
      await runLane(db, { workerId: "test", handlers: buildHandlers(), drainAndExit: true });
      failed = await upscaleJob(renderId);
      if (failed?.attempts) break;
      await db.execute(
        sql`update jobs set run_at = now() - interval '1 second' where status = 'queued'`,
      );
    }

    expect(failed).toBeDefined();
    const state = failed!.state as { providerJobId?: string; platePath?: string };
    expect(state.providerJobId).toBeUndefined();
    // The plate stays in state, so the resubmit signs the stored file again.
    expect(state.platePath).toMatch(/^renders\//);
    expect(failed!.attempts).toBe(1);
    expect(failed!.lastError).toMatch(/input url expired/);

    await drainAll();
    expect(submits).toHaveLength(2);
    expect(submits[1]!.videoUrl).toContain("lipsync-plate.mp4");
    expect(submits[1]!.upscaleFactor).toBe(2.25);
    expect((await paramsOf(renderId)).lipsyncPath).toMatch(/lipsync-upscaled\.mp4$/);
  });

  it("falls back to the plate on a permanent failure and holds the render for QC", async () => {
    await db
      .update(dbSchema.appConfig)
      .set({ value: true })
      .where(sql`${dbSchema.appConfig.key} = 'auto_release_b'`);
    setUpscaleProvider({
      async submit() {
        throw new PermanentError("fal 400: invalid upscale_factor");
      },
      async poll() {
        return { status: "pending" };
      },
    });

    const renderId = await queueBRender();
    await drainAll();

    const params = await paramsOf(renderId);
    // The 480p plate is what Remotion composed, and why is on the record.
    expect(params.lipsyncPath).toBe(params.lipsyncPlatePath);
    expect(params.upscaleError).toMatch(/invalid upscale_factor/);

    const row = await renderRow(renderId);
    // auto_release_b is on, and a degraded render still does not auto-release.
    expect(row.status).toBe("qc_pending");
    expect(row.releasedAt).toBeNull();
    expect(row.filePath).toMatch(/^renders\//);
  });

  it("a QC regeneration re-rolls: no seed, clip paths, or upscale error on the new params", async () => {
    const renderId = await queueBRender();
    await drainAll();
    const params = await paramsOf(renderId);
    // Plant an upscaleError too, so all four stripped keys are exercised.
    await db
      .update(dbSchema.videoRenders)
      .set({ params: { ...params, upscaleError: "fal 400: something" } })
      .where(sql`${dbSchema.videoRenders.id} = ${renderId}`);

    const { regeneratedRenderId } = await rejectRender(db, renderId, "עיניים מוזרות");
    expect(regeneratedRenderId).toBeDefined();

    const retry = await paramsOf(regeneratedRenderId!);
    expect(retry.seed).toBeUndefined();
    expect(retry.lipsyncPlatePath).toBeUndefined();
    expect(retry.lipsyncPath).toBeUndefined();
    expect(retry.upscaleError).toBeUndefined();
    // The inputs that define the take carry over unchanged.
    expect(retry.audioRenderId).toBe(params.audioRenderId);
    expect(retry.personaId).toBe(params.personaId);
  });
});
