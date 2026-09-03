import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextResponse } from "next/server";

/**
 * The middleware is the only place a Server-Component request can refresh a
 * Supabase session, and `setAll` writes the rotated cookies onto a `response`
 * local. Anything it returns instead of that local — both early-exit redirects
 * — has to carry those cookies forward, or the browser keeps presenting the
 * spent refresh token and GoTrue revokes the family once the 10s reuse window
 * closes (supabase/config.toml:171,174).
 *
 * The fake createServerClient below rotates cookies the way auth-js does: it
 * calls the `setAll` hook it was constructed with from inside `getUser()`, so
 * every case here goes through the real `response` reassignment.
 */

/**
 * What one real refresh writes: a token too big for one cookie, so it arrives
 * chunked, plus the removal of a stale chunk — @supabase/ssr concatenates
 * removals and writes into a single `setAll` call. Options are the library's
 * defaults (dist/main/utils/constants.js).
 */
const ROTATED = [
  {
    name: "sb-test-auth-token.0",
    value: "R2-chunk-0",
    options: { path: "/", maxAge: 34_560_000, httpOnly: true, sameSite: "lax" as const },
  },
  {
    name: "sb-test-auth-token.1",
    value: "R2-chunk-1",
    options: { path: "/", maxAge: 34_560_000, httpOnly: true, sameSite: "lax" as const },
  },
  { name: "sb-test-stale.2", value: "", options: { path: "/", maxAge: 0 } },
];

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  businessRows: [] as { id: string }[],
}));

vi.mock("@/lib/supabase/client", () => ({
  supabaseUrl: () => "http://127.0.0.1:54321",
  supabaseAnonKey: () => "anon-key",
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: { cookies: { setAll: (c: typeof ROTATED) => void } },
  ) => ({
    auth: {
      getUser: async () => {
        options.cookies.setAll(ROTATED);
        return { data: { user: state.user } };
      },
    },
    from: () => ({
      select: () => ({ limit: async () => ({ data: state.businessRows }) }),
    }),
  }),
}));

async function run(path: string) {
  const { NextRequest } = await import("next/server");
  const { middleware } = await import("../src/middleware");
  return middleware(new NextRequest(new URL(path, "http://localhost:3000")));
}

/** The rotated cookie as the browser would receive it. */
const setCookieFor = (res: Response, name: string) =>
  res.headers.getSetCookie().find((line) => line.startsWith(`${name}=`));

/**
 * Every exit has to hand the browser exactly what `setAll` wrote — both chunks,
 * every attribute, and the removal still removing. Copying name and value only
 * would turn a 400-day cookie into a session cookie and re-emit the removal as
 * a live one; copying just the first entry would splice a fresh chunk .0 onto a
 * stale chunk .1. Both mutations satisfy a presence-only assertion, so each
 * cookie is checked whole.
 */
function expectRotationCarried(res: NextResponse) {
  for (const { name, value, options } of ROTATED) {
    expect(res.cookies.get(name)?.value).toBe(value);

    const line = setCookieFor(res, name);
    expect(line, `no Set-Cookie for ${name}`).toBeDefined();
    expect(line).toContain(`Path=${options.path}`);
    expect(line).toContain(`Max-Age=${options.maxAge}`);
    expect(line?.includes("HttpOnly")).toBe(Boolean(options.httpOnly));
    expect(line?.includes("SameSite=lax")).toBe(options.sameSite === "lax");
  }
}

beforeEach(() => {
  state.user = null;
  state.businessRows = [];
});

describe("middleware carries the refreshed auth cookies onto every exit", () => {
  it("keeps them on the signed-out /home -> /start redirect", async () => {
    const res = await run("/home");

    expect(res.status).toBeGreaterThanOrEqual(307);
    expect(res.status).toBeLessThanOrEqual(308);
    expect(res.headers.get("location")).toBe("http://localhost:3000/start");
    expectRotationCarried(res);
  });

  it("keeps them on the owner's /start -> /home redirect", async () => {
    state.user = { id: "11111111-1111-4111-8111-111111111111" };
    state.businessRows = [{ id: "22222222-2222-4222-8222-222222222222" }];

    const res = await run("/start");

    expect(res.status).toBeGreaterThanOrEqual(307);
    expect(res.status).toBeLessThanOrEqual(308);
    expect(res.headers.get("location")).toBe("http://localhost:3000/home");
    expectRotationCarried(res);
  });

  it("still keeps them on the pass-through that was already correct", async () => {
    state.user = { id: "11111111-1111-4111-8111-111111111111" };

    const res = await run("/home");

    expect(res.headers.get("location")).toBeNull();
    expectRotationCarried(res);
  });
});
