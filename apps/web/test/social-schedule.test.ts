import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderRow } from "../src/lib/service-b-ui";

/**
 * Social posting PR 3 — the schedule flow (decisions 0101, 0102, 0107, and
 * 0108's four fixes) over the real route handlers, pages and layouts on PGlite:
 *
 * - the switch: an account it does not allow (and a signed-out visitor) gets a
 *   404 on every new route and page, and no button, tag, calendar row or
 *   notice anywhere it already goes;
 * - scheduling: a time past the horizon or past the file's life is refused in
 *   Hebrew; the AI label rides only when ticked;
 * - a pending post can be changed and cancelled; one being posted cannot;
 * - the tile's tags, one per platform (0115 §3): "מתוזמן" while any post of
 *   the video waits, TikTok's "נשלח לטיקטוק" while one sits delivered,
 *   "פורסם" once one went out and none waits, nothing for failed posts alone,
 *   nothing for a platform the account's switches hide;
 * - TikTok in the flow (0115 §2): no caption step, no tick, the inbox note,
 *   and TikTok's own cap answered in Hebrew;
 * - the date and time pickers: 24-hour, 5-minute steps, the range enforced;
 * - the sound picker's proxy, its Instagram-only rows, and the connect's way
 *   back to the video.
 */

const fixture = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  db: undefined as unknown,
  businesses: [] as { id: string; name: string; questionnaire: unknown }[],
  /** Reads of postingNotices — never for an account the switch hides. */
  noticeReads: 0,
  /** Make the switch read itself fail, as a dropped connection would. */
  switchFails: false,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: fixture.user }, error: null }) },
    // The home layout's and page's businesses read.
    from: () => ({
      select: () => ({ order: async () => ({ data: fixture.businesses, error: null }) }),
    }),
  }),
}));

vi.mock("@aiugc/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aiugc/core")>();
  return {
    ...actual,
    getDb: () => fixture.db,
    // The web reads both switches through this one call (lib/social.ts).
    getPlatformAccess: (...args: Parameters<typeof actual.getPlatformAccess>) => {
      if (fixture.switchFails) return Promise.reject(new Error("ECONNRESET"));
      return actual.getPlatformAccess(...args);
    },
    postingNotices: (...args: Parameters<typeof actual.postingNotices>) => {
      fixture.noticeReads++;
      return actual.postingNotices(...args);
    },
  };
});

vi.mock("@/lib/persona-catalog", () => ({
  loadPersonaCatalog: async () => [],
  isStableCatalogUrl: () => false,
}));
vi.mock("@/lib/wizard-gate", () => ({ wizardGate: async () => ({ balance: null }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    notFound: () => {
      throw new Error("NEXT_NOT_FOUND");
    },
    redirect: (path: string) => {
      throw new Error(`NEXT_REDIRECT ${path}`);
    },
    // The post page's refresh after a 409, rendered here outside an app router.
    useRouter: () => ({ refresh: () => {} }),
  };
});

const core = await import("@aiugc/core");
const { createTestDb } = await import("../../../packages/core/test/helpers/pglite");
const { tempStorage } = await import("../../../packages/core/test/helpers/storage");
const {
  connectInstagram,
  connectTiktok,
  FakeMeta,
  samplePage,
  seedOwnerAndBusiness,
  seedReleasedRender,
  socialTestEnv,
} = await import("../../../packages/core/test/helpers/social");
const postsRoute = await import("../src/app/api/social/posts/route");
const { PATCH: editPost } = await import("../src/app/api/social/posts/[id]/route");
const { POST: cancelPost } = await import("../src/app/api/social/posts/[id]/cancel/route");
const { POST: acknowledge } =
  await import("../src/app/api/social/posts/acknowledge-failures/route");
const { GET: sounds } = await import("../src/app/api/social/instagram/sounds/route");
const { GET: getRender } = await import("../src/app/api/renders/[id]/route");
const { GET: listRenders } = await import("../src/app/api/businesses/[businessId]/renders/route");
const { default: PostingLayout } = await import("../src/app/(posting)/layout");
const { default: SchedulePage } = await import("../src/app/(posting)/schedule/[renderId]/page");
const { default: CalendarPage } = await import("../src/app/(posting)/calendar/page");
const { default: PostPage } = await import("../src/app/(posting)/calendar/[postId]/page");
const { default: HomeLayout } = await import("../src/app/home/layout");
const { default: HomePage } = await import("../src/app/home/page");
const { Sidebar } = await import("../src/app/home/sidebar");
const { PostingNotice } = await import("../src/app/home/posting-notice");
const { ScheduleFlow } = await import("../src/app/(posting)/schedule/[renderId]/schedule-flow");
const { AiTick } = await import("../src/components/social/ai-tick");
const { MonthCalendar, TimeList } = await import("../src/components/social/when-fields");
const { SoundPreview } = await import("../src/components/social/sound-picker");
const { RenderTile } = await import("../src/app/home/render-tile");
const { PostDetail } = await import("../src/app/(posting)/calendar/[postId]/post-detail");
const { socialReturnPath } = await import("../src/lib/social-oauth");
const form = await import("../src/lib/schedule-form");
const ui = await import("../src/lib/social-posting-ui");
const connectUi = await import("../src/lib/social-ui");

const schema = core.schema;
type Db = ReturnType<typeof core.getDb>;

const NOT_FOUND = { ok: false, error: "לא נמצא." };
const HOUR = 3_600_000;

let pg: { close(): Promise<void> };
let db: Db;
let restoreEnv: () => void;
let cleanupStorage: () => void;
let storageRoot: string;
let customer: string;
let customerBusiness: string;
let customerRender: string;
let admin: string;
let adminBusiness: string;
let adminRender: string;
let adminAccount: string;

const as = (userId: string | null) => {
  fixture.user = userId ? { id: userId, email: "someone@social.test" } : null;
};

const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });
const json = (body: unknown) =>
  new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const patch = (body: unknown) =>
  new Request("http://localhost/api", {
    method: "PATCH",
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

/** Every element in a server component's returned tree (props.children and other element props). */
function elements(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, out);
  } else if (isValidElement(node)) {
    out.push(node);
    const props = node.props as Record<string, unknown>;
    for (const value of Object.values(props)) {
      if (Array.isArray(value) || isValidElement(value)) elements(value as ReactNode, out);
    }
  }
  return out;
}

async function schedule(body: Record<string, unknown>) {
  return postsRoute.POST(
    json({
      renderId: adminRender,
      accountIds: [adminAccount],
      scheduledAt: new Date(Date.now() + HOUR).toISOString(),
      timezone: "Asia/Jerusalem",
      caption: "כיתוב",
      ...body,
    }),
  );
}

async function postRow(id: string) {
  return (
    await db.select().from(schema.scheduledPosts).where(eq(schema.scheduledPosts.id, id))
  )[0]!;
}

beforeAll(async () => {
  restoreEnv = socialTestEnv();
  const created = await createTestDb();
  pg = created.pg;
  db = created.db as unknown as Db;
  fixture.db = db;
  const temp = tempStorage();
  storageRoot = temp.root;
  cleanupStorage = temp.cleanup;
  core.setStorage(temp.storage);

  ({ userId: customer, businessId: customerBusiness } = await seedOwnerAndBusiness(db, {
    email: "customer@social.test",
  }));
  customerRender = (
    await seedReleasedRender(db, temp.storage, storageRoot, { businessId: customerBusiness })
  ).id;
  ({ userId: admin, businessId: adminBusiness } = await seedOwnerAndBusiness(db, {
    email: "admin@social.test",
    role: "admin",
  }));
  adminAccount = (await connectInstagram(db, admin))[0]!;
  adminRender = (
    await seedReleasedRender(db, temp.storage, storageRoot, { businessId: adminBusiness })
  ).id;
});

