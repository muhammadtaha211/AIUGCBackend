import { createHmac } from "node:crypto";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Social posting PR 2 — connecting accounts (decisions 0101, 0102) over the
 * real route handlers and pages on PGlite:
 *
 * - the switch: an unnamed customer (and a signed-out visitor) gets a 404 on
 *   every route, the 404 page on the pre-screen and no section in settings; a
 *   NAMED non-admin account gets all of it, like an admin;
 * - the Facebook round trip: the state cookie, the dialog URL (scope list or a
 *   configuration id, rerequest for "add another"), every Instagram account
 *   from one approval, the return address honoured and never an open redirect,
 *   a forged or replayed state refused;
 * - disconnect: tokens erased, pending posts cancelled, the count answered;
 * - Meta's deletion callback: refused without a valid signature, honoured with
 *   one, and its public status page.
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
    // The settings page's plan row; pinned in packages/core, not here.
    getAccountBilling: async () => ({
      subscription: null,
      currentPlan: null,
      plans: [],
      manualOutstanding: 0,
    }),
  };
});

// The settings page reads the selected-business cookie.
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
const { connectInstagram, FakeMeta, samplePage, seedOwnerAndBusiness, socialTestEnv } =
  await import("../../../packages/core/test/helpers/social");
const { GET: start } = await import("../src/app/api/social/instagram/start/route");
const { GET: callback } = await import("../src/app/api/social/instagram/callback/route");
const { POST: disconnect } = await import("../src/app/api/social/accounts/[id]/disconnect/route");
const { POST: dataDeletion } = await import("../src/app/api/social/meta/data-deletion/route");
const { default: SettingsPage } = await import("../src/app/home/settings/page");
const { default: PreScreenPage } = await import("../src/app/home/settings/connect/instagram/page");
const { default: DeletionStatusPage } =
  await import("../src/app/(legal)/social/deletion/[code]/page");
const { SocialAccountsSection } = await import("../src/app/home/settings/social-accounts");
const { InstagramPreScreen } = await import("../src/app/home/settings/connect/instagram/prescreen");
const { OAUTH_COOKIE } = await import("../src/lib/social-oauth");
const ui = await import("../src/lib/social-ui");

const schema = core.schema;
type Db = ReturnType<typeof core.getDb>;
type Meta = InstanceType<typeof FakeMeta>;

const NOT_FOUND = { ok: false, error: "לא נמצא." };
const APP_SECRET = "test_app_secret";

let pg: { close(): Promise<void> };
let db: Db;
let restoreEnv: () => void;
let customer: string;
let reviewer: string;
let admin: string;

const as = (userId: string | null) => {
  fixture.user = userId ? { id: userId, email: "someone@social.test" } : null;
};

/** Two Pages with an Instagram account each, from one approval. */
class TwoAccounts extends FakeMeta {
  override async pagesWithInstagram() {
    await super.pagesWithInstagram();
    return [samplePage("17841400000000001"), samplePage("17841400000000002", "-b")];
  }
}
class NoAccounts extends FakeMeta {
  override async pagesWithInstagram() {
    await super.pagesWithInstagram();
    return [];
  }
}

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  core.resetEnvCache();
}

async function liveAccounts(userId: string) {
  return db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.userId, userId));
}

/** start → the cookie it wrote and where it sent the browser. */
async function startFlow(query = "") {
  const response = await start(new Request(`http://localhost/api/social/instagram/start${query}`));
  return {
    response,
    location: response.headers.get("location") ?? "",
    cookie: response.cookies.get(OAUTH_COOKIE)?.value ?? "",
  };
}

function callbackRequest(query: Record<string, string>, cookie?: string) {
  return new NextRequest(
    `http://localhost/api/social/instagram/callback?${new URLSearchParams(query).toString()}`,
    { headers: cookie ? { cookie: `${OAUTH_COOKIE}=${cookie}` } : {} },
  );
}

