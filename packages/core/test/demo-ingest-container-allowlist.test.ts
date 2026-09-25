import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import { buildHandlers } from "../src/handlers";
import { runLane } from "../src/jobs/worker";
import { createBusiness } from "../src/pipelines/businesses";
import { createDemo } from "../src/pipelines/demos";
import { setStorage } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import { tempStorage } from "./helpers/storage";

const exec = promisify(execFile);

/**
 * INP-08 control (b), real ffmpeg/ffprobe, DRY_RUN off (handleIngestDemo's
 * DRY_RUN branch never calls probe/normalizeVideo at all, so this suite must
 * run the live path). T3: a well-formed file with a genuine video stream, in
 * a container outside the allow-list, is rejected at ingest — before any
 * transcode. T4 (guard): a normal mp4 and a webm — the two families the
 * allow-list actually names — pass, unchanged from before this fix.
 */

const dir = path.join(tmpdir(), "aiugc-demo-ingest-allowlist");
// Vertical (9:16-ish), 9s — inside DEMO_MIN/MAX_DURATION_MS (8s/90s) and past
// the height>width sanity check, so a rejection in these two fixtures could
// only come from the container check itself.
const mp4Fixture = path.join(dir, "vertical.mp4");
const webmFixture = path.join(dir, "vertical.webm");
// A real video stream (mpeg4, has width/height) in a container the allow-list
// does not name — never audio-only, which probe() already rejects today.
// Same vertical dims and duration as the two guard fixtures above, so on the
// UNMODIFIED tree this file passes every existing check (aspect, duration)
// and reaches normalizeVideo — isolating the container check as the only
// thing that can make T3 fail once the fix lands.
const aviFixture = path.join(dir, "clip.avi");

beforeAll(async () => {
  mkdirSync(dir, { recursive: true });
  await exec("ffmpeg", [
    ...["-y", "-f", "lavfi", "-i", "color=c=gray:s=96x170:r=5:d=9"],
    ...["-pix_fmt", "yuv420p", "-c:v", "libx264", mp4Fixture],
  ]);
  await exec("ffmpeg", [
    ...["-y", "-f", "lavfi", "-i", "color=c=gray:s=96x170:r=5:d=9"],
    ...["-pix_fmt", "yuv420p", "-c:v", "libvpx-vp9", webmFixture],
  ]);
  await exec("ffmpeg", [
    ...["-y", "-f", "lavfi", "-i", "color=c=green:s=96x170:r=5:d=9"],
    ...["-pix_fmt", "yuv420p", "-c:v", "mpeg4", aviFixture],
  ]);
}, 60_000);

describe("demo ingest container allow-list (INP-08 control b, real ffmpeg, DRY_RUN off)", () => {
  let db: Db;
  let pg: { close(): Promise<void> };
  let cleanupStorage: () => void;

  beforeAll(async () => {
    delete process.env.DRY_RUN; // the live path — DRY_RUN fakes ingest and never touches ffmpeg
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
    process.env.DRY_RUN = "1"; // restore the suite-wide default
    resetEnvCache();
    await pg.close();
  });

  async function ingest(filePath: string) {
    const business = await createBusiness(db, {
      ownerEmail: `ingest-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      name: "עסק לבדיקה",
      ownerRole: "admin",
    });
    const demo = await createDemo(db, { businessId: business.id, filePath });
    await runLane(db, { workerId: "test", handlers: buildHandlers(), drainAndExit: true });
    const rows = await db.select().from(dbSchema.demos).where(eq(dbSchema.demos.id, demo.id));
    return rows[0]!;
  }

  it("T3: an AVI with a genuine video stream — container outside the allow-list — is rejected at ingest, and normalizeVideo never runs", async () => {
    const row = await ingest(aviFixture);
    expect(row.status).toBe("rejected");
    expect(row.rejectReason).toBe("הקובץ לא מכיל וידאו תקין");
    // normalizeVideo only ever runs after this check and only sets
    // normalizedPath on success — still null is the observable proof it
    // never ran.
    expect(row.normalizedPath).toBeNull();
  });

  it("T4 (guard): a normal mp4 passes ingest validation unchanged", async () => {
    const row = await ingest(mp4Fixture);
    expect(row.status).toBe("ready");
    expect(row.normalizedPath).not.toBeNull();
  });

  it("T4 (guard): a webm passes ingest validation unchanged", async () => {
    const row = await ingest(webmFixture);
    expect(row.status).toBe("ready");
    expect(row.normalizedPath).not.toBeNull();
  });
});
