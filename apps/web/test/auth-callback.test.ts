import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /auth/callback — the OAuth (PKCE) landing point, and since
 * `fix/site-url-landing` also where the middleware forwards a Site-URL landing
 * on `/`. Four outcomes; these cases are about the two that fail.
 *
 * The rule they pin (defect
 * the-site-url-landing-signs-you-into-the-wrong-account): a round-trip that
 * failed must not leave the browser signed in as whoever it was before. The
 * customer reads the Hebrew failure message on /login, and the `/` -> /home
 * owner bounce would otherwise walk them straight back into the older account.
 * So both failure branches sign that session out — `scope: "local"`, this
 * browser only — and neither success branch touches it.
 *
 * The clear is best-effort and the redirect is the priority: signOut's two
 * failure modes each get a case asserting the landing does not move — an
 * `error` union, and a rejection, which comes from `_callRefreshToken` and NOT
 * from the cookie write (lib/supabase/server.ts swallows that one). route.ts's
 * own comment carries the full reasoning; do not restate a different mechanism
 * here.
 *
 * Since the guard, the clear is also conditional: it runs only when a PKCE
 * code-verifier cookie says this browser started the round-trip. Without that,
 * `/auth/callback?error=x` was an unauthenticated sign-out any cross-site link
 * could trigger — the auth cookies are SameSite=Lax and ride a top-level GET.
 * Every failure case therefore comes in two: evidence present, and absent.
 *
 * Supabase is mocked at `@/lib/supabase/server`, matched on the raw `@/`
 * specifier the route imports — the same trick sumit-return-route.test.ts
 * uses; apps/web/vitest.config.ts teaches vitest the alias for the imports
 * that are NOT mocked. `next/headers` is mocked the same way, by its own bare
 * specifier.
 */

const fixture = vi.hoisted(() => ({
  /** How many clients the route built — the error-params branch had none. */
  clients: 0,
  /** Makes the factory itself fail, the way an unset env var would. */
  clientThrows: false,
  /** The request's cookie jar, as `cookies()` hands it to the route. */
  cookies: [] as { name: string; value: string }[],
  exchangeCodeForSession: vi.fn(),
  signOut: vi.fn(),
}));

/**
 * The real names, spelled the way the two libraries build them:
 * `sb-<project-ref>-auth-token` from supabase-js's default storage key, plus
 * auth-js's `-code-verifier`. The route matches the verifier by SUFFIX, so the
 * ref here is arbitrary — which is the point of these being realistic rather
 * than exact.
 */
const VERIFIER = { name: "sb-hyaqydcmwbnbaiqqufow-auth-token-code-verifier", value: "base64-zC9h" };
/** A live session, i.e. the thing a drive-by victim is carrying. Not evidence. */
const SESSION = { name: "sb-hyaqydcmwbnbaiqqufow-auth-token", value: "base64-eyJhbGci" };

vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => fixture.cookies }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => {
    fixture.clients += 1;
    if (fixture.clientThrows) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
    return {
      auth: {
        exchangeCodeForSession: fixture.exchangeCodeForSession,
        signOut: fixture.signOut,
      },
    };
  },
}));

const { GET } = await import("../src/app/auth/callback/route");

const ORIGIN = "http://localhost:3000";
const OAUTH_FAILED = `${ORIGIN}/login?error=oauth`;
/** A PKCE auth code. It is a credential: it must not reach any log line. */
const CODE = "8f0b6c21-4a17-4d0e-9c3b-2f5a7e1d9b40";

const get = (query: string) => GET(new Request(`${ORIGIN}/auth/callback${query}`));

/** Silences the route's own logging and hands back everything it was given. */
function captureLogs() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

/** Every argument of every call, flattened — what did the route actually say? */
const logs = (spy: ReturnType<typeof captureLogs>) => spy.mock.calls.flat().map(String).join(" ");

beforeEach(() => {
  fixture.clients = 0;
  fixture.clientThrows = false;
  // The default is a browser that DID start a sign-in here and is also signed
  // in already — the wrong-account case the clear exists for.
  fixture.cookies = [SESSION, VERIFIER];
  fixture.exchangeCodeForSession.mockReset();
  fixture.exchangeCodeForSession.mockResolvedValue({ error: null });
  fixture.signOut.mockReset();
  fixture.signOut.mockResolvedValue({ error: null });
});

