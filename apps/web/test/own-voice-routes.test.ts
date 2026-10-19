import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The own-voice routes (decision 0118) over the real handlers on PGlite: the
 * upload target and the type it settles, registration and the shared daily
 * pool, the transcript step's poll with its quote, and the approval — the
 * audio gate, which refuses an added word and charges nothing. DRY_RUN, so
 * the hook line is the extractor's stand-in and no provider is called.
 */

const fixture = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  db: undefined as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: fixture.user }, error: null }) },
  }),
}));

vi.mock("@aiugc/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aiugc/core")>();
  return { ...actual, getDb: () => fixture.db };
});

process.env.DRY_RUN = "1";

const core = await import("@aiugc/core");
const ownVoice = await import("@aiugc/core/own-voice");
const { createTestDb } = await import("../../../packages/core/test/helpers/pglite");
const { tempStorage } = await import("../../../packages/core/test/helpers/storage");
const { POST: uploadUrl } =
  await import("../src/app/api/businesses/[businessId]/recordings/upload-url/route");
const { POST: register } = await import("../src/app/api/businesses/[businessId]/recordings/route");
const { GET: poll } = await import("../src/app/api/recordings/[id]/route");
const { POST: approve } = await import("../src/app/api/recordings/[id]/approve/route");

const schema = core.schema;
type Db = ReturnType<typeof core.getDb>;