afterAll(async () => {
  core.setStorage(undefined);
  core.setMetaGraphProvider(undefined);
  cleanupStorage();
  restoreEnv();
  await pg.close();
});

beforeEach(async () => {
  await db.delete(schema.scheduledPosts);
  await db.delete(schema.jobs).where(eq(schema.jobs.type, "publish_post"));
  await db
    .delete(schema.appConfig)
    .where(inArray(schema.appConfig.key, ["social_posting", "tiktok_posting"]));
  fixture.noticeReads = 0;
  fixture.switchFails = false;
  as(null);
});

describe("the switch hides PR 3 from an account it does not allow", () => {
  const someId = "00000000-0000-4000-8000-000000000000";

  async function everyRoute(): Promise<{ status: number; body: unknown }[]> {
    const responses = [
      await postsRoute.GET(
        new Request(
          `http://localhost/api/social/posts?from=${new Date().toISOString()}&to=${new Date(Date.now() + 86_400_000).toISOString()}`,
        ),
      ),
      await postsRoute.POST(json({ renderId: customerRender, accountIds: [someId] })),
      await editPost(patch({ caption: "x" }), params({ id: someId })),
      await cancelPost(
        new Request("http://localhost/api", { method: "POST" }),
        params({ id: someId }),
      ),
      await acknowledge(),
      await sounds(
        new Request(`http://localhost/api/social/instagram/sounds?accountId=${someId}&kind=music`),
      ),
    ];
    return Promise.all(responses.map(async (r) => ({ status: r.status, body: await r.json() })));
  }

  it("a customer the switch hides gets 404 on every new route, and so does a signed-out visitor", async () => {
    for (const who of [customer, null]) {
      as(who);
      for (const response of await everyRoute()) {
        expect(response).toEqual({ status: 404, body: NOT_FOUND });
      }
    }
  });

  it("every new page and the posting frame answer a hidden account with the 404 page", async () => {
    for (const who of [customer, null]) {
      as(who);
      expect(await thrown(PostingLayout({ children: null }))).toBe("NEXT_NOT_FOUND");
      expect(
        await thrown(
          SchedulePage({
            ...params({ renderId: customerRender }),
            searchParams: Promise.resolve({}),
          }),
        ),
      ).toBe("NEXT_NOT_FOUND");
      expect(await thrown(CalendarPage({ searchParams: Promise.resolve({}) }))).toBe(
        "NEXT_NOT_FOUND",
      );
      expect(await thrown(PostPage(params({ postId: someId })))).toBe("NEXT_NOT_FOUND");
    }
  });

  it("the player gets no button, the tile no tag, the nav no calendar and /home no notice", async () => {
    as(customer);
    const render = await (
      await getRender(new Request("http://localhost"), params({ id: customerRender }))
    ).json();
    expect(render.status).toBe("released");
    expect(render.downloadUrl).toBeDefined();
    expect("scheduleHref" in render).toBe(false);
    expect("pendingPosts" in render).toBe(false);

    const list = await (
      await listRenders(
        new Request("http://localhost/api"),
        params({ businessId: customerBusiness }),
      )
    ).json();
    expect(list.renders).toHaveLength(1);
    expect("postTags" in list.renders[0]).toBe(false);

    fixture.businesses = [{ id: customerBusiness, name: "עסק", questionnaire: null }];
    const frame = await HomeLayout({ children: null });
    const sidebar = elements(frame).find((el) => el.type === Sidebar)!;
    expect((sidebar.props as { postingAllowed: boolean }).postingAllowed).toBe(false);

    const home = HomePage() as ReactElement<{ children: ReactElement }>;
    const content = await (home.props.children.type as () => Promise<ReactNode>)();
    expect(elements(content).some((el) => el.type === PostingNotice)).toBe(false);
    expect(fixture.noticeReads).toBe(0);
  });

  it("a NAMED account sees all of it, like an admin", async () => {
    await db
      .insert(schema.appConfig)
      .values({ key: "social_posting", value: { access: "named", userIds: [customer] } });
    as(customer);
    const render = await (
      await getRender(new Request("http://localhost"), params({ id: customerRender }))
    ).json();
    expect(render.scheduleHref).toBe(`/schedule/${customerRender}`);
    expect(render.pendingPosts).toBe(0);
    expect(await thrown(PostingLayout({ children: null }))).toBe("rendered");
    fixture.businesses = [{ id: customerBusiness, name: "עסק", questionnaire: null }];
    const sidebar = elements(await HomeLayout({ children: null })).find(
      (el) => el.type === Sidebar,
    )!;
    expect((sidebar.props as { postingAllowed: boolean }).postingAllowed).toBe(true);
  });
});

describe("a failed switch read", () => {
  it("hides social posting and breaks nothing that was there before", async () => {
    as(customer);
    fixture.switchFails = true;
    fixture.businesses = [{ id: customerBusiness, name: "עסק", questionnaire: null }];

    const sidebar = elements(await HomeLayout({ children: null })).find(
      (el) => el.type === Sidebar,
    )!;
    expect((sidebar.props as { postingAllowed: boolean }).postingAllowed).toBe(false);
    const home = HomePage() as ReactElement<{ children: ReactElement }>;
    const content = await (home.props.children.type as () => Promise<ReactNode>)();
    expect(elements(content).some((el) => el.type === PostingNotice)).toBe(false);

    const render = await getRender(new Request("http://localhost"), params({ id: customerRender }));
    expect(render.status).toBe(200);
    expect("scheduleHref" in (await render.json())).toBe(false);
    const list = await listRenders(
      new Request("http://localhost/api"),
      params({ businessId: customerBusiness }),
    );
    expect(list.status).toBe(200);
    expect("postTags" in (await list.json()).renders[0]).toBe(false);
  });
});

