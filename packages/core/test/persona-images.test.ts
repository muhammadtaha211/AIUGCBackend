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
import {
  addHookClip,
  addPersona,
  addPersonaImage,
  setDefaultPersonaImage,
  setPersonaImageRetired,
} from "../src/pipelines/bank";
import { createBusiness, setQuestionnaire } from "../src/pipelines/businesses";
import { createComposite } from "../src/pipelines/composites";
import { setImagegenProvider } from "../src/providers/imagegen";
import { missingObjectError, setStorage, type Storage } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import { tempStorage } from "./helpers/storage";

/**
 * A persona_images row is inserted with the "pending" placeholder to mint an
 * id for the storage key, then uploaded, then updated (hook clips share the
 * pattern). These tests pin down the guarantees around it: composites never
 * consume a placeholder (and put the default image first), a failed upload
 * deletes the row it minted, and the default flag only moves after a
 * successful upload.
 */

describe("persona images (placeholder rows, upload cleanup)", () => {
  let db: Db;
  let pg: { close(): Promise<void> };
  let storage: Storage;
  let cleanupStorage: () => void;

  async function lanePass(): Promise<void> {
    await runLane(db, { workerId: "test", handlers: buildHandlers(), drainAndExit: true });
  }

  async function makeRunnable(): Promise<void> {
    await db.execute(
      sql`update jobs set run_at = now() - interval '1 second' where status = 'queued'`,
    );
  }

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

  function tempFile(name: string): string {
    const dir = path.join(tmpdir(), "aiugc-persona-image-inputs");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    writeFileSync(file, "fake bytes");
    return file;
  }

  /** A storage backend whose uploads always fail; reads pass through. */
  function failingStorage(): Storage {
    return {
      async put() {
        throw new Error("disk full");
      },
      download: storage.download,
      remove: storage.remove,
      signedUrl: storage.signedUrl,
      createSignedUploadUrl: storage.createSignedUploadUrl,
    };
  }

  /** Composites are physical-product only; each test gets its own business. */
  async function physicalBusiness(name: string) {
    const shop = await createBusiness(db, {
      ownerEmail: "founder@example.com",
      name,
      ownerRole: "admin",
    });
    await setQuestionnaire(db, shop.id, {
      category: "physical_product",
      product_name: name,
      what_it_does: "קרם לחות טבעי לעור רגיש",
      advantages: ["רכיבים טבעיים בלבד"],
      target_audience: "נשים 25-45",
      tone: "friendly",
    });
    return shop;
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
    setImagegenProvider(undefined);
    setStorage(storage);
  });

  afterAll(async () => {
    setStorage(undefined);
    cleanupStorage();
    await pg.close();
  });

  it("a composite skips placeholder rows and sends the default reference first", async () => {
    const shop = await physicalBusiness("קרם הפנים");
    const persona = await addPersona(db, { name: "דנה", voiceId: "voice_dana" });
    // A placeholder stranded by a failed upload before the cleanup existed
    // (oldest row — an unordered LIMIT would have picked it up).
    await db.insert(dbSchema.personaImages).values({ personaId: persona.id, filePath: "pending" });
    const defaultImage = await addPersonaImage(db, {
      personaId: persona.id,
      filePath: tempFile("face.jpg"),
      isDefault: true,
    });
    const extraImage = await addPersonaImage(db, {
      personaId: persona.id,
      filePath: tempFile("face2.jpg"),
    });
    expect(defaultImage.isDefault).toBe(true);
    expect(extraImage.isDefault).toBe(false);

    const submits: string[][] = [];
    setImagegenProvider({
      async submit(input) {
        submits.push(input.imageUrls);
        return { providerJobId: "imggen_1" };
      },
      async poll() {
        return { status: "done", imageUrl: "dryrun://imagegen/imggen_1.png" };
      },
    });

    const composite = await createComposite(db, {
      businessId: shop.id,
      personaId: persona.id,
      productImageFile: tempFile("product.jpg"),
    });
    await drainAll();

    // Only the two uploaded references, default first, then the product photo.
    expect(submits).toHaveLength(1);
    expect(submits[0]).toEqual([
      await storage.signedUrl(defaultImage.filePath, 3600),
      await storage.signedUrl(extraImage.filePath, 3600),
      await storage.signedUrl(composite.productImagePath!, 3600),
    ]);

    const row = (
      await db
        .select()
        .from(dbSchema.composites)
        .where(sql`${dbSchema.composites.id} = ${composite.id}`)
    )[0]!;
    expect(row.status).toBe("ready");
  });

  it("a persona with only placeholder rows fails permanently on the first attempt", async () => {
    const shop = await physicalBusiness("שמן זית");
    const persona = await addPersona(db, { name: "יעל", voiceId: "voice_yael" });
    await db
      .insert(dbSchema.personaImages)
      .values({ personaId: persona.id, filePath: "pending", isDefault: true });

    setImagegenProvider({
      async submit() {
        throw new Error("submit must not be called for a persona with no usable image");
      },
      async poll() {
        throw new Error("poll must not be called for a persona with no usable image");
      },
    });

    const composite = await createComposite(db, {
      businessId: shop.id,
      personaId: persona.id,
      productImageFile: tempFile("product2.jpg"),
    });
    await lanePass();

    const job = (await jobByKey(`composite:${composite.id}`))!;
    expect(job.status).toBe("failed");
    expect(job.errorClass).toBe("permanent");
    expect(job.attempts).toBe(0);
    expect(job.lastError).toMatch(/תמונת ייחוס/);

    const row = (
      await db
        .select()
        .from(dbSchema.composites)
        .where(sql`${dbSchema.composites.id} = ${composite.id}`)
    )[0]!;
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/תמונת ייחוס/);
  });

  it("a failed upload leaves no persona_images row behind", async () => {
    const persona = await addPersona(db, { name: "רות", voiceId: "voice_rut" });
    setStorage(failingStorage());

    await expect(
      addPersonaImage(db, { personaId: persona.id, filePath: tempFile("face3.jpg") }),
    ).rejects.toThrow("disk full");

    const rows = await db
      .select()
      .from(dbSchema.personaImages)
      .where(sql`${dbSchema.personaImages.personaId} = ${persona.id}`);
    expect(rows).toHaveLength(0);
  });

  it("a failed --default upload leaves the previous default still flagged", async () => {
    const persona = await addPersona(db, { name: "מיכל", voiceId: "voice_michal" });
    const original = await addPersonaImage(db, {
      personaId: persona.id,
      filePath: tempFile("face4.jpg"),
    });
    expect(original.isDefault).toBe(true); // first image becomes the default
    setStorage(failingStorage());

    await expect(
      addPersonaImage(db, {
        personaId: persona.id,
        filePath: tempFile("face5.jpg"),
        isDefault: true,
      }),
    ).rejects.toThrow("disk full");

    const rows = await db
      .select()
      .from(dbSchema.personaImages)
      .where(sql`${dbSchema.personaImages.personaId} = ${persona.id}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(original.id);
    expect(rows[0]!.isDefault).toBe(true);
  });

  it("a failed hook clip upload leaves no hook_clips row behind", async () => {
    setStorage(failingStorage());

    await expect(
      addHookClip(db, {
        filePath: tempFile("hook.mp4"),
        durationMs: 2000,
        textSafeArea: { x: 100, y: 200, w: 880, h: 400 },
      }),
    ).rejects.toThrow("disk full");

    const rows = await db.select().from(dbSchema.hookClips);
    expect(rows).toHaveLength(0);
  });

  it("uploads raw bytes (web admin) through the same storage path as a local file", async () => {
    const persona = await addPersona(db, { name: "שירה", voiceId: "voice_shira" });
    const image = await addPersonaImage(db, {
      personaId: persona.id,
      bytes: Buffer.from("jpeg bytes from the browser"),
      extension: ".jpg",
    });
    expect(image.filePath).toMatch(/^assets\/bank\/persona_image\/.*\/image\.jpg$/);
    expect(image.isDefault).toBe(true); // first image still becomes the default
    const url = await storage.signedUrl(image.filePath, 60);
    expect(url).toContain("image.jpg");
  });

  it("setDefaultPersonaImage moves the flag and refuses retired or pending images", async () => {
    const persona = await addPersona(db, { name: "תמר", voiceId: "voice_tamar" });
    const first = await addPersonaImage(db, {
      personaId: persona.id,
      filePath: tempFile("t1.jpg"),
    });
    const second = await addPersonaImage(db, {
      personaId: persona.id,
      filePath: tempFile("t2.jpg"),
    });
    expect(first.isDefault).toBe(true);
    expect(second.isDefault).toBe(false);

    await setDefaultPersonaImage(db, second.id);
    const rows = await db
      .select()
      .from(dbSchema.personaImages)
      .where(sql`${dbSchema.personaImages.personaId} = ${persona.id}`);
    expect(rows.find((r) => r.id === first.id)!.isDefault).toBe(false);
    expect(rows.find((r) => r.id === second.id)!.isDefault).toBe(true);

    await setPersonaImageRetired(db, first.id, true);
    await expect(setDefaultPersonaImage(db, first.id)).rejects.toThrow(/is retired/);

    const pending = (
      await db
        .insert(dbSchema.personaImages)
        .values({ personaId: persona.id, filePath: "pending" })
        .returning()
    )[0]!;
    await expect(setDefaultPersonaImage(db, pending.id)).rejects.toThrow(/no stored file/);
  });

  it("retire is refused on the current default; any other image retires and comes back", async () => {
    const persona = await addPersona(db, { name: "אביגיל", voiceId: "voice_avigail" });
    const defaultImage = await addPersonaImage(db, {
      personaId: persona.id,
      filePath: tempFile("a1.jpg"),
    });
    const extra = await addPersonaImage(db, {
      personaId: persona.id,
      filePath: tempFile("a2.jpg"),
    });

    await expect(setPersonaImageRetired(db, defaultImage.id, true)).rejects.toThrow(
      /cannot retire the default/,
    );

    await setPersonaImageRetired(db, extra.id, true);
    let row = (
      await db
        .select()
        .from(dbSchema.personaImages)
        .where(sql`${dbSchema.personaImages.id} = ${extra.id}`)
    )[0]!;
    expect(row.retired).toBe(true);

    await setPersonaImageRetired(db, extra.id, false);
    row = (
      await db
        .select()
        .from(dbSchema.personaImages)
        .where(sql`${dbSchema.personaImages.id} = ${extra.id}`)
    )[0]!;
    expect(row.retired).toBe(false);
  });

  it("the missing-object message keeps the storage path out of the user text", () => {
    const storagePath = "assets/1b2c3d4e-0000-0000-0000-000000000000/demo/abc/video.mp4";
    const err = missingObjectError(storagePath);
    expect(err).toBeInstanceOf(PermanentError);
    expect(err.message).toMatch(/קובץ המקור לא נמצא/);
    expect(err.message).not.toContain("/");
    expect(err.message).not.toContain(storagePath);
    // The path survives on the error itself for the worker's { err } log line.
    expect((err as PermanentError & { storagePath?: string }).storagePath).toBe(storagePath);
  });
});
