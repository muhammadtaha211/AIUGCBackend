import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The גוש טקסט customer flow end to end over the real route handlers on PGlite
 * (decision 0099): the C catalog → one character's clips → texts served one at
 * a time → a free edit held to the render rules → the 25-credit quote → the
 * render with the customer's box, debited once → the library and the poll.
 * Then the refusals: a stranger's session, a foreign script, every clip the
 * gallery would never offer, and an empty balance. DRY_RUN, so the batch is
 * the founder's examples and the content-policy gate passes without a call.
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
      signedUrl: async (path: string, _ttl: number, opts?: { download?: string }) =>
        `https://signed.test/${path}${opts?.download ? `?download=${opts.download}` : ""}`,
      publicUrl: (path: string) => `https://public.test/${path}`,
    }),
  };
});

const core = await import("@aiugc/core");
const { createTestDb } = await import("../../../packages/core/test/helpers/pglite");
const { GET: listPersonas } = await import("../src/app/api/personas/route");
const { GET: listClips } = await import("../src/app/api/text-block-clips/route");
const { POST: nextText } =
  await import("../src/app/api/businesses/[businessId]/text-blocks/next/route");
const { POST: editText } = await import("../src/app/api/scripts/[id]/text/route");
const { GET: getQuote } =
  await import("../src/app/api/businesses/[businessId]/text-blocks/renders/quote/route");
const { POST: createRender } =
  await import("../src/app/api/businesses/[businessId]/text-blocks/renders/route");
const { GET: listRenders } = await import("../src/app/api/businesses/[businessId]/renders/route");
const { GET: pollRender } = await import("../src/app/api/renders/[id]/route");
const { wizardGate } = await import("../src/lib/wizard-gate");

const schema = core.schema;
type Db = ReturnType<typeof core.getDb>;

