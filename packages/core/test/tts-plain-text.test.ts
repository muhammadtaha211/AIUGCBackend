import { execFile } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CaptionChunk } from "../src/captions";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import * as dbSchema from "../src/db/schema";
import { buildHandlers } from "../src/handlers";
import { runLane } from "../src/jobs/worker";
import { measureDurationMs } from "../src/media/ffmpeg";
import { createBusiness } from "../src/pipelines/businesses";
import { requestAudio, stripAudioTags } from "../src/pipelines/tts";
import { synthesize } from "../src/providers/elevenlabs";
import { setStorage } from "../src/storage";
import { createTestDb } from "./helpers/pglite";
import { tempStorage } from "./helpers/storage";

/**
 * Eleven v4, plain text (vault 0119): the request carries eleven_v4 with
 * stability 1.0 and similarity 1.0, and no bracketed audio tag ever reaches
 * ElevenLabs — not from an enhancement pass (retired), not from a script, not
 * from a pronunciation-map entry.
 */

const SCRIPT = "ניסיתי מיליון דברים ושום דבר לא עבד עד שגיליתי את זה";

const exec = promisify(execFile);

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/**
 * What with-timestamps answers: audio plus a per-character alignment in
 * seconds, 50 ms a character unless `endMs` sets where the last one ends.
 */
function withTimestamps(text: string, opts: { audio?: Buffer; endMs?: number } = {}) {
  const characters = [...text];
  const step = opts.endMs === undefined ? 0.05 : opts.endMs / 1000 / characters.length;
  const alignment = {
    characters,
    character_start_times_seconds: characters.map((_, i) => i * step),
    character_end_times_seconds: characters.map((_, i) => (i + 1) * step),
  };
  return {
    audio_base64: (opts.audio ?? Buffer.from("fake mp3")).toString("base64"),
    alignment,
    normalized_alignment: alignment,
  };
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  const [, init] = fetchMock.mock.calls[call]! as [string, { body: string }];
  return JSON.parse(init.body) as Record<string, unknown>;
}

describe("stripAudioTags", () => {
  it("removes tags and collapses the whitespace they leave behind", () => {
    expect(stripAudioTags("[excited] תלחצו על הקישור [short pause] עכשיו!")).toBe(
      "תלחצו על הקישור עכשיו!",
    );
  });

  it("passes text without a tag through byte for byte", () => {
    const plain = "ניסיתי  מיליון\nדברים. ";
    expect(stripAudioTags(plain)).toBe(plain);
  });

  it("keeps an unclosed bracket: it is not a tag", () => {
    expect(stripAudioTags("[oops ניסיתי הכל")).toBe("[oops ניסיתי הכל");
  });
});

describe("synthesize — the Eleven v4 request", () => {
  const fetchMock = vi.fn();

  beforeAll(() => {
    process.env.DRY_RUN = "0";
    process.env.ELEVENLABS_API_KEY = "test_elevenlabs_key";
    resetEnvCache();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    delete process.env.ELEVENLABS_API_KEY;
    process.env.DRY_RUN = "1";
    resetEnvCache();
  });

  it("posts eleven_v4 with stability 1.0 and similarity 1.0 to with-timestamps — and nothing else", async () => {
    fetchMock.mockResolvedValueOnce(response(200, withTimestamps(SCRIPT)));

    await synthesize({ text: SCRIPT, voiceId: "voice_test" });

    const [url, init] = fetchMock.mock.calls[0]! as [string, { headers: Record<string, string> }];
    expect(url).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/voice_test/with-timestamps?output_format=mp3_44100_128",
    );
    expect(init.headers["xi-api-key"]).toBe("test_elevenlabs_key");
    // toEqual on the whole body: no language_code, style, speed or speaker boost.
    expect(sentBody(fetchMock)).toEqual({
      text: SCRIPT,
      model_id: "eleven_v4",
      voice_settings: { stability: 1, similarity_boost: 1 },
    });
  });

  it("returns the character alignment in milliseconds", async () => {
    fetchMock.mockResolvedValueOnce(response(200, withTimestamps("אבג")));

    const tts = await synthesize({ text: "אבג", voiceId: "voice_test" });

    expect(tts.charAlignment).toEqual({
      characters: ["א", "ב", "ג"],
      startTimesMs: [0, 50, 100],
      endTimesMs: [50, 100, 150],
    });
  });
});

