import { createHmac } from "node:crypto";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
 *   one, and its public status page;
 * - TikTok's connect (decision 0115): its own switch, its own cookie, the
 *   console's exact redirect, every refusal its own outcome worded as TikTok's,
 *   a grant without video.upload refused, tokens sealed, its card in settings.
 */

const fixture = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  db: undefined as unknown,
  /** Reads of app_config.instagram_connect — never before the switch's gate. */
  modeReads: 0,
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
    getInstagramConnectMode: (db: Parameters<typeof actual.getInstagramConnectMode>[0]) => {
      fixture.modeReads++;
      return actual.getInstagramConnectMode(db);
    },
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
    // The settings section's refresh after a ניתוק, rendered here outside an app router.
    useRouter: () => ({ refresh: () => {} }),
  };
});

const core = await import("@aiugc/core");
const { createTestDb } = await import("../../../packages/core/test/helpers/pglite");
const {
  connectInstagram,
  connectTiktok,
  FakeMeta,
  FakeTiktok,
  samplePage,
  sampleTiktokTokens,
  seedOwnerAndBusiness,
  socialTestEnv,
} = await import("../../../packages/core/test/helpers/social");
const { GET: start } = await import("../src/app/api/social/instagram/start/route");
const { GET: callback } = await import("../src/app/api/social/instagram/callback/route");
const { GET: sounds } = await import("../src/app/api/social/instagram/sounds/route");
const { GET: tiktokStart } = await import("../src/app/api/social/tiktok/start/route");
const { GET: tiktokCallback } = await import("../src/app/api/social/tiktok/callback/route");
const { POST: disconnect } = await import("../src/app/api/social/accounts/[id]/disconnect/route");
const { POST: dataDeletion } = await import("../src/app/api/social/meta/data-deletion/route");
const { default: SettingsPage } = await import("../src/app/home/settings/page");
const { default: PreScreenPage } = await import("../src/app/connect/instagram/page");
const { default: DeletionStatusPage } =
  await import("../src/app/(legal)/social/deletion/[code]/page");
const { SocialAccountsSection } = await import("../src/app/home/settings/social-accounts");
const { InstagramPreScreen } = await import("../src/app/connect/instagram/prescreen");
const {
  decodeOAuthCookie,
  encodeOAuthCookie,
  IG_ONBOARDING_EXTRAS,
  OAUTH_COOKIE,
  OAUTH_WINDOW_MS,
  TIKTOK_OAUTH_COOKIE,
} = await import("../src/lib/social-oauth");
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

/** app_config.instagram_connect as the founder sets it in SQL; null deletes the row. */
async function setConnectMode(value: string | null) {
  if (value === null) {
    await db.execute(sql`delete from app_config where key = 'instagram_connect'`);
    return;
  }
  await db.execute(
    sql`insert into app_config (key, value) values ('instagram_connect', ${value}::jsonb)
        on conflict (key) do update set value = excluded.value`,
  );
}

