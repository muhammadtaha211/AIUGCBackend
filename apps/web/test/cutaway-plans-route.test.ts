import { eq } from "drizzle-orm";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Demo cutaways over the real route handlers on PGlite (vault 0121): the draft
 * (free, idempotent, laid out from the hook text), the window picker's save,
 * and the render that copies the plan — then the refusals: another business's
 * demo or plan, a demo still being analysed, bodies with keys they may not
 * carry, a start that is not a moment, two windows on the same footage.
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
const { POST: draft } = await import("../src/app/api/businesses/[businessId]/cutaway-plans/route");
const { PATCH: save } =
  await import("../src/app/api/businesses/[businessId]/cutaway-plans/[planId]/route");
const { POST: createRender } = await import("../src/app/api/businesses/[businessId]/renders/route");

const schema = core.schema;
type Db = ReturnType<typeof core.getDb>;
type Plan = import("../src/lib/service-b-ui").CutawayPlanWire;

const send = (method: string, url: string, body: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const forBusiness = (businessId: string) => ({ params: Promise.resolve({ businessId }) });
const forPlan = (businessId: string, planId: string) => ({
  params: Promise.resolve({ businessId, planId }),
});

/** 15 three-word chunks 1.2 s apart: an 18 s voice that lays out two cutaways. */
const CAPTIONS = Array.from({ length: 15 }, (_, c) => ({
  text: "",
  startMs: c * 1200,
  endMs: c * 1200 + 1100,
  words: [0, 1, 2].map((w) => ({
    word: `מילה${c * 3 + w}`,
    startMs: c * 1200 + w * 400,
    endMs: c * 1200 + w * 400 + 350,
  })),
}));

let pg: { close(): Promise<void> };
let db: Db;
let cleanup: () => void;
let customer: { id: string; ownerUserId: string };
let stranger: { id: string; ownerUserId: string };
let scriptId: string;
let audioId: string;
let demoId: string;
let foreignDemoId: string;
let analysingDemoId: string;

const as = (business: { ownerUserId: string }) => {
  fixture.user = { id: business.ownerUserId, email: "someone@cutaways.test" };
};

async function approvedAudio(businessId: string) {
  const [script] = await db
    .insert(schema.scripts)
    .values({
      businessId,
      kind: "b_script",
      text: CAPTIONS.map((c) => c.words.map((w) => w.word).join(" ")).join(" "),
    })
    .returning();
  const [audio] = await db
    .insert(schema.audioRenders)
    .values({
      scriptId: script!.id,
      voiceId: "voice_noa",
      status: "ready",
      filePath: "renders/x/vo.mp3",
      durationMs: 18_000,
      wordTimestamps: CAPTIONS,
      approvedAt: new Date(),
    })
    .returning();
  return { scriptId: script!.id, audioId: audio!.id };
}

async function readyDemo(businessId: string, analysis: "ready" | "analysing") {
  const [demo] = await db
    .insert(schema.demos)
    .values({
      businessId,
      status: "ready",
      normalizedPath: "assets/x/normalized.mp4",
      durationMs: 62_000,
    })
    .returning();
  await db.insert(schema.demoAnalyses).values({
    demoId: demo!.id,
    status: analysis,
    timeline:
      analysis === "ready"
        ? Array.from({ length: 30 }, (_, i) => ({
            timestampMs: 600 + i * 2000,
            screenName: `מסך ${i}`,
            visibleText: [],
            action: `step ${i}`,
            actionType: "tap",
            screenKind: "product",
            sameStateAsPrevious: false,
            legibility: "high",
            salienceNote: null,
            thumbPath: `assets/x/${i}.jpg`,
          }))
        : null,
  });
  return demo!.id;
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

  customer = await core.createBusiness(db, { ownerEmail: "c@cutaways.test", name: "עסק" });
  await core.grantCredits(db, { userId: customer.ownerUserId, credits: 5000, note: "test" });
  stranger = await core.createBusiness(db, { ownerEmail: "s@cutaways.test", name: "זר" });
  ({ scriptId, audioId } = await approvedAudio(customer.id));
  demoId = await readyDemo(customer.id, "ready");
  analysingDemoId = await readyDemo(customer.id, "analysing");
  foreignDemoId = await readyDemo(stranger.id, "ready");
});

afterAll(async () => {
  await pg.close();
  cleanup();
});