/** A full round trip under the current session, through the given fake Meta. */
async function roundTrip(meta: Meta, query = "") {
  core.setMetaGraphProvider(meta);
  const { location, cookie } = await startFlow(query);
  const state = new URL(location).searchParams.get("state")!;
  const response = await callback(callbackRequest({ code: "the_code", state }, cookie));
  return { response, location: response.headers.get("location") ?? "" };
}

function forId(id: string) {
  return { params: Promise.resolve({ id }) };
}

function settingsProps(params: Record<string, string> = {}) {
  return { searchParams: Promise.resolve(params) };
}

/** Every element of a server component's returned tree, without rendering it. */
function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode };
  return [node, ...elements(props.children)];
}

function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (!isValidElement(node)) return "";
  return text((node.props as { children?: ReactNode }).children);
}

function signedRequest(payload: object, secret = APP_SECRET): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${sig}.${encoded}`;
}

function deletionPost(body: Record<string, string>) {
  return new Request("http://localhost/api/social/meta/data-deletion", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
}

beforeAll(async () => {
  restoreEnv = socialTestEnv();
  setEnv({ META_APP_SECRET: APP_SECRET });
  const created = await createTestDb();
  pg = created.pg;
  db = created.db;
  fixture.db = db;
  customer = (await seedOwnerAndBusiness(db, { email: "customer@social.test" })).userId;
  reviewer = (await seedOwnerAndBusiness(db, { email: "reviewer@social.test" })).userId;
  admin = (await seedOwnerAndBusiness(db, { email: "admin@social.test", role: "admin" })).userId;
  await db.execute(
    sql`insert into app_config (key, value) values ('social_posting', ${JSON.stringify({
      access: "named",
      userIds: [reviewer],
    })}::jsonb)`,
  );
});

beforeEach(() => {
  as(null);
  core.setMetaGraphProvider(undefined);
  setEnv({ DRY_RUN: "1", META_APP_ID: undefined, META_LOGIN_CONFIG_ID: undefined });
});

afterAll(async () => {
  core.setMetaGraphProvider(undefined);
  restoreEnv();
  await pg.close();
});

describe("the switch: no trace for an account it does not allow", () => {
  it("an unnamed customer gets a 404 on every route, the 404 page on the pre-screen, no section in settings", async () => {
    as(customer);
    const someId = "99999999-9999-4999-8999-999999999999";
    for (const response of [
      await start(new Request("http://localhost/api/social/instagram/start")),
      await callback(callbackRequest({ code: "x", state: "y" })),
      await disconnect(new Request("http://localhost/x", { method: "POST" }), forId(someId)),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(NOT_FOUND);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    await expect(PreScreenPage(settingsProps())).rejects.toThrow("NEXT_NOT_FOUND");
    const tree = await SettingsPage(settingsProps({ social: "connected", n: "1" }));
    expect(elements(tree).some((el) => el.type === SocialAccountsSection)).toBe(false);
    expect(text(tree)).not.toContain(ui.SOCIAL_SECTION_TITLE);
  });

  it("a signed-out visitor gets the same 404, never a 401 that would say the route exists", async () => {
    as(null);
    const response = await start(new Request("http://localhost/api/social/instagram/start"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(NOT_FOUND);
  });

  it("a named non-admin account sees the pre-screen, the section and every route", async () => {
    as(reviewer);
    const pre = await PreScreenPage(settingsProps({ return: "/home/renders", add: "1" }));
    expect(elements(pre).find((el) => el.type === InstagramPreScreen)?.props).toEqual({
      returnTo: "/home/renders",
      add: true,
    });
    const tree = await SettingsPage(settingsProps());
    const section = elements(tree).find((el) => el.type === SocialAccountsSection);
    expect(section).toBeDefined();
    expect((await startFlow()).response.status).toBe(307);
  });

  it("an admin sees it under every setting", async () => {
    as(admin);
    expect((await startFlow()).response.status).toBe(307);
    const tree = await SettingsPage(settingsProps());
    expect(elements(tree).some((el) => el.type === SocialAccountsSection)).toBe(true);
  });
});

describe("the Facebook round trip", () => {
  it("start writes an HttpOnly, path-scoped state cookie and sends Facebook the five permissions", async () => {
    as(reviewer);
    setEnv({ DRY_RUN: "0", META_APP_ID: "1234567890" });
    const { response, location } = await startFlow();
    const url = new URL(location);
    expect(`${url.origin}${url.pathname}`).toBe("https://www.facebook.com/v26.0/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe("1234567890");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost/api/social/instagram/callback",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe(core.INSTAGRAM_SCOPES.join(","));
    expect(url.searchParams.has("auth_type")).toBe(false);
    expect(url.searchParams.get("state")!.length).toBeGreaterThanOrEqual(32);
    const setCookie = response.headers.get("set-cookie")!;
    expect(setCookie).toContain(`${OAUTH_COOKIE}=`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toContain("Path=/api/social/instagram");
  });

  it('"add another" asks Facebook again (auth_type=rerequest); a configuration id replaces the scope list', async () => {
    as(reviewer);
    setEnv({ DRY_RUN: "0", META_APP_ID: "1234567890" });
    expect(new URL((await startFlow("?add=1")).location).searchParams.get("auth_type")).toBe(
      "rerequest",
    );
    setEnv({ META_LOGIN_CONFIG_ID: "cfg_42" });
    const url = new URL((await startFlow()).location);
    expect(url.searchParams.get("config_id")).toBe("cfg_42");
    expect(url.searchParams.has("scope")).toBe(false);
  });

  it("no app id is a configuration fault: settings says the connect did not happen", async () => {
    as(reviewer);
    setEnv({ DRY_RUN: "0", META_APP_ID: undefined });
    const { location } = await startFlow();
    expect(new URL(location).pathname).toBe("/home/settings");
    expect(new URL(location).searchParams.get("social")).toBe("error");
  });

  it("one approval brings in every Instagram account that has its own Page, both tokens sealed, and settings names the count", async () => {
    as(reviewer);
    const meta = new TwoAccounts();
    const { response, location } = await roundTrip(meta);
    expect(response.status).toBe(307);
    const landed = new URL(location);
    expect(landed.pathname).toBe("/home/settings");
    expect(landed.searchParams.get("social")).toBe("connected");
    expect(landed.searchParams.get("n")).toBe("2");
    expect(landed.hash).toBe("#connections");
    // The cookie is spent whatever happened.
    expect(response.headers.get("set-cookie")).toMatch(new RegExp(`${OAUTH_COOKIE}=;`));
    expect(meta.calls).toMatchObject({
      exchangeCode: 1,
      exchangeLongLived: 1,
      me: 1,
      pagesWithInstagram: 1,
    });
    const rows = await liveAccounts(reviewer);
    expect(rows.map((r) => r.externalId).sort()).toEqual([
      "17841400000000001",
      "17841400000000002",
    ]);
    for (const row of rows) {
      expect(row.status).toBe("connected");
      expect(row.fbUserId).toBe("fb_user_1");
      expect(row.accessTokenEnc).toMatch(/^v1\./);
      expect(row.userTokenEnc).toMatch(/^v1\./);
      expect(row.accessTokenEnc).not.toContain("page_token");
      expect(row.userTokenExpiresAt).not.toBeNull();
    }
    const tree = await SettingsPage(settingsProps({ social: "connected", n: "2" }));
    const section = elements(tree).find((el) => el.type === SocialAccountsSection)!;
    const props = section.props as { accounts: { pictureUrl: string | null }[]; flash: unknown };
    expect(props.accounts).toHaveLength(2);
    expect(props.flash).toEqual({ kind: "ok", text: "2 חשבונות חוברו." });
    // What reaches the client never carries a token.
    expect(JSON.stringify(props)).not.toMatch(/token|v1\./i);
  });

  it("a reconnect restores the same row in place; one account names itself", async () => {
    as(reviewer);
    const before = await liveAccounts(reviewer);
    const { location } = await roundTrip(new FakeMeta());
    const landed = new URL(location);
    expect(landed.searchParams.get("n")).toBe("1");
    const id = landed.searchParams.get("id")!;
    expect(before.map((r) => r.id)).toContain(id);
    expect((await liveAccounts(reviewer)).length).toBe(before.length);
    const tree = await SettingsPage(settingsProps({ social: "connected", n: "1", id }));
    const section = elements(tree).find((el) => el.type === SocialAccountsSection)!;
    expect((section.props as { flash: { text: string } }).flash.text).toMatch(/^החשבון .+ חובר\.$/);
  });

  it("a return address is honoured after connecting, and kept through a failure", async () => {
    as(reviewer);
    const { location } = await roundTrip(new FakeMeta(), "?return=%2Fhome%2Frenders%3Fx%3D1");
    expect(location).toBe("http://localhost/home/renders?x=1");

    // The customer closes Facebook's window: the right state, and Facebook's refusal.
    const meta = new FakeMeta();
    core.setMetaGraphProvider(meta);
    const flow = await startFlow("?return=%2Fhome%2Frenders");
    const state = new URL(flow.location).searchParams.get("state")!;
    const refused = await callback(
      callbackRequest({ error: "access_denied", error_reason: "user_denied", state }, flow.cookie),
    );
    expect(meta.calls.exchangeCode).toBe(0);
    const landed = new URL(refused.headers.get("location")!);
    expect(landed.pathname).toBe("/home/settings");
    expect(landed.searchParams.get("social")).toBe("error");
    expect(landed.searchParams.get("return")).toBe("/home/renders");
  });

  it("an outside return address is dropped, never followed", async () => {
    as(reviewer);
    for (const bad of [
      "https://evil.example/",
      "//evil.example",
      "/api/billing/sumit/return?x=1",
      "/login",
    ]) {
      const { location } = await roundTrip(new FakeMeta(), `?return=${encodeURIComponent(bad)}`);
      expect(new URL(location).origin).toBe("http://localhost");
      expect(new URL(location).pathname).toBe("/home/settings");
    }
  });

  it("a forged, missing or someone else's state is refused before any exchange", async () => {
    as(reviewer);
    const meta = new FakeMeta();
    core.setMetaGraphProvider(meta);
    const { cookie, location } = await startFlow();
    const state = new URL(location).searchParams.get("state")!;

    const cases = [
      callbackRequest({ code: "c", state: "forged" }, cookie),
      callbackRequest({ code: "c", state }),
      callbackRequest({ code: "c" }, cookie),
    ];
    for (const request of cases) {
      const response = await callback(request);
      expect(new URL(response.headers.get("location")!).searchParams.get("social")).toBe("error");
    }
    // The same cookie under another allowed session (the admin) is not theirs.
    as(admin);
    const crossed = await callback(callbackRequest({ code: "c", state }, cookie));
    expect(new URL(crossed.headers.get("location")!).searchParams.get("social")).toBe("error");
    expect(meta.calls.exchangeCode).toBe(0);
  });

  it("an approval with no Instagram professional account says so and connects nothing", async () => {
    as(admin);
    const { location } = await roundTrip(new NoAccounts());
    expect(new URL(location).searchParams.get("social")).toBe("none");
    expect(await liveAccounts(admin)).toEqual([]);
    const tree = await SettingsPage(settingsProps({ social: "none" }));
    const section = elements(tree).find((el) => el.type === SocialAccountsSection)!;
    expect((section.props as { flash: unknown }).flash).toEqual({
      kind: "error",
      text: ui.CONNECT_NO_ACCOUNT,
    });
  });

  it("Meta refusing the code exchange lands on the failure line, not an error page", async () => {
    as(admin);
    const meta = new FakeMeta();
    meta.throwOn.exchangeCode = new core.MetaGraphError(400, { message: "bad code", code: 100 });
    const { location } = await roundTrip(meta);
    expect(new URL(location).searchParams.get("social")).toBe("error");
  });

  it("DRY_RUN walks the whole flow without Facebook: start lands straight on the callback", async () => {
    as(admin);
    const { location, cookie } = await startFlow();
    const url = new URL(location);
    expect(url.pathname).toBe("/api/social/instagram/callback");
    expect(url.searchParams.get("code")).toBe("dry_run");
    const response = await callback(
      callbackRequest({ code: "dry_run", state: url.searchParams.get("state")! }, cookie),
    );
    expect(new URL(response.headers.get("location")!).searchParams.get("social")).toBe("connected");
    const rows = await liveAccounts(admin);
    expect(rows.map((r) => r.displayName)).toEqual(["חשבון לדוגמה"]);
  });
});

describe("disconnect", () => {
  it("erases every token, keeps the row, cancels the account's scheduled posts and answers how many", async () => {
    const owner = await seedOwnerAndBusiness(db, { email: "poster@social.test" });
    await db.execute(
      sql`update app_config set value = ${JSON.stringify({
        access: "named",
        userIds: [reviewer, owner.userId],
      })}::jsonb where key = 'social_posting'`,
    );
    const [accountId] = await connectInstagram(db, owner.userId);
    const [render] = await db
      .insert(schema.videoRenders)
      .values({ businessId: owner.businessId, service: "b", params: {}, status: "released" })
      .returning();
    const post = (status: "scheduled" | "posted") => ({
      userId: owner.userId,
      businessId: owner.businessId,
      videoRenderId: render!.id,
      socialAccountId: accountId!,
      platform: "instagram" as const,
      scheduledAt: new Date(Date.now() + 86_400_000),
      timezone: "Asia/Jerusalem",
      status,
    });
    await db
      .insert(schema.scheduledPosts)
      .values([post("scheduled"), post("scheduled"), post("posted")]);

    // Not theirs: the same 404 as a missing account.
    as(reviewer);
    const foreign = await disconnect(
      new Request("http://localhost/x", { method: "POST" }),
      forId(accountId!),
    );
    expect(foreign.status).toBe(404);

    as(owner.userId);
    const response = await disconnect(
      new Request("http://localhost/x", { method: "POST" }),
      forId(accountId!),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, cancelled: 2 });
    const [row] = await db
      .select()
      .from(schema.socialAccounts)
      .where(eq(schema.socialAccounts.id, accountId!));
    expect(row).toMatchObject({
      status: "disconnected",
      accessTokenEnc: null,
      userTokenEnc: null,
      refreshTokenEnc: null,
    });
    const statuses = (
      await db
        .select({ status: schema.scheduledPosts.status })
        .from(schema.scheduledPosts)
        .where(eq(schema.scheduledPosts.socialAccountId, accountId!))
    )
      .map((p) => p.status)
      .sort();
    expect(statuses).toEqual(["cancelled", "cancelled", "posted"]);
    // Twice is a 404, not a second count.
    const again = await disconnect(
      new Request("http://localhost/x", { method: "POST" }),
      forId(accountId!),
    );
    expect(again.status).toBe(404);
    const bad = await disconnect(
      new Request("http://localhost/x", { method: "POST" }),
      forId("nope"),
    );
    expect(bad.status).toBe(404);
  });
});

describe("Meta's data-deletion callback", () => {
  it("is refused without a valid signature, and nothing is touched", async () => {
    const owner = await seedOwnerAndBusiness(db, { email: "deleter@social.test" });
    await connectInstagram(db, owner.userId, [samplePage("17841400000000099")]);
    const payload = { algorithm: "HMAC-SHA256", user_id: "fb_user_1", issued_at: 1 };
    for (const body of [
      {},
      { signed_request: "" },
      { signed_request: "garbage" },
      { signed_request: signedRequest(payload, "not_the_secret") },
      { signed_request: signedRequest({ ...payload, algorithm: "none" }) },
    ]) {
      const response = await dataDeletion(deletionPost(body));
      expect(response.status).toBe(400);
    }
    const rows = await liveAccounts(owner.userId);
    expect(rows.every((r) => r.status === "connected" && r.accessTokenEnc)).toBe(true);
  });

  it("with a valid signature erases that Facebook user's connections and answers {url, confirmation_code}; the status page reads it back", async () => {
    const response = await dataDeletion(
      deletionPost({
        signed_request: signedRequest({
          algorithm: "HMAC-SHA256",
          user_id: "fb_user_1",
          issued_at: 1,
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { url: string; confirmation_code: string };
    expect(body.url).toBe(`http://localhost/social/deletion/${body.confirmation_code}`);
    const left = await db
      .select()
      .from(schema.socialAccounts)
      .where(eq(schema.socialAccounts.fbUserId, "fb_user_1"));
    expect(left.length).toBeGreaterThan(0);
    for (const row of left.filter((r) => r.status !== "disconnected")) {
      expect(row).toMatchObject({
        status: "deleted",
        accessTokenEnc: null,
        userTokenEnc: null,
        username: null,
        displayName: null,
        pictureUrl: null,
        pageName: null,
      });
    }

    const found = await DeletionStatusPage({
      params: Promise.resolve({ code: body.confirmation_code }),
    });
    expect(text(found)).toContain(ui.DELETION_DONE.after);
    expect(text(found)).toContain(body.confirmation_code);
    const missing = await DeletionStatusPage({
      params: Promise.resolve({ code: "99999999-9999-4999-8999-999999999999" }),
    });
    expect(text(missing)).toContain(ui.DELETION_NOT_FOUND);
    const junk = await DeletionStatusPage({ params: Promise.resolve({ code: "' or 1=1" }) });
    expect(text(junk)).toContain(ui.DELETION_NOT_FOUND);
  });
});