function post(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function forBusiness(businessId: string) {
  return { params: Promise.resolve({ businessId }) };
}

function forId(id: string) {
  return { params: Promise.resolve({ id }) };
}

const AREA = { x: 80, y: 360, w: 820, h: 1040 };
/** The customer's own box — not the clip's area, so the pin is provably theirs. */
const RECT = { x: 120, y: 500, w: 840, h: 900 };
const NO_ACCESS = { ok: false, error: "אין לך גישה לעסק הזה." };
const NOT_FOUND = { ok: false, error: "לא נמצא." };

let pg: { close(): Promise<void> };
let db: Db;
let customer: { id: string; ownerUserId: string };
let stranger: { id: string; ownerUserId: string };
let broke: { id: string; ownerUserId: string };
let personaId: string;
let clipId: string;
const refusedClips: Record<string, string> = {};
let maleClipId: string;

const as = (business: { ownerUserId: string }) => {
  fixture.user = { id: business.ownerUserId, email: "someone@flow.test" };
};

async function makeBusiness(email: string) {
  const business = await core.createBusiness(db, { ownerEmail: email, name: `Biz ${email}` });
  // No `wow`: `discovery` must never be written or served (decision 0099 §5).
  await core.setQuestionnaire(db, business.id, {
    category: "app_or_digital",
    product_name: "קורס אקסל",
    what_it_does: "מלמד אקסל מאפס",
    advantages: ["קצר וברור"],
    target_audience: "עובדי משרד",
    tone: "friendly",
  });
  return business;
}

async function clip(values: {
  personaId?: string;
  active?: boolean;
  speakerGender?: "female" | "male";
}) {
  const [row] = await db
    .insert(schema.textBlockClips)
    .values({
      filePath: `assets/bank/text_block_clip/${crypto.randomUUID()}/clip.mp4`,
      durationMs: 12_000,
      speakerGender: values.speakerGender ?? "female",
      textSafeArea: AREA,
      personaId: values.personaId,
      active: values.active ?? true,
    })
    .returning();
  return row!.id;
}

beforeAll(async () => {
  process.env.DRY_RUN = "1";
  core.resetEnvCache();
  const testDb = await createTestDb();
  db = testDb.db as unknown as Db;
  fixture.db = db;
  pg = testDb.pg;

  customer = await makeBusiness("customer@flow.test");
  await core.grantCredits(db, { userId: customer.ownerUserId, credits: 100, note: "test" });
  stranger = await makeBusiness("stranger@flow.test");
  await core.grantCredits(db, { userId: stranger.ownerUserId, credits: 100, note: "test" });
  broke = await makeBusiness("broke@flow.test");

  // A character for גוש טקסט alone: no voice, a preview portrait only.
  personaId = (await core.addPersona(db, { name: "רוני", gender: "female" })).id;
  await db.insert(schema.personaImages).values({
    personaId,
    filePath: `assets/bank/persona_image/${personaId}/preview.jpg`,
    kind: "preview",
  });
  clipId = await clip({ personaId });

  refusedClips.inactive = await clip({ personaId, active: false });
  refusedClips.unassigned = await clip({});
  const retired = await core.addPersona(db, { name: "דנה", gender: "female" });
  await db.update(schema.personas).set({ active: false }).where(eq(schema.personas.id, retired.id));
  refusedClips.inactivePersona = await clip({ personaId: retired.id });
  const [hook] = await db
    .insert(schema.hookClips)
    .values({ filePath: "assets/bank/hook_clip/h/clip.mp4", durationMs: 3500, textSafeArea: AREA })
    .returning();
  refusedClips.hookClip = hook!.id;
  refusedClips.unknown = crypto.randomUUID();

  const male = await core.addPersona(db, { name: "יואב", gender: "male" });
  maleClipId = await clip({ personaId: male.id, speakerGender: "male" });
});

afterAll(async () => {
  await pg.close();
  delete process.env.DRY_RUN;
  core.resetEnvCache();
});

describe("the גוש טקסט customer flow", () => {
  let servedIds: string[] = [];
  let editedId: string;
  let renderId: string;

  it("the C catalog lists the character, and its gallery lists its usable clip only", async () => {
    as(customer);
    const personas = await listPersonas(
      new Request("http://localhost/api/personas?withTextBlocks=1"),
    );
    expect(personas.status).toBe(200);
    const catalog = (await personas.json()) as { personas: { id: string; imageUrl: string }[] };
    expect(catalog.personas.map((p) => p.id)).toEqual([personaId]);
    expect(catalog.personas[0]!.imageUrl).toContain("preview.jpg");

    const clips = await listClips(
      new Request(`http://localhost/api/text-block-clips?personaId=${personaId}`),
    );
    expect(clips.status).toBe(200);
    const body = (await clips.json()) as { clips: Record<string, unknown>[] };
    expect(body.clips).toHaveLength(1);
    expect(body.clips[0]).toMatchObject({
      id: clipId,
      durationMs: 12_000,
      textSafeArea: AREA,
      textColor: "white",
    });
    expect(body.clips[0]!.previewUrl).toMatch(/^https:\/\/signed\.test\/assets\/bank\//);
  });

  it("the clip listing: no character is a 404, an unknown character an empty list", async () => {
    as(customer);
    for (const query of ["", "?personaId=not-a-uuid"]) {
      const response = await listClips(
        new Request(`http://localhost/api/text-block-clips${query}`),
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(NOT_FOUND);
    }
    const unknown = await listClips(
      new Request(`http://localhost/api/text-block-clips?personaId=${crypto.randomUUID()}`),
    );
    expect(await unknown.json()).toEqual({ clips: [] });
  });

  it("serves one text at a time: two clicks, two structures, neither discovery, one batch", async () => {
    as(customer);
    const served: { scriptId: string; text: string; skeleton: string }[] = [];
    for (let i = 0; i < 2; i++) {
      const response = await nextText(
        post(`/api/businesses/${customer.id}/text-blocks/next`, { clipId }),
        forBusiness(customer.id),
      );
      expect(response.status).toBe(200);
      served.push((await response.json()) as (typeof served)[number]);
    }
    expect(served[0]!.skeleton).not.toBe(served[1]!.skeleton);
    expect(served.map((s) => s.skeleton)).not.toContain("discovery");
    expect(served.every((s) => s.text.length > 0)).toBe(true);
    servedIds = served.map((s) => s.scriptId);

    // One batch of the nine fitting structures, `discovery` never written.
    const rows = await db
      .select()
      .from(schema.scripts)
      .where(
        and(eq(schema.scripts.businessId, customer.id), eq(schema.scripts.kind, "text_block")),
      );
    expect(rows).toHaveLength(9);
    expect(rows.map((r) => (r.params as { skeleton: string }).skeleton)).not.toContain("discovery");
  });

  it("an edit is held to the render rules, and a valid one is a new, normalized row", async () => {
    as(customer);
    const original = servedIds[0]!;
    const edit = (text: string) =>
      editText(post(`/api/scripts/${original}/text`, { text }), forId(original));

    const long = await edit("א".repeat(451));
    expect(long.status).toBe(400);
    expect(await long.json()).toEqual({
      ok: false,
      error: "הטקסט ארוך מדי — עד 450 תווים, ויש בו 451.",
    });

    const emoji = await edit("טקסט עם אימוג'י 😀");
    expect(emoji.status).toBe(400);
    expect(await emoji.json()).toEqual({
      ok: false,
      error: "הטקסט מכיל תו שלא ניתן לצרוב (U+1F600).",
    });

    const valid = await edit("  זה הטקסט   שלי \r\nשורה שנייה  ");
    expect(valid.status).toBe(200);
    const body = (await valid.json()) as { scriptId: string; text: string };
    expect(body.scriptId).not.toBe(original);
    expect(body.text).toBe("זה הטקסט שלי\nשורה שנייה");
    editedId = body.scriptId;
    const [row] = await db.select().from(schema.scripts).where(eq(schema.scripts.id, editedId));
    expect(row).toMatchObject({ kind: "text_block", userEdited: true, businessId: customer.id });
    expect((row!.params as { speakerGender: string }).speakerGender).toBe("female");
  });

  it("quotes the flat 25 against the balance", async () => {
    as(customer);
    const response = await getQuote(
      new Request(`http://localhost/api/businesses/${customer.id}/text-blocks/renders/quote`),
      forBusiness(customer.id),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ quote: { credits: 25, balance: 100, shortfall: 0 } });
  });

  it("renders the edit in the customer's box, debited once", async () => {
    as(customer);
    const response = await createRender(
      post(`/api/businesses/${customer.id}/text-blocks/renders`, {
        clipId,
        scriptId: editedId,
        textSafeArea: RECT,
      }),
      forBusiness(customer.id),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { renderId: string; balance: number };
    expect(body.balance).toBe(75);
    renderId = body.renderId;

    const [render] = await db
      .select()
      .from(schema.videoRenders)
      .where(eq(schema.videoRenders.id, renderId));
    expect(render).toMatchObject({ service: "c", status: "queued", businessId: customer.id });
    expect(render!.params).toMatchObject({
      textBlockClipId: clipId,
      scriptId: editedId,
      text: "זה הטקסט שלי\nשורה שנייה",
      textSafeArea: RECT,
    });
    const ledger = await db
      .select()
      .from(schema.creditLedger)
      .where(eq(schema.creditLedger.refId, renderId));
    expect(ledger.map((r) => ({ reason: r.reason, delta: r.delta }))).toEqual([
      { reason: "debit_render", delta: -25 },
    ]);
  });

  it("the library lists it, and once released the poll signs a download", async () => {
    as(customer);
    const library = await listRenders(
      new Request(`http://localhost/api/businesses/${customer.id}/renders?page=1`),
      forBusiness(customer.id),
    );
    const listed = (await library.json()) as { renders: { id: string; service: string }[] };
    expect(listed.renders).toContainEqual(expect.objectContaining({ id: renderId, service: "c" }));

    await db
      .update(schema.videoRenders)
      .set({ status: "released", filePath: `renders/${renderId}/out.mp4` })
      .where(eq(schema.videoRenders.id, renderId));
    const poll = await pollRender(
      new Request(`http://localhost/api/renders/${renderId}`),
      forId(renderId),
    );
    expect(poll.status).toBe(200);
    const state = (await poll.json()) as {
      status: string;
      videoUrl?: string;
      downloadUrl?: string;
    };
    expect(state.status).toBe("released");
    expect(state.videoUrl).toBe(`https://signed.test/renders/${renderId}/out.mp4`);
    expect(state.downloadUrl).toMatch(/\?download=tavnit-.*\.mp4$/);
  });
});

describe("the גוש טקסט routes refuse", () => {
  /** A text of the customer's own, served through the route. */
  async function servedText(business: { id: string; ownerUserId: string }) {
    as(business);
    const response = await nextText(
      post(`/api/businesses/${business.id}/text-blocks/next`, { clipId }),
      forBusiness(business.id),
    );
    return ((await response.json()) as { scriptId: string }).scriptId;
  }

  it("a stranger's session on next, quote and renders: 403", async () => {
    const scriptId = await servedText(customer);
    as(stranger);
    const responses = [
      await nextText(
        post(`/api/businesses/${customer.id}/text-blocks/next`, { clipId }),
        forBusiness(customer.id),
      ),
      await getQuote(
        new Request(`http://localhost/api/businesses/${customer.id}/text-blocks/renders/quote`),
        forBusiness(customer.id),
      ),
      await createRender(
        post(`/api/businesses/${customer.id}/text-blocks/renders`, {
          clipId,
          scriptId,
          textSafeArea: RECT,
        }),
        forBusiness(customer.id),
      ),
    ];
    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual(NO_ACCESS);
    }
  });

  it("another business's script on the stranger's own business: 403, and no render", async () => {
    const scriptId = await servedText(customer);
    as(stranger);
    const response = await createRender(
      post(`/api/businesses/${stranger.id}/text-blocks/renders`, {
        clipId,
        scriptId,
        textSafeArea: RECT,
      }),
      forBusiness(stranger.id),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "התסריט לא שייך לעסק הזה." });
    const renders = await db
      .select()
      .from(schema.videoRenders)
      .where(eq(schema.videoRenders.businessId, stranger.id));
    expect(renders).toEqual([]);
  });

  it("the edit route on a foreign script: 403", async () => {
    const scriptId = await servedText(customer);
    as(stranger);
    const response = await editText(
      post(`/api/scripts/${scriptId}/text`, { text: "טקסט של מישהו אחר" }),
      forId(scriptId),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(NO_ACCESS);
  });

  it("every clip the gallery would never offer: 404 on next and on renders", async () => {
    const scriptId = await servedText(customer);
    for (const [why, refused] of Object.entries(refusedClips)) {
      const next = await nextText(
        post(`/api/businesses/${customer.id}/text-blocks/next`, { clipId: refused }),
        forBusiness(customer.id),
      );
      expect([why, next.status, await next.json()]).toEqual([why, 404, NOT_FOUND]);
      const render = await createRender(
        post(`/api/businesses/${customer.id}/text-blocks/renders`, {
          clipId: refused,
          scriptId,
          textSafeArea: RECT,
        }),
        forBusiness(customer.id),
      );
      expect([why, render.status, await render.json()]).toEqual([why, 404, NOT_FOUND]);
    }
  });

  it("a text written for the other speaker's gender: 400 in Hebrew", async () => {
    const scriptId = await servedText(customer);
    const response = await createRender(
      post(`/api/businesses/${customer.id}/text-blocks/renders`, {
        clipId: maleClipId,
        scriptId,
        textSafeArea: RECT,
      }),
      forBusiness(customer.id),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: "הטקסט נכתב בקול של דמות אחרת — קבלו טקסט חדש לדמות הזאת.",
    });
  });

  it("an empty balance: gated at the wizard, 402 at confirm, and no render row", async () => {
    expect(await wizardGate(broke.id)).toEqual({ allowed: false, balance: 0 });
    expect((await wizardGate(customer.id)).allowed).toBe(true);

    const scriptId = await servedText(broke);
    const response = await createRender(
      post(`/api/businesses/${broke.id}/text-blocks/renders`, {
        clipId,
        scriptId,
        textSafeArea: RECT,
      }),
      forBusiness(broke.id),
    );
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({
      ok: false,
      error: "אין מספיק קרדיטים ליצירת הסרטון — חסרים 25.",
    });
    const renders = await db
      .select()
      .from(schema.videoRenders)
      .where(eq(schema.videoRenders.businessId, broke.id));
    expect(renders).toEqual([]);
  });
});
