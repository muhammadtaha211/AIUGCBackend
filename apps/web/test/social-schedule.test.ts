import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Social posting PR 3 — the schedule flow (decisions 0101, 0102, 0107) over
 * the real route handlers, pages and layouts on PGlite:
 *
 * - the switch: an account it does not allow (and a signed-out visitor) gets a
 *   404 on every new route and page, and no button, tag, calendar row or
 *   notice anywhere it already goes;
 * - scheduling: a time past the horizon or past the file's life is refused in
 *   Hebrew; the AI label rides only when ticked;
 * - a pending post can be changed and cancelled; one being posted cannot;
 * - the grey tag shows while any post of the video is pending;
 * - the sound picker's proxy, and the connect's way back to the video.
 */

const fixture = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  db: undefined as unknown,
  businesses: [] as { id: string; name: string; questionnaire: unknown }[],
  /** Reads of postingNotices — never for an account the switch hides. */
  noticeReads: 0,
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
  };
});

const core = await import("@aiugc/core");
const { createTestDb } = await import("../../../packages/core/test/helpers/pglite");
const { tempStorage } = await import("../../../packages/core/test/helpers/storage");
const {
  connectInstagram,
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
const { socialReturnPath } = await import("../src/lib/social-oauth");
const form = await import("../src/lib/schedule-form");
const ui = await import("../src/lib/social-posting-ui");

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
  await db.delete(schema.appConfig).where(eq(schema.appConfig.key, "social_posting"));
  fixture.noticeReads = 0;
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
    expect("scheduled" in list.renders[0]).toBe(false);

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

describe("the grey tag and the player's line", () => {
  beforeEach(() => as(admin));

  async function tagged(): Promise<boolean | undefined> {
    const list = await (
      await listRenders(new Request("http://localhost/api"), params({ businessId: adminBusiness }))
    ).json();
    return list.renders.find((row: { id: string }) => row.id === adminRender)?.scheduled;
  }

  it("shows while any post of the video is scheduled or publishing, and not after", async () => {
    expect(await tagged()).toBe(false);
    const first = (await (await schedule({})).json()).posts[0].id as string;
    const second = (await (await schedule({})).json()).posts[0].id as string;
    expect(await tagged()).toBe(true);

    const render = await (
      await getRender(new Request("http://localhost"), params({ id: adminRender }))
    ).json();
    expect(render.pendingPosts).toBe(2);

    await db
      .update(schema.scheduledPosts)
      .set({ status: "publishing" })
      .where(eq(schema.scheduledPosts.id, first));
    await db
      .update(schema.scheduledPosts)
      .set({ status: "posted" })
      .where(eq(schema.scheduledPosts.id, second));
    expect(await tagged()).toBe(true);
    await db
      .update(schema.scheduledPosts)
      .set({ status: "failed", failureKind: "platform_refused", failedAt: new Date() })
      .where(eq(schema.scheduledPosts.id, first));
    expect(await tagged()).toBe(false);
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
        prefill: null,
      }),
    );
    expect(markup).toContain(ui.STEP_ACCOUNTS_TITLE);
    expect(markup).toContain(ui.NO_ACCOUNT_TITLE);
    expect(markup).not.toContain(ui.AI_TICK_LABEL);
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
  });
});
