import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The middleware is the only place a Server-Component request can refresh a
 * Supabase session, and `setAll` writes the rotated cookies onto a `response`
 * local. Anything it returns instead of that local — both early-exit redirects
 * — has to carry those cookies forward, or the browser keeps presenting the
 * spent refresh token and GoTrue revokes the family once the 10s reuse window
 * closes (supabase/config.toml:171,174).
 *
 * The fake createServerClient below rotates a cookie the way auth-js does: it
 * calls the `setAll` hook it was constructed with from inside `getUser()`, so
 * every case here goes through the real `response` reassignment.
 */

const ROTATED = { name: "sb-test-auth-token", value: "R2", options: { path: "/" } };

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
    options: { cookies: { setAll: (c: (typeof ROTATED)[]) => void } },
  ) => ({
    auth: {
      getUser: async () => {
        options.cookies.setAll([ROTATED]);
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
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
    expect(setCookieFor(res, ROTATED.name)).toBeDefined();
  });

  it("keeps them on the owner's /start -> /home redirect", async () => {
    state.user = { id: "11111111-1111-4111-8111-111111111111" };
    state.businessRows = [{ id: "22222222-2222-4222-8222-222222222222" }];

    const res = await run("/start");

    expect(res.status).toBeGreaterThanOrEqual(307);
    expect(res.status).toBeLessThanOrEqual(308);
    expect(res.headers.get("location")).toBe("http://localhost:3000/home");
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
    expect(setCookieFor(res, ROTATED.name)).toBeDefined();
  });

  it("still keeps them on the pass-through that was already correct", async () => {
    state.user = { id: "11111111-1111-4111-8111-111111111111" };

    const res = await run("/home");

    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
    expect(setCookieFor(res, ROTATED.name)).toBeDefined();
  });
});
