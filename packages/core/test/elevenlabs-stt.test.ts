import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../src/config";
import { PermanentError, TransientError } from "../src/jobs/errors";
import { RECORDING_FAILED } from "../src/own-voice";
import { scribeWords, transcribe } from "../src/providers/elevenlabs";

/**
 * The Scribe v2 contract (decision 0118), pinned without a live call: the
 * multipart fields, the word mapping (words only, seconds -> ms, an untimed
 * word borrows its neighbours'), the error taxonomy with 401's detail.status,
 * and a customer who only ever reads the generic Hebrew line.
 */

const dir = path.join(tmpdir(), "aiugc-elevenlabs-stt");
const file = path.join(dir, "rec.wav");

function response(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("transcribe (live path)", () => {
  const fetchMock = vi.fn();

  beforeAll(() => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, "RIFF-fake-wav");
    process.env.DRY_RUN = "0";
    process.env.ELEVENLABS_API_KEY = "test_eleven_key";
    resetEnvCache();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => fetchMock.mockReset());

  afterAll(() => {
    vi.unstubAllGlobals();
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.DRY_RUN;
    resetEnvCache();
  });

  it("posts the six fields and the file, and maps the words", async () => {
    fetchMock.mockResolvedValueOnce(
      response(200, {
        language_code: "heb",
        audio_duration_secs: 4.25,
        text: "שלום, אממ דנה.",
        words: [
          { text: "שלום,", type: "word", start: 0.1, end: 0.42, logprob: -0.1 },
          { text: " ", type: "spacing", start: 0.42, end: 0.5 },
          { text: "אממ", type: "word", start: 0.5, end: 0.7 },
          { text: " ", type: "spacing", start: 0.7, end: 1.9 },
          { text: "דנה.", type: "word", start: 1.9, end: 2.31 },
        ],
      }),
    );
    const result = await transcribe({ file, durationMs: 4250 });
    expect(result).toEqual({
      audioDurationSecs: 4.25,
      words: [
        { text: "שלום,", startMs: 100, endMs: 420 },
        { text: "אממ", startMs: 500, endMs: 700 },
        { text: "דנה.", startMs: 1900, endMs: 2310 },
      ],
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "xi-api-key": "test_eleven_key" });
    const form = init.body as FormData;
    expect(Object.fromEntries([...form.entries()].filter(([k]) => k !== "file"))).toEqual({
      model_id: "scribe_v2",
      language_code: "heb",
      timestamps_granularity: "word",
      tag_audio_events: "false",
      no_verbatim: "false",
      diarize: "false",
    });
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("a key without Speech to Text access is permanent, and the customer reads only the generic line", async () => {
    fetchMock.mockResolvedValueOnce(
      response(401, { detail: { status: "missing_permissions", message: "The API key ..." } }),
    );
    const err = await transcribe({ file, durationMs: 4000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermanentError);
    expect((err as PermanentError).message).toBe("elevenlabs stt 401: missing_permissions");
    expect((err as PermanentError).customerMessage).toBe(RECORDING_FAILED);
  });

  it("422 is permanent; 429, 5xx and a network failure are transient", async () => {
    fetchMock.mockResolvedValueOnce(response(422, { detail: [{ msg: "bad" }] }));
    await expect(transcribe({ file, durationMs: 4000 })).rejects.toBeInstanceOf(PermanentError);
    fetchMock.mockResolvedValueOnce(
      response(429, { detail: { status: "too_many_concurrent_requests" } }),
    );
    await expect(transcribe({ file, durationMs: 4000 })).rejects.toBeInstanceOf(TransientError);
    fetchMock.mockResolvedValueOnce(response(503, {}));
    await expect(transcribe({ file, durationMs: 4000 })).rejects.toBeInstanceOf(TransientError);
    fetchMock.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(transcribe({ file, durationMs: 4000 })).rejects.toBeInstanceOf(TransientError);
  });
});

describe("scribeWords", () => {
  it("gives an untimed word its neighbours' times", () => {
    expect(
      scribeWords([
        { text: "א", type: "word", start: 0.1, end: 0.3 },
        { text: "ב", type: "word", start: null, end: null },
        { text: "ג", type: "word", start: 0.9, end: 1.1 },
        { text: "(צחוק)", type: "audio_event", start: 1.1, end: 1.5 },
      ]),
    ).toEqual([
      { text: "א", startMs: 100, endMs: 300 },
      { text: "ב", startMs: 300, endMs: 900 },
      { text: "ג", startMs: 900, endMs: 1100 },
    ]);
  });
});

describe("transcribe (DRY_RUN)", () => {
  beforeAll(() => {
    process.env.DRY_RUN = "1";
    resetEnvCache();
  });
  afterAll(() => {
    delete process.env.DRY_RUN;
    resetEnvCache();
  });

  it("is keyless and deterministic: words from 100 ms, a 1.2 s pause after the fourth, the filler", async () => {
    const a = await transcribe({ file: "unused", durationMs: 10_000 });
    const b = await transcribe({ file: "unused", durationMs: 10_000 });
    expect(a).toEqual(b);
    expect(a.audioDurationSecs).toBe(10);
    expect(a.words[0]!.startMs).toBe(100);
    expect(a.words[4]!.startMs - a.words[3]!.endMs).toBeGreaterThan(1200);
    expect(a.words.map((w) => w.text)).toContain("אממ");
    expect(a.words[a.words.length - 1]!.endMs).toBeLessThanOrEqual(9900);
  });

  it("still returns words for the shortest recording", async () => {
    const r = await transcribe({ file: "unused", durationMs: 3000 });
    expect(r.words.length).toBeGreaterThan(0);
    expect(r.words[r.words.length - 1]!.endMs).toBeLessThanOrEqual(2900);
  });
});
