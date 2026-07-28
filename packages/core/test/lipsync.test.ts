import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/db";
import { appConfig, personas } from "../src/db/schema";
import { PermanentError } from "../src/jobs/errors";
import {
  DEFAULT_LIPSYNC_PROMPT,
  GPU_COST_AGOROT_PER_SECOND,
  lipsyncSettings,
  resolveLipsyncPrompt,
} from "../src/pipelines/renders";
import { framesForAudio, LIPSYNC_MAX_FRAMES, LIPSYNC_MIN_FRAMES } from "../src/providers/lipsync";
import { createTestDb } from "./helpers/pglite";

/**
 * The first paid render came back 5.8s long for a 10s script: fal renders
 * `num_frames` (default 145) and does not extend to the audio. The next two
 * were rejected 422 for the opposite reason — fal wants the audio to outlast
 * the frames by one. These pin the derivation between those two walls; no live
 * API is touched.
 */

describe("framesForAudio", () => {
  const FPS = 25;
  const SAFETY = 2;

  it("leaves fal's required frame of audio headroom (the 422 regression)", () => {
    // Real submit: 276 frames for 11.04s audio → "must be at least 11.08s".
    expect(framesForAudio(11_040, FPS, SAFETY)).toBe(274);
    expect(framesForAudio(11_040, FPS, SAFETY)).not.toBe(276);
  });

  it("derives the frame count from the audio duration", () => {
    expect(framesForAudio(8_000, FPS, SAFETY)).toBe(198);
    expect(framesForAudio(15_000, FPS, SAFETY)).toBe(373);
    expect(framesForAudio(10_000, FPS, SAFETY)).toBe(248); // truncated at 145 once
  });

  it("floors the partial frame instead of rounding up past the audio", () => {
    expect(framesForAudio(8_370, FPS, SAFETY)).toBe(207); // 209.25 → 209 − 2
    expect(framesForAudio(8_020, FPS, SAFETY)).toBe(198); // 200.5 → 200 − 2, not 201
  });

  it("clamps up to the schema minimum for very short audio", () => {
    expect(framesForAudio(500, FPS, SAFETY)).toBe(LIPSYNC_MIN_FRAMES);
    expect(framesForAudio(1_720, FPS, SAFETY)).toBe(LIPSYNC_MIN_FRAMES); // exactly 41
    expect(framesForAudio(2_000, FPS, SAFETY)).toBe(48);
  });

  it("throws PermanentError past the schema maximum instead of truncating", () => {
    expect(() => framesForAudio(30_000, FPS, SAFETY)).toThrow(PermanentError);
    expect(() => framesForAudio(30_000, FPS, SAFETY)).toThrow(/28\.9/); // real limit, in Hebrew
  });

  it("accepts audio right up to the maximum", () => {
    expect(framesForAudio(28_920, FPS, SAFETY)).toBe(LIPSYNC_MAX_FRAMES);
    expect(() => framesForAudio(28_960, FPS, SAFETY)).toThrow(PermanentError);
  });

  it("follows the configured fps", () => {
    expect(framesForAudio(10_000, 30, SAFETY)).toBe(298);
    expect(() => framesForAudio(28_000, 30, SAFETY)).toThrow(PermanentError); // 838 > 721
  });

  it("respects the configured safety margin", () => {
    expect(framesForAudio(11_040, FPS, 0)).toBe(276); // what fal rejected
    expect(framesForAudio(11_040, FPS, 5)).toBe(271);
    // The margin moves the ceiling with it: 28.84s is the max at safety 0.
    expect(framesForAudio(28_840, FPS, 0)).toBe(LIPSYNC_MAX_FRAMES);
    expect(() => framesForAudio(28_920, FPS, 0)).toThrow(PermanentError);
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

  it("defaults to 25fps / 720p / 2 safety frames when the app_config rows are absent", async () => {
    expect(await lipsyncSettings(db)).toEqual({ fps: 25, resolution: "720p", safetyFrames: 2 });
  });

  it("reads the rows when they exist (480p is one INSERT, no deploy)", async () => {
    await db.insert(appConfig).values([
      { key: "lipsync_fps", value: 30 },
      { key: "lipsync_resolution", value: "480p" },
      { key: "lipsync_safety_frames", value: 4 },
    ]);
    expect(await lipsyncSettings(db)).toEqual({ fps: 30, resolution: "480p", safetyFrames: 4 });
  });
});

/**
 * The motion prompt is what the paid render taught us: persona first (they don't
 * all move the same), then a global knob, then the default. `identity` is
 * free-form jsonb written by hand, so every shape of garbage in it has to fall
 * through to the next source rather than kill the render.
 */
describe("resolveLipsyncPrompt", () => {
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

  async function addPersona(identity: unknown): Promise<string> {
    const rows = await db
      .insert(personas)
      .values({ name: "בדיקה", voiceId: "voice_1", identity })
      .returning({ id: personas.id });
    return rows[0]!.id;
  }

  it("uses the built-in default when neither the persona nor app_config overrides it", async () => {
    expect(await resolveLipsyncPrompt(db)).toBe(DEFAULT_LIPSYNC_PROMPT);
    expect(await resolveLipsyncPrompt(db, await addPersona({}))).toBe(DEFAULT_LIPSYNC_PROMPT);
  });

  it("falls through a malformed identity instead of throwing", async () => {
    for (const identity of [
      "not an object",
      [],
      42,
      { motionPrompt: 7 },
      { motionPrompt: null },
      { motionPrompt: "" },
      { motionPrompt: "   " },
    ]) {
      expect(await resolveLipsyncPrompt(db, await addPersona(identity))).toBe(
        DEFAULT_LIPSYNC_PROMPT,
      );
    }
    // The column is NOT NULL, but jsonb `null` is a value, not a SQL NULL.
    const jsonNull = (
      await db
        .insert(personas)
        .values({ name: "בדיקה", voiceId: "voice_1", identity: sql`'null'::jsonb` })
        .returning({ id: personas.id })
    )[0]!.id;
    expect(await resolveLipsyncPrompt(db, jsonNull)).toBe(DEFAULT_LIPSYNC_PROMPT);
    // A render can name a persona that was since deleted.
    expect(await resolveLipsyncPrompt(db, "00000000-0000-0000-0000-000000000000")).toBe(
      DEFAULT_LIPSYNC_PROMPT,
    );
  });

  it("prefers app_config lipsync_prompt over the default", async () => {
    await db.insert(appConfig).values({ key: "lipsync_prompt", value: "GLOBAL PROMPT" });
    expect(await resolveLipsyncPrompt(db)).toBe("GLOBAL PROMPT");
    expect(await resolveLipsyncPrompt(db, await addPersona({ motionPrompt: "  " }))).toBe(
      "GLOBAL PROMPT",
    );
  });

  it("prefers the persona's identity.motionPrompt over app_config", async () => {
    const personaId = await addPersona({ gender: "f", motionPrompt: "PERSONA PROMPT" });
    expect(await resolveLipsyncPrompt(db, personaId)).toBe("PERSONA PROMPT");
  });
});
