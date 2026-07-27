import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db";
import { appConfig } from "../src/db/schema";
import { PermanentError } from "../src/jobs/errors";
import { GPU_COST_AGOROT_PER_SECOND, lipsyncSettings } from "../src/pipelines/renders";
import { framesForAudio, LIPSYNC_MAX_FRAMES, LIPSYNC_MIN_FRAMES } from "../src/providers/lipsync";
import { createTestDb } from "./helpers/pglite";

/**
 * The first paid render came back 5.8s long for a 10s script: fal renders
 * `num_frames` (default 145) and does not extend to the audio. These pin the
 * derivation that replaced the default — no live API is touched.
 */

describe("framesForAudio", () => {
  const FPS = 25;

  it("derives the frame count from the audio duration", () => {
    expect(framesForAudio(8_000, FPS)).toBe(200);
    expect(framesForAudio(15_000, FPS)).toBe(375);
    expect(framesForAudio(10_000, FPS)).toBe(250); // the render that got truncated at 145
  });

  it("rounds to the nearest frame", () => {
    expect(framesForAudio(8_020, FPS)).toBe(201); // 200.5 → 201
    expect(framesForAudio(8_010, FPS)).toBe(200); // 200.25 → 200
  });

  it("clamps up to the schema minimum for very short audio", () => {
    expect(framesForAudio(500, FPS)).toBe(LIPSYNC_MIN_FRAMES);
    expect(framesForAudio(1_640, FPS)).toBe(LIPSYNC_MIN_FRAMES); // exactly 41
    expect(framesForAudio(2_000, FPS)).toBe(50);
  });

  it("throws PermanentError past the schema maximum instead of truncating", () => {
    expect(() => framesForAudio(30_000, FPS)).toThrow(PermanentError);
    expect(() => framesForAudio(30_000, FPS)).toThrow(/28/); // max seconds, in Hebrew
  });

  it("accepts audio right up to the maximum", () => {
    expect(framesForAudio(28_840, FPS)).toBe(LIPSYNC_MAX_FRAMES);
    expect(() => framesForAudio(28_860, FPS)).toThrow(PermanentError);
  });

  it("follows the configured fps", () => {
    expect(framesForAudio(10_000, 30)).toBe(300);
    expect(() => framesForAudio(28_000, 30)).toThrow(PermanentError); // 840 > 721
  });
});

describe("GPU_COST_AGOROT_PER_SECOND", () => {
  it("charges 720p at double the 480p rate", () => {
    expect(GPU_COST_AGOROT_PER_SECOND["480p"]).toBe(75);
    expect(GPU_COST_AGOROT_PER_SECOND["720p"]).toBe(150);
  });

  it("makes a 10s render cost differently per resolution", () => {
    expect(10 * GPU_COST_AGOROT_PER_SECOND["480p"]).toBe(750);
    expect(10 * GPU_COST_AGOROT_PER_SECOND["720p"]).toBe(1_500);
  });
});

describe("lipsyncSettings", () => {
  let db: Db;
  let pg: { close(): Promise<void> };

  beforeAll(async () => {
    const testDb = await createTestDb();
    db = testDb.db;
    pg = testDb.pg;
  });

  afterAll(async () => {
    await pg.close();
  });

  it("defaults to 25fps / 720p when the app_config rows are absent", async () => {
    expect(await lipsyncSettings(db)).toEqual({ fps: 25, resolution: "720p" });
  });

  it("reads the rows when they exist (480p is one INSERT, no deploy)", async () => {
    await db.insert(appConfig).values([
      { key: "lipsync_fps", value: 30 },
      { key: "lipsync_resolution", value: "480p" },
    ]);
    expect(await lipsyncSettings(db)).toEqual({ fps: 30, resolution: "480p" });
  });
});
