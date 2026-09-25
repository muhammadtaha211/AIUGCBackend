import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * INP-08 follow-up: a file-only protocol whitelist still lets a whitelisted
 * container reference other local files, so the demuxer allow-list has to
 * cover EVERY read of the raw customer upload, not just the first probe() —
 * checking with a restricted demuxer set and then transcoding with an
 * unrestricted one is a check-then-use gap. This drives the real ingest job
 * (spawn mocked, DB/storage real) and inspects every spawned argv, proving
 * demos.ts actually WIRES the allow-list into normalizeVideo()'s call — not
 * just that normalizeVideo() can accept one in isolation
 * (ffmpeg-protocol-whitelist-spawn.test.ts covers that unit already).
 */

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({ spawn: (...args: unknown[]) => spawnMock(...args) }));

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

type FakeProc = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };

// height > width (vertical) and duration inside DEMO_MIN/MAX_DURATION_MS
// (8s/90s) so the mocked flow clears every pre-existing sanity check and
// reaches normalizeVideo()/thumbnail() — the point of this test.
const okProbeJson = JSON.stringify({
  streams: [{ codec_type: "video", width: 10, height: 20, avg_frame_rate: "10/1" }],
  format: { duration: "20.0" },
});

function fakeProcess(bin: string, args: string[]): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  queueMicrotask(() => {
    if (bin === "ffprobe") {
      proc.stdout.emit("data", Buffer.from(okProbeJson, "utf8"));
    } else {
      // ffmpeg: the mock never actually transcodes, but the ingest handler
      // uploads whatever lands at the output path afterward — stand in a file.
      const outPath = args.at(-1)!;
      mkdirSync(path.dirname(outPath), { recursive: true });
      writeFileSync(outPath, Buffer.from([0]));
    }
    proc.emit("close", 0);
  });
  return proc;
}

describe("demo ingest wires the demuxer allow-list into every raw-upload spawn (spawn mocked)", () => {
  let db: Db;
  let pg: { close(): Promise<void> };
  let cleanupStorage: () => void;
  let rawFile: string;

  beforeAll(async () => {
    spawnMock.mockImplementation((bin: string, args: string[]) => fakeProcess(bin, args));
    delete process.env.DRY_RUN; // the live path — DRY_RUN fakes ingest and never spawns ffmpeg
    resetEnvCache();
    const testDb = await createTestDb();
    db = testDb.db;
    pg = testDb.pg;
    const ts = tempStorage();
    setStorage(ts.storage);
    cleanupStorage = ts.cleanup;

    const dir = path.join(tmpdir(), "aiugc-ingest-wiring-fixture");
    mkdirSync(dir, { recursive: true });
    rawFile = path.join(dir, "raw.mp4");
    writeFileSync(rawFile, Buffer.from([0])); // never actually read — spawn is mocked
  });

  afterAll(async () => {
    setStorage(undefined);
    cleanupStorage();
    process.env.DRY_RUN = "1"; // restore the suite-wide default
    resetEnvCache();
    await pg.close();
  });

  it("probe() and normalizeVideo() both carry the demuxer allow-list; thumbnail() does not (it reads the already-normalized file, not raw customer bytes)", async () => {
    const business = await createBusiness(db, {
      ownerEmail: `wiring-${Date.now()}@example.com`,
      name: "עסק לבדיקה",
      ownerRole: "admin",
    });
    const demo = await createDemo(db, { businessId: business.id, filePath: rawFile });
    await runLane(db, { workerId: "test", handlers: buildHandlers(), drainAndExit: true });

    const rows = await db.select().from(dbSchema.demos).where(eq(dbSchema.demos.id, demo.id));
    expect(rows[0]!.status).toBe("ready"); // sanity: the mocked flow actually completed

    const calls = spawnMock.mock.calls as [string, string[]][];
    const ffprobeCalls = calls.filter(([bin]) => bin === "ffprobe");
    const ffmpegCalls = calls.filter(([bin]) => bin === "ffmpeg");
    expect(ffprobeCalls).toHaveLength(1); // the raw upload's probe
    expect(ffmpegCalls).toHaveLength(2); // normalizeVideo, then thumbnail, in that order

    for (const [, args] of ffprobeCalls) {
      expect(args).toContain("-format_whitelist");
    }
    const [normalizeArgs, thumbnailArgs] = ffmpegCalls.map(([, args]) => args);
    expect(normalizeArgs).toContain("-format_whitelist"); // reads the RAW file — must carry it
    expect(thumbnailArgs).not.toContain("-format_whitelist"); // reads the NORMALIZED file — out of scope
  });
});
