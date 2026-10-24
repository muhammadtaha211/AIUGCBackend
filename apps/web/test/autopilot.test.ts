import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The Instagram autopilot on the web (decision 0127): who reaches the setup
 * (no switch row = admins only; a hidden account gets the same 404 a missing
 * route does), the setup's refusals in Hebrew, a stale resume, the calendar's
 * autopilot mark and skipped slots, and the sound picker's list mode leaving
 * the manual picker as it was.
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
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    notFound: () => {
      throw new Error("NEXT_NOT_FOUND");
    },
  };
});

const core = await import("@aiugc/core");
const { createTestDb } = await import("../../../packages/core/test/helpers/pglite");
const { tempStorage } = await import("../../../packages/core/test/helpers/storage");
const { socialTestEnv, seedReleasedRender } =
  await import("../../../packages/core/test/helpers/social");
const { seedWorld, israel, SOUNDS, accountInput } =
  await import("../../../packages/core/test/helpers/autopilot");
const autopilotRoute = await import("../src/app/api/autopilot/route");
const { POST: resume } = await import("../src/app/api/autopilot/resume/route");
const { GET: listPosts } = await import("../src/app/api/social/posts/route");
const { default: AutopilotPage } = await import("../src/app/(posting)/autopilot/page");
const { default: CalendarPage } = await import("../src/app/(posting)/calendar/page");
const { SoundPicker } = await import("../src/components/social/sound-picker");
const ui = await import("../src/lib/social-posting-ui");
const autopilotUi = await import("../src/lib/autopilot-ui");

const schema = core.schema;
type Db = ReturnType<typeof core.getDb>;
type World = Awaited<ReturnType<typeof seedWorld>>;

let pg: { close(): Promise<void> };
let db: Db;
let restoreEnv: () => void;
let cleanupStorage: () => void;
let world: World;
let customer: string;

const as = (userId: string | null) => {
  fixture.user = userId ? { id: userId, email: "someone@autopilot.test" } : null;
};
const put = (body: unknown) =>
  new Request("http://localhost/api/autopilot", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const post = (body: unknown) =>
  new Request("http://localhost/api/autopilot/resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function thrown(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "rendered";
  } catch (err) {
    return (err as Error).message;
  }
}

beforeAll(async () => {
  restoreEnv = socialTestEnv();
  ({ db, pg } = (await createTestDb()) as unknown as { db: Db; pg: { close(): Promise<void> } });
  fixture.db = db;
  const temp = tempStorage();
  cleanupStorage = temp.cleanup;
  core.setStorage(temp.storage);
  world = await seedWorld(db as never, { savedAt: israel("2026-10-24", "12:00") });
  const [row] = await db
    .insert(schema.users)
    .values({ email: "customer@autopilot.test" })
    .returning();
  customer = row!.id;
  (globalThis as { __storageRoot?: string }).__storageRoot = temp.root;
});

afterAll(async () => {
  core.setStorage(undefined);
  cleanupStorage();
  restoreEnv();
  await pg.close();
});

describe("who reaches the autopilot", () => {
  it("lets an admin in with no switch row, and answers anyone else the plain 404", async () => {
    as(world.userId);
    const ok = await autopilotRoute.GET(new Request("http://localhost/api/autopilot"));
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { setup: { accounts: unknown[]; demos: { name: string }[] } };
    expect(body.setup.accounts).toHaveLength(4);
    expect(body.setup.demos.map((d) => d.name)).toEqual(["Service B", "Service A"]);

    for (const who of [customer, null]) {
      as(who);
      const hidden = await autopilotRoute.GET(new Request("http://localhost/api/autopilot"));
      expect(hidden.status).toBe(404);
      expect(await hidden.json()).toEqual({ ok: false, error: "לא נמצא." });
      expect((await autopilotRoute.PUT(put({}))).status).toBe(404);
      expect((await resume(post({}))).status).toBe(404);
      expect(await thrown(AutopilotPage())).toBe("NEXT_NOT_FOUND");
    }
    as(world.userId);
    expect(await thrown(AutopilotPage())).toBe("rendered");
  });

  it("puts the setup link on the calendar for an admin only", async () => {
    as(world.userId);
    const page = (await CalendarPage({ searchParams: Promise.resolve({}) })) as ReactElement<{
      autopilot: boolean;
    }>;
    expect(isValidElement(page)).toBe(true);
    expect(page.props.autopilot).toBe(true);
  });
});

