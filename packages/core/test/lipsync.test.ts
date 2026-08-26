import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../src/config";
import type { Db } from "../src/db";
import { appConfig } from "../src/db/schema";
import { PermanentError, TransientError } from "../src/jobs/errors";
import { GPU_COST_AGOROT_PER_SECOND, lipsyncResolution } from "../src/pipelines/renders";
import { HeyGenLipsync } from "../src/providers/lipsync";
import { createTestDb } from "./helpers/pglite";

/**
 * The HeyGen v3 contract, pinned without a live call: the submit body shape
 * (image+audio pinned to 9:16, no engine/fps/frames/seed fields; motion knobs
 * only when set), the poll status mapping, and the HTTP error taxonomy.
 */

describe("HeyGenLipsync", () => {
  const fetchMock = vi.fn();

  beforeAll(() => {
    process.env.HEYGEN_API_KEY = "test_heygen_key";
    resetEnvCache();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    delete process.env.HEYGEN_API_KEY;
    resetEnvCache();
  });

  function response(status: number, body: unknown) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }

  const submitInput = {
    imageUrl: "https://storage.example/persona.jpg?token=secret",
    audioUrl: "https://storage.example/vo.mp3?token=secret",
    resolution: "1080p",
  } as const;

  it("submits a v3 image+audio body pinned to 9:16 — no engine, fps, frames, seed, or motion knobs when unset", async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, { data: { video_id: "vid_1", status: "waiting", output_format: "mp4" } }),
    );

    const { providerJobId } = await new HeyGenLipsync().submit(submitInput);

    expect(providerJobId).toBe("vid_1");
    const [url, init] = fetchMock.mock.calls[0]! as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe("https://api.heygen.com/v3/videos");
    expect(init.headers["x-api-key"]).toBe("test_heygen_key");
    expect(JSON.parse(init.body)).toEqual({
      type: "image",
      image: { type: "url", url: submitInput.imageUrl },
      audio_url: submitInput.audioUrl,
      aspect_ratio: "9:16",
      resolution: "1080p",
    });
  });

  it("sends motion_prompt and expressiveness (the native v3 names) when set", async () => {
    fetchMock.mockResolvedValueOnce(response(200, { data: { video_id: "vid_2" } }));

    await new HeyGenLipsync().submit({
      ...submitInput,
      motionPrompt: "מחוות ידיים טבעיות תוך כדי דיבור",
      expressiveness: "medium",
    });

    const [, init] = fetchMock.mock.calls[0]! as [string, { body: string }];
    expect(JSON.parse(init.body)).toEqual({
      type: "image",
      image: { type: "url", url: submitInput.imageUrl },
      audio_url: submitInput.audioUrl,
      aspect_ratio: "9:16",
      resolution: "1080p",
      motion_prompt: "מחוות ידיים טבעיות תוך כדי דיבור",
      expressiveness: "medium",
    });
  });

  it("polls GET /v3/videos/{id}: pending/waiting/processing stay pending", async () => {
    for (const status of ["pending", "waiting", "processing"]) {
      fetchMock.mockResolvedValueOnce(response(200, { data: { id: "vid_1", status } }));
      expect(await new HeyGenLipsync().poll("vid_1")).toEqual({ status: "pending" });
    }
    const [url] = fetchMock.mock.calls[0]! as [string];
    expect(url).toBe("https://api.heygen.com/v3/videos/vid_1");
  });

  it("maps completed to done with the presigned video url", async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, {
        data: {
          id: "vid_1",
          status: "completed",
          video_url: "https://cdn.heygen.com/vid_1.mp4?sig=x",
        },
      }),
    );
    expect(await new HeyGenLipsync().poll("vid_1")).toEqual({
      status: "done",
      videoUrl: "https://cdn.heygen.com/vid_1.mp4?sig=x",
    });
  });

  it("maps failed to failed with the failure message, and completed-without-url to failed", async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, {
        data: { id: "vid_1", status: "failed", failure_code: "e1", failure_message: "bad audio" },
      }),
    );
    expect(await new HeyGenLipsync().poll("vid_1")).toEqual({
      status: "failed",
      reason: "bad audio",
    });

    fetchMock.mockResolvedValueOnce(response(200, { data: { id: "vid_1", status: "completed" } }));
    expect(await new HeyGenLipsync().poll("vid_1")).toEqual({
      status: "failed",
      reason: "heygen result has no video url",
    });
  });

  it("an unknown status is failed with the status on the record, not an infinite pend", async () => {
    fetchMock.mockResolvedValueOnce(response(200, { data: { id: "vid_1", status: "archived" } }));
    expect(await new HeyGenLipsync().poll("vid_1")).toEqual({
      status: "failed",
      reason: "heygen status archived",
    });
  });

  it("4xx is a PermanentError, 5xx and 429 are TransientErrors", async () => {
    fetchMock.mockResolvedValueOnce(response(400, { error: { code: "invalid", message: "no" } }));
    await expect(new HeyGenLipsync().submit(submitInput)).rejects.toBeInstanceOf(PermanentError);

    fetchMock.mockResolvedValueOnce(response(500, { error: "boom" }));
    await expect(new HeyGenLipsync().submit(submitInput)).rejects.toBeInstanceOf(TransientError);

    fetchMock.mockResolvedValueOnce(response(429, { error: "slow down" }));
    await expect(new HeyGenLipsync().poll("vid_1")).rejects.toBeInstanceOf(TransientError);
  });

  it("a network error is a TransientError", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(new HeyGenLipsync().submit(submitInput)).rejects.toBeInstanceOf(TransientError);
  });
});

describe("GPU_COST_AGOROT_PER_SECOND", () => {
  it("charges both tiers the same (HeyGen prices 720p and 1080p identically)", () => {
    expect(GPU_COST_AGOROT_PER_SECOND["720p"]).toBe(25);
    expect(GPU_COST_AGOROT_PER_SECOND["1080p"]).toBe(25);
  });

  it("makes a 10s render cost 250 agorot at either resolution", () => {
    expect(10 * GPU_COST_AGOROT_PER_SECOND["720p"]).toBe(250);
    expect(10 * GPU_COST_AGOROT_PER_SECOND["1080p"]).toBe(250);
  });
});

describe("lipsyncResolution", () => {
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

  it("defaults to 1080p when the app_config row is absent", async () => {
    // 0031 seeds lipsync_resolution="1080p", which is also the code default — so
    // without this delete the test passes without ever taking the absent path.
    await db.delete(appConfig).where(eq(appConfig.key, "lipsync_resolution"));
    expect(await lipsyncResolution(db)).toBe("1080p");
  });

  it("reads the row when it exists (dropping to 720p is one INSERT, no deploy)", async () => {
    // Upsert, not insert: 0031 seeds this key, so a plain insert duplicate-keys.
    await db
      .insert(appConfig)
      .values({ key: "lipsync_resolution", value: "720p" })
      .onConflictDoUpdate({ target: appConfig.key, set: { value: "720p" } });
    expect(await lipsyncResolution(db)).toBe("720p");
  });
});
