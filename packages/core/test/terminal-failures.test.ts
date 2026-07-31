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
import { DEFAULT_POLL_DEADLINE_SECONDS } from "../src/jobs/poll";
import { runLane } from "../src/jobs/worker";
import { addPersona, addPersonaImage } from "../src/pipelines/bank";
import { createBusiness, setQuestionnaire } from "../src/pipelines/businesses";
import { createComposite } from "../src/pipelines/composites";
import { creditBalance, grantPeriod } from "../src/pipelines/credits";
import { createBRender, type VariantParams } from "../src/pipelines/sets";
import { approveAudio, requestAudio } from "../src/pipelines/tts";
import { setLipsyncProvider } from "../src/providers/lipsync";
import { setUpscaleProvider } from "../src/providers/upscale";
import { getStorage, setStorage, type Storage } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import { tempStorage } from "./helpers/storage";

/**
 * The two ways a job must reach a terminal failure instead of spinning:
 * a missing storage object (never appears on retry — fail on the FIRST
 * attempt), and a provider that never finishes a poll (fail once the
 * poll deadline passes, refund, stop rescheduling).
 */

describe("terminal failures (dry-run, real DB + jobs + storage)", () => {
  let db: Db;
  let pg: { close(): Promise<void> };
  let storage: Storage;
  let cleanupStorage: () => void;

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

  /** Drain the queue, fast-forwarding rescheduled (polling) jobs. */
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

  async function jobByKey(idempotencyKey: string) {
    const rows = await db
      .select()
      .from(dbSchema.jobs)
      .where(sql`${dbSchema.jobs.idempotencyKey} = ${idempotencyKey}`);
    return rows[0];
  }

  async function queuedJobs() {
    return db.select().from(dbSchema.jobs).where(sql`${dbSchema.jobs.status} = 'queued'`);
  }

  function tempFile(name: string): string {
    const dir = path.join(tmpdir(), "aiugc-terminal-inputs");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    writeFileSync(file, "fake bytes");
    return file;
  }

  /** A Service B render with approved audio, queued at the lipsync step. */
  async function queueBRender(businessId: string): Promise<string> {
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

  async function renderRow(videoRenderId: string) {
    const rows = await db
      .select()
      .from(dbSchema.videoRenders)
      .where(sql`${dbSchema.videoRenders.id} = ${videoRenderId}`);
    return rows[0]!;
  }

  beforeAll(async () => {
    process.env.DRY_RUN = "1";
    resetEnvCache();
    const testDb = await createTestDb();
    db = testDb.db;
    pg = testDb.pg;
    const ts = tempStorage();
    setStorage(ts.storage);
    storage = ts.storage;
    cleanupStorage = ts.cleanup;
  });

  afterEach(() => {
    setLipsyncProvider(undefined);
    setUpscaleProvider(undefined);
  });

  afterAll(async () => {
    setStorage(undefined);
    cleanupStorage();
    await pg.close();
  });

  it("a composite whose source object is gone fails permanently on the first attempt", async () => {
    const shop = await createBusiness(db, {
      ownerEmail: "founder@example.com",
      name: "קרם הפנים",
      ownerRole: "admin",
    });
    await setQuestionnaire(db, shop.id, {
      category: "physical_product",
      product_name: "קרם הפנים",
      what_it_does: "קרם לחות טבעי לעור רגיש",
      advantages: ["רכיבים טבעיים בלבד"],
      target_audience: "נשים 25-45",
      tone: "friendly",
    });
    const persona = await addPersona(db, { name: "דנה", voiceId: "voice_dana" });
    await addPersonaImage(db, { personaId: persona.id, filePath: tempFile("persona2.jpg") });

    const composite = await createComposite(db, {
      businessId: shop.id,
      personaId: persona.id,
      productImageFile: tempFile("product.jpg"),
    });
    // The upload succeeded, then the object disappeared (deleted, janitored, wrong env).
    await storage.remove(composite.productImagePath!);

    await lanePass();

    // Not "5 retries over 8 minutes": permanent on attempt one, nothing requeued.
    const job = (await jobByKey(`composite:${composite.id}`))!;
    expect(job.status).toBe("failed");
    expect(job.errorClass).toBe("permanent");
    expect(job.attempts).toBe(0);
    expect(job.lastError).toMatch(/קובץ המקור לא נמצא/);
    expect(await queuedJobs()).toHaveLength(0);

    // The user sees "the source file was not found", not a generic failure.
    const row = (
      await db
        .select()
        .from(dbSchema.composites)
        .where(sql`${dbSchema.composites.id} = ${composite.id}`)
    )[0]!;
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/קובץ המקור לא נמצא/);
  });

  it("the local storage backend reports a missing object as PermanentError", async () => {
    // getStorage() with no Supabase env vars builds the filesystem backend; the
    // missing-path probes only read, so the repo's .storage/ is never written.
    const prev = {
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    resetEnvCache();
    setStorage(undefined);
    try {
      const local = getStorage();
      await expect(local.signedUrl("assets/none/missing.mp4", 3600)).rejects.toBeInstanceOf(
        PermanentError,
      );
      await expect(
        local.download("assets/none/missing.mp4", path.join(tmpdir(), "aiugc-none", "out.mp4")),
      ).rejects.toThrow(/קובץ המקור לא נמצא/);
    } finally {
      if (prev.url !== undefined) process.env.SUPABASE_URL = prev.url;
      if (prev.key !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prev.key;
      resetEnvCache();
      setStorage(storage);
    }
  });

  it("lipsync that never finishes fails at the poll deadline, refunds, and stops", async () => {
    // A paying (non-admin) business, so the render debits credits — the refund
    // on terminal failure is the point.
    const biz = await createBusiness(db, { ownerEmail: "customer@example.com", name: "לקוח" });
    const sub = (
      await db
        .insert(dbSchema.subscriptions)
        .values({
          businessId: biz.id,
          planCode: "starter",
          status: "active",
          gatewayRecurringRef: "tok_test",
          currentPeriodStart: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
          currentPeriodEnd: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        })
        .returning()
    )[0]!;
    await grantPeriod(db, { businessId: biz.id, credits: 100, subscriptionId: sub.id });

    let polls = 0;
    setLipsyncProvider({
      async submit() {
        return { providerJobId: "stuck_lipsync_1" };
      },
      async poll() {
        polls++;
        return { status: "pending" };
      },
    });

    const renderId = await queueBRender(biz.id);
    expect(await creditBalance(db, biz.id)).toBeLessThan(100); // debited at enqueue

    // Submit checkpoints the provider job id AND the submit timestamp.
    await lanePass();
    const key = `lipsync:${renderId}`;
    let job = (await jobByKey(key))!;
    let state = job.state as { providerJobId?: string; submittedAt?: number };
    expect(state.providerJobId).toBe("stuck_lipsync_1");
    expect(typeof state.submittedAt).toBe("number");

    // Inside the window a pending poll keeps polling — no attempt consumed.
    await makeRunnable();
    await lanePass();
    job = (await jobByKey(key))!;
    expect(polls).toBe(1);
    expect(job.status).toBe("queued");
    expect(job.attempts).toBe(0);

    // Age the FIRST submit past the window (default 2400s) and poll once more.
    state = job.state as { providerJobId?: string; submittedAt?: number };
    await db
      .update(dbSchema.jobs)
      .set({
        state: { ...state, submittedAt: Date.now() - (DEFAULT_POLL_DEADLINE_SECONDS + 60) * 1000 },
      })
      .where(sql`${dbSchema.jobs.id} = ${job.id}`);
    await makeRunnable();
    await lanePass();

    job = (await jobByKey(key))!;
    expect(job.status).toBe("failed");
    expect(job.errorClass).toBe("permanent");
    expect(job.lastError).toMatch(/לא הסתיים בזמן/);
    expect(await queuedJobs()).toHaveLength(0); // no further rescheduling

    // Terminal-failure path: render failed with the Hebrew message, credits back.
    const render = await renderRow(renderId);
    expect(render.status).toBe("failed");
    expect(render.error).toMatch(/לא הסתיים בזמן/);
    expect(await creditBalance(db, biz.id)).toBe(100);
    const refunds = await db
      .select()
      .from(dbSchema.creditLedger)
      .where(sql`${dbSchema.creditLedger.refId} = ${renderId}`);
    expect(refunds.map((r) => r.reason).sort()).toEqual(["debit_render", "refund_failed"]);
  });

  it("lipsync refuses a stranded default persona image instead of signing it", async () => {
    const biz = await createBusiness(db, {
      ownerEmail: "founder@example.com",
      name: "חנות הפרחים",
      ownerRole: "admin",
    });
    const persona = await addPersona(db, { name: "תמר", voiceId: "voice_tamar" });
    // A placeholder stranded by a failed upload before the cleanup existed,
    // still carrying the default flag.
    await db
      .insert(dbSchema.personaImages)
      .values({ personaId: persona.id, filePath: "pending", isDefault: true });
    const script = (
      await db
        .insert(dbSchema.scripts)
        .values({
          businessId: biz.id,
          personaId: persona.id,
          kind: "b_script",
          text: "ניסיתי מיליון דברים ושום דבר לא עבד עד שגיליתי את זה",
        })
        .returning()
    )[0]!;
    const audio = await requestAudio(db, { scriptId: script.id, voiceId: "voice_tamar" });
    await drainAll();
    await approveAudio(db, audio.id);

    setLipsyncProvider({
      async submit() {
        throw new Error("submit must not be called with a placeholder image");
      },
      async poll() {
        throw new Error("poll must not be called with a placeholder image");
      },
    });

    const render = await createBRender(db, {
      businessId: biz.id,
      audioRenderId: audio.id,
      personaId: persona.id,
    });
    await lanePass();

    const job = (await jobByKey(`lipsync:${render.id}`))!;
    expect(job.status).toBe("failed");
    expect(job.errorClass).toBe("permanent");
    expect(job.attempts).toBe(0);
    expect(job.lastError).toMatch(/no reference images/);
    expect(await queuedJobs()).toHaveLength(0);

    const row = await renderRow(render.id);
    expect(row.status).toBe("failed");
  });

  it("upscale that never finishes hits the deadline and falls back to the plate", async () => {
    const biz = await createBusiness(db, {
      ownerEmail: "founder@example.com",
      name: "מסעדת הבית",
      ownerRole: "admin",
    });
    setUpscaleProvider({
      async submit() {
        return { providerJobId: "stuck_upscale_1" };
      },
      async poll() {
        return { status: "pending" };
      },
    });

    const renderId = await queueBRender(biz.id);
    // Walk lipsync (dry-run) through to the first upscale poll.
    const key = `upscale:${renderId}`;
    let job = await jobByKey(key);
    for (let i = 0; i < 8 && !(job?.state as { providerJobId?: string })?.providerJobId; i++) {
      await lanePass();
      job = await jobByKey(key);
      await makeRunnable();
    }
    const state = job!.state as { providerJobId?: string; submittedAt?: number };
    expect(state.providerJobId).toBe("stuck_upscale_1");
    expect(typeof state.submittedAt).toBe("number");

    await db
      .update(dbSchema.jobs)
      .set({
        state: { ...state, submittedAt: Date.now() - (DEFAULT_POLL_DEADLINE_SECONDS + 60) * 1000 },
      })
      .where(sql`${dbSchema.jobs.id} = ${job!.id}`);
    await makeRunnable();
    await lanePass();

    // Upscale's terminal path is the plate fallback, not a refund: the customer
    // keeps the render (never auto-released) and the timeout is on the record.
    job = (await jobByKey(key))!;
    expect(job.status).toBe("succeeded");
    await drainAll(); // render_video composes the plate

    const render = await renderRow(renderId);
    const params = render.params as VariantParams;
    expect(params.lipsyncPath).toBe(params.lipsyncPlatePath);
    expect(params.upscaleError).toMatch(/לא הסתיים בזמן/);
    expect(render.status).toBe("qc_pending");
    expect(await queuedJobs()).toHaveLength(0);
  });
});
