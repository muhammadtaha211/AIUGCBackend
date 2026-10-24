import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The demo name (decision 0125) over the real route handlers on PGlite: a
 * demo registered with the field skipped stays unnamed; a name saved from the
 * upload step is returned by the demo GET and by both shapes of the business
 * list, and survives a note-only save; rename and clear; the 40-character cap
 * at the route; another account's demo refused untouched; and a name-only
 * save leaving updated_at — the raw file's retention clock — alone.
 * DRY_RUN, so nothing calls a provider.
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

const core = await import("@aiugc/core");
const { createTestDb } = await import("../../../packages/core/test/helpers/pglite");
const { tempStorage } = await import("../../../packages/core/test/helpers/storage");
const { POST: register, GET: list } =
  await import("../src/app/api/businesses/[businessId]/demos/route");
const { GET: getDemo, PATCH: patchDemo } = await import("../src/app/api/demos/[id]/route");

const schema = core.schema;
type Db = ReturnType<typeof core.getDb>;

const NO_ACCESS = { ok: false, error: "אין לך גישה לעסק הזה." };
const NOT_FOUND = { ok: false, error: "לא נמצא." };
const INVALID = { ok: false, error: "הבקשה לא תקינה." };
/** Latin first, inside an RTL page: the mixed case the display isolates. */
const MIXED = "Tavnit — אשף הוק + דמו";

const send = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const forBusiness = (businessId: string) => ({ params: Promise.resolve({ businessId }) });
const forDemo = (id: string) => ({ params: Promise.resolve({ id }) });

let pg: { close(): Promise<void> };
let db: Db;
let cleanup: () => void;
let customer: { id: string; ownerUserId: string };
let stranger: { id: string; ownerUserId: string };

const as = (business: { ownerUserId: string } | null) => {
  fixture.user = business ? { id: business.ownerUserId, email: "someone@names.test" } : null;
};

/** The upload step's register call, then ingest stood in for: ready, a length. */
async function uploadedDemo(businessId: string): Promise<string> {
  const uploadPath = `raw/${businessId}/demo/${crypto.randomUUID()}/demo.mp4`;
  const res = await register(send("POST", "/x", { uploadPath }), forBusiness(businessId));
  expect(res.status).toBe(200);
  const { demoId } = (await res.json()) as { demoId: string };
  await db
    .update(schema.demos)
    .set({ status: "ready", durationMs: 41_000, normalizedPath: "assets/x/n.mp4" })
    .where(eq(schema.demos.id, demoId));
  return demoId;
}

async function row(demoId: string) {
  const [found] = await db.select().from(schema.demos).where(eq(schema.demos.id, demoId));
  return found!;
}

const patch = (demoId: string, body: unknown) =>
  patchDemo(send("PATCH", "/x", body), forDemo(demoId));

async function readBack(demoId: string) {
  const one = (await (await getDemo(send("GET", "/x"), forDemo(demoId))).json()) as {
    name?: string;
  };
  const all = (await (await list(send("GET", "/x"), forBusiness(customer.id))).json()) as {
    demos: { id: string; name?: string }[];
  };
  const paged = (await (await list(send("GET", "/x?page=1"), forBusiness(customer.id))).json()) as {
    demos: { id: string; name?: string }[];
    durations: { id: string; name?: string }[];
  };
  return {
    one,
    listed: all.demos.find((d) => d.id === demoId)!,
    picked: paged.demos.find((d) => d.id === demoId)!,
    duration: paged.durations.find((d) => d.id === demoId)!,
  };
}

beforeAll(async () => {
  process.env.DRY_RUN = "1";
  core.resetEnvCache();
  const testDb = await createTestDb();
  db = testDb.db as unknown as Db;
  fixture.db = db;
  pg = testDb.pg;
  const ts = tempStorage();
  core.setStorage(ts.storage);
  cleanup = ts.cleanup;

  customer = await core.createBusiness(db, { ownerEmail: "c@names.test", name: "עסק" });
  stranger = await core.createBusiness(db, { ownerEmail: "s@names.test", name: "זר" });
});

afterAll(async () => {
  await pg.close();
  cleanup();
});

