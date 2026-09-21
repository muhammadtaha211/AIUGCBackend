import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { authReadFailed, authedUser } from "../src/lib/auth-user";

/**
 * The defect: a FAILED `auth.getUser()` used to be indistinguishable from
 * "signed out", so a GoTrue blip evicted a live session to /start, and from
 * there OnboardingFlow forwards to /home/new-business, whose completion posts
 * `allowCreate` and creates a SECOND business.
 * docs/vault/defects/auth-getuser-errors-read-as-signed-out.md
 *
 * The trap, and the reason these cases are shaped the way they are: auth-js
 * populates `error` for the ORDINARY signed-out case too, so `if (error) throw`
 * would put the error card in front of every logged-out visitor. The five
 * `error` values below are the ones measured against the live project on
 * 2026-09-10 (@supabase/auth-js 2.110.6) — see
 * docs/vault/facts/getuser-resolves-an-error-when-signed-out.md. Three of them
 * are ANSWERS and two are the absence of one, and the whole contract is that
 * those two groups are not treated alike.
 */
const user = { id: "11111111-1111-4111-8111-111111111111", email: "founder@example.com" };

/** Verbatim from the measurement: name, message and status as auth-js built them. */
const SESSION_MISSING = { name: "AuthSessionMissingError", message: "Auth session missing!" };
const BAD_JWT = {
  name: "AuthApiError",
  message: "invalid JWT: unable to parse or verify signature",
};
const HOST_DOWN = { name: "AuthRetryableFetchError", message: "fetch failed" };
const GOTRUE_503 = { name: "AuthRetryableFetchError", message: "{}" };
const UNPARSEABLE = { name: "AuthUnknownError", message: "Unexpected token < in JSON" };
/** No `name` at all — a hand-written double, or a class this list has not met. */
const UNNAMED = { message: "who knows" };

describe("authReadFailed", () => {
  it("is false for no error at all", () => {
    expect(authReadFailed(null)).toBe(false);
    expect(authReadFailed(undefined)).toBe(false);
  });

  it("is false for the errors that ARE an answer", () => {
    // Both mean "there is no usable session here", which the caller's redirect
    // to /start already handles correctly. Reading them as failures would show
    // the error card to every signed-out visitor and — worse — strand anyone
    // holding a stale token on a page that cannot reach /login.
    expect(authReadFailed(SESSION_MISSING)).toBe(false);
    expect(authReadFailed(BAD_JWT)).toBe(false);
  });

  it("is true for the errors that leave the question open", () => {
    // auth-js raises AuthRetryableFetchError for a non-Response failure and for
    // anything in 500-599, and AuthUnknownError when a body will not parse.
    expect(authReadFailed(HOST_DOWN)).toBe(true);
    expect(authReadFailed(GOTRUE_503)).toBe(true);
    expect(authReadFailed(UNPARSEABLE)).toBe(true);
  });

  it("is false for an unnamed error rather than throwing on one", () => {
    // A hand-written double, or a future auth-js class this list has not been
    // taught. Erring toward the redirect is the cheaper mistake.
    expect(authReadFailed(UNNAMED)).toBe(false);
  });
});

describe("authedUser", () => {
  it("returns the user a successful read produced", () => {
    expect(authedUser({ data: { user }, error: null })).toEqual(user);
  });

  it("returns null when there is no session and auth-js says so plainly", () => {
    expect(authedUser({ data: { user: null }, error: null })).toBeNull();
  });

  it("returns null for a signed-out request, which arrives WITH an error", () => {
    // The measured shape of an ordinary logged-out visitor. If this ever throws,
    // /home stops redirecting to /start and starts rendering the error card for
    // everyone who is not signed in.
    expect(authedUser({ data: { user: null }, error: SESSION_MISSING })).toBeNull();
  });

  it("returns null for a session whose token is no longer valid", () => {
    // A verdict, not a failure: the way out is /login, and throwing would put an
    // error card between the customer and it.
    expect(authedUser({ data: { user: null }, error: BAD_JWT })).toBeNull();
  });

  it("throws when GoTrue could not be reached", () => {
    expect(() => authedUser({ data: { user: null }, error: HOST_DOWN })).toThrow(
      /auth read failed: fetch failed/,
    );
  });

  it("throws when GoTrue answered 5xx", () => {
    expect(() => authedUser({ data: { user: null }, error: GOTRUE_503 })).toThrow(
      /auth read failed/,
    );
  });

  it("throws when the response could not be parsed at all", () => {
    expect(() => authedUser({ data: { user: null }, error: UNPARSEABLE })).toThrow(
      /auth read failed/,
    );
  });

  it("throws even when a user came back alongside a failed read", () => {
    // Not a shape auth-js produces — UserResponse is a union and the two are
    // exclusive. It pins the PRECEDENCE anyway: a result carrying a read failure
    // is never trusted for its data.
    expect(() => authedUser({ data: { user }, error: HOST_DOWN })).toThrow(/auth read failed/);
  });

  it("does not crash on a result with no error property at all", () => {
    // What a hand-written test double returns; `result.error` is undefined, not
    // null. Nothing to report and nothing to throw about.
    expect(authedUser({ data: { user: null } } as Parameters<typeof authedUser>[0])).toBeNull();
  });
});