describe("scheduling", () => {
  beforeEach(() => as(admin));

  it("writes one post per account; the AI label is stored only when ticked", async () => {
    const untouched = await (await schedule({})).json();
    expect(untouched.ok).toBe(true);
    expect((await postRow(untouched.posts[0].id)).aiLabel).toBe(false);

    const ticked = await (await schedule({ aiLabel: true })).json();
    expect((await postRow(ticked.posts[0].id)).aiLabel).toBe(true);
  });

  it("refuses a time past the horizon, and past the file's life, in Hebrew", async () => {
    const far = await schedule({
      scheduledAt: new Date(Date.now() + 31 * 86_400_000).toISOString(),
    });
    expect(far.status).toBe(422);
    expect(await far.json()).toEqual({ ok: false, error: ui.horizonLine(30) });

    // Released 85 days ago: retention 90 minus the 2-day margin leaves 3 days.
    await db
      .update(schema.videoRenders)
      .set({ releasedAt: new Date(Date.now() - 85 * 86_400_000) })
      .where(eq(schema.videoRenders.id, adminRender));
    const late = await schedule({
      scheduledAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    });
    expect(late.status).toBe(422);
    expect((await late.json()).error).toBe(
      "הסרטון לא יישמר אצלנו עד המועד הזה. בחרו מועד מוקדם יותר.",
    );
    await db
      .update(schema.videoRenders)
      .set({ releasedAt: new Date() })
      .where(eq(schema.videoRenders.id, adminRender));

    const past = await schedule({ scheduledAt: new Date(Date.now() - 10 * 60_000).toISOString() });
    expect(past.status).toBe(422);
    expect((await past.json()).error).toBe(ui.PAST_LINE);
  });

  it("refuses a body that is not a request at all", async () => {
    const bad = await postsRoute.POST(json({ renderId: "not-a-uuid" }));
    expect(bad.status).toBe(400);
    const badSound = await schedule({
      sound: { audioId: "a1", kind: "music", title: "t", previewUrl: "javascript:alert(1)" },
    });
    expect(badSound.status).toBe(400);
  });

  it("a pending post can be changed and cancelled; one being posted cannot", async () => {
    const { posts } = await (await schedule({})).json();
    const id = posts[0].id as string;

    const changed = await editPost(patch({ caption: "חדש", aiLabel: true }), params({ id }));
    expect(changed.status).toBe(200);
    const body = await changed.json();
    expect(body.post.caption).toBe("חדש");
    expect(body.post.aiLabel).toBe(true);
    expect("failureDetail" in body.post).toBe(false);

    const moved = new Date(Date.now() + 2 * HOUR);
    expect(
      (
        await editPost(
          patch({ scheduledAt: moved.toISOString(), timezone: "Asia/Jerusalem" }),
          params({ id }),
        )
      ).status,
    ).toBe(200);
    const job = (
      await db
        .select()
        .from(schema.jobs)
        .where(eq(schema.jobs.idempotencyKey, `post:${id}`))
    )[0]!;
    expect(job.runAt.getTime()).toBe(moved.getTime());

    // The job claimed it: posting started.
    await db
      .update(schema.scheduledPosts)
      .set({ status: "publishing", providerContainerId: "container_1" })
      .where(eq(schema.scheduledPosts.id, id));
    const lateEdit = await editPost(patch({ caption: "מאוחר" }), params({ id }));
    expect(lateEdit.status).toBe(409);
    expect((await lateEdit.json()).error).toBe(ui.NOT_PENDING_LINE);
    const lateCancel = await cancelPost(new Request("http://localhost"), params({ id }));
    expect(lateCancel.status).toBe(409);
    expect((await postRow(id)).status).toBe("publishing");

    const second = (await (await schedule({})).json()).posts[0].id as string;
    expect((await cancelPost(new Request("http://localhost"), params({ id: second }))).status).toBe(
      200,
    );
    expect((await postRow(second)).status).toBe("cancelled");
  });

  it("someone else's post is a 404, never a 409", async () => {
    const { posts } = await (await schedule({})).json();
    as(customer);
    await db
      .insert(schema.appConfig)
      .values({ key: "social_posting", value: { access: "everyone" } });
    const response = await editPost(patch({ caption: "x" }), params({ id: posts[0].id }));
    expect(response.status).toBe(404);
    expect(await thrown(PostPage(params({ postId: posts[0].id })))).toBe("NEXT_NOT_FOUND");
  });

  it("the calendar's month leaves cancelled posts out", async () => {
    const kept = (await (await schedule({})).json()).posts[0].id as string;
    const gone = (await (await schedule({})).json()).posts[0].id as string;
    await cancelPost(new Request("http://localhost"), params({ id: gone }));
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const month = await (
      await postsRoute.GET(new Request(`http://localhost/api/social/posts?from=${from}&to=${to}`))
    ).json();
    expect(month.posts.map((post: { id: string }) => post.id)).toEqual([kept]);
    expect(month.posts[0].account.username).toBe("user");
    expect(month.posts[0].failureLine).toBeNull();
    // More than 45 days is not a month.
    const wide = await postsRoute.GET(
      new Request(
        `http://localhost/api/social/posts?from=${from}&to=${new Date(Date.now() + 60 * 86_400_000).toISOString()}`,
      ),
    );
    expect(wide.status).toBe(400);
  });
});