/** The start route's cookie, re-sealed as if it had been issued `minutesAgo`. */
function agedCookie(cookie: string, minutesAgo: number): string {
  const saved = decodeOAuthCookie(cookie)!;
  return encodeOAuthCookie({ ...saved, issuedAt: Date.now() - minutesAgo * 60_000 });
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

beforeEach(async () => {
  as(null);
  core.setMetaGraphProvider(undefined);
  setEnv({ DRY_RUN: "1", META_APP_ID: undefined, META_LOGIN_CONFIG_ID: undefined });
  await setConnectMode(null);
  fixture.modeReads = 0;
});

afterAll(async () => {
  core.setMetaGraphProvider(undefined);
  restoreEnv();
  await pg.close();
});

describe("the switch: no trace for an account it does not allow", () => {
  it("an unnamed customer gets a 404 on every route, the 404 page on the pre-screen, no section in settings", async () => {
    // An account the customer really owns (connected while the switch let them
    // in, say): only the switch can turn the disconnect into a 404, not a
    // missing row.
    const [own] = await connectInstagram(db, customer, [samplePage("17841400000000077")]);
    // With Meta's one-window setup switched on, nothing changes for them —
    // and a live start (not DRY_RUN's stub branch) would read the mode.
    await setConnectMode('"onboarding"');
    setEnv({ DRY_RUN: "0", META_APP_ID: "1234567890" });
    as(customer);
    for (const response of [
      await start(new Request("http://localhost/api/social/instagram/start")),
      await callback(callbackRequest({ code: "x", state: "y" })),
      await disconnect(new Request("http://localhost/x", { method: "POST" }), forId(own!)),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(NOT_FOUND);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    const [kept] = await db
      .select()
      .from(schema.socialAccounts)
      .where(eq(schema.socialAccounts.id, own!));
    expect(kept!.status).toBe("connected");
    expect(kept!.accessTokenEnc).not.toBeNull();
    await expect(PreScreenPage(settingsProps())).rejects.toThrow("NEXT_NOT_FOUND");
    for (const social of ["connected", "none", "expired"]) {
      const tree = await SettingsPage(settingsProps({ social, n: "1" }));
      expect(elements(tree).some((el) => el.type === SocialAccountsSection)).toBe(false);
      expect(text(tree)).not.toContain(ui.SOCIAL_SECTION_TITLE);
    }
    // The connect mode is read only behind the gate…
    expect(fixture.modeReads).toBe(0);
    // …and the count does see a read: the same start, by an allowed account.
    as(reviewer);
    expect((await startFlow()).response.status).toBe(307);
    expect(fixture.modeReads).toBe(1);
  });

  it("a signed-out visitor gets the same 404 everywhere, never a 401 or a redirect that would say the page exists", async () => {
    await setConnectMode('"onboarding"');
    setEnv({ DRY_RUN: "0", META_APP_ID: "1234567890" });
    as(null);
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
    expect(fixture.modeReads).toBe(0);
  });

  it("a named non-admin account sees the pre-screen, the section and every route", async () => {
    as(reviewer);
    const pre = await PreScreenPage(settingsProps({ return: "/home/renders", add: "1" }));
    expect(elements(pre).find((el) => el.type === InstagramPreScreen)?.props).toEqual({
      returnTo: "/home/renders",
      add: true,
      mode: "standard",
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
    // Today's request, nothing more: the one-window setup is off without its row.
    expect([...url.searchParams.keys()]).toEqual([
      "client_id",
      "redirect_uri",
      "state",
      "response_type",
      "scope",
    ]);
    const setCookie = response.headers.get("set-cookie")!;
    expect(setCookie).toContain(`${OAUTH_COOKIE}=`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toContain("Path=/api/social/instagram");
    // The browser keeps it a day; the callback allows the window thirty minutes.
    expect(setCookie).toMatch(/Max-Age=86400/i);
    const saved = decodeOAuthCookie(response.cookies.get(OAUTH_COOKIE)?.value)!;
    expect(Math.abs(saved.issuedAt - Date.now())).toBeLessThan(60_000);
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

  it("the one-window setup: switched on, start sends Meta's onboarding parameters with a code return; off, absent or a typo, today's request", async () => {
    as(reviewer);
    setEnv({ DRY_RUN: "0", META_APP_ID: "1234567890", META_LOGIN_CONFIG_ID: "cfg_42" });
    await setConnectMode('"onboarding"');
    for (const query of ["", "?add=1"]) {
      const url = new URL((await startFlow(query)).location);
      expect(`${url.origin}${url.pathname}`).toBe("https://www.facebook.com/v26.0/dialog/oauth");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        client_id: "1234567890",
        redirect_uri: "http://localhost/api/social/instagram/callback",
        state: expect.stringMatching(/^[\w-]{32,}$/),
        // A code in the query, never Meta's documented token in the fragment.
        response_type: "code",
        display: "page",
        extras: '{"setup":{"channel":"IG_API_ONBOARDING"}}',
        override_default_response_type: "true",
        scope: core.INSTAGRAM_SCOPES.join(","),
      });
    }
    expect(IG_ONBOARDING_EXTRAS).toBe('{"setup":{"channel":"IG_API_ONBOARDING"}}');

    for (const mode of ['"standard"', '"Onboarding"', '{"mode":"onboarding"}', null]) {
      await setConnectMode(mode);
      const url = new URL((await startFlow("?add=1")).location);
      // Order and count pinned too: today's request, byte for byte but the random state.
      expect(
        [...url.searchParams].map(([key, value]) => [key, key === "state" ? "<state>" : value]),
      ).toEqual([
        ["client_id", "1234567890"],
        ["redirect_uri", "http://localhost/api/social/instagram/callback"],
        ["state", "<state>"],
        ["response_type", "code"],
        ["config_id", "cfg_42"],
        ["auth_type", "rerequest"],
      ]);
    }
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
    // With a fragment of its own, so none Facebook appended can ride along.
    expect(location).toBe("http://localhost/home/renders?x=1#");

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
    expect(landed.searchParams.get("social")).toBe("cancelled");
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

  it("a forged, missing or someone else's state is refused before any exchange, with its own line", async () => {
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
      expect(new URL(response.headers.get("location")!).searchParams.get("social")).toBe(
        "mismatch",
      );
      expect(response.headers.get("set-cookie")).toMatch(new RegExp(`${OAUTH_COOKIE}=;`));
    }
    // The same cookie under another allowed session (the admin) is not theirs.
    as(admin);
    const crossed = await callback(callbackRequest({ code: "c", state }, cookie));
    expect(new URL(crossed.headers.get("location")!).searchParams.get("social")).toBe("mismatch");
    expect(meta.calls.exchangeCode).toBe(0);

    const tree = await SettingsPage(settingsProps({ social: "mismatch" }));
    const section = elements(tree).find((el) => el.type === SocialAccountsSection)!;
    expect((section.props as { flash: unknown }).flash).toEqual({
      kind: "error",
      text: ui.CONNECT_MISMATCH,
    });
  });

  it("a return later than the window's thirty minutes is refused before any exchange, with its own line", async () => {
    as(reviewer);
    const meta = new FakeMeta();
    core.setMetaGraphProvider(meta);
    expect(OAUTH_WINDOW_MS).toBe(30 * 60_000);

    const late = await startFlow("?return=%2Fhome%2Frenders");
    const lateState = new URL(late.location).searchParams.get("state")!;
    const refused = await callback(
      callbackRequest({ code: "c", state: lateState }, agedCookie(late.cookie, 31)),
    );
    expect(meta.calls.exchangeCode).toBe(0);
    expect(refused.headers.get("set-cookie")).toMatch(new RegExp(`${OAUTH_COOKIE}=;`));
    const landed = new URL(refused.headers.get("location")!);
    expect(landed.searchParams.get("social")).toBe("expired");
    // The retry still lands where the customer was going.
    expect(landed.searchParams.get("return")).toBe("/home/renders");
    const tree = await SettingsPage(settingsProps({ social: "expired" }));
    const section = elements(tree).find((el) => el.type === SocialAccountsSection)!;
    expect((section.props as { flash: unknown }).flash).toEqual({
      kind: "error",
      text: ui.CONNECT_EXPIRED,
    });

    // A late cookie that is someone else's is foreign, not late.
    as(admin);
    const crossed = await callback(
      callbackRequest({ code: "c", state: lateState }, agedCookie(late.cookie, 31)),
    );
    expect(new URL(crossed.headers.get("location")!).searchParams.get("social")).toBe("mismatch");

    // Twenty-nine minutes in is still inside the window.
    as(reviewer);
    const slow = await startFlow();
    const slowState = new URL(slow.location).searchParams.get("state")!;
    const connected = await callback(
      callbackRequest({ code: "c", state: slowState }, agedCookie(slow.cookie, 29)),
    );
    expect(new URL(connected.headers.get("location")!).searchParams.get("social")).toBe(
      "connected",
    );
    expect(meta.calls.exchangeCode).toBe(1);
  });

  it("a closed window, a Facebook error and an empty return each land on their own line, with no exchange", async () => {
    as(reviewer);
    const meta = new FakeMeta();
    core.setMetaGraphProvider(meta);
    const { cookie, location } = await startFlow();
    const state = new URL(location).searchParams.get("state")!;
    const outcomes: [Record<string, string>, string, string][] = [
      [
        { error: "access_denied", error_reason: "user_denied", state },
        "cancelled",
        ui.CONNECT_CANCELLED,
      ],
      [{ error: "server_error", state }, "error", ui.CONNECT_FAILED],
      // Meta's documented token return lives in the fragment, which never reaches a server.
      [{}, "error", ui.CONNECT_FAILED],
    ];
    for (const [query, outcome, line] of outcomes) {
      const response = await callback(callbackRequest(query, cookie));
      expect(new URL(response.headers.get("location")!).searchParams.get("social")).toBe(outcome);
      const tree = await SettingsPage(settingsProps({ social: outcome }));
      const section = elements(tree).find((el) => el.type === SocialAccountsSection)!;
      expect((section.props as { flash: unknown }).flash).toEqual({ kind: "error", text: line });
    }
    expect(meta.calls.exchangeCode).toBe(0);
    // Every line is its own, and none is the bare "try again" of PR 2.
    const lines = [
      ui.CONNECT_EXPIRED,
      ui.CONNECT_MISMATCH,
      ui.CONNECT_CANCELLED,
      ui.CONNECT_FAILED,
      ui.connectNoAccountLine("standard"),
      ui.connectNoAccountLine("onboarding"),
    ];
    expect(new Set(lines).size).toBe(lines.length);
    expect(lines).not.toContain("החיבור לאינסטגרם לא הושלם. נסו שוב.");
  });

  it("every address the callback sends the browser to carries a fragment of its own", async () => {
    as(reviewer);
    const locations: string[] = [];
    locations.push((await roundTrip(new FakeMeta())).location);
    locations.push((await roundTrip(new FakeMeta(), "?return=%2Fhome%2Frenders")).location);
    locations.push((await roundTrip(new NoAccounts(), "?return=%2Fhome%2Frenders")).location);
    const broken = new FakeMeta();
    broken.throwOn.me = new core.MetaGraphError(500, { message: "boom", code: 1 });
    locations.push((await roundTrip(broken)).location);
    const { cookie, location } = await startFlow("?return=%2Fhome%2Frenders");
    const state = new URL(location).searchParams.get("state")!;
    for (const request of [
      callbackRequest({}, cookie),
      callbackRequest({ error: "access_denied", state }, cookie),
      callbackRequest({ code: "c", state: "forged" }, cookie),
      callbackRequest({ code: "c", state }, agedCookie(cookie, 31)),
    ]) {
      locations.push((await callback(request)).headers.get("location")!);
    }
    expect(locations).toHaveLength(8);
    for (const at of locations) expect(at).toMatch(/^http:\/\/localhost\/home\/[^#]*#/);
  });

  it("an add that brings back an account already connected keeps its one row and adds only the new one", async () => {
    as(reviewer);
    const [shira] = await connectInstagram(db, reviewer, [
      samplePage("17841400000000031", "-shira"),
    ]);
    class ShiraAndOmri extends FakeMeta {
      override async pagesWithInstagram() {
        await super.pagesWithInstagram();
        return [
          samplePage("17841400000000031", "-shira"),
          samplePage("17841400000000032", "-omri"),
        ];
      }
    }
    for (let i = 0; i < 2; i++) {
      const { location } = await roundTrip(new ShiraAndOmri(), "?add=1");
      expect(new URL(location).searchParams.get("n")).toBe("2");
      const rows = (await liveAccounts(reviewer)).filter((row) =>
        ["17841400000000031", "17841400000000032"].includes(row.externalId),
      );
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.externalId === "17841400000000031")!.id).toBe(shira);
      expect(rows.every((row) => row.status === "connected")).toBe(true);
    }
  });

  it("an approval with no Instagram professional account says so, with what to do in the window the mode opens", async () => {
    as(admin);
    const { location } = await roundTrip(new NoAccounts());
    expect(new URL(location).searchParams.get("social")).toBe("none");
    expect(await liveAccounts(admin)).toEqual([]);
    for (const [mode, line] of [
      [null, ui.connectNoAccountLine("standard")],
      ['"onboarding"', ui.connectNoAccountLine("onboarding")],
    ] as const) {
      await setConnectMode(mode);
      const tree = await SettingsPage(settingsProps({ social: "none" }));
      const section = elements(tree).find((el) => el.type === SocialAccountsSection)!;
      expect((section.props as { flash: unknown }).flash).toEqual({ kind: "error", text: line });
    }
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

describe("TikTok's connect (decision 0115)", () => {
  const CLIENT_KEY = "test_tiktok_client_key";
  const someId = "99999999-9999-4999-8999-999999999999";
  let tiktoker: string;

  beforeAll(async () => {
    // TikTok's switch alone: Instagram's stays shut for this account.
    tiktoker = (await seedOwnerAndBusiness(db, { email: "tiktoker@social.test" })).userId;
    await db.execute(
      sql`insert into app_config (key, value) values ('tiktok_posting', ${JSON.stringify({
        access: "named",
        userIds: [tiktoker],
      })}::jsonb)`,
    );
  });

  beforeEach(() => {
    core.setTiktokProvider(undefined);
    setEnv({ TIKTOK_CLIENT_KEY: undefined });
  });

  afterAll(() => {
    core.setTiktokProvider(undefined);
  });

  /** start → the cookie it wrote and where it sent the browser. */
  async function tiktokStartFlow(query = "") {
    const response = await tiktokStart(
      new Request(`http://localhost/api/social/tiktok/start${query}`),
    );
    return {
      response,
      location: response.headers.get("location") ?? "",
      cookie: response.cookies.get(TIKTOK_OAUTH_COOKIE)?.value ?? "",
    };
  }

  function tiktokReturn(query: Record<string, string>, cookie?: string) {
    return new NextRequest(
      `http://localhost/api/social/tiktok/callback?${new URLSearchParams(query).toString()}`,
      { headers: cookie ? { cookie: `${TIKTOK_OAUTH_COOKIE}=${cookie}` } : {} },
    );
  }

  /** A full round trip under the current session, through the given fake TikTok. */
  async function tiktokRoundTrip(tiktok: InstanceType<typeof FakeTiktok>, query = "") {
    core.setTiktokProvider(tiktok);
    const { location, cookie } = await tiktokStartFlow(query);
    const state = new URL(location).searchParams.get("state")!;
    const response = await tiktokCallback(tiktokReturn({ code: "the_code", state }, cookie));
    return { response, location: response.headers.get("location") ?? "" };
  }

  async function tiktokRows(userId: string) {
    return (await liveAccounts(userId)).filter((row) => row.platform === "tiktok");
  }

  async function section(userId: string, params: Record<string, string> = {}) {
    as(userId);
    const tree = await SettingsPage(settingsProps(params));
    return elements(tree).find((el) => el.type === SocialAccountsSection) as
      ReactElement<Parameters<typeof SocialAccountsSection>[0]> | undefined;
  }

  it("each platform's routes open under its own switch alone", async () => {
    // Instagram's switch alone, no switch at all, signed out: TikTok's routes are a 404.
    for (const who of [reviewer, customer, null]) {
      as(who);
      for (const response of [
        await tiktokStart(new Request("http://localhost/api/social/tiktok/start")),
        await tiktokCallback(tiktokReturn({ code: "x", state: "y" })),
      ]) {
        expect(response.status).toBe(404);
        expect(await response.json()).toEqual(NOT_FOUND);
        expect(response.headers.get("set-cookie")).toBeNull();
      }
    }

    // TikTok's switch alone: Instagram's connect, its sounds and its pre-screen are a 404…
    as(tiktoker);
    for (const response of [
      await start(new Request("http://localhost/api/social/instagram/start")),
      await callback(callbackRequest({ code: "x", state: "y" })),
      await sounds(
        new Request(`http://localhost/api/social/instagram/sounds?accountId=${someId}&kind=music`),
      ),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(NOT_FOUND);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    await expect(PreScreenPage(settingsProps())).rejects.toThrow("NEXT_NOT_FOUND");

    // …and TikTok's are open, as they are for an admin.
    expect((await tiktokStartFlow()).response.status).toBe(307);
    as(admin);
    expect((await tiktokStartFlow()).response.status).toBe(307);
  });

  it("DRY_RUN lands on this origin's own callback with a stub code, under TikTok's own cookie", async () => {
    as(tiktoker);
    const { response, location, cookie } = await tiktokStartFlow("?return=%2Fhome%2Frenders");
    expect(response.status).toBe(307);
    const url = new URL(location);
    // Never tavnit.ai: the console's redirect is production's, DRY_RUN walks locally.
    expect(`${url.origin}${url.pathname}`).toBe("http://localhost/api/social/tiktok/callback");
    expect(url.searchParams.get("code")).toBe("dry_run");
    const saved = decodeOAuthCookie(cookie)!;
    expect(url.searchParams.get("state")).toBe(saved.state);
    expect(saved).toMatchObject({ userId: tiktoker, returnTo: "/home/renders" });

    const setCookie = response.headers.get("set-cookie")!;
    expect(setCookie).toContain(`${TIKTOK_OAUTH_COOKIE}=`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toContain("Path=/api/social/tiktok");
    expect(setCookie).toMatch(/Max-Age=86400/i);
    // Instagram's state is untouched: the two round trips never spend each other's.
    expect(response.cookies.get(OAUTH_COOKIE)).toBeUndefined();

    // The stub walks the rest: the sample account connects, and the return address is honoured.
    const done = await tiktokCallback(
      tiktokReturn({ code: "dry_run", state: saved.state }, cookie),
    );
    expect(done.headers.get("location")).toBe("http://localhost/home/renders#");
    expect((await tiktokRows(tiktoker)).map((row) => row.displayName)).toContain(
      "חשבון טיקטוק לדוגמה",
    );
  });

  it("live, start sends TikTok's authorize page the console's exact redirect, both scopes and the cookie's state", async () => {
    as(tiktoker);
    setEnv({ DRY_RUN: "0", TIKTOK_CLIENT_KEY: CLIENT_KEY });
    const { response, location, cookie } = await tiktokStartFlow();
    expect(response.status).toBe(307);
    const state = decodeOAuthCookie(cookie)!.state;
    expect(state.length).toBeGreaterThanOrEqual(32);
    expect(location).toBe(core.tiktokAuthorizeUrl({ clientKey: CLIENT_KEY, state }));
    const url = new URL(location);
    expect(`${url.origin}${url.pathname}`).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_key: CLIENT_KEY,
      response_type: "code",
      scope: "user.info.basic,video.upload",
      redirect_uri: "https://tavnit.ai/api/social/tiktok/callback",
      state,
      disable_auto_auth: "1",
    });
  });

  it("no client key is a configuration fault: settings says TikTok's connect did not happen", async () => {
    as(tiktoker);
    setEnv({ DRY_RUN: "0", TIKTOK_CLIENT_KEY: undefined });
    const { response, location } = await tiktokStartFlow("?return=%2Fhome%2Frenders");
    const landed = new URL(location);
    expect(landed.pathname).toBe("/home/settings");
    expect(landed.searchParams.get("social")).toBe("error");
    expect(landed.searchParams.get("p")).toBe("tiktok");
    expect(landed.searchParams.get("return")).toBe("/home/renders");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("a cancel, TikTok's error, a forged, missing or late state each land on their own outcome, TikTok's, with the cookie spent and no exchange", async () => {
    as(tiktoker);
    const tiktok = new FakeTiktok();
    core.setTiktokProvider(tiktok);
    const { cookie, location } = await tiktokStartFlow("?return=%2Fhome%2Frenders");
    const state = new URL(location).searchParams.get("state")!;
    const cases: [NextRequest, string][] = [
      [
        tiktokReturn({ error: "access_denied", error_description: "no", state }, cookie),
        "cancelled",
      ],
      [tiktokReturn({ error: "server_error", state }, cookie), "error"],
      [tiktokReturn({ code: "c", state: "forged" }, cookie), "mismatch"],
      [tiktokReturn({ code: "c", state }), "mismatch"],
      [tiktokReturn({ code: "c", state }, agedCookie(cookie, 31)), "expired"],
      [tiktokReturn({}, cookie), "error"],
    ];
    for (const [request, outcome] of cases) {
      const response = await tiktokCallback(request);
      const landed = new URL(response.headers.get("location")!);
      expect(landed.pathname).toBe("/home/settings");
      expect(landed.hash).toBe("#connections");
      expect(landed.searchParams.get("social")).toBe(outcome);
      expect(landed.searchParams.get("p")).toBe("tiktok");
      const setCookie = response.headers.get("set-cookie")!;
      expect(setCookie).toMatch(new RegExp(`${TIKTOK_OAUTH_COOKIE}=;`));
      expect(setCookie).toContain("Path=/api/social/tiktok");
    }
    expect(tiktok.calls.exchangeCode).toBe(0);

    // The same cookie under another allowed session (the admin) is not theirs.
    as(admin);
    const crossed = await tiktokCallback(tiktokReturn({ code: "c", state }, cookie));
    expect(new URL(crossed.headers.get("location")!).searchParams.get("social")).toBe("mismatch");
    expect(tiktok.calls.exchangeCode).toBe(0);
  });

  it("a grant without video.upload is refused with its own outcome, and no account is written", async () => {
    as(tiktoker);
    const tiktok = new FakeTiktok();
    tiktok.tokens = { ...sampleTiktokTokens("tt_open_scope"), scopes: ["user.info.basic"] };
    const before = (await tiktokRows(tiktoker)).length;
    const { location } = await tiktokRoundTrip(tiktok);
    const landed = new URL(location);
    expect(landed.searchParams.get("social")).toBe("scope");
    expect(landed.searchParams.get("p")).toBe("tiktok");
    expect(tiktok.calls).toMatchObject({ exchangeCode: 1, userInfo: 0 });
    const rows = await tiktokRows(tiktoker);
    expect(rows).toHaveLength(before);
    expect(rows.some((row) => row.externalId === "tt_open_scope")).toBe(false);
  });

  it("a full grant connects the account, both tokens sealed and never in the redirect, and settings names it", async () => {
    as(tiktoker);
    const tiktok = new FakeTiktok();
    tiktok.tokens = sampleTiktokTokens("tt_open_live", {
      access: "ACCESS_SECRET_1",
      refresh: "REFRESH_SECRET_1",
    });
    const { response, location } = await tiktokRoundTrip(tiktok);
    expect(response.status).toBe(307);
    expect(tiktok.calls).toMatchObject({ exchangeCode: 1, userInfo: 1 });
    const landed = new URL(location);
    expect(landed.pathname).toBe("/home/settings");
    expect(landed.hash).toBe("#connections");
    const [row] = (await tiktokRows(tiktoker)).filter((r) => r.externalId === "tt_open_live");
    expect(Object.fromEntries(landed.searchParams)).toEqual({
      social: "connected",
      p: "tiktok",
      n: "1",
      id: row!.id,
    });
    expect(row).toMatchObject({
      status: "connected",
      displayName: "שם טיקטוק חדש",
      username: null,
    });
    expect(row!.accessTokenEnc).toMatch(/^v1\./);
    expect(row!.refreshTokenEnc).toMatch(/^v1\./);
    expect(`${row!.accessTokenEnc}${row!.refreshTokenEnc}`).not.toContain("SECRET");
    // Nothing the browser receives carries a token.
    expect(location).not.toMatch(/SECRET|v1\./);
    expect(response.headers.get("set-cookie")).toMatch(new RegExp(`${TIKTOK_OAUTH_COOKIE}=;`));
    expect(response.headers.get("set-cookie")).not.toMatch(/SECRET|v1\./);
    expect(await response.text()).not.toMatch(/SECRET|v1\./);

    const found = await section(tiktoker, {
      social: "connected",
      n: "1",
      id: row!.id,
      p: "tiktok",
    });
    expect(found!.props.flash).toEqual({ kind: "ok", text: ui.connectedLine(1, "שם טיקטוק חדש") });
    expect(found!.props.platforms).toEqual(["tiktok"]);
    expect(JSON.stringify(found!.props)).not.toMatch(/token|SECRET|v1\./i);

    // A return address is honoured after connecting.
    as(tiktoker);
    const back = await tiktokRoundTrip(new FakeTiktok(), "?return=%2Fhome%2Frenders");
    expect(back.location).toBe("http://localhost/home/renders#");
  });

  it("settings words each failed round trip as TikTok's when it was TikTok's", async () => {
    const lines: [string, string][] = [
      ["expired", ui.TIKTOK_CONNECT_EXPIRED],
      ["mismatch", ui.TIKTOK_CONNECT_MISMATCH],
      ["cancelled", ui.TIKTOK_CONNECT_CANCELLED],
      ["scope", ui.TIKTOK_CONNECT_SCOPE],
      ["error", ui.TIKTOK_CONNECT_FAILED],
    ];
    for (const [social, text] of lines) {
      const found = await section(tiktoker, { social, p: "tiktok" });
      expect(found!.props.flash).toEqual({ kind: "error", text });
    }
    // Without `p`, the same outcome is Instagram's line.
    expect((await section(tiktoker, { social: "expired" }))!.props.flash).toEqual({
      kind: "error",
      text: ui.CONNECT_EXPIRED,
    });
    // Every TikTok line is its own, and none sends the customer to Facebook.
    const texts = lines.map(([, text]) => text);
    expect(new Set(texts).size).toBe(texts.length);
    for (const text of texts) expect(text).not.toMatch(/פייסבוק|אינסטגרם/);
  });

  it("the TikTok card is there only under TikTok's switch, Instagram's only under Instagram's", async () => {
    const markup = (props: Parameters<typeof SocialAccountsSection>[0]) =>
      renderToStaticMarkup(createElement(SocialAccountsSection, props));
    const TIKTOK_START = 'href="/api/social/tiktok/start"';
    const IG_PRESCREEN = 'href="/connect/instagram';

    const onlyTiktok = (await section(tiktoker))!;
    expect(onlyTiktok.props.platforms).toEqual(["tiktok"]);
    expect(onlyTiktok.props.accounts.every((account) => account.platform === "tiktok")).toBe(true);
    const tiktokCard = markup(onlyTiktok.props);
    expect(tiktokCard).toContain(ui.TIKTOK_LABEL);
    expect(tiktokCard).toContain(ui.TIKTOK_CARD_LEAD);
    expect(tiktokCard).toContain('<img src="/brand/tiktok-icon-black-circle.png"');
    // Connected already: a plain link to TikTok's start route, "הוספת חשבון".
    expect(tiktokCard).toMatch(
      new RegExp(`<a ${TIKTOK_START} class="[^"]*">${ui.SOCIAL_ADD_ANOTHER}</a>`),
    );
    // TikTok's basic profile has no handle: the name alone, masked in a recording.
    expect(tiktokCard).toContain("<bdi>שם טיקטוק חדש</bdi>");
    expect(tiktokCard).not.toContain(">@");
    expect(tiktokCard).not.toContain(IG_PRESCREEN);
    expect(tiktokCard).not.toContain("/brand/instagram-glyph-black.svg");

    // Nothing connected yet: the primary "חיבור חשבון", and the empty line.
    const empty = markup({ ...onlyTiktok.props, accounts: [], flash: null });
    expect(empty).toMatch(new RegExp(`<a ${TIKTOK_START} class="[^"]*">${ui.SOCIAL_CONNECT}</a>`));
    expect(empty).toContain(ui.SOCIAL_EMPTY);

    const onlyInstagram = (await section(reviewer))!;
    expect(onlyInstagram.props.platforms).toEqual(["instagram"]);
    const instagramCard = markup(onlyInstagram.props);
    expect(instagramCard).toContain(IG_PRESCREEN);
    expect(instagramCard).toContain('<img src="/brand/instagram-glyph-black.svg"');
    expect(instagramCard).not.toContain(ui.TIKTOK_CARD_LEAD);
    expect(instagramCard).not.toContain("/api/social/tiktok/start");

    const both = markup((await section(admin))!.props);
    expect(both.indexOf(IG_PRESCREEN)).toBeGreaterThan(-1);
    expect(both.indexOf(IG_PRESCREEN)).toBeLessThan(both.indexOf(ui.TIKTOK_CARD_LEAD));
  });

  it("ניתוק takes a TikTok account like an Instagram one; an account on a hidden platform is a 404", async () => {
    as(tiktoker);
    const accountId = await connectTiktok(db, tiktoker, "tt_open_gone");
    // An Instagram account from before the switches changed: hidden, so not found.
    const [instagramId] = await connectInstagram(db, tiktoker, [
      samplePage("17841400000000088", "-tt"),
    ]);
    const hidden = await disconnect(
      new Request("http://localhost/x", { method: "POST" }),
      forId(instagramId!),
    );
    expect(hidden.status).toBe(404);

    const response = await disconnect(
      new Request("http://localhost/x", { method: "POST" }),
      forId(accountId),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, cancelled: 0 });
    const [row] = await db
      .select()
      .from(schema.socialAccounts)
      .where(eq(schema.socialAccounts.id, accountId));
    expect(row).toMatchObject({
      status: "disconnected",
      accessTokenEnc: null,
      refreshTokenEnc: null,
    });
    const [kept] = await db
      .select()
      .from(schema.socialAccounts)
      .where(eq(schema.socialAccounts.id, instagramId!));
    expect(kept!.status).toBe("connected");
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
    const bodies: Record<string, string>[] = [
      {},
      { signed_request: "" },
      { signed_request: "garbage" },
      { signed_request: signedRequest(payload, "not_the_secret") },
      { signed_request: signedRequest({ ...payload, algorithm: "none" }) },
    ];
    for (const body of bodies) {
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
    // Meta documents "an alphanumeric confirmation code".
    expect(body.confirmation_code).toMatch(/^[0-9a-f]{32}$/);
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
      title: "לנתק את ⁨חנות הפרחים⁩?",
      body: null,
    });
    // An English name keeps its own punctuation inside the Hebrew question.
    expect(ui.disconnectConfirm("Yoga & Co.", 0).title).toBe("לנתק את ⁨Yoga & Co.⁩?");
    expect(ui.disconnectConfirm("חנות הפרחים", 1).body).toBe("פרסום מתוזמן אחד לחשבון הזה יבוטל.");
    expect(ui.disconnectConfirm("חנות הפרחים", 3).body).toBe(
      "3 פרסומים מתוזמנים לחשבון הזה יבוטלו.",
    );
    expect(ui.disconnectDoneLine(0)).toBe("החשבון נותק.");
    expect(ui.disconnectDoneLine(1)).toBe("החשבון נותק. פרסום מתוזמן אחד בוטל.");
    expect(ui.disconnectDoneLine(4)).toBe("החשבון נותק. 4 פרסומים מתוזמנים בוטלו.");
    expect(ui.connectedLine(1, "חנות הפרחים")).toBe("החשבון ⁨חנות הפרחים⁩ חובר.");
    expect(ui.connectedLine(3, null)).toBe("3 חשבונות חוברו.");
    expect(ui.accountName({ displayName: null, username: "flowers.tlv" })).toBe("flowers.tlv");
    expect(ui.parseSocialOutcome("connected")).toBe("connected");
    expect(ui.parseSocialOutcome("<script>")).toBeNull();
  });

  it("today's connect says how to link a Page first, in Meta's own labels; adding opens with it, Continue before Edit settings (0106)", () => {
    const path = "עריכת פרופיל ← דף ← חיבור או יצירה";
    const connect = ui.preScreenLines("standard", false);
    const add = ui.preScreenLines("standard", true);
    for (const lines of [connect, add]) {
      expect(lines.filter((line) => line.includes(path))).toHaveLength(1);
      expect(new Set(lines).size).toBe(lines.length);
    }
    expect(add[0]).toMatch(/^לחשבון האינסטגרם החדש צריך עמוד פייסבוק משלו/);
    const continueLine = add.find((line) => line.includes("Continue"))!;
    expect(continueLine.indexOf("Continue")).toBeLessThan(continueLine.indexOf("Edit"));
    // Facebook's button labels stay whole, LTR islands inside the Hebrew.
    expect(continueLine).toContain(ui.isolated("Edit settings"));
    expect(ui.connectNoAccountLine("standard")).toContain(path);
    // The one-window lines are untouched and unused while the switch is off.
    expect(ui.preScreenLines("onboarding", true)).toEqual(ui.preScreenLines("onboarding", false));
  });

  it("no line says a video is labelled as AI (0102)", () => {
    const all = Object.values(ui)
      .flatMap((v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v : []))
      .join(" ");
    expect(all).not.toMatch(/AI|בינה מלאכותית|מסומן/);
  });
});