describe("POST /api/businesses/[businessId]/cutaway-plans", () => {
  it("drafts from the product mention, the demo in order, free, and returns the same plan on a second visit", async () => {
    as(customer);
    const first = await draft(send("POST", "/x", { audioId, demoId }), forBusiness(customer.id));
    expect(first.status).toBe(200);
    const plan = (await first.json()) as Plan;
    expect(plan.slots.length).toBeGreaterThanOrEqual(1);
    expect(plan.captions).toHaveLength(15);
    // No name to hear: 40% of the 18 s voice.
    expect(plan.mentionMs).toBe(7200);
    for (const slot of plan.slots) expect(slot.fromMs).toBeGreaterThanOrEqual(plan.mentionMs);
    const again = await draft(send("POST", "/x", { audioId, demoId }), forBusiness(customer.id));
    expect(((await again.json()) as Plan).planId).toBe(plan.planId);
    expect(await db.select().from(schema.usageEvents)).toHaveLength(0);
  });

  it("takes no hook text from the client: the layout's line is the script's own", async () => {
    as(customer);
    const hooked = await draft(
      send("POST", "/x", { audioId, demoId, hookText: "מילה0 מילה1 מילה2" }),
      forBusiness(customer.id),
    );
    expect(hooked.status).toBe(400);
  });

  it("refuses another business's demo, a demo still in analysis, extra keys and a stranger", async () => {
    as(customer);
    const foreign = await draft(
      send("POST", "/x", { audioId, demoId: foreignDemoId }),
      forBusiness(customer.id),
    );
    expect(foreign.status).toBe(404);
    const analysing = await draft(
      send("POST", "/x", { audioId, demoId: analysingDemoId }),
      forBusiness(customer.id),
    );
    expect(analysing.status).toBe(409);
    expect((await analysing.json()).error).toMatch(/בניתוח/);
    const extra = await draft(
      send("POST", "/x", { audioId, demoId, slots: [] }),
      forBusiness(customer.id),
    );
    expect(extra.status).toBe(400);
    as(stranger);
    const notTheirs = await draft(
      send("POST", "/x", { audioId, demoId }),
      forBusiness(customer.id),
    );
    expect(notTheirs.status).toBe(403);
  });
});

/** The plan as the wizard holds it right now. */
async function currentPlan(): Promise<Plan> {
  as(customer);
  return (await (
    await draft(send("POST", "/x", { audioId, demoId }), forBusiness(customer.id))
  ).json()) as Plan;
}

const edits = (plan: Plan) =>
  plan.slots.map(({ id, fromMs, toMs, demoStartMs }) => ({ id, fromMs, toMs, demoStartMs }));

describe("PATCH /api/businesses/[businessId]/cutaway-plans/[planId]", () => {
  it("moves a clip to another phrase, adds one, removes one — and refuses what the step never offers", async () => {
    const plan = await currentPlan();
    const patch = (body: unknown, planId = plan.planId, businessId = customer.id) =>
      save(send("PATCH", "/x", body), forPlan(businessId, planId));
    const window = (state: number) => plan.anchors.find((a) => a.stateIndex === state)!.startMs;

    // Moved to the first phrase: before the product mention, on purpose — allowed.
    const first = plan.slots[0]!;
    const moved = await patch({
      expectedUpdatedAt: plan.updatedAt,
      slots: [{ ...edits(plan)[0]!, fromMs: 1200, toMs: 1200 + (first.toMs - first.fromMs) }],
    });
    expect(moved.status).toBe(200);
    let saved = (await moved.json()) as Plan;
    expect(saved.slots[0]).toMatchObject({
      id: 1,
      fromMs: 1200,
      draftDemoStartMs: first.demoStartMs,
    });

    // Added, then the first removed.
    const added = await patch({
      expectedUpdatedAt: saved.updatedAt,
      slots: [...edits(saved), { id: 2, fromMs: 9600, toMs: 14_400, demoStartMs: window(27) }],
    });
    expect(added.status).toBe(200);
    saved = (await added.json()) as Plan;
    expect(saved.slots.map((s) => s.id)).toEqual([1, 2]);
    const removed = await patch({
      expectedUpdatedAt: saved.updatedAt,
      slots: edits(saved).filter((s) => s.id === 2),
    });
    expect(removed.status).toBe(200);
    saved = (await removed.json()) as Plan;
    expect(saved.slots.map((s) => s.id)).toEqual([2]);

    // A stale version: someone else's tab, or a tap racing a save.
    const stale = await patch({ expectedUpdatedAt: plan.updatedAt, slots: [] });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toMatch(/השתנו/);
    const v = saved.updatedAt;
    const clip = edits(saved)[0]!;
    // Off a spoken word, overlapping, reused footage, a twin id: 422 with the step's line.
    for (const slots of [
      [{ ...clip, fromMs: clip.fromMs + 1 }],
      [clip, { ...clip, id: 3, fromMs: clip.fromMs + 1200, toMs: clip.toMs + 1200 }],
      [clip, { id: 3, fromMs: 2400, toMs: 7200, demoStartMs: clip.demoStartMs }],
      [clip, { ...clip, fromMs: 2400, toMs: 7200 }],
    ]) {
      const refused = await patch({ expectedUpdatedAt: v, slots });
      expect(refused.status).toBe(422);
      expect((await refused.json()).error).toMatch(/הקטע/);
    }
    // What the schema never lets through: an id past 8, extra keys, a malformed plan id.
    expect((await patch({ expectedUpdatedAt: v, slots: [{ ...clip, id: 9 }] })).status).toBe(400);
    expect((await patch({ expectedUpdatedAt: v, slots: [clip], starts: [] })).status).toBe(400);
    expect((await patch({ expectedUpdatedAt: v, slots: [{ ...clip, label: "א" }] })).status).toBe(
      400,
    );
    expect((await patch({ expectedUpdatedAt: v, slots: [clip] }, "plan-1")).status).toBe(404);

    // The stranger's own business, with the customer's plan id: not theirs.
    as(stranger);
    expect(
      (await patch({ expectedUpdatedAt: v, slots: [] }, plan.planId, stranger.id)).status,
    ).toBe(404);
  });
});