describe("the tile's tags and the player's line", () => {
  beforeEach(() => as(admin));

  const ig = (tag: string) => ({ platform: "instagram" as const, tag });
  const tt = (tag: string) => ({ platform: "tiktok" as const, tag });

  async function tag(businessId = adminBusiness, renderId = adminRender) {
    const list = await (
      await listRenders(new Request("http://localhost/api"), params({ businessId }))
    ).json();
    return list.renders.find((row: { id: string }) => row.id === renderId) as Record<
      string,
      unknown
    >;
  }

  const tags = async (businessId?: string, renderId?: string) =>
    (await tag(businessId, renderId)).postTags;

  async function setStatus(
    id: string,
    status: "publishing" | "delivered" | "posted" | "failed" | "cancelled",
  ) {
    await db
      .update(schema.scheduledPosts)
      .set({
        status,
        ...(status === "failed" ? { failureKind: "platform_refused", failedAt: new Date() } : {}),
      })
      .where(eq(schema.scheduledPosts.id, id));
  }

  it("the rule (0108 §1, per platform since 0115 §3): waiting → מתוזמן, delivered → נשלח לטיקטוק, posted → פורסם, failed only → none", () => {
    const counts = (waiting: number, delivered: number, posted: number) => ({
      waiting,
      delivered,
      posted,
    });
    expect(ui.postTag(counts(1, 0, 0))).toBe("scheduled");
    expect(ui.postTag(counts(0, 0, 1))).toBe("posted");
    expect(ui.postTag(counts(2, 0, 3))).toBe("scheduled");
    expect(ui.postTag(counts(0, 1, 0))).toBe("delivered");
    // An unfinished draft in TikTok outranks a posted one; a waiting post outranks both.
    expect(ui.postTag(counts(0, 1, 4))).toBe("delivered");
    expect(ui.postTag(counts(1, 1, 1))).toBe("scheduled");
    expect(ui.postTag(counts(0, 0, 0))).toBeNull();
    expect(ui.TILE_TAG).toBe("מתוזמן");
    expect(ui.TILE_TAG_POSTED).toBe("פורסם");
    expect(ui.TILE_TAG_DELIVERED).toBe("נשלח לטיקטוק");

    // At most one per platform, Instagram first whatever order the counts came
    // in, and no chip for a platform with nothing to tag.
    expect(ui.postTags({ tiktok: counts(0, 1, 0), instagram: counts(0, 0, 1) })).toEqual([
      ig("posted"),
      tt("delivered"),
    ]);
    expect(ui.postTags({ tiktok: counts(1, 0, 0) })).toEqual([tt("scheduled")]);
    expect(ui.postTags({ instagram: counts(0, 0, 0), tiktok: counts(0, 0, 0) })).toEqual([]);
    expect(ui.postTags({})).toEqual([]);
  });

  it("the list route tags all four cases, from the posts themselves", async () => {
    expect(await tags()).toEqual([]);
    const first = (await (await schedule({})).json()).posts[0].id as string;
    const second = (await (await schedule({})).json()).posts[0].id as string;

    // Waiting: scheduled, and a post being published still waits.
    expect(await tags()).toEqual([ig("scheduled")]);
    await setStatus(first, "publishing");
    expect(await tags()).toEqual([ig("scheduled")]);
    const render = await (
      await getRender(new Request("http://localhost"), params({ id: adminRender }))
    ).json();
    expect(render.pendingPosts).toBe(2);

    // Both: one went out, one still waits.
    await setStatus(second, "posted");
    expect(await tags()).toEqual([ig("scheduled")]);

    // Posted: one went out and none waits — a failed one beside it changes nothing.
    await setStatus(first, "failed");
    expect(await tags()).toEqual([ig("posted")]);

    // Failed only (a cancelled one beside it): no tag.
    await setStatus(second, "cancelled");
    expect(await tags()).toEqual([]);
    await setStatus(second, "failed");
    expect(await tags()).toEqual([]);
  });

  it("a TikTok post has its own chip beside Instagram's, and delivered never reads as posted", async () => {
    const tiktokAccount = await connectTiktok(db, admin, "tt_open_tags");
    const igPost = (await (await schedule({})).json()).posts[0].id as string;
    const ttPost = (await (await schedule({ accountIds: [tiktokAccount] })).json()).posts[0]
      .id as string;
    expect(await tags()).toEqual([ig("scheduled"), tt("scheduled")]);

    await setStatus(igPost, "posted");
    await setStatus(ttPost, "delivered");
    expect(await tags()).toEqual([ig("posted"), tt("delivered")]);

    // The owner finished it in TikTok.
    await setStatus(ttPost, "posted");
    expect(await tags()).toEqual([ig("posted"), tt("posted")]);

    // A failed TikTok post alone: no TikTok chip; Instagram's stays.
    await setStatus(ttPost, "failed");
    expect(await tags()).toEqual([ig("posted")]);
  });

  it("an account the switches hide sees no tag, and each platform's chip follows its own switch", async () => {
    const [account] = await connectInstagram(db, customer, [samplePage("17841400000000077", "c")]);
    const tiktokAccount = await connectTiktok(db, customer, "tt_open_hidden");
    const row = {
      userId: customer,
      businessId: customerBusiness,
      videoRenderId: customerRender,
      socialAccountId: account!,
      platform: "instagram" as const,
      scheduledAt: new Date(Date.now() + HOUR),
      timezone: "Asia/Jerusalem",
    };
    await db
      .insert(schema.scheduledPosts)
      .values([
        row,
        { ...row, status: "posted" },
        { ...row, socialAccountId: tiktokAccount, platform: "tiktok", status: "delivered" },
      ]);

    as(customer);
    const hidden = await tag(customerBusiness, customerRender);
    expect(hidden.status).toBe("released");
    expect("postTags" in hidden).toBe(false);

    // Instagram's switch alone: TikTok's delivered post leaves no trace.
    await db
      .insert(schema.appConfig)
      .values({ key: "social_posting", value: { access: "named", userIds: [customer] } });
    expect(await tags(customerBusiness, customerRender)).toEqual([ig("scheduled")]);

    // Both switches: both chips, Instagram first.
    await db
      .insert(schema.appConfig)
      .values({ key: "tiktok_posting", value: { access: "named", userIds: [customer] } });
    expect(await tags(customerBusiness, customerRender)).toEqual([
      ig("scheduled"),
      tt("delivered"),
    ]);

    // TikTok's switch alone.
    await db.delete(schema.appConfig).where(eq(schema.appConfig.key, "social_posting"));
    expect(await tags(customerBusiness, customerRender)).toEqual([tt("delivered")]);
  });

  it("the tile draws one chip per platform, each its mark, its name for a screen reader and its word", () => {
    const tile = (postTags: { platform: "instagram" | "tiktok"; tag: string }[] | undefined) =>
      renderToStaticMarkup(
        createElement(RenderTile, {
          render: {
            id: "r",
            status: "released",
            thumbUrl: "t",
            refunded: undefined,
            postTags: postTags as RenderRow["postTags"],
          },
          onPlay: () => {},
        }),
      );
    const IG_MARK = '<img src="/brand/instagram-glyph-black.svg"';
    const TT_MARK = '<img src="/brand/tiktok-icon-black-circle.png"';

    const both = tile([ig("scheduled"), tt("delivered")]);
    expect(both).toContain(`text-ink/70">${IG_MARK}`);
    expect(both).toContain(`<span class="sr-only">אינסטגרם: </span>${ui.TILE_TAG}</span>`);
    expect(both).toContain(`text-sky-800">${TT_MARK}`);
    expect(both).toContain(`<span class="sr-only">טיקטוק: </span>${ui.TILE_TAG_DELIVERED}</span>`);
    expect(both.indexOf(IG_MARK)).toBeLessThan(both.indexOf(TT_MARK));
    expect(both).not.toContain(ui.TILE_TAG_POSTED);

    const posted = tile([ig("posted"), tt("posted")]);
    expect(posted).toContain(`text-emerald-800">${IG_MARK}`);
    expect(posted).toContain(`<span class="sr-only">אינסטגרם: </span>${ui.TILE_TAG_POSTED}</span>`);
    expect(posted).toContain(`<span class="sr-only">טיקטוק: </span>${ui.TILE_TAG_POSTED}</span>`);

    expect(tile([tt("scheduled")])).not.toContain(IG_MARK);
    for (const none of [[], undefined]) {
      expect(tile(none)).not.toContain(ui.TILE_TAG);
      expect(tile(none)).not.toContain(ui.TILE_TAG_POSTED);
      expect(tile(none)).not.toContain(ui.TILE_TAG_DELIVERED);
      expect(tile(none)).not.toContain("/brand/");
    }
  });

  it("a chosen sound's Latin title keeps its own direction", () => {
    expect(ui.chosenSoundLine("Flowers (Sped Up)")).toBe("נבחר: \u2068Flowers (Sped Up)\u2069");
  });

  it("the pending line counts", () => {
    expect(ui.pendingPostsLine(0)).toBeNull();
    expect(ui.pendingPostsLine(1)).toBe("מתוזמן לפרסום");
    expect(ui.pendingPostsLine(3)).toBe("מתוזמן ל־3 פרסומים");
  });
});

describe("the /home notice", () => {
  it("counts a failure until הבנתי, and says nothing after", async () => {
    as(admin);
    fixture.businesses = [{ id: adminBusiness, name: "עסק", questionnaire: null }];
    const id = (await (await schedule({})).json()).posts[0].id as string;
    await core.failPost(db, id, "platform_refused", "test");

    const home = HomePage() as ReactElement<{ children: ReactElement }>;
    const content = await (home.props.children.type as () => Promise<ReactNode>)();
    const notice = elements(content).find((el) => el.type === PostingNotice)!;
    expect((notice.props as { failures: number }).failures).toBe(1);
    expect(renderToStaticMarkup(notice)).toContain(ui.failedNoticeLine(1));

    expect((await (await acknowledge()).json()).acknowledged).toBe(1);
    const after = await (home.props.children.type as () => Promise<ReactNode>)();
    const quiet = elements(after).find((el) => el.type === PostingNotice)!;
    expect((quiet.props as { failures: number }).failures).toBe(0);
    expect(renderToStaticMarkup(quiet)).toBe("");
  });
});

