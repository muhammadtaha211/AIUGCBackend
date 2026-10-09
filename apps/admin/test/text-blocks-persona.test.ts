import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * A גוש טקסט clip's speaker is its character (decision 0099 §3): the register
 * and PATCH routes copy the persona's gender into speaker_gender in the same
 * write, refuse a persona with no gender, and never take a gender on its own.
 * The real handlers over PGlite with an admin session; storage and the
 * normalize job are stubbed (the access test covers the guard).
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
  return {
    ...actual,
    getDb: () => fixture.db,
    getStorage: () => ({ signedUrl: async () => "https://storage.test/clip.mp4" }),
    requestTextBlockClipNormalize: async () => undefined,
  };
});

const { eq } = await import("drizzle-orm");
const core = await import("@aiugc/core");
const { createTestDb } = await import("../../../packages/core/test/helpers/pglite");
const { INVALID_BODY } = await import("../src/lib/api");
const { PERSONA_WITHOUT_GENDER, textBlockUploadPath } = await import("../src/lib/text-blocks");
const register = await import("../src/app/api/admin/text-blocks/route");
const patchRoute = await import("../src/app/api/admin/text-blocks/[id]/route");

type Db = ReturnType<typeof core.getDb>;

function json(method: string, path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const registerClip = (personaId: string) =>
  register.POST(
    json("POST", "/api/admin/text-blocks", {
      uploadPath: textBlockUploadPath(randomUUID()),
      durationMs: 10_000,
      width: 1080,
      height: 1920,
      personaId,
      textSafeArea: { x: 80, y: 360, w: 820, h: 1040 },
    }),
  );

const patchClip = (id: string, body: unknown) =>
  patchRoute.PATCH(json("PATCH", `/api/admin/text-blocks/${id}`, body), {
    params: Promise.resolve({ id }),
  });

async function clipRow(id: string) {
  const db = fixture.db as Db;
  const rows = await db
    .select()
    .from(core.schema.textBlockClips)
    .where(eq(core.schema.textBlockClips.id, id));
  return rows[0]!;
}

let pg: { close(): Promise<void> };
let dana: string;
let avi: string;
let genderless: string;

beforeAll(async () => {
  const testDb = await createTestDb();
  fixture.db = testDb.db;
  pg = testDb.pg;
  const [admin] = await testDb.db
    .insert(core.schema.users)
    .values({ email: "admin@example.com", role: "admin" })
    .returning();
  fixture.user = { id: admin!.id, email: admin!.email };
  // No voice on any of them: a גוש טקסט character needs none (0055).
  const personas = await testDb.db
    .insert(core.schema.personas)
    .values([
      { name: "דנה", gender: "female" },
      { name: "אבי", gender: "male" },
      { name: "בלי מגדר", gender: null },
    ])
    .returning({ id: core.schema.personas.id });
  [dana, avi, genderless] = personas.map((p) => p.id) as [string, string, string];
});

afterAll(async () => {
  await pg.close();
});

describe("register takes the character, and the gender from it", () => {
  it("stores the persona and its gender as the speaker's", async () => {
    const response = await registerClip(avi);
    expect(response.status).toBe(200);
    const { clipId } = (await response.json()) as { clipId: string };
    const row = await clipRow(clipId);
    expect(row.personaId).toBe(avi);
    expect(row.speakerGender).toBe("male");
  });

  it("refuses an unknown character and one with no gender, writing no row", async () => {
    const db = fixture.db as Db;
    const before = (await db.select().from(core.schema.textBlockClips)).length;

    const unknown = await registerClip(randomUUID());
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ ok: false, error: "הדמות לא נמצאה." });

    const noGender = await registerClip(genderless);
    expect(noGender.status).toBe(400);
    expect(await noGender.json()).toEqual({ ok: false, error: PERSONA_WITHOUT_GENDER });

    expect((await db.select().from(core.schema.textBlockClips)).length).toBe(before);
  });
});

describe("PATCH moves the gender with the character, and only with it", () => {
  it("assigning sets both columns; null unassigns and keeps the gender", async () => {
    const { clipId } = (await (await registerClip(dana)).json()) as { clipId: string };
    expect((await clipRow(clipId)).speakerGender).toBe("female");

    expect((await patchClip(clipId, { personaId: avi })).status).toBe(200);
    let row = await clipRow(clipId);
    expect(row.personaId).toBe(avi);
    expect(row.speakerGender).toBe("male");

    expect((await patchClip(clipId, { personaId: null })).status).toBe(200);
    row = await clipRow(clipId);
    expect(row.personaId).toBeNull();
    expect(row.speakerGender).toBe("male");
  });

  it("refuses a speakerGender key and a character with no gender, leaving the row as it was", async () => {
    const { clipId } = (await (await registerClip(dana)).json()) as { clipId: string };

    const gender = await patchClip(clipId, { speakerGender: "male" });
    expect(gender.status).toBe(400);
    expect(await gender.json()).toEqual({ ok: false, error: INVALID_BODY });

    const noGender = await patchClip(clipId, { personaId: genderless });
    expect(noGender.status).toBe(400);
    expect(await noGender.json()).toEqual({ ok: false, error: PERSONA_WITHOUT_GENDER });

    const unknown = await patchClip(clipId, { personaId: randomUUID() });
    expect(unknown.status).toBe(400);

    const row = await clipRow(clipId);
    expect(row.personaId).toBe(dana);
    expect(row.speakerGender).toBe("female");
  });
});
