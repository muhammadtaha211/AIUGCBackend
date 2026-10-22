import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The finished video's "גרסה נוספת" (decision 0124), over the real
 * GET /api/renders/[id] on PGlite and the real player markup:
 *
 * - a released steps-format A render gets it, pointed at the A wizard with its
 *   recording held (?demo=, which the wizard restores onto the character step);
 * - its price is the quote's, read live — move a_steps_credits and the number
 *   moves — and it is named only when the quote gives the discount;
 * - a released C render gets it, pointed at the text step's character and clip,
 *   with no price;
 * - B, the retired full format and an unfinished render get nothing.
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
const { GET: pollRender } = await import("../src/app/api/renders/[id]/route");
const { RenderPlayer } = await import("../src/components/render-player");
const { NEXT_VERSION_BUTTON, nextVersionLine } = await import("../src/lib/quote-ui");
const { cWizardEntry } = await import("../src/lib/service-c-ui");
const { STEP_EVENTS, stepProperties } = await import("../src/lib/analytics");

const schema = core.schema;
type Db = ReturnType<typeof core.getDb>;
type Business = { id: string; ownerUserId: string };

let pg: { close(): Promise<void> };
let db: Db;
let customer: Business;
let admin: Business;

const as = (business: Business) => {
  fixture.user = { id: business.ownerUserId, email: "someone@next.test" };
};

