import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Service C clips (text_block_clips) never reach a Service A hook picker
 * (decision 0089 §4: "hook pickers never list these clips"). Structural — the
 * banks are two tables — and proven here against the two listings a customer
 * can reach: GET /api/hooks (both forms) and the Service A persona catalog.
 * The text block clip belongs to the same persona as the hook clip (0054), so
 * "not listed" is about the table, not about a missing owner.
 *
 * Then the other direction (decision 0099 §4): which characters the Service C
 * catalog lists, and that a voiceless character never reaches Service B.
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
      personaId,
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

describe("the Service C catalog lists characters with a usable text block clip", () => {
  const db = () => fixture.db as ReturnType<typeof core.getDb>;
  const ids = async (service: "a" | "b" | "c") =>
    (await loadPersonaCatalog(service)).map((p) => p.id).sort();

  /** A character with one image, and optionally one text block clip of its own. */
  async function character(opts: {
    voiceId?: string;
    imageKind: "preview" | "selfie";
    clip?: { active?: boolean; filePath?: string };
    active?: boolean;
  }) {
    const persona = await core.addPersona(db(), {
      name: "דמות",
      voiceId: opts.voiceId,
      gender: "female",
    });
    if (opts.active === false) {
      await db()
        .update(core.schema.personas)
        .set({ active: false })
        .where(eq(core.schema.personas.id, persona.id));
    }
    await db()
      .insert(core.schema.personaImages)
      .values({
        personaId: persona.id,
        filePath: `assets/bank/persona_image/${persona.id}/image.jpg`,
        kind: opts.imageKind,
        isDefault: true,
      });
    if (opts.clip) {
      await db()
        .insert(core.schema.textBlockClips)
        .values({
          filePath: opts.clip.filePath ?? `assets/bank/text_block_clip/${persona.id}/clip.mp4`,
          durationMs: 10_000,
          speakerGender: "female",
          textSafeArea: { x: 80, y: 360, w: 820, h: 1040 },
          personaId: persona.id,
          active: opts.clip.active ?? true,
        });
    }
    return persona.id;
  }

  it("a C-only character (preview image, no voice) is in C and in neither A nor B", async () => {
    const cOnly = await character({ imageKind: "preview", clip: {} });
    expect(await ids("c")).toEqual([personaId, cOnly].sort());
    expect(await ids("a")).not.toContain(cOnly);
    expect(await ids("b")).not.toContain(cOnly);
  });

  it("a voiceless character with a selfie is not in B", async () => {
    const voiceless = await character({ imageKind: "selfie" });
    const b = await ids("b");
    expect(b).toContain(personaId);
    expect(b).not.toContain(voiceless);
  });

  it("an inactive or pending clip, or an inactive character, keeps a character out of C", async () => {
    const inactiveClip = await character({ imageKind: "preview", clip: { active: false } });
    const pendingClip = await character({ imageKind: "preview", clip: { filePath: "pending" } });
    const inactivePersona = await character({ imageKind: "preview", clip: {}, active: false });
    const c = await ids("c");
    expect(c).not.toContain(inactiveClip);
    expect(c).not.toContain(pendingClip);
    expect(c).not.toContain(inactivePersona);
    expect(c).toContain(personaId);
  });
});