describe("the AI tick", () => {
  it("starts unticked, and the request carries a label only when ticked", () => {
    const markup = renderToStaticMarkup(AiTick({ checked: false, onChange: () => {} }));
    expect(markup).toContain(ui.AI_TICK_LABEL);
    expect(markup).not.toMatch(/checked/);

    const base = {
      renderId: "r",
      accountIds: ["a"],
      at: new Date("2026-10-13T10:00:00Z"),
      timezone: "Asia/Jerusalem",
      instagram: true,
      caption: "",
      sound: null,
    };
    expect("aiLabel" in form.scheduleRequestBody({ ...base, aiLabel: false })).toBe(false);
    expect(form.scheduleRequestBody({ ...base, aiLabel: true }).aiLabel).toBe(true);
  });

  it("the flow opens on its first step, the tick not yet on screen", () => {
    const markup = renderToStaticMarkup(
      createElement(ScheduleFlow, {
        render: { id: "r", service: "a", voiced: false, thumbUrl: null, downloadUrl: "d" },
        accounts: [],
        horizon: { maxScheduledAt: new Date().toISOString(), limitedBy: "policy", days: 30 },
        connectHref: "/connect/instagram?return=%2Fschedule%2Fr",
        platforms: ["instagram"],
        prefill: null,
      }),
    );
    expect(markup).toContain(ui.STEP_ACCOUNTS_TITLE);
    expect(markup).toContain(ui.NO_ACCOUNT_TITLE);
    expect(markup).not.toContain(ui.AI_TICK_LABEL);
  });
});

