import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Every Service C route refuses a non-admin at runtime — with no session and
 * with a signed-in customer — before it touches storage, the model or a
 * render. The static wiring test in admin.test.ts proves each file calls
 * requireAdmin; this one drives the handlers through the real requireAdmin
 * over a real (PGlite) users table and asserts the 403, and that the core
 * functions behind the guard were never called.
 */

const fixture = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  db: undefined as unknown,
  generateTextBlocks: vi.fn(),
  createTextBlockRender: vi.fn(),
  requestTextBlockClipNormalize: vi.fn(),
  updateScriptText: vi.fn(),
  getStorage: vi.fn(),
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
    getStorage: fixture.getStorage,
    generateTextBlocks: fixture.generateTextBlocks,
    createTextBlockRender: fixture.createTextBlockRender,
    requestTextBlockClipNormalize: fixture.requestTextBlockClipNormalize,
    updateScriptText: fixture.updateScriptText,
  };
});

const core = await import("@aiugc/core");
const { createTestDb } = await import("../../../packages/core/test/helpers/pglite");

const uploadUrl = await import("../src/app/api/admin/text-blocks/upload-url/route");
const register = await import("../src/app/api/admin/text-blocks/route");
const patch = await import("../src/app/api/admin/text-blocks/[id]/route");
const generate = await import("../src/app/api/admin/text-blocks/generate/route");
const editText = await import("../src/app/api/admin/text-blocks/scripts/[id]/text/route");
const createRender = await import("../src/app/api/admin/text-blocks/renders/route");

const UUID = "11111111-1111-4111-8111-111111111111";

function json(method: string, path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** Every new route, called with a well-formed body so only the guard can refuse it. */
const ROUTES: { name: string; call: () => Promise<Response> }[] = [
  {
    name: "POST /api/admin/text-blocks/upload-url",
    call: () =>
      uploadUrl.POST(
        json("POST", "/api/admin/text-blocks/upload-url", { type: "video/mp4", size: 1000 }),
      ),
  },
  {
    name: "POST /api/admin/text-blocks",
    call: () =>
      register.POST(
        json("POST", "/api/admin/text-blocks", {
          uploadPath: `assets/bank/text_block_clip/${UUID}/clip.mp4`,
          durationMs: 10_000,
          width: 1080,
          height: 1920,
          speakerGender: "female",
          textSafeArea: { x: 80, y: 360, w: 820, h: 1040 },
        }),
      ),
  },
  {
    name: "PATCH /api/admin/text-blocks/[id]",
    call: () =>
      patch.PATCH(json("PATCH", `/api/admin/text-blocks/${UUID}`, { active: false }), params(UUID)),
  },
  {
    name: "POST /api/admin/text-blocks/generate",
    call: () =>
      generate.POST(
        json("POST", "/api/admin/text-blocks/generate", { businessId: UUID, clipId: UUID }),
      ),
  },
  {
    name: "POST /api/admin/text-blocks/scripts/[id]/text",
    call: () =>
      editText.POST(
        json("POST", `/api/admin/text-blocks/scripts/${UUID}/text`, { text: "שלום" }),
        params(UUID),
      ),
  },
  {
    name: "POST /api/admin/text-blocks/renders",
    call: () =>
      createRender.POST(
        json("POST", "/api/admin/text-blocks/renders", {
          businessId: UUID,
          clipId: UUID,
          scriptId: UUID,
        }),
      ),
  },
];

let pg: { close(): Promise<void> };
let customer: { id: string; email: string };

beforeAll(async () => {
  const testDb = await createTestDb();
  fixture.db = testDb.db;
  pg = testDb.pg;
  const [row] = await testDb.db
    .insert(core.schema.users)
    .values({ email: "customer@example.com" }) // role defaults to customer
    .returning();
  customer = { id: row!.id, email: row!.email };
});

afterAll(async () => {
  await pg.close();
});

describe("Service C routes refuse non-admins", () => {
  for (const route of ROUTES) {
    it(`${route.name}: 403 with no session`, async () => {
      fixture.user = null;
      const response = await route.call();
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ ok: false, error: "אין הרשאה." });
    });

    it(`${route.name}: 403 for a signed-in customer`, async () => {
      fixture.user = customer;
      const response = await route.call();
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ ok: false, error: "אין הרשאה." });
    });
  }

  it("nothing behind the guard ran: no storage, no model, no render, no edit", () => {
    expect(fixture.getStorage).not.toHaveBeenCalled();
    expect(fixture.generateTextBlocks).not.toHaveBeenCalled();
    expect(fixture.createTextBlockRender).not.toHaveBeenCalled();
    expect(fixture.requestTextBlockClipNormalize).not.toHaveBeenCalled();
    expect(fixture.updateScriptText).not.toHaveBeenCalled();
  });
});