describe("synth_tts sends plain text (real DB + jobs)", () => {
  let db: Db;
  let pg: { close(): Promise<void> };
  let cleanupStorage: () => void;
  let businessId: string;

  async function synth(text: string): Promise<typeof dbSchema.audioRenders.$inferSelect> {
    const inserted = await db
      .insert(dbSchema.scripts)
      .values({ businessId, kind: "b_script", text, promptVersion: "test" })
      .returning();
    const audio = await requestAudio(db, { scriptId: inserted[0]!.id, voiceId: "voice_test" });
    await runLane(db, { workerId: "test", handlers: buildHandlers(), drainAndExit: true });
    const rows = await db
      .select()
      .from(dbSchema.audioRenders)
      .where(sql`${dbSchema.audioRenders.id} = ${audio.id}`);
    return rows[0]!;
  }

  const captionText = (row: typeof dbSchema.audioRenders.$inferSelect) =>
    (row.wordTimestamps as CaptionChunk[]).map((c) => c.text).join(" ");

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

  afterAll(async () => {
    setStorage(undefined);
    cleanupStorage();
    await pg.close();
  });

  it("DRY_RUN, keyless: the sent text is the script byte for byte, and the captions are its words", async () => {
    const row = await synth(SCRIPT);
    expect(row.status).toBe("ready");
    expect(row.alignmentSource).toBe("elevenlabs");
    expect(row.renderedText).toBe(SCRIPT);
    expect(captionText(row).split(" ")).toEqual(SCRIPT.split(" "));
  });

  it("a script that is only a bracketed span fails plainly instead of sending an empty text", async () => {
    const row = await synth("[לינק בביו]");
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/no speakable text/);
    expect(row.renderedText).toBeNull();
  });

  it("a leftover tts_enhance row adds nothing: the flag is read by no code", async () => {
    // Upsert, not insert: 0031 seeds the row false.
    await db
      .insert(dbSchema.appConfig)
      .values({ key: "tts_enhance", value: true })
      .onConflictDoUpdate({ target: dbSchema.appConfig.key, set: { value: true } });

    const row = await synth(SCRIPT);
    expect(row.status).toBe("ready");
    expect(row.renderedText).toBe(SCRIPT);
  });

  describe("against the real provider code (fetch mocked)", () => {
    const fetchMock = vi.fn();
    // A real one-second mp3: off DRY_RUN, handleSynthTts probes the file.
    const dir = path.join(tmpdir(), "aiugc-tts-plain-text");
    const toneFile = path.join(dir, "tone-1s.mp3");
    let tone: Buffer;
    let toneMs: number;

    beforeAll(async () => {
      process.env.DRY_RUN = "0";
      process.env.ELEVENLABS_API_KEY = "test_elevenlabs_key";
      resetEnvCache();
      vi.stubGlobal("fetch", fetchMock);
      mkdirSync(dir, { recursive: true });
      await exec("ffmpeg", [
        ...["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1"],
        ...["-ar", "44100", "-ac", "1", toneFile],
      ]);
      tone = readFileSync(toneFile);
      toneMs = await measureDurationMs(toneFile);
    }, 60_000);

    afterEach(() => {
      fetchMock.mockReset();
    });

    afterAll(() => {
      vi.unstubAllGlobals();
      delete process.env.ELEVENLABS_API_KEY;
      process.env.DRY_RUN = "1";
      resetEnvCache();
    });

    it("no tag reaches ElevenLabs — not one typed into the script, not one a pronunciation entry carries", async () => {
      await db.insert(dbSchema.pronunciationEntries).values({
        businessId,
        match: "AI",
        replacement: "[confident] איי איי",
        active: true,
      });
      fetchMock.mockImplementation(async (_url: string, init: { body: string }) =>
        response(
          200,
          withTimestamps((JSON.parse(init.body) as { text: string }).text, { audio: tone }),
        ),
      );

      const row = await synth("[excited] ניסיתי את ה-AI הזה [laughs] ושום דבר לא עבד");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = sentBody(fetchMock);
      expect(body.model_id).toBe("eleven_v4");
      expect(body.voice_settings).toEqual({ stability: 1, similarity_boost: 1 });
      // A tag becomes a space, so the map's tag leaves "ה- איי": words are never glued.
      expect(body.text).toBe("ניסיתי את ה- איי איי הזה ושום דבר לא עבד");
      expect(body.text).not.toMatch(/[[\]]/);
      // What was sent is what rendered_text records, and the captions are its words.
      expect(row.status).toBe("ready");
      expect(row.renderedText).toBe(body.text);
      expect(captionText(row)).toBe(body.text);
    });

    it("duration_ms is the file's length when the alignment runs past it (v4's 80 ms)", async () => {
      fetchMock.mockResolvedValueOnce(
        response(200, withTimestamps(SCRIPT, { audio: tone, endMs: toneMs + 80 })),
      );

      const row = await synth(SCRIPT);

      expect(row.status).toBe("ready");
      expect(row.durationMs).toBe(toneMs);
      // The caption times are ElevenLabs' own and are left alone.
      expect((row.wordTimestamps as CaptionChunk[]).at(-1)!.endMs).toBe(toneMs + 80);
    });

    it("duration_ms is the alignment's end when that stops inside the file", async () => {
      fetchMock.mockResolvedValueOnce(
        response(200, withTimestamps(SCRIPT, { audio: tone, endMs: toneMs - 200 })),
      );

      const row = await synth(SCRIPT);

      expect(row.status).toBe("ready");
      expect(row.durationMs).toBe(toneMs - 200);
    });
  });
});