async function poll(renderId: string) {
  const response = await pollRender(new Request(`http://localhost/api/renders/${renderId}`), {
    params: Promise.resolve({ id: renderId }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { status: string; nextVersion?: unknown };
}

/** A recording with one finished render of it; `paid` debits that render. */
async function aRender(
  business: Business,
  opts: { format?: "steps" | "full"; paid?: boolean; status?: "released" | "rendering" } = {},
) {
  const [demo] = await db
    .insert(schema.demos)
    .values({ businessId: business.id, status: "ready" })
    .returning();
  const [set] = await db
    .insert(schema.sets)
    .values({ businessId: business.id, demoId: demo!.id, service: "a", grid: {} })
    .returning();
  const [render] = await db
    .insert(schema.videoRenders)
    .values({
      businessId: business.id,
      setId: set!.id,
      service: "a",
      params:
        opts.format === "full"
          ? { format: "full" }
          : { format: "steps", stepPlanId: crypto.randomUUID() },
      status: opts.status ?? "released",
      filePath: `renders/${crypto.randomUUID()}.mp4`,
    })
    .returning();
  if (opts.paid) {
    await core.debitRender(db, { businessId: business.id, videoRenderId: render!.id, cost: 45 });
  }
  return { demoId: demo!.id, renderId: render!.id };
}

async function setStepsCredits(credits: number) {
  const [row] = await db
    .select()
    .from(schema.appConfig)
    .where(eq(schema.appConfig.key, "credit_costs"));
  await db
    .update(schema.appConfig)
    .set({ value: { ...(row!.value as object), a_steps_credits: credits } })
    .where(eq(schema.appConfig.key, "credit_costs"));
}

beforeAll(async () => {
  process.env.DRY_RUN = "1";
  core.resetEnvCache();
  const testDb = await createTestDb();
  db = testDb.db as unknown as Db;
  fixture.db = db;
  pg = testDb.pg;

  customer = await core.createBusiness(db, { ownerEmail: "customer@next.test", name: "Biz" });
  await core.grantCredits(db, { userId: customer.ownerUserId, credits: 1000, note: "test" });
  admin = await core.createBusiness(db, {
    ownerEmail: "founder@next.test",
    name: "Founder",
    ownerRole: "admin",
  });
}, 120_000);

afterAll(async () => {
  await pg.close();
});

describe("GET /api/renders/[id] — the next version (decision 0124)", () => {
  it("a finished hook + demo video opens the A wizard with its recording held", async () => {
    as(customer);
    const { demoId, renderId } = await aRender(customer, { paid: true });
    const body = await poll(renderId);
    expect(body.nextVersion).toEqual({
      service: "a",
      href: `/home/a/new?demo=${demoId}`,
      credits: 25,
    });
  });

  it("the price is the quote's, read live — never a literal", async () => {
    as(customer);
    const { demoId, renderId } = await aRender(customer, { paid: true });
    const quote = await core.quoteStepsASet(db, customer.id, demoId);
    try {
      await setStepsCredits(31);
      expect((await poll(renderId)).nextVersion).toMatchObject({ credits: 31 });
      // And it is the number the render step's confirm will carry.
      const next = await core.quoteStepsASet(db, customer.id, demoId);
      expect(core.quoteTotal(next, 1)).toBe(31);
    } finally {
      await setStepsCredits(quote.creditsPerRender);
    }
  });

  it("names no price when the quote gives no discount: the analysis still owed, or the admin bypass", async () => {
    as(customer);
    const unpaid = await aRender(customer);
    const owed = await poll(unpaid.renderId);
    expect(owed.nextVersion).toEqual({
      service: "a",
      href: `/home/a/new?demo=${unpaid.demoId}`,
    });

    as(admin);
    const founders = await aRender(admin);
    expect(await poll(founders.renderId)).toMatchObject({
      nextVersion: { service: "a", href: `/home/a/new?demo=${founders.demoId}` },
    });
    expect((await poll(founders.renderId)).nextVersion).not.toHaveProperty("credits");
  });

  it("a finished גוש טקסט goes back to the text step with the same character and clip", async () => {
    as(customer);
    const persona = await core.addPersona(db, { name: "רוני", gender: "female" });
    const [clip] = await db
      .insert(schema.textBlockClips)
      .values({
        filePath: `assets/bank/text_block_clip/${crypto.randomUUID()}/clip.mp4`,
        durationMs: 12_000,
        speakerGender: "female",
        textSafeArea: { x: 80, y: 360, w: 820, h: 1040 },
        personaId: persona.id,
      })
      .returning();
    const [render] = await db
      .insert(schema.videoRenders)
      .values({
        businessId: customer.id,
        service: "c",
        params: { textBlockClipId: clip!.id, scriptId: crypto.randomUUID(), text: "טקסט" },
        status: "released",
        filePath: `renders/${crypto.randomUUID()}.mp4`,
      })
      .returning();
    expect((await poll(render!.id)).nextVersion).toEqual({
      service: "c",
      href: `/home/c/new?persona=${persona.id}&clip=${clip!.id}`,
    });
  });

  it("B, the retired full format and an unfinished render get nothing", async () => {
    as(customer);
    const [b] = await db
      .insert(schema.videoRenders)
      .values({
        businessId: customer.id,
        service: "b",
        params: {},
        status: "released",
        filePath: `renders/${crypto.randomUUID()}.mp4`,
      })
      .returning();
    expect((await poll(b!.id)).status).toBe("released");
    expect(await poll(b!.id)).not.toHaveProperty("nextVersion");

    const full = await aRender(customer, { format: "full", paid: true });
    expect(await poll(full.renderId)).not.toHaveProperty("nextVersion");

    const rendering = await aRender(customer, { status: "rendering" });
    expect(await poll(rendering.renderId)).not.toHaveProperty("nextVersion");
  });
});

describe("the player's next version", () => {
  const markup = (props: Parameters<typeof RenderPlayer>[0]) =>
    renderToStaticMarkup(createElement(RenderPlayer, props));

  it("is not there without the route's say-so — every B render", () => {
    const html = markup({ videoUrl: "v", downloadUrl: "d", scheduleHref: "/schedule/r" });
    expect(html).not.toContain(NEXT_VERSION_BUTTON);
  });

  it("A: the action and the line, with the number it was given", () => {
    for (const credits of [25, 31]) {
      const html = markup({
        videoUrl: "v",
        nextVersion: { service: "a", href: "/home/a/new?demo=x", credits },
      });
      expect(html).toContain(NEXT_VERSION_BUTTON);
      expect(html).toContain('href="/home/a/new?demo=x"');
      expect(html).toContain(nextVersionLine(credits));
      expect(html).toContain(`${credits} קרדיטים`);
    }
  });

  it("C: the action and no line", () => {
    const html = markup({
      videoUrl: "v",
      nextVersion: { service: "c", href: "/home/c/new?persona=p&clip=c" },
    });
    expect(html).toContain(NEXT_VERSION_BUTTON);
    expect(html).not.toContain(nextVersionLine(undefined));
  });

  it("reserved at a modal's open: inert, and no line until the route answers", () => {
    const html = markup({ nextVersion: { service: "a" } });
    expect(html).toContain(NEXT_VERSION_BUTTON);
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain(nextVersionLine(undefined));
  });
});

describe("the next version's line, entry and event", () => {
  it("the line names the number it is given, and no discount without one", () => {
    expect(nextVersionLine(7)).toContain("7 קרדיטים");
    expect(nextVersionLine(31)).toContain("31 קרדיטים");
    expect(nextVersionLine(undefined)).not.toContain("קרדיטים");
    expect(nextVersionLine(undefined)).not.toContain("בהנחה");
    // The pitch is in both: no results claim, no number of videos.
    expect(nextVersionLine(7).endsWith(nextVersionLine(undefined))).toBe(true);
  });

  it("the C entry takes two well-formed ids or nothing", () => {
    const persona = crypto.randomUUID();
    const clip = crypto.randomUUID();
    expect(cWizardEntry({ persona, clip })).toEqual({ personaId: persona, clipId: clip });
    expect(cWizardEntry({ persona })).toBeUndefined();
    expect(cWizardEntry({ persona, clip: "nope" })).toBeUndefined();
    expect(cWizardEntry({ persona: [persona, persona], clip })).toBeUndefined();
    expect(cWizardEntry({})).toBeUndefined();
  });

  it("the event carries the service, A or C only", () => {
    expect(STEP_EVENTS.next_version_started.service).toEqual(["a", "c"]);
    expect(stepProperties("next_version_started", { service: "a" })).toEqual({ service: "a" });
    expect(stepProperties("next_version_started", { service: "c" })).toEqual({ service: "c" });
    expect(stepProperties("next_version_started", { service: "b" })).toBeNull();
  });
});