/**
 * The convention guard, and the reason this file is worth more than the unit
 * tests above it. `authedUser` only helps a caller that calls it, and the way
 * this shape reached fourteen sites was copy: a new page starts from an old
 * one. Neither the unit tests nor typecheck can see that — a new page with the
 * plain destructure is perfectly valid code. So this asserts the convention
 * over the source itself.
 *
 * Two rules, because the right answer differs by surface and both halves are
 * decisions someone made on purpose:
 *   - under app/home, a file that reads the session goes through the helper
 *     and throws to the boundary;
 *   - everywhere else in apps/web, a file that reads the session must be on
 *     the allowlist below, which names what it does instead and why.
 * A new call site anywhere in apps/web reddens one of them.
 */
const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

/**
 * Every apps/web reader of the session that is NOT under app/home, with the
 * marker that proves it still handles the failure. None of these may throw:
 * middleware has no boundary above it (a throw is a 500 on every matched
 * route), a route handler has no boundary either but does have a status code
 * to tell the truth with, and the wizard runs in the browser.
 */
const OUTSIDE_HOME: Record<string, { marker: string; why: string }> = {
  "middleware.ts": {
    marker: "if (authReadFailed(authError)) console.error",
    why: "no boundary above middleware — a throw is a 500 on every matched route",
  },
  "lib/api.ts": {
    marker: "jsonError(503, GENERIC_ERROR)",
    why: "route handlers answer 503, because a failed read is not an absent session",
  },
  "app/api/onboarding/complete/route.ts": {
    marker: "status: 503",
    why: "same as lib/api.ts, on the route the wizard posts the questionnaire to",
  },
  "components/onboarding/onboarding-flow.tsx": {
    marker: "createClient().auth.getUser()",
    why: "browser client, and its error case already falls through to rendering the wizard",
  },
  "app/(marketing)/pricing/page.tsx": {
    marker: "if (authReadFailed(error)) console.error",
    why: "a public page that reads the session only to pick the cards' call to action — a failed read is logged and shown the signed-out cards, never the error card",
  },
  "app/api/billing/sumit/return/route.ts": {
    marker: "if (authReadFailed(error)) console.error",
    why: "the browser arrives from Sumit's payment page; a failed read is logged and treated as no session, so nothing completes and the customer goes through /login with this URL as next — the payment waits at Sumit, and signing in completes it",
  },
};

function sourceFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("every apps/web session read handles a failed one", () => {
  const readers = sourceFilesUnder(SRC_DIR)
    .map((file) => ({
      // Posix-style, so the keys above read the same on every machine.
      name: relative(SRC_DIR, file).split("\\").join("/"),
      source: readFileSync(file, "utf8"),
    }))
    // The scan is a substring match, so it also hits files that only TALK
    // about the call — which is none of them except the helper, whose own doc
    // comment quotes it. It is the thing being conformed to, not a site.
    .filter(({ name, source }) => name !== "lib/auth-user.ts" && source.includes("auth.getUser()"));

  it("finds the reads at all (the scan is not silently matching nothing)", () => {
    expect(readers.length).toBeGreaterThanOrEqual(13);
  });

  it.each(readers.map(({ name }) => name))("%s", (name) => {
    const { source } = readers.find((reader) => reader.name === name)!;

    if (name.startsWith("app/home/")) {
      expect(source).toContain("authedUser(");
      return;
    }

    const exception = OUTSIDE_HOME[name];
    expect(
      exception,
      `${name} reads the session and is not under app/home — decide what it does with a failed read, then add it to OUTSIDE_HOME with the reason`,
    ).toBeDefined();
    expect(source, `${name}: ${exception!.why}`).toContain(exception!.marker);
  });
});
