import { eq } from "drizzle-orm";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import { WORK_DIR } from "../src/paths";
import { addPersona, addPersonaImage } from "../src/pipelines/bank";
import { setStorage } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import { tempStorage } from "./helpers/storage";

/**
 * 2026-09-02: two admin uploads on Vercel came back as the generic 500 with
 * the bytes landed in both buckets and the row still at "pending" — the blur
 * placeholder's scratch mkdir threw on the read-only filesystem, outside its
 * try/catch. This pins the fix: WORK_DIR is pointed under a regular file so
 * the mkdir cannot succeed, and the upload must still land with a null blur.
 */

// vi.mock is hoisted above every import, so the blocker file is created inside
// the factory — a module-level const would not exist yet when it runs.
vi.mock("../src/paths", async (importOriginal) => {
  const [fs, os, pathMod, original] = await Promise.all([
    import("node:fs"),
    import("node:os"),
    import("node:path"),
    importOriginal<typeof import("../src/paths")>(),
  ]);
  const blocker = pathMod.join(os.tmpdir(), `aiugc-blur-guard-${process.pid}.txt`);
  fs.writeFileSync(blocker, "a regular file: nothing can be created beneath it");
  return { ...original, WORK_DIR: pathMod.join(blocker, "work") };
});

describe("persona image blur placeholder cannot fail the upload", () => {
  let db: Db;
  let pg: { close(): Promise<void> };
  let cleanupStorage: () => void;

  beforeAll(async () => {
    process.env.DRY_RUN = "1";
    resetEnvCache();
    const testDb = await createTestDb();
    db = testDb.db;
    pg = testDb.pg;
    const ts = tempStorage();
    setStorage(ts.storage);
    cleanupStorage = ts.cleanup;
  });

  afterAll(async () => {
    setStorage(undefined);
    cleanupStorage();
    // The blocker file the mock created: WORK_DIR is "<blocker>/work".
    rmSync(path.dirname(WORK_DIR), { force: true });
    await pg.close();
  });

  it("lands the upload with a null blur when the scratch dir cannot be created", async () => {
    // The precondition the whole test rests on — if the mock did not take,
    // fail here instead of passing for the wrong reason.
    expect(() => mkdirSync(path.join(WORK_DIR, "persona-blur"), { recursive: true })).toThrow();

    const persona = await addPersona(db, { name: "ליאת", voiceId: "voice_liat" });
    const image = await addPersonaImage(db, {
      personaId: persona.id,
      bytes: Buffer.from("jpeg bytes from the browser"),
      extension: ".jpg",
    });
    expect(image.filePath).toMatch(/^assets\/bank\/persona_image\//);
    expect(image.catalogPath).toMatch(/^catalog\/bank\/persona_image\//);
    expect(image.blurDataUrl).toBeNull();
    expect(image.isDefault).toBe(true);

    const rows = await db
      .select()
      .from(dbSchema.personaImages)
      .where(eq(dbSchema.personaImages.id, image.id));
    expect(rows[0]!.filePath).not.toBe("pending");
    expect(rows[0]!.filePath).toBe(image.filePath);
    expect(rows[0]!.catalogPath).toBe(image.catalogPath);
  });
});