describe("demo names (decision 0125)", () => {
  it("a demo registered with the field skipped stays unnamed everywhere", async () => {
    as(customer);
    const demoId = await uploadedDemo(customer.id);
    // A's continue with the name field left empty sends the note alone.
    expect((await patch(demoId, { description: "" })).status).toBe(200);

    expect((await row(demoId)).name).toBeNull();
    const seen = await readBack(demoId);
    expect("name" in seen.one).toBe(false);
    expect("name" in seen.listed).toBe(false);
    expect("name" in seen.picked).toBe(false);
    expect("name" in seen.duration).toBe(false);
  });

  it("a name saved from the upload step is returned everywhere and kept by a note-only save", async () => {
    as(customer);
    const demoId = await uploadedDemo(customer.id);
    expect((await patch(demoId, { description: "גלילה בתפריט", name: MIXED })).status).toBe(200);

    const seen = await readBack(demoId);
    expect(seen.one.name).toBe(MIXED);
    expect(seen.listed.name).toBe(MIXED);
    expect(seen.picked.name).toBe(MIXED);
    expect(seen.duration.name).toBe(MIXED);

    // A later continue with the field untouched sends no name key.
    expect((await patch(demoId, { description: "הערה אחרת" })).status).toBe(200);
    expect(await row(demoId)).toMatchObject({ name: MIXED, description: "הערה אחרת" });
  });

  it("renames, and clears on an empty or blank name, leaving the note alone", async () => {
    as(customer);
    const demoId = await uploadedDemo(customer.id);
    await patch(demoId, { description: "הערה", name: "ראשון" });

    expect((await patch(demoId, { name: "שם חדש" })).status).toBe(200);
    expect(await row(demoId)).toMatchObject({ name: "שם חדש", description: "הערה" });

    expect((await patch(demoId, { name: "" })).status).toBe(200);
    expect(await row(demoId)).toMatchObject({ name: null, description: "הערה" });

    await patch(demoId, { name: "שוב" });
    expect((await patch(demoId, { name: "   " })).status).toBe(200);
    expect((await row(demoId)).name).toBeNull();
    expect("name" in (await readBack(demoId)).listed).toBe(false);
  });

  it("holds the 40-character cap at the route, after trimming", async () => {
    as(customer);
    const demoId = await uploadedDemo(customer.id);
    await patch(demoId, { name: "קיים" });
    const forty = "א".repeat(40);

    const over = await patch(demoId, { name: `${forty}ב` });
    expect(over.status).toBe(400);
    expect(await over.json()).toEqual(INVALID);
    expect((await row(demoId)).name).toBe("קיים");

    expect((await patch(demoId, { name: `  ${forty}  ` })).status).toBe(200);
    expect((await row(demoId)).name).toBe(forty);
  });

  it("refuses another account's demo and leaves it as it was", async () => {
    as(customer);
    const demoId = await uploadedDemo(customer.id);
    await patch(demoId, { name: "שלי" });

    as(stranger);
    const foreign = await patch(demoId, { name: "של מישהו אחר" });
    // The project's ownership gate: 403 on someone else's row, 404 on none.
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual(NO_ACCESS);
    expect((await getDemo(send("GET", "/x"), forDemo(demoId))).status).toBe(403);
    expect((await row(demoId)).name).toBe("שלי");

    const missing = await patch(crypto.randomUUID(), { name: "x" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual(NOT_FOUND);
    expect((await patch("not-a-uuid", { name: "x" })).status).toBe(404);

    as(null);
    expect((await patch(demoId, { name: "x" })).status).toBe(401);
    expect((await row(demoId)).name).toBe("שלי");
  });

  it("a name-only save leaves updated_at, the raw file's retention clock, alone", async () => {
    as(customer);
    const demoId = await uploadedDemo(customer.id);
    const old = new Date("2026-09-01T00:00:00.000Z");
    await db.update(schema.demos).set({ updatedAt: old }).where(eq(schema.demos.id, demoId));

    expect((await patch(demoId, { name: "ספריית הסרטונים" })).status).toBe(200);
    expect((await row(demoId)).updatedAt.toISOString()).toBe(old.toISOString());
  });

  it("refuses a body with neither key, or a name that is not a string", async () => {
    as(customer);
    const demoId = await uploadedDemo(customer.id);
    for (const body of [{}, { name: 5 }, { name: null }, null]) {
      const res = await patch(demoId, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(INVALID);
    }
    expect((await row(demoId)).name).toBeNull();
  });
});