function post(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const forBusiness = (businessId: string) => ({ params: Promise.resolve({ businessId }) });
const forId = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (path: string) => new Request(`http://localhost${path}`);

let db: Db;
let pg: { close(): Promise<void> };
let cleanupStorage: () => void;
let owner: { id: string; email: string };
let stranger: { id: string; email: string };
let businessId: string;
let personaId: string;

const WORDS = [
  { text: "שלום,", startMs: 100, endMs: 420 },
  { text: "אממ", startMs: 500, endMs: 700 },
  { text: "קוראים", startMs: 1900, endMs: 2300 },
  { text: "לי", startMs: 2300, endMs: 2450 },
  { text: "דנה.", startMs: 2450, endMs: 2900 },
];

async function readyRecording(): Promise<string> {
  const filePath = await core
    .getStorage()
    .put("renders", `${businessId}/recording/${crypto.randomUUID()}/audio.mp3`, Buffer.from("mp3"));
  const [rec] = await db
    .insert(schema.voiceRecordings)
    .values({
      businessId,
      status: "ready",
      rawPath: `raw/${businessId}/recording/${crypto.randomUUID()}/upload.webm`,
      filePath,
      sourceMs: 4200,
      durationMs: 3100,
      words: WORDS,
    })
    .returning();
  return rec!.id;
}

beforeAll(async () => {
  core.resetEnvCache();
  const testDb = await createTestDb();
  db = testDb.db as unknown as Db;
  pg = testDb.pg;
  fixture.db = db;
  const ts = tempStorage();
  core.setStorage(ts.storage);
  cleanupStorage = ts.cleanup;

  const business = await core.createBusiness(db, { ownerEmail: "owner@ov.test", name: "הסטודיו" });
  businessId = business.id;
  owner = { id: business.ownerUserId, email: "owner@ov.test" };
  await core.grantCredits(db, { userId: owner.id, credits: 500, note: "test" });
  const other = await core.createBusiness(db, { ownerEmail: "other@ov.test", name: "אחר" });
  stranger = { id: other.ownerUserId, email: "other@ov.test" };
  personaId = (await core.addPersona(db, { name: "נועה", voiceId: "voice_noa" })).id;
});

afterAll(async () => {
  await pg.close();
  cleanupStorage();
});

describe("POST recordings/upload-url", () => {
  it("settles the type once: a WhatsApp .opus with no type goes up as audio/ogg", async () => {
    fixture.user = owner;
    const res = await uploadUrl(
      post(`/api/businesses/${businessId}/recordings/upload-url`, {
        type: "",
        size: 180_000,
        name: "PTT-20261019-WA0003.opus",
      }),
      forBusiness(businessId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contentType).toBe("audio/ogg");
    expect(body.uploadPath).toMatch(
      new RegExp(`^raw/${businessId}/recording/[0-9a-f-]{36}/upload\\.ogg$`),
    );
    expect(core.isOwnedRecordingUploadPath(businessId, body.uploadPath)).toBe(true);
    expect(body.uploadUrl).toMatch(/^upload:\/\//);
  });

  it("refuses an unsupported file and an over-cap one, in Hebrew", async () => {
    fixture.user = owner;
    const png = await uploadUrl(
      post(`/api/businesses/${businessId}/recordings/upload-url`, { type: "image/png", size: 10 }),
      forBusiness(businessId),
    );
    expect(png.status).toBe(400);
    expect((await png.json()).error).toBe(ownVoice.RECORDING_UNSUPPORTED);
    const big = await uploadUrl(
      post(`/api/businesses/${businessId}/recordings/upload-url`, {
        type: "audio/mpeg",
        size: ownVoice.RECORDING_MAX_AUDIO_BYTES + 1,
      }),
      forBusiness(businessId),
    );
    expect(big.status).toBe(400);
    expect((await big.json()).error).toBe("הקובץ גדול מדי (26MB). המקסימום לקובץ שמע הוא 25MB.");
  });

  it("is someone else's business: 403", async () => {
    fixture.user = stranger;
    const res = await uploadUrl(
      post(`/api/businesses/${businessId}/recordings/upload-url`, { type: "audio/webm", size: 10 }),
      forBusiness(businessId),
    );
    expect(res.status).toBe(403);
  });
});

describe("POST recordings (register)", () => {
  it("registers only a path minted for this business, once per upload", async () => {
    fixture.user = owner;
    const foreign = core.recordingUploadPath(crypto.randomUUID(), crypto.randomUUID(), "webm");
    const refused = await register(
      post(`/api/businesses/${businessId}/recordings`, { uploadPath: foreign }),
      forBusiness(businessId),
    );
    expect(refused.status).toBe(400);
    // A well-formed path this business never minted has no row: 404.
    const unminted = await register(
      post(`/api/businesses/${businessId}/recordings`, {
        uploadPath: core.recordingUploadPath(businessId, crypto.randomUUID(), "webm"),
      }),
      forBusiness(businessId),
    );
    expect(unminted.status).toBe(404);

    const minted = await uploadUrl(
      post(`/api/businesses/${businessId}/recordings/upload-url`, {
        type: "audio/webm",
        size: 9000,
      }),
      forBusiness(businessId),
    );
    const { uploadPath } = await minted.json();
    const first = await register(
      post(`/api/businesses/${businessId}/recordings`, { uploadPath }),
      forBusiness(businessId),
    );
    expect(first.status).toBe(200);
    const again = await register(
      post(`/api/businesses/${businessId}/recordings`, { uploadPath }),
      forBusiness(businessId),
    );
    expect((await again.json()).recordingId).toBe((await first.json()).recordingId);
    const jobs = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.type, "transcribe_recording"));
    expect(jobs).toHaveLength(1);
  });

  it("answers the full daily pool with the recording line, 429, before anything is uploaded", async () => {
    fixture.user = owner;
    await db
      .update(schema.appConfig)
      .set({ value: 1 })
      .where(eq(schema.appConfig.key, "audio_preview_daily_limit"));
    try {
      const res = await uploadUrl(
        post(`/api/businesses/${businessId}/recordings/upload-url`, {
          type: "audio/mp4",
          size: 9000,
        }),
        forBusiness(businessId),
      );
      expect(res.status).toBe(429);
      expect((await res.json()).error).toBe(ownVoice.RECORDING_DAILY_CAP);
    } finally {
      await db
        .update(schema.appConfig)
        .set({ value: 20 })
        .where(eq(schema.appConfig.key, "audio_preview_daily_limit"));
    }
  });
});

describe("GET recordings/[id]", () => {
  it("a ready recording carries its words, its file and the render's quote", async () => {
    fixture.user = owner;
    const id = await readyRecording();
    const res = await poll(get(`/api/recordings/${id}`), forId(id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ready");
    expect(body.durationMs).toBe(3100);
    expect(body.words).toEqual(WORDS);
    expect(body.audioUrl).toMatch(/^file:\/\//);
    // The same quote the render step shows: the minimum for a short take.
    const quote = await core.quoteBForDuration(db, { businessId, durationMs: 3100 });
    expect(body.quote).toEqual({
      credits: quote.creditsPerRender,
      balance: 500,
      shortfall: Math.max(0, quote.creditsPerRender - 500),
    });
  });

  it("a failed recording carries its Hebrew line, and a stranger gets 403", async () => {
    fixture.user = owner;
    const [failed] = await db
      .insert(schema.voiceRecordings)
      .values({
        businessId,
        status: "failed",
        rawPath: `raw/${businessId}/recording/${crypto.randomUUID()}/upload.mp3`,
        error: "ההקלטה באורך 2 שניות. אפשר מ־3 עד 90 שניות.",
      })
      .returning();
    const res = await poll(get(`/api/recordings/${failed!.id}`), forId(failed!.id));
    expect(await res.json()).toEqual({
      status: "failed",
      error: "ההקלטה באורך 2 שניות. אפשר מ־3 עד 90 שניות.",
    });
    fixture.user = stranger;
    expect((await poll(get(`/api/recordings/${failed!.id}`), forId(failed!.id))).status).toBe(403);
  });
});

describe("POST recordings/[id]/approve", () => {
  it("refuses an added word, a repeated index and a respell with a space — in Hebrew, 400", async () => {
    fixture.user = owner;
    const id = await readyRecording();
    const cases: [unknown, string][] = [
      [[{ i: 5, text: "עוד" }], ownVoice.TRANSCRIPT_MISMATCH],
      [
        [
          { i: 0, text: "שלום," },
          { i: 0, text: "שוב" },
        ],
        ownVoice.TRANSCRIPT_MISMATCH,
      ],
      [[{ i: 0, text: "שלום לכם" }], ownVoice.TRANSCRIPT_ONE_WORD],
    ];
    for (const [kept, error] of cases) {
      const res = await approve(
        post(`/api/recordings/${id}/approve`, { personaId, kept }),
        forId(id),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(error);
    }
  });

  it("approves a respell and a drop, and charges nothing", async () => {
    fixture.user = owner;
    const id = await readyRecording();
    const ledgerBefore = await db.select().from(schema.creditLedger);
    const res = await approve(
      post(`/api/recordings/${id}/approve`, {
        personaId,
        kept: [
          { i: 0, text: "שלום," },
          { i: 2, text: "קוראים" },
          { i: 3, text: "לי" },
          { i: 4, text: "דנה!" },
        ],
      }),
      forId(id),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ text: "שלום, קוראים לי דנה!", durationMs: 3100 });
    expect(typeof body.hookText).toBe("string");
    const audio = (
      await db.select().from(schema.audioRenders).where(eq(schema.audioRenders.id, body.audioId))
    )[0]!;
    expect(audio.scriptId).toBe(body.scriptId);
    expect(audio.approvedAt).not.toBeNull();
    expect(await db.select().from(schema.creditLedger)).toEqual(ledgerBefore);
  });

  it("is a stranger's recording: 403, nothing made", async () => {
    fixture.user = stranger;
    const id = await readyRecording();
    const before = await db.select().from(schema.audioRenders);
    const res = await approve(
      post(`/api/recordings/${id}/approve`, { personaId, kept: [{ i: 0, text: "שלום," }] }),
      forId(id),
    );
    expect(res.status).toBe(403);
    expect(await db.select().from(schema.audioRenders)).toHaveLength(before.length);
  });
});
