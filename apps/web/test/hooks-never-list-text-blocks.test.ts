import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Service C clips (text_block_clips) never reach a Service A hook picker
 * (decision 0089 §4: "hook pickers never list these clips"). Structural — the
 * banks are two tables — and proven here against the two listings a customer
 * can reach: GET /api/hooks (both forms) and the Service A persona catalog.
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
    getStorage: () => ({
      signedUrl: async (path: string) => `https://signed.test/${path}`,
      publicUrl: (path: string) => `https://public.test/${path}`,
    }),
  };
});

const core = await import("@aiugc/core");
const { createTestDb } = await import("../../../packages/core/test/helpers/pglite");
const { GET: listHooks } = await import("../src/app/api/hooks/route");
const { loadPersonaCatalog } = await import("../src/lib/persona-catalog");

let pg: { close(): Promise<void> };
let personaId: string;
let hookClipId: string;
let genericHookClipId: string;
let textBlockClipId: string;

beforeAll(async () => {
  const testDb = await createTestDb();
  fixture.db = testDb.db;
  pg = testDb.pg;
  const db = testDb.db;
  const [user] = await db
    .insert(core.schema.users)
    .values({ email: "customer@example.com" })
    .returning();
  fixture.user = { id: user!.id, email: user!.email };

  const [persona] = await db
    .insert(core.schema.personas)
    .values({ name: "מיכל", voiceId: "voice", gender: "female" })
    .returning();
  personaId = persona!.id;
  await db.insert(core.schema.personaImages).values({
    personaId,
    filePath: "assets/bank/persona_image/p/image.jpg",
    isDefault: true,
    kind: "selfie",
  });
  const rect = { x: 25, y: 1062, w: 1009, h: 179 };
  const [hook] = await db
    .insert(core.schema.hookClips)
    .values({
      filePath: "assets/bank/hook_clip/h/clip.mp4",
      durationMs: 3500,
      textSafeArea: rect,
      personaId,
    })
    .returning();
  hookClipId = hook!.id;
  const [generic] = await db
    .insert(core.schema.hookClips)
    .values({ filePath: "assets/bank/hook_clip/g/clip.mp4", durationMs: 3500, textSafeArea: rect })
    .returning();
  genericHookClipId = generic!.id;
  const [textBlock] = await db
    .insert(core.schema.textBlockClips)
    .values({
      filePath: "assets/bank/text_block_clip/t/clip.mp4",
      durationMs: 10_000,
      speakerGender: "female",
      textSafeArea: { x: 80, y: 360, w: 820, h: 1040 },
    })
    .returning();
  textBlockClipId = textBlock!.id;
});

afterAll(async () => {
  await pg.close();
});

describe("Service A hook listings never return a text block clip", () => {
  it("GET /api/hooks?personaId= returns the persona's hook clip only", async () => {
    const response = await listHooks(
      new Request(`http://localhost/api/hooks?personaId=${personaId}`),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { hooks: { id: string }[] };
    expect(body.hooks.map((h) => h.id)).toEqual([hookClipId]);
    expect(body.hooks.map((h) => h.id)).not.toContain(textBlockClipId);
  });

  it("GET /api/hooks (the generic listing) returns the generic hook clip only", async () => {
    const response = await listHooks(new Request("http://localhost/api/hooks"));
    const body = (await response.json()) as { hooks: { id: string }[] };
    expect(body.hooks.map((h) => h.id)).toEqual([genericHookClipId]);
  });

  it("the Service A persona catalog counts hook clips, not text block clips", async () => {
    // The persona qualifies through its hook clip; retire that and the text
    // block clip alone does not keep it in the A catalog.
    expect((await loadPersonaCatalog("a")).map((p) => p.id)).toEqual([personaId]);
    const db = fixture.db as ReturnType<typeof core.getDb>;
    await db
      .update(core.schema.hookClips)
      .set({ active: false })
      .where(eq(core.schema.hookClips.id, hookClipId));
    expect(await loadPersonaCatalog("a")).toEqual([]);
  });
});