describe("TikTok in the schedule flow (0115 §2)", () => {
  const instagramAccount = {
    id: "ig-1",
    platform: "instagram" as const,
    username: "flowers.tlv",
    displayName: "חנות הפרחים",
    pictureUrl: null,
    status: "connected" as const,
    canSearchSounds: true,
  };
  const tiktokAccount = {
    id: "tt-1",
    platform: "tiktok" as const,
    username: null,
    displayName: "פרחים בטיקטוק",
    pictureUrl: null,
    status: "connected" as const,
    canSearchSounds: false,
  };
  const sound = { audioId: "a1", kind: "music" as const, title: "Flowers" };

  /** The flow as the page draws it, opened on a step with the given picks. */
  function flow(opts: {
    picked: string[];
    openOn?: "when" | "caption";
    accounts?: (typeof instagramAccount | typeof tiktokAccount)[];
    platforms?: ("instagram" | "tiktok")[];
    connectHref?: string;
  }) {
    return renderToStaticMarkup(
      createElement(ScheduleFlow, {
        render: { id: "r", service: "a", voiced: false, thumbUrl: null, downloadUrl: "d" },
        accounts: opts.accounts ?? [instagramAccount, tiktokAccount],
        horizon: {
          maxScheduledAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
          limitedBy: "policy",
          days: 30,
        },
        connectHref: opts.connectHref ?? "/home/settings#connections",
        platforms: opts.platforms ?? ["instagram", "tiktok"],
        // A caption, a sound and a tick left over from an earlier pick.
        prefill: { accountIds: opts.picked, caption: "כיתוב שנשאר", sound, aiLabel: true },
        openOn: opts.openOn,
      }),
    );
  }

  const SUBMIT = `>${ui.SUBMIT_BUTTON}</button>`;
  const CONTINUE = `>${ui.CONTINUE_BUTTON}</button>`;

  it("TikTok alone: no caption step — מתי? submits, with the inbox note above it and never the tick", () => {
    const when = flow({ picked: ["tt-1"], openOn: "when" });
    expect(when).toContain(ui.STEP_WHEN_TITLE);
    expect(when).toContain(SUBMIT);
    expect(when).not.toContain(CONTINUE);
    expect(when).toContain(ui.TIKTOK_INBOX_NOTE);
    expect(when.indexOf(ui.TIKTOK_INBOX_NOTE)).toBeLessThan(when.indexOf(SUBMIT));
    // What the time is for (0116): after the fields, ahead of the inbox note.
    expect(when).toContain(ui.TIKTOK_WHEN_NOTE);
    expect(when.indexOf(ui.TIKTOK_WHEN_NOTE)).toBeLessThan(when.indexOf(ui.TIKTOK_INBOX_NOTE));
    expect(when.indexOf(ui.NOW_BUTTON)).toBeLessThan(when.indexOf(ui.TIKTOK_WHEN_NOTE));
    expect(when).not.toContain(ui.AI_TICK_LABEL);
    expect(when).not.toContain(ui.STEP_CAPTION_TITLE);
    expect(when).not.toContain(ui.SOUND_LABEL);
    expect(when).not.toContain("<textarea");
  });

  it("TikTok alone sends the file alone: an empty caption, no sound, no label, whatever the form held", async () => {
    const at = new Date(Date.now() + HOUR);
    const body = form.scheduleRequestBody({
      renderId: adminRender,
      accountIds: ["tt-1"],
      at,
      timezone: "Asia/Jerusalem",
      instagram: false,
      caption: "כיתוב שנשאר",
      sound,
      aiLabel: true,
    });
    expect(body.caption).toBe("");
    expect(body.sound).toBeNull();
    expect("aiLabel" in body).toBe(false);

    // Through the route: core would refuse a sound with no Instagram account
    // (sound_without_instagram), so the body's own rule is what lets it through.
    as(admin);
    const account = await connectTiktok(db, admin, "tt_open_flow");
    const response = await postsRoute.POST(json({ ...body, accountIds: [account] }));
    expect(response.status).toBe(200);
    const { posts } = await response.json();
    expect(await postRow(posts[0].id)).toMatchObject({
      platform: "tiktok",
      status: "scheduled",
      caption: "",
      sound: null,
      aiLabel: false,
    });
  });

  it("Instagram and TikTok together: מתי? continues; the caption step is Instagram's, named so, with the sound, the tick and then the note", () => {
    const when = flow({ picked: ["ig-1", "tt-1"], openOn: "when" });
    expect(when).toContain(CONTINUE);
    expect(when).not.toContain(SUBMIT);
    expect(when).not.toContain(ui.TIKTOK_INBOX_NOTE);
    expect(when).not.toContain(ui.TIKTOK_WHEN_NOTE);

    const caption = flow({ picked: ["ig-1", "tt-1"], openOn: "caption" });
    expect(caption).toContain(`>${ui.CAPTION_LABEL_INSTAGRAM}<textarea`);
    expect(caption).toContain(ui.SOUND_LABEL);
    expect(caption).toContain(ui.AI_TICK_LABEL);
    expect(caption).toContain(ui.TIKTOK_INBOX_NOTE);
    expect(caption).not.toContain(ui.TIKTOK_WHEN_NOTE);
    expect(caption.indexOf(ui.AI_TICK_LABEL)).toBeLessThan(caption.indexOf(ui.TIKTOK_INBOX_NOTE));
    expect(caption.indexOf(ui.TIKTOK_INBOX_NOTE)).toBeLessThan(caption.indexOf(SUBMIT));
  });

  it("Instagram alone is as before: the plain caption label, no note", () => {
    const caption = flow({ picked: ["ig-1"], openOn: "caption" });
    expect(caption).toContain(`>${ui.CAPTION_LABEL}<textarea`);
    expect(caption).not.toContain(ui.CAPTION_LABEL_INSTAGRAM);
    expect(caption).not.toContain(ui.TIKTOK_INBOX_NOTE);
    expect(caption).toContain(ui.AI_TICK_LABEL);
    const igWhen = flow({ picked: ["ig-1"], openOn: "when" });
    expect(igWhen).toContain(CONTINUE);
    expect(igWhen).not.toContain(ui.TIKTOK_WHEN_NOTE);
    expect(igWhen).not.toContain(ui.TIKTOK_INBOX_NOTE);
  });

  it("each account row carries its platform's mark; the no-account card offers what the switches open", () => {
    const rows = flow({ picked: [] });
    expect(rows).toContain('<img src="/brand/instagram-glyph-black.svg"');
    expect(rows).toContain('<img src="/brand/tiktok-icon-black-circle.png"');
    // TikTok's basic profile has no handle: no "@" line for it.
    expect(rows.match(/>@/g)).toHaveLength(1);

    const cases: [("instagram" | "tiktok")[], string][] = [
      [["instagram"], ui.NO_ACCOUNT_BODY],
      [["tiktok"], ui.NO_ACCOUNT_BODY_TIKTOK],
      [["instagram", "tiktok"], ui.NO_ACCOUNT_BODY_BOTH],
    ];
    for (const [platforms, body] of cases) {
      expect(ui.noAccountBody(platforms)).toBe(body);
      expect(flow({ picked: [], accounts: [], platforms })).toContain(body);
    }
    // TikTok's connect is a route that redirects off-site: a plain link to it.
    const start = "/api/social/tiktok/start?return=%2Fschedule%2Fr";
    expect(flow({ picked: [], accounts: [], platforms: ["tiktok"], connectHref: start })).toContain(
      `<a href="${start}"`,
    );
  });

  it("the done line says what happens on each platform", () => {
    const [date, time] = ["13 באוקטובר", "14:30"];
    expect(ui.doneLineFor({ instagram: true, tiktok: false }, date, time)).toBe(
      ui.doneLine(date, time),
    );
    expect(ui.doneLineFor({ instagram: false, tiktok: true }, date, time)).toBe(
      "הסרטון יישלח לטיקטוק ב־13 באוקטובר בשעה 14:30. אפשר לשנות או לבטל בלוח הפרסומים עד שהשליחה מתחילה.",
    );
    expect(ui.doneLineFor({ instagram: true, tiktok: true }, date, time)).toBe(
      "הסרטון יפורסם באינסטגרם ויישלח לטיקטוק ב־13 באוקטובר בשעה 14:30. אפשר לשנות או לבטל בלוח הפרסומים עד שהפרסום מתחיל.",
    );
  });

  it("TikTok's cap on unfinished videos is a 429, in Hebrew", async () => {
    as(admin);
    const account = await connectTiktok(db, admin, "tt_open_cap");
    for (let i = 0; i < 5; i++) {
      expect((await schedule({ accountIds: [account] })).status).toBe(200);
    }
    const sixth = await schedule({ accountIds: [account] });
    expect(sixth.status).toBe(429);
    expect(await sixth.json()).toEqual({ ok: false, error: ui.TIKTOK_PENDING_CAP_LINE });
  });

  it("the calendar and the post page word TikTok's states as TikTok's, and never call delivered posted", () => {
    expect(ui.postDisplayStatus({ status: "delivered", deferredUntil: null })).toBe("delivered");
    expect(ui.postStatusLabel("delivered", "tiktok")).toBe(ui.TILE_TAG_DELIVERED);
    expect(ui.postStatusLabel("delivered", "tiktok")).not.toBe(ui.POST_STATUS_LABELS.posted);
    const deferred = ui.postDisplayStatus({ status: "publishing", deferredUntil: new Date() });
    expect(ui.postStatusLabel(deferred, "instagram")).toBe("ממתין למכסת הפרסומים של אינסטגרם");
    expect(ui.postStatusLabel(deferred, "tiktok")).toBe(ui.DEFERRED_LABEL_TIKTOK);
  });

  it("a TikTok post's page has no caption, sound or tick, and once delivered says what to do in TikTok", () => {
    const page = (platform: "instagram" | "tiktok", status: string) =>
      renderToStaticMarkup(
        createElement(PostDetail, {
          post: {
            id: "p",
            status,
            scheduledAt: new Date().toISOString(),
            timezone: "Asia/Jerusalem",
            caption: "",
            sound: null,
            aiLabel: false,
            deferredUntil: null,
            permalink: null,
            failureLine: null,
            account: {
              id: "a",
              platform,
              username: platform === "instagram" ? "flowers.tlv" : null,
              displayName: "חנות הפרחים",
              pictureUrl: null,
            },
            render: { id: "r", service: "a", thumbUrl: null },
          },
          downloadUrl: null,
          horizon: null,
          soundAccountId: null,
          voiced: false,
        }),
      );
    const delivered = page("tiktok", "delivered");
    expect(delivered).toContain(`>${ui.TILE_TAG_DELIVERED}</span>`);
    expect(delivered).toContain(ui.TIKTOK_DELIVERED_LINE);
    expect(delivered).toContain('<img src="/brand/tiktok-icon-black-circle.png"');
    expect(delivered).not.toContain(`>${ui.POST_STATUS_LABELS.posted}<`);
    expect(delivered).not.toContain(`>${ui.FIELD_CAPTION}</dt>`);
    expect(delivered).not.toContain(`>${ui.FIELD_SOUND}</dt>`);
    expect(delivered).not.toContain(ui.AI_TICK_LABEL);
    // Not yet delivered: still no caption or sound row, and no delivery line.
    const waiting = page("tiktok", "publishing");
    expect(waiting).not.toContain(`>${ui.FIELD_CAPTION}</dt>`);
    expect(waiting).not.toContain(ui.TIKTOK_DELIVERED_LINE);
    // Instagram's page keeps both rows.
    const instagram = page("instagram", "posted");
    expect(instagram).toContain(`>${ui.FIELD_CAPTION}</dt>`);
    expect(instagram).toContain(`>${ui.FIELD_SOUND}</dt>`);
    expect(instagram).toContain('<img src="/brand/instagram-glyph-black.svg"');
    expect(instagram).not.toContain(ui.TIKTOK_DELIVERED_LINE);
  });

  it("the TikTok-only time step says what the time is for, and that עכשיו sends it right away", () => {
    const note = ui.TIKTOK_WHEN_NOTE;
    expect(note).toContain("במועד שבחרתם");
    expect(note).toContain("מייל תזכורת");
    expect(note).toContain("הסאונד, הכיתוב והפרסום נעשים בטיקטוק");
    expect(note).toContain(`״${ui.NOW_BUTTON}״ שולח`);
    expect(note).toContain("מיד");
  });

  it("the card, the schedule note, the post page and the email print one inbox path, the same words", () => {
    const phrases = [
      core.TIKTOK_PATH_INBOX,
      core.TIKTOK_PATH_SYSTEM,
      core.TIKTOK_PATH_NOTIFICATION,
    ];
    for (const line of [
      connectUi.TIKTOK_CARD_LEAD,
      ui.TIKTOK_INBOX_NOTE,
      ui.TIKTOK_DELIVERED_LINE,
    ]) {
      expect(line).toContain(core.TIKTOK_FINISH_LINE);
      for (const phrase of phrases) expect(line).toContain(phrase);
      // Each tab in Hebrew with its English name beside it; the notification's English title quoted.
      expect(line).toContain("תיבת דואר נכנס");
      expect(line).toContain("Inbox");
      expect(line).toContain("התראות מערכת");
      expect(line).toContain("System Notifications");
      expect(line).toContain("Your content from Tavnit is ready");
    }
    const email = core.deliveryEmail({
      posts: [
        {
          postId: "00000000-0000-4000-8000-000000000001",
          renderId: "r",
          accountId: "a",
          service: "a",
          businessName: "חנות הפרחים",
          accountName: "פרחים בטיקטוק",
          platform: "tiktok",
          when: "יום שישי, 17 באוקטובר, 10:00",
        },
      ],
    });
    for (const body of [email.text, email.html]) {
      for (const phrase of phrases) expect(body).toContain(phrase);
    }
    // On the screens as rendered: the settings card's lead and the post page's line.
    expect(renderToStaticMarkup(createElement("p", null, connectUi.TIKTOK_CARD_LEAD))).toContain(
      core.TIKTOK_INBOX_PATH,
    );
  });

  it("the delivery email's link is a page that exists: it opens for its owner, and is a 404 for anyone else", async () => {
    as(admin);
    const account = await connectTiktok(db, admin, "tt_open_email_link");
    const [post] = await db
      .insert(schema.scheduledPosts)
      .values({
        userId: admin,
        businessId: adminBusiness,
        videoRenderId: adminRender,
        socialAccountId: account,
        platform: "tiktok",
        scheduledAt: new Date(Date.now() - 600_000),
        timezone: "Asia/Jerusalem",
        caption: "",
        status: "delivered",
        deliveredAt: new Date(Date.now() - 590_000),
      })
      .returning();
    const email = core.deliveryEmail({
      posts: [
        {
          postId: post!.id,
          renderId: adminRender,
          accountId: account,
          service: "a",
          businessName: "עסק",
          accountName: "פרחים בטיקטוק",
          platform: "tiktok",
          when: "עכשיו",
        },
      ],
    });
    const origin = "https://tavnit.ai";
    const url = email.text.split("\n").find((line) => line.startsWith(`${origin}/calendar/`));
    const link = url?.slice(origin.length);
    expect(link).toBe(`/calendar/${post!.id}`);

    const postId = link!.split("/").pop()!;
    const opened = renderToStaticMarkup((await PostPage(params({ postId }))) as ReactElement);
    expect(opened).toContain(ui.TIKTOK_DELIVERED_LINE);
    expect(opened).toContain(`>${ui.TILE_TAG_DELIVERED}</span>`);

    // The page is the owner's alone: signed out, or another account, is the 404 the calendar gives.
    as(null);
    expect(await thrown(PostPage(params({ postId })))).toBe("NEXT_NOT_FOUND");
    as(customer);
    expect(await thrown(PostPage(params({ postId })))).toBe("NEXT_NOT_FOUND");
  });

  it("no line names a Drafts folder: what the owner gets is TikTok's notification", () => {
    const lines = Object.values(ui)
      .flatMap((value) => (typeof value === "string" ? [value] : []))
      .concat(
        ui.doneLineFor({ instagram: false, tiktok: true }, "d", "t"),
        ui.doneLineFor({ instagram: true, tiktok: true }, "d", "t"),
        connectUi.TIKTOK_CARD_LEAD,
      )
      .join(" ");
    expect(lines).not.toMatch(/טיוט|Drafts?/i);
  });
});