describe("POST /api/businesses/[businessId]/renders with a cutaway plan", () => {
  it("copies the plan's clips onto the render, moves the one a longer hook text reaches, and carries none with none left", async () => {
    as(customer);
    const dir = path.join(tmpdir(), "aiugc-cutaway-route");
    mkdirSync(dir, { recursive: true });
    const selfie = path.join(dir, "selfie.jpg");
    writeFileSync(selfie, "fake");
    const persona = await core.addPersona(db, { name: "נועה", voiceId: "voice_noa" });
    const image = await core.addPersonaImage(db, {
      personaId: persona.id,
      filePath: selfie,
      kind: "selfie",
    });
    const body = { scriptId, audioId, personaId: persona.id, personaImageId: image.id };
    const paramsOf = async (response: Response) => {
      const [row] = await db
        .select()
        .from(schema.videoRenders)
        .where(eq(schema.videoRenders.id, (await response.json()).renderId));
      return row!.params as { cutaways?: { planId: string; slots: { fromMs: number }[] } };
    };

    // One clip early in the script, just after the first phrase.
    let plan = await currentPlan();
    const window = plan.anchors.find((a) => a.stateIndex === 5)!.startMs;
    plan = (await (
      await save(
        send("PATCH", "/x", {
          expectedUpdatedAt: plan.updatedAt,
          slots: [{ id: 1, fromMs: 1200, toMs: 6000, demoStartMs: window }],
        }),
        forPlan(customer.id, plan.planId),
      )
    ).json()) as Plan;

    const withCutaways = await createRender(
      send("POST", "/x", { ...body, cutawayPlanId: plan.planId }),
      forBusiness(customer.id),
    );
    expect(withCutaways.status).toBe(200);
    const params = await paramsOf(withCutaways);
    expect(params.cutaways?.planId).toBe(plan.planId);
    expect(params.cutaways?.slots.map((s) => s.fromMs)).toEqual([1200]);

    // Five spoken words leave on the phrase at 2.4 s: the clip under them moves there.
    const hooked = await createRender(
      send("POST", "/x", {
        ...body,
        hookEffect: "zoom",
        hookText: "מילה0 מילה1 מילה2 מילה3 מילה4",
        cutawayPlanId: plan.planId,
      }),
      forBusiness(customer.id),
    );
    expect(hooked.status).toBe(200);
    expect((await paramsOf(hooked)).cutaways?.slots.map((s) => s.fromMs)).toEqual([2400]);

    const headOnly = await createRender(send("POST", "/x", body), forBusiness(customer.id));
    expect(await paramsOf(headOnly)).not.toHaveProperty("cutaways");

    // Every clip removed, the plan still sent: today's ad, no cutaways key.
    await save(
      send("PATCH", "/x", { expectedUpdatedAt: plan.updatedAt, slots: [] }),
      forPlan(customer.id, plan.planId),
    );
    const emptied = await createRender(
      send("POST", "/x", { ...body, cutawayPlanId: plan.planId }),
      forBusiness(customer.id),
    );
    expect(emptied.status).toBe(200);
    expect(await paramsOf(emptied)).not.toHaveProperty("cutaways");
  });
});