describe("the Hebrew lines", () => {
  it("the disconnect confirm and its done line count what they say", () => {
    expect(ui.disconnectConfirm("חנות הפרחים", 0)).toEqual({
      title: "לנתק את חנות הפרחים?",
      body: null,
    });
    expect(ui.disconnectConfirm("חנות הפרחים", 1).body).toBe("פרסום מתוזמן אחד לחשבון הזה יבוטל.");
    expect(ui.disconnectConfirm("חנות הפרחים", 3).body).toBe(
      "3 פרסומים מתוזמנים לחשבון הזה יבוטלו.",
    );
    expect(ui.disconnectDoneLine(0)).toBe("החשבון נותק.");
    expect(ui.disconnectDoneLine(1)).toBe("החשבון נותק. פרסום מתוזמן אחד בוטל.");
    expect(ui.disconnectDoneLine(4)).toBe("החשבון נותק. 4 פרסומים מתוזמנים בוטלו.");
    expect(ui.connectedLine(1, "חנות הפרחים")).toBe("החשבון חנות הפרחים חובר.");
    expect(ui.connectedLine(3, null)).toBe("3 חשבונות חוברו.");
    expect(ui.accountName({ displayName: null, username: "flowers.tlv" })).toBe("flowers.tlv");
    expect(ui.parseSocialOutcome("connected")).toBe("connected");
    expect(ui.parseSocialOutcome("<script>")).toBeNull();
  });

  it("no line says a video is labelled as AI (0102)", () => {
    const all = Object.values(ui)
      .flatMap((v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v : []))
      .join(" ");
    expect(all).not.toMatch(/AI|בינה מלאכותית|מסומן/);
  });
});