describe("the setup's refusals", () => {
  const shir = () => world.shape[0]!;
  const body = (overrides: Record<string, unknown> = {}, account = {}) => ({
    businessId: world.businessId,
    sounds: SOUNDS,
    accounts: [accountInput(world, shir(), account)],
    ...overrides,
  });

  it("refuses a count above the clips with the maximum, in Hebrew", async () => {
    as(world.userId);
    const res = await autopilotRoute.PUT(
      put(body({}, { aPerDay: 5, postTimes: ["09:00", "10:00", "11:00", "12:00", "13:00"] })),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      ok: false,
      error: autopilotUi.autopilotErrorLine("count_over_clips", { max: 4 }),
    });
  });

  it("refuses a character on two accounts, a business not his, and a body not shaped like a setup", async () => {
    as(world.userId);
    const two = await autopilotRoute.PUT(
      put({
        businessId: world.businessId,
        sounds: SOUNDS,
        accounts: [
          accountInput(world, world.shape[0]!),
          accountInput(world, world.shape[1]!, { personaIds: [world.personas.get("טליה")!] }),
        ],
      }),
    );
    expect(two.status).toBe(422);
    expect((await two.json()).error).toBe(
      autopilotUi.autopilotErrorLine("character_on_two_accounts"),
    );
    const notHis = await autopilotRoute.PUT(
      put(body({ businessId: "00000000-0000-4000-8000-000000000000" })),
    );
    expect(notHis.status).toBe(404);
    expect((await autopilotRoute.PUT(put({ accounts: "x" }))).status).toBe(400);
  });

  it("saves a good setup and answers the fresh state", async () => {
    as(world.userId);
    const res = await autopilotRoute.PUT(put(body()));
    expect(res.status).toBe(200);
    const saved = (await res.json()) as {
      setup: { accounts: { igUserId: string; aPerDay: number }[] };
    };
    expect(saved.setup.accounts.find((a) => a.igUserId === shir().igUserId)!.aPerDay).toBe(4);
  });

  it("answers a resume for a pause that moved on with a 409", async () => {
    as(world.userId);
    await db
      .update(schema.autopilotAccounts)
      .set({ pausedCause: "connection", pausedAt: new Date("2026-10-25T10:00:00Z") })
      .where(eq(schema.autopilotAccounts.igUserId, shir().igUserId));
    const stale = await resume(
      post({ igUserId: shir().igUserId, pausedAt: "2026-10-25T09:00:00.000Z" }),
    );
    expect(stale.status).toBe(409);
    const fresh = await resume(
      post({ igUserId: shir().igUserId, pausedAt: "2026-10-25T10:00:00.000Z" }),
    );
    expect(fresh.status).toBe(200);
    const [row] = await db
      .select()
      .from(schema.autopilotAccounts)
      .where(eq(schema.autopilotAccounts.igUserId, shir().igUserId));
    expect(row!.pausedCause).toBeNull();
  });
});

describe("the calendar", () => {
  it("marks an autopilot post and lists a skipped slot, for an account the autopilot reaches", async () => {
    const storageRoot = (globalThis as { __storageRoot?: string }).__storageRoot!;
    const render = await seedReleasedRender(db as never, core.getStorage(), storageRoot, {
      businessId: world.businessId,
    });
    const accountId = world.accounts.get(world.shape[1]!.igUserId)!;
    const at = new Date(Date.now() + 3 * 3_600_000);
    const [scheduled] = await core.schedulePosts(db, {
      userId: world.userId,
      videoRenderId: render.id,
      accountIds: [accountId],
      scheduledAt: at,
      timezone: "Asia/Jerusalem",
      caption: "",
      sound: SOUNDS[0]!,
      platforms: ["instagram"],
    });
    const day = at.toISOString().slice(0, 10);
    await db.insert(schema.autopilotSlots).values([
      {
        userId: world.userId,
        igUserId: world.shape[1]!.igUserId,
        socialAccountId: accountId,
        day,
        slotIndex: 0,
        scheduledFor: at,
        scheduledPostId: scheduled!.id,
        videoRenderId: render.id,
        status: "scheduled",
      },
      {
        userId: world.userId,
        igUserId: world.shape[1]!.igUserId,
        socialAccountId: accountId,
        day,
        slotIndex: 1,
        scheduledFor: new Date(at.getTime() + 3_600_000),
        status: "skipped",
        skipReason: "render_failed",
      },
    ]);
    const range = `from=${encodeURIComponent(new Date(at.getTime() - 86_400_000).toISOString())}&to=${encodeURIComponent(new Date(at.getTime() + 86_400_000).toISOString())}`;
    as(world.userId);
    const res = await listPosts(new Request(`http://localhost/api/social/posts?${range}`));
    const body = (await res.json()) as {
      posts: { id: string; autopilot: boolean }[];
      skipped?: { reason: string }[];
    };
    expect(body.posts.find((p) => p.id === scheduled!.id)!.autopilot).toBe(true);
    expect(body.skipped).toEqual([expect.objectContaining({ reason: "render_failed" })]);

    // A customer the posting switch names but the autopilot does not: no skipped key at all.
    await db
      .insert(schema.appConfig)
      .values({ key: "social_posting", value: { access: "named", userIds: [customer] } });
    as(customer);
    const theirs = (await (
      await listPosts(new Request(`http://localhost/api/social/posts?${range}`))
    ).json()) as { skipped?: unknown };
    expect(theirs.skipped).toBeUndefined();
  });
});

describe("the sound picker's list mode", () => {
  const picker = (pickOnly?: boolean) =>
    renderToStaticMarkup(
      createElement(SoundPicker, {
        accountId: null,
        value: null,
        onChange: () => {},
        service: "a",
        voiced: false,
        ...(pickOnly === undefined ? {} : { pickOnly }),
      }),
    );

  it("leaves the manual picker as it was, and hides 'no sound' and the note in list mode", () => {
    expect(picker()).toBe(picker(false));
    // The no-sound BUTTON (the reconnect line also says the words).
    expect(picker()).toContain(`>${ui.NO_SOUND}</button>`);
    expect(picker()).toContain(ui.SOUND_NOTE);
    expect(picker(true)).not.toContain(`>${ui.NO_SOUND}</button>`);
    expect(picker(true)).not.toContain(ui.SOUND_NOTE);
  });
});