describe("GET /auth/callback", () => {
  it("ends the previous session when the exchange fails, and lands on /login", async () => {
    fixture.exchangeCodeForSession.mockResolvedValue({ error: { message: "invalid request" } });
    const logged = captureLogs();

    try {
      const response = await get(`?code=${CODE}`);

      expect(fixture.signOut).toHaveBeenCalledTimes(1);
      expect(fixture.signOut).toHaveBeenCalledWith({ scope: "local" });
      // The status, not just the header: a 200 carrying a Location renders a
      // blank page and the Hebrew message is never seen.
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(OAUTH_FAILED);
    } finally {
      logged.mockRestore();
    }
  });

  it("ends it on the error-params branch too, which had no client of its own", async () => {
    const logged = captureLogs();

    try {
      const response = await get("?error=access_denied&error_description=user%20refused");

      expect(fixture.clients).toBe(1);
      expect(fixture.exchangeCodeForSession).not.toHaveBeenCalled();
      expect(fixture.signOut).toHaveBeenCalledTimes(1);
      expect(fixture.signOut).toHaveBeenCalledWith({ scope: "local" });
      expect(response.headers.get("location")).toBe(OAUTH_FAILED);
    } finally {
      logged.mockRestore();
    }
  });

  /**
   * The whole point of clearing only on failure. A working exchange has just
   * written the session the user asked for; signing it out here would sign
   * them out of the account they successfully chose.
   */
  it("leaves a working exchange alone and continues to /start", async () => {
    const response = await get(`?code=${CODE}`);

    expect(fixture.exchangeCodeForSession).toHaveBeenCalledWith(CODE);
    expect(fixture.signOut).not.toHaveBeenCalled();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/start`);
  });

  /**
   * Neither branch: no code, no error params. Unchanged on purpose, so
   * nothing regresses if GoTrue ever moves the params.
   */
  it("still continues to /start when the query carries nothing, and clears nothing", async () => {
    const response = await get("");

    expect(fixture.clients).toBe(0);
    expect(fixture.signOut).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(`${ORIGIN}/start`);
  });

  /**
   * signOut REJECTS rather than resolving when auth-js's `_callRefreshToken`
   * is handed a falsy refresh token: that throw comes before its own try, and
   * `_useSession` has no catch. The failure message is what the user came for
   * — it must survive a clear that cannot happen.
   */
  it("still lands on /login when the clear throws", async () => {
    fixture.signOut.mockRejectedValue(new Error("Auth session missing!"));
    const logged = captureLogs();

    try {
      const response = await get("?error=access_denied");

      expect(response.headers.get("location")).toBe(OAUTH_FAILED);
      expect(logs(logged)).toContain("Auth session missing!");
    } finally {
      logged.mockRestore();
    }
  });

  /** The other failure mode: signOut resolving an `error` instead of throwing. */
  it("still lands on /login when the clear answers with an error", async () => {
    fixture.signOut.mockResolvedValue({ error: { message: "logout failed" } });
    const logged = captureLogs();

    try {
      const response = await get("?error=access_denied");

      expect(response.headers.get("location")).toBe(OAUTH_FAILED);
      expect(logs(logged)).toContain("logout failed");
    } finally {
      logged.mockRestore();
    }
  });

  /**
   * The mutation that would silently defeat the whole commit: `void
   * endPreviousSession(...)` instead of `await`. Every other case still passes
   * under it, because signOut IS called — just not waited for. It matters
   * because the real clear writes its cookie removals only AFTER a network
   * round-trip (`_signOut` awaits the /logout POST before
   * `removeCurrentSession()`), so an un-awaited clear produces a redirect with
   * no Set-Cookie on it at all — the exact no-op this branch exists to end.
   */
  it("waits for the clear to finish before it answers", async () => {
    let cleared = false;
    fixture.signOut.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      cleared = true;
      return { error: null };
    });
    const logged = captureLogs();

    try {
      const response = await get("?error=access_denied");

      expect(cleared).toBe(true);
      expect(response.headers.get("location")).toBe(OAUTH_FAILED);
    } finally {
      logged.mockRestore();
    }
  });

  /**
   * The error-params branch builds its own client, and building it is part of
   * the clear — so it happens inside the guard. Passing it as an argument
   * would put it outside, and on a deploy with an unset NEXT_PUBLIC_SUPABASE_*
   * the branch whose only job is to show the failure message would answer 500
   * instead. Before this commit it built no client and always redirected.
   */
  it("still lands on /login when the client cannot be built at all", async () => {
    fixture.clientThrows = true;
    const logged = captureLogs();

    try {
      const response = await get("?error=access_denied");

      expect(fixture.signOut).not.toHaveBeenCalled();
      expect(response.headers.get("location")).toBe(OAUTH_FAILED);
      expect(logs(logged)).toContain("NEXT_PUBLIC_SUPABASE_URL is not set");
    } finally {
      logged.mockRestore();
    }
  });

  /**
   * The guard. `/auth/callback?error=x` is reachable by anyone with a link, and
   * the session cookie rides a top-level cross-site GET because it is
   * SameSite=Lax — so without evidence that this browser started a round-trip,
   * the clear is a sign-out button on the open internet. The PKCE code-verifier
   * cookie is that evidence.
   *
   * Absent, each branch must be exactly what it was before the clear existed:
   * same redirect, same log, nothing touched. Note the fixtures below still
   * carry SESSION — the victim of a drive-by IS signed in; being signed in is
   * not evidence of having started anything.
   */
  describe("only when this browser started the round-trip", () => {
    it("does not clear on a failed exchange when there is no verifier", async () => {
      fixture.cookies = [SESSION];
      fixture.exchangeCodeForSession.mockResolvedValue({ error: { message: "invalid request" } });
      const logged = captureLogs();

      try {
        const response = await get(`?code=${CODE}`);

        expect(fixture.signOut).not.toHaveBeenCalled();
        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toBe(OAUTH_FAILED);
        // The log is the branch's other half and must not move either.
        expect(logs(logged)).toContain("code exchange failed");
      } finally {
        logged.mockRestore();
      }
    });

    it("does not clear on the error-params branch when there is no verifier", async () => {
      fixture.cookies = [SESSION];
      const logged = captureLogs();

      try {
        const response = await get("?error=access_denied&error_description=user%20refused");

        expect(fixture.signOut).not.toHaveBeenCalled();
        // Not one client built: byte-for-byte the origin/main behaviour.
        expect(fixture.clients).toBe(0);
        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toBe(OAUTH_FAILED);
        expect(logs(logged)).toContain("provider returned an error");
      } finally {
        logged.mockRestore();
      }
    });

    /**
     * An empty value is what a removal leaves behind — @supabase/ssr writes
     * `value: ""` with `maxAge: 0` (cookies.js:428-440), and a request racing
     * that response can still present the name. A name on its own is not
     * evidence.
     */
    it("treats an empty verifier as absent on the failed-exchange branch", async () => {
      fixture.cookies = [SESSION, { ...VERIFIER, value: "" }];
      fixture.exchangeCodeForSession.mockResolvedValue({ error: { message: "invalid request" } });
      const logged = captureLogs();

      try {
        const response = await get(`?code=${CODE}`);

        expect(fixture.signOut).not.toHaveBeenCalled();
        expect(response.headers.get("location")).toBe(OAUTH_FAILED);
      } finally {
        logged.mockRestore();
      }
    });

    it("treats an empty verifier as absent on the error-params branch", async () => {
      fixture.cookies = [SESSION, { ...VERIFIER, value: "" }];
      const logged = captureLogs();

      try {
        const response = await get("?error=access_denied");

        expect(fixture.signOut).not.toHaveBeenCalled();
        expect(fixture.clients).toBe(0);
        expect(response.headers.get("location")).toBe(OAUTH_FAILED);
      } finally {
        logged.mockRestore();
      }
    });

    /**
     * Where the read SITS, not just that it happens. auth-js removes the
     * verifier inside `_exchangeCodeForSession` on every outcome — at
     * GoTrueClient.js:1591, ahead of the `if (error) throw` below it, and again
     * at :1609 in the catch. This fake does the same thing to the store, so a
     * read moved to after the exchange sees nothing and the clear silently
     * stops happening on the one branch that needs it most.
     */
    it("reads the verifier before the exchange can consume it", async () => {
      fixture.exchangeCodeForSession.mockImplementation(async () => {
        fixture.cookies = fixture.cookies.filter((c) => c.name !== VERIFIER.name);
        return { error: { message: "invalid request" } };
      });
      const logged = captureLogs();

      try {
        const response = await get(`?code=${CODE}`);

        expect(fixture.signOut).toHaveBeenCalledTimes(1);
        expect(fixture.signOut).toHaveBeenCalledWith({ scope: "local" });
        expect(response.headers.get("location")).toBe(OAUTH_FAILED);
      } finally {
        logged.mockRestore();
      }
    });
  });

  /**
   * The code is a credential. This pins the exchange-failure log, the one line
   * that handles a GoTrue message on a request whose URL carries the code —
   * adding `code` to that call turns this red. It does NOT cover the catch
   * path's log, which prints the thrown value whole; nothing in the tree puts
   * the code into a thrown value, and pretending otherwise with a planted
   * fixture would be theatre.
   */
  it("never writes the auth code to a log line", async () => {
    fixture.exchangeCodeForSession.mockResolvedValue({ error: { message: "invalid request" } });
    fixture.signOut.mockRejectedValue(new Error("Auth session missing!"));
    const logged = captureLogs();

    try {
      await get(`?code=${CODE}`);

      expect(logs(logged)).not.toContain(CODE);
    } finally {
      logged.mockRestore();
    }
  });
});
