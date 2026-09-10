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

/**
 * The second argument @supabase/ssr hands `setAll` — verbatim from
 * applyServerStorage (dist/main/cookies.js:447-449), the flush path a server
 * client's refresh actually takes. Responses that set auth cookies must not be
 * cached, or a CDN serves one user's session token to the next
 * (dist/main/types.d.ts:21-25).
 */
const ROTATION_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
};

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  authError: null as { name: string; message: string } | null,
  businessRows: [] as { id: string }[],
  businessError: null as { message: string } | null,
  rotationHeaders: {} as Record<string, string>,
}));

vi.mock("@/lib/supabase/client", () => ({
  supabaseUrl: () => "http://127.0.0.1:54321",
  supabaseAnonKey: () => "anon-key",
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookies: { setAll: (c: typeof ROTATED, headers: Record<string, string>) => void };
    },
  ) => ({
    auth: {
      getUser: async () => {
        options.cookies.setAll(ROTATED, state.rotationHeaders);
        // auth-js's own union: a failed read resolves user: null WITH an error,
        // which is byte-for-byte what a signed-out request resolves without one.
        return { data: { user: state.user }, error: state.authError };
      },
    },
    from: () => ({
      // PostgREST's discriminated union: rows OR an error, never both, and
      // `data` is null on failure — which is exactly why the middleware cannot
      // read a failed query as "this user owns nothing".
      select: () => ({
        limit: async () =>
          state.businessError
            ? { data: null, error: state.businessError }
            : { data: state.businessRows, error: null },
      }),
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

/** Every no-store header `setAll` was handed, on whatever response left. */
function expectNoStoreCarried(res: NextResponse) {
  for (const [key, value] of Object.entries(ROTATION_HEADERS)) {
    expect(res.headers.get(key), `no ${key} header`).toBe(value);
  }
}

beforeEach(() => {
  state.user = null;
  state.authError = null;
  state.businessRows = [];
  state.rotationHeaders = ROTATION_HEADERS;
  // Not optional: a leaked businessError turns the /start -> /home case's read
  // into data: null and kills that redirect, but only once someone reorders or
  // shuffles the tests.
  state.businessError = null;
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

  /**
   * The failed-read case. The routing half of it does not restate a defect the
   * way the two above do — the unfixed middleware passed it too, because
   * `data: null` already fell through `if (data && data.length > 0)`. What
   * pins the guard itself is the log: delete the `if (error)` block and this
   * goes red. Between them they assert the whole contract — an error is not
   * routed on in either direction, it is recorded, and the rotated cookies
   * survive the pass-through.
   * See docs/vault/defects/a-failed-businesses-query-reads-as-no-businesses.md.
   */
  it("does not route either way when the businesses read fails, and says so", async () => {
    state.user = { id: "11111111-1111-4111-8111-111111111111" };
    state.businessError = { message: "connection terminated unexpectedly" };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await run("/start");

      expect(res.headers.get("location")).toBeNull();
      expect(logged).toHaveBeenCalledTimes(1);
      expectRotationCarried(res);
    } finally {
      logged.mockRestore();
    }
  });

  /**
   * The other falsy `data` — a real account that genuinely owns nothing. It
   * must reach the wizard on /start, which is every new account's entry. Split
   * from the case above because they are one branch in the code and two
   * different truths: without this one, narrowing the redirect condition to
   * `if (!error)` would send every brand-new account to /home and no test in
   * apps/web would notice.
   */
  it("leaves a signed-in user who owns nothing on /start", async () => {
    state.user = { id: "11111111-1111-4111-8111-111111111111" };
    state.businessRows = [];

    const res = await run("/start");

    expect(res.headers.get("location")).toBeNull();
    expectRotationCarried(res);
  });

  /**
   * The failed AUTH read. Like the businesses case above, the routing half is
   * behaviour-preserving and that is the whole decision: middleware has no
   * error boundary above it, so a throw here would be a 500 on every matched
   * route — including /login, the one page someone locked out needs. The
   * bounce to /start therefore stays, and the log is the only thing that
   * separates a GoTrue blip from a real sign-out afterwards. Delete the
   * `if (authReadFailed(...))` line and this goes red.
   * See docs/vault/defects/auth-getuser-errors-read-as-signed-out.md.
   */
  it("still bounces /home to /start when the auth read fails, but says so", async () => {
    state.authError = { name: "AuthRetryableFetchError", message: "fetch failed" };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await run("/home");

      expect(res.headers.get("location")).toBe("http://localhost:3000/start");
      expect(logged).toHaveBeenCalledTimes(1);
      expectRotationCarried(res);
    } finally {
      logged.mockRestore();
    }
  });

  /**
   * The other error — and the one that made `if (authError)` the wrong guard.
   * auth-js resolves AuthSessionMissingError for an ORDINARY signed-out
   * request (measured 2026-09-10; see the fact note), and this middleware runs
   * on every public page, so a bare error check would have logged an error for
   * every anonymous pageview on the site. Nothing is logged here on purpose.
   */
  it("says nothing when the reason there is no user is that nobody is signed in", async () => {
    state.authError = { name: "AuthSessionMissingError", message: "Auth session missing!" };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await run("/");

      expect(res.headers.get("location")).toBeNull();
      expect(logged).not.toHaveBeenCalled();
      expectRotationCarried(res);
    } finally {
      logged.mockRestore();
    }
  });

  it("still keeps them on the pass-through that was already correct", async () => {
    state.user = { id: "11111111-1111-4111-8111-111111111111" };

    const res = await run("/home");

    expect(res.headers.get("location")).toBeNull();
    expectRotationCarried(res);
  });
});

/**
 * `setAll` takes a SECOND argument — a header map the library expects on the
 * same response as the cookies, because a response carrying Set-Cookie for a
 * session must not be cached by a CDN. The hook declared one parameter and
 * TypeScript said nothing: a shorter function is assignable, so the map was
 * silently discarded on every exit.
 * See docs/vault/defects/supabase-ssr-setall-cache-headers-are-ignored.md.
 *
 * These pin the map to the same three exits the cookies already ride, and pin
 * the guard that keeps it off responses that were handed nothing.
 */
describe("middleware carries the no-store headers onto every exit", () => {
  it("stamps them on the pass-through", async () => {
    state.user = { id: "11111111-1111-4111-8111-111111111111" };

    const res = await run("/home");

    expect(res.headers.get("location")).toBeNull();
    expectNoStoreCarried(res);
  });

  it("stamps them on the signed-out /home -> /start redirect", async () => {
    const res = await run("/home");

    expect(res.headers.get("location")).toBe("http://localhost:3000/start");
    expectNoStoreCarried(res);
  });

  it("stamps them on the owner's /start -> /home redirect", async () => {
    state.user = { id: "11111111-1111-4111-8111-111111111111" };
    state.businessRows = [{ id: "22222222-2222-4222-8222-222222222222" }];

    const res = await run("/start");

    expect(res.headers.get("location")).toBe("http://localhost:3000/home");
    expectNoStoreCarried(res);
  });

  /**
   * The guard, and the reason the write is not unconditional. `setItem`,
   * `removeItem` and `clearAuthCookiesAtScopes` all call `setAll` with `{}`
   * (cookies.js:240,293 and clearAuthCookiesAtScopes.js:65). Stamping no-store
   * from one of those would take the signed-out marketing homepage — served
   * from the edge today — off the CDN for nothing. The cookies still have to
   * ride: an empty header map says nothing about them.
   */
  it("adds no Cache-Control at all when the header map is empty", async () => {
    state.rotationHeaders = {};

    const res = await run("/");

    expect(res.headers.get("location")).toBeNull();
    for (const key of Object.keys(ROTATION_HEADERS)) {
      expect(res.headers.get(key), `${key} should not be set`).toBeNull();
    }
    expectRotationCarried(res);
  });
});
