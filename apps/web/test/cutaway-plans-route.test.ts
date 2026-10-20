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
  await core.grantCredits(db, { userId: customer.ownerUserId, credits: 500, note: "test" });
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
  it("drafts the demo in order, free, and returns the same plan on a second visit", async () => {
    as(customer);
    const first = await draft(send("POST", "/x", { audioId, demoId }), forBusiness(customer.id));
    expect(first.status).toBe(200);
    const plan = (await first.json()) as Plan;
    expect(plan.slots.length).toBeGreaterThanOrEqual(1);
    expect(plan.words).toHaveLength(45);
    const again = await draft(send("POST", "/x", { audioId, demoId }), forBusiness(customer.id));
    expect(((await again.json()) as Plan).planId).toBe(plan.planId);
    expect(await db.select().from(schema.usageEvents)).toHaveLength(0);
  });

  it("a hook text is a different layout and a new plan", async () => {
    as(customer);
    const plain = (await (
      await draft(send("POST", "/x", { audioId, demoId }), forBusiness(customer.id))
    ).json()) as Plan;
    const hooked = (await (
      await draft(
        send("POST", "/x", { audioId, demoId, hookText: "מילה0 מילה1 מילה2" }),
        forBusiness(customer.id),
      )
    ).json()) as Plan;
    expect(hooked.planId).not.toBe(plain.planId);
    expect(hooked.hookText).toBe("מילה0 מילה1 מילה2");
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

describe("PATCH /api/businesses/[businessId]/cutaway-plans/[planId]", () => {
  it("moves a window to another moment and refuses what the picker never offers", async () => {
    as(customer);
    const plan = (await (
      await draft(send("POST", "/x", { audioId, demoId }), forBusiness(customer.id))
    ).json()) as Plan;
    const starts = plan.slots.map((s) => s.demoStartMs);
    const later = plan.anchors.find((a) => a.stateIndex === 27)!.startMs;
    const moved = [...starts.slice(0, -1), later];
    const ok = await save(
      send("PATCH", "/x", { starts: moved }),
      forPlan(customer.id, plan.planId),
    );
    expect(ok.status).toBe(200);
    const saved = (await ok.json()) as Plan;
    expect(saved.slots.at(-1)!.demoStartMs).toBe(later);
    expect(saved.slots.at(-1)!.draftDemoStartMs).toBe(starts.at(-1));

    const notAMoment = await save(
      send("PATCH", "/x", { starts: starts.map((s) => s + 1) }),
      forPlan(customer.id, plan.planId),
    );
    expect(notAMoment.status).toBe(422);
    if (starts.length > 1) {
      const overlap = await save(
        send("PATCH", "/x", { starts: starts.map(() => starts[0]) }),
        forPlan(customer.id, plan.planId),
      );
      expect(overlap.status).toBe(422);
    }
    const wrongCount = await save(
      send("PATCH", "/x", { starts: [...starts, later] }),
      forPlan(customer.id, plan.planId),
    );
    expect(wrongCount.status).toBe(422);
    const extra = await save(
      send("PATCH", "/x", { starts, fromMs: [0] }),
      forPlan(customer.id, plan.planId),
    );
    expect(extra.status).toBe(400);
    const malformed = await save(send("PATCH", "/x", { starts }), forPlan(customer.id, "plan-1"));
    expect(malformed.status).toBe(404);

    // The stranger's own business, with the customer's plan id: not theirs.
    as(stranger);
    const foreign = await save(send("PATCH", "/x", { starts }), forPlan(stranger.id, plan.planId));
    expect(foreign.status).toBe(404);
  });
});

describe("POST /api/businesses/[businessId]/renders with a cutaway plan", () => {
  it("copies the plan's windows onto the render; without one the params carry none", async () => {
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
    const plan = (await (
      await draft(send("POST", "/x", { audioId, demoId }), forBusiness(customer.id))
    ).json()) as Plan;
    const body = { scriptId, audioId, personaId: persona.id, personaImageId: image.id };

    const withCutaways = await createRender(
      send("POST", "/x", { ...body, cutawayPlanId: plan.planId }),
      forBusiness(customer.id),
    );
    expect(withCutaways.status).toBe(200);
    const { renderId } = await withCutaways.json();
    const [row] = await db
      .select()
      .from(schema.videoRenders)
      .where(eq(schema.videoRenders.id, renderId));
    expect((row!.params as { cutaways?: { planId: string } }).cutaways?.planId).toBe(plan.planId);

    const headOnly = await createRender(send("POST", "/x", body), forBusiness(customer.id));
    const [plain] = await db
      .select()
      .from(schema.videoRenders)
      .where(eq(schema.videoRenders.id, (await headOnly.json()).renderId));
    expect(plain!.params).not.toHaveProperty("cutaways");

    // A plan laid out for no hook text cannot ride a render that burns one.
    const stale = await createRender(
      send("POST", "/x", {
        ...body,
        hookEffect: "zoom",
        hookText: "מילה0 מילה1 מילה2",
        cutawayPlanId: plan.planId,
      }),
      forBusiness(customer.id),
    );
    expect(stale.status).toBe(409);
  });
});