describe("the form's own check", () => {
  const horizon = (limitedBy: "policy" | "retention", max: Date) => ({
    maxScheduledAt: max.toISOString(),
    limitedBy,
    days: 30,
  });
  const now = new Date("2026-10-13T10:00:00Z");

  it("past, beyond the horizon, beyond the file's life — and a minute of grace for עכשיו", () => {
    const max = new Date("2026-11-12T10:00:00Z");
    expect(
      form.instantProblem(new Date(now.getTime() - 30_000), now, horizon("policy", max)),
    ).toBeNull();
    expect(
      form.instantProblem(new Date(now.getTime() - 5 * 60_000), now, horizon("policy", max)),
    ).toBe(ui.PAST_LINE);
    expect(form.instantProblem(new Date("2026-11-13T10:00:00Z"), now, horizon("policy", max))).toBe(
      ui.horizonLine(30),
    );
    expect(
      form.instantProblem(new Date("2026-11-13T10:00:00Z"), now, horizon("retention", max)),
    ).toBe(ui.retentionLine(form.formatDay(max)));
  });

  it("the inputs round-trip through local time", () => {
    const at = form.fromInputs("2026-10-13", "14:30")!;
    expect(form.toDateInput(at)).toBe("2026-10-13");
    expect(form.toTimeInput(at)).toBe("14:30");
    expect(form.fromInputs("2026-13-40", "10:00")).toBeNull();
    expect(form.fromInputs("2026-02-30", "10:00")).toBeNull();
    expect(form.fromInputs("2026-10-13", "24:00")).toBeNull();
    expect(form.fromInputs("2026-10-13", "12:60")).toBeNull();
    expect(form.fromInputs("", "")).toBeNull();
  });
});

describe("the date and time pickers (0108 §3, §4)", () => {
  /** The opening tag of the day's button in the month's markup. */
  const dayButton = (markup: string, day: string) =>
    markup.match(new RegExp(`<button[^>]*data-day="${day}"[^>]*>`))?.[0] ?? "";

  it("the time list is 24-hour, in 5-minute steps, with no AM or PM", () => {
    const times = form.timeOptions();
    expect(times).toHaveLength(24 * 12);
    expect(times.slice(0, 3)).toEqual(["00:00", "00:05", "00:10"]);
    expect(times).toContain("13:00");
    expect(times).toContain("18:45");
    expect(times.at(-1)).toBe("23:55");
    for (const time of times) expect(time).toMatch(/^([01]\d|2[0-3]):[0-5][05]$/);

    const markup = renderToStaticMarkup(
      createElement(TimeList, { value: "14:30", onPick: () => {}, onClose: () => {} }),
    );
    const shown = [...markup.matchAll(/role="option"[^>]*>([^<]*)<\/li>/g)].map((m) => m[1]);
    expect(shown).toEqual(times);
    expect(markup).not.toMatch(/AM|PM|לפנה"צ|אחה"צ/);
    expect(markup).toMatch(/aria-selected="true"[^>]*>14:30</);
  });

  it("the list opens on the time, or the next step after it (עכשיו)", () => {
    const times = form.timeOptions();
    expect(times[form.timeOptionIndex(times, "14:30")]).toBe("14:30");
    expect(times[form.timeOptionIndex(times, "14:37")]).toBe("14:40");
    expect(times[form.timeOptionIndex(times, "23:58")]).toBe("23:55");
  });

  it("a day past the allowed range cannot be picked, nor one before it", () => {
    const markup = renderToStaticMarkup(
      createElement(MonthCalendar, {
        value: "2026-10-14",
        min: "2026-10-13",
        max: "2026-10-20",
        onPick: () => {},
        onClose: () => {},
      }),
    );
    expect(dayButton(markup, "2026-10-21")).toContain('disabled=""');
    expect(dayButton(markup, "2026-10-31")).toContain('disabled=""');
    expect(dayButton(markup, "2026-10-12")).toContain('disabled=""');
    for (const open of ["2026-10-13", "2026-10-14", "2026-10-20"]) {
      expect(dayButton(markup, open)).not.toBe("");
      expect(dayButton(markup, open)).not.toContain('disabled=""');
    }
    expect(dayButton(markup, "2026-10-14")).toContain('aria-pressed="true"');

    expect(form.dayPickable("2026-11-13", "2026-10-13", "2026-11-12")).toBe(false);
    expect(form.dayPickable("2026-11-12", "2026-10-13", "2026-11-12")).toBe(true);
    expect(form.dayPickable("2026-10-12", "2026-10-13", "2026-11-12")).toBe(false);
  });

  it("the month is Sunday first, and moves by whole local days", () => {
    // 1 October 2026 is a Thursday: four empty cells before it.
    const days = form.monthDays(2026, 9);
    expect(days.slice(0, 5)).toEqual([null, null, null, null, "2026-10-01"]);
    expect(days.at(-1)).toBe("2026-10-31");
    expect(form.shiftDay("2026-10-31", 1)).toBe("2026-11-01");
    expect(form.shiftDay("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("the sound row's play button (0108 §5)", () => {
  const sound = (previewUrl?: string) => ({
    audioId: "1",
    kind: "original_sound" as const,
    title: "Trending",
    previewUrl,
  });
  const row = (previewUrl?: string) =>
    renderToStaticMarkup(
      createElement(SoundPreview, {
        sound: sound(previewUrl),
        playing: false,
        onPlay: () => {},
        onOpenInstagram: () => {},
      }),
    );

  it("a sound with no file says האזנה באינסטגרם and opens Instagram's page in a new tab", () => {
    const page = "https://www.instagram.com/reels/audio/587784541076604/";
    const markup = row(page);
    expect(markup).toMatch(/^<a /);
    expect(markup).toContain(`href="${page}"`);
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain(`>${ui.SOUND_ON_INSTAGRAM}</a>`);
    expect(ui.SOUND_ON_INSTAGRAM).toBe("האזנה באינסטגרם");
    expect(markup).not.toContain(ui.SOUND_PREVIEW_ARIA);
    expect(form.isInstagramPage("https://instagram.com/reels/audio/1")).toBe(true);
  });

  it("a sound with a file keeps its play button, in place", () => {
    for (const file of [
      "https://scontent.cdninstagram.com/v/t39/audio.m4a",
      "https://ig.example/preview.mp3",
    ]) {
      expect(form.isInstagramPage(file)).toBe(false);
      const markup = row(file);
      expect(markup).toMatch(/^<button type="button" aria-label="השמעת תצוגה מקדימה"/);
      expect(markup).not.toContain("target=");
      expect(markup).not.toContain(ui.SOUND_ON_INSTAGRAM);
    }
    expect(form.isInstagramPage("not a url")).toBe(false);
    expect(row(undefined)).toContain(`aria-label="${ui.SOUND_NO_PREVIEW}"`);
  });
});

describe("the sound picker's proxy", () => {
  beforeEach(() => as(admin));

  it("answers one kind per call through the User token, and reconnect once that token is gone", async () => {
    const meta = new FakeMeta();
    core.setMetaGraphProvider(meta);
    const ok = await (
      await sounds(
        new Request(
          `http://localhost/api/social/instagram/sounds?accountId=${adminAccount}&kind=music&q=שיר`,
        ),
      )
    ).json();
    expect(ok).toEqual({
      ok: true,
      status: "ok",
      items: [{ audioId: "a1", kind: "music", title: "t" }],
    });
    expect(meta.calls.searchAudio).toBe(1);

    await db
      .update(schema.socialAccounts)
      .set({ userTokenExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.socialAccounts.id, adminAccount));
    const gone = await (
      await sounds(
        new Request(
          `http://localhost/api/social/instagram/sounds?accountId=${adminAccount}&kind=music`,
        ),
      )
    ).json();
    expect(gone).toEqual({ ok: true, status: "reconnect" });
    expect(meta.calls.searchAudio).toBe(1);
    await db
      .update(schema.socialAccounts)
      .set({ userTokenExpiresAt: new Date(Date.now() + 60 * 86_400_000) })
      .where(eq(schema.socialAccounts.id, adminAccount));
    core.setMetaGraphProvider(undefined);
  });

  it("another account's id is a 404, and a bad kind a 400", async () => {
    const [other] = await connectInstagram(db, customer, [samplePage("ig_other", "o")]);
    const response = await sounds(
      new Request(`http://localhost/api/social/instagram/sounds?accountId=${other}&kind=music`),
    );
    expect(response.status).toBe(404);
    const bad = await sounds(
      new Request(
        `http://localhost/api/social/instagram/sounds?accountId=${adminAccount}&kind=video`,
      ),
    );
    expect(bad.status).toBe(400);
  });
});

describe("the way back to the video", () => {
  it("the connect returns to the schedule flow and the calendar, and nowhere else", () => {
    const id = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
    expect(socialReturnPath(`/schedule/${id}`)).toBe(`/schedule/${id}`);
    expect(socialReturnPath(`/schedule/${id}?from=${id}`)).toBe(`/schedule/${id}?from=${id}`);
    expect(socialReturnPath("/calendar")).toBe("/calendar");
    expect(socialReturnPath(`/calendar/${id}`)).toBe(`/calendar/${id}`);
    expect(socialReturnPath("/home/renders")).toBe("/home/renders");
    for (const bad of [
      "//evil.example/schedule",
      "/schedule/../admin",
      "/schedule/x",
      "/calendarx",
      "https://evil.example/calendar",
      "/schedule/" + id + " /x",
    ]) {
      expect(socialReturnPath(bad)).toBeNull();
    }
  });

  it("an account with nothing connected is sent to connect, and back to this video", async () => {
    const { userId, businessId } = await seedOwnerAndBusiness(db, { email: "fresh@social.test" });
    const render = await seedReleasedRender(db, core.getStorage(), storageRoot, { businessId });
    as(userId);
    await db
      .insert(schema.appConfig)
      .values({ key: "social_posting", value: { access: "named", userIds: [userId] } });
    const page = (await SchedulePage({
      ...params({ renderId: render.id }),
      searchParams: Promise.resolve({}),
    })) as ReactElement<{ connectHref: string; accounts: unknown[] }>;
    expect(page.props.accounts).toEqual([]);
    expect(page.props.connectHref).toBe(
      `/connect/instagram?return=${encodeURIComponent(`/schedule/${render.id}`)}`,
    );

    // Both switches: settings, where each platform has its card; TikTok's
    // alone: TikTok's own connect (0115). Back to this video either way.
    const back = encodeURIComponent(`/schedule/${render.id}`);
    const pageProps = async () =>
      (
        (await SchedulePage({
          ...params({ renderId: render.id }),
          searchParams: Promise.resolve({}),
        })) as ReactElement<{ connectHref: string; platforms: string[] }>
      ).props;
    await db
      .insert(schema.appConfig)
      .values({ key: "tiktok_posting", value: { access: "named", userIds: [userId] } });
    expect(await pageProps()).toMatchObject({
      connectHref: `/home/settings?return=${back}#connections`,
      platforms: ["instagram", "tiktok"],
    });
    await db.delete(schema.appConfig).where(eq(schema.appConfig.key, "social_posting"));
    expect(await pageProps()).toMatchObject({
      connectHref: `/api/social/tiktok/start?return=${back}`,
      platforms: ["tiktok"],
    });
  });
});
