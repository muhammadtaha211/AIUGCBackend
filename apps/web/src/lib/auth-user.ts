/**
 * Server-only. The one place the `auth.getUser()` failure case is decided.
 *
 * Every /home page resolves the session first and sends a null user to /start.
 * That is only safe if a FAILED read is distinguishable from a signed-out one,
 * and the naive `const { data: { user } } = ...` these pages used to carry
 * could not tell them apart — both arrive as `user: null`. So a GoTrue blip
 * evicted a live session to /start, where OnboardingFlow's own client getUser
 * succeeds a moment later, finds no finished draft, and forwards to
 * /home/new-business, whose completion posts `allowCreate` and skips the owner
 * idempotency guard.
 * (docs/vault/defects/auth-getuser-errors-read-as-signed-out.md)
 *
 * BUT `if (error) throw` would be badly wrong, and the reason is the whole
 * point of this file. auth-js populates `error` for the ORDINARY signed-out
 * case too — measured against the live project on 2026-09-10, @supabase/auth-js
 * 2.110.6 (docs/vault/facts/getuser-resolves-an-error-when-signed-out.md):
 *
 *   no cookies at all              -> AuthSessionMissingError   status 400
 *   unparseable auth cookie        -> AuthSessionMissingError   status 400
 *   session present, bad JWT       -> AuthApiError  bad_jwt     status 403
 *   session present, GoTrue 503    -> AuthRetryableFetchError   status 503
 *   session present, host down     -> AuthRetryableFetchError   status 0
 *
 * The first three are ANSWERS — "there is no usable session here" — and the
 * honest response to them is the redirect the caller already has. Only the last
 * two are the absence of an answer, and only they may throw. Throwing on the
 * first three would have put the error card in front of every signed-out
 * visitor and locked anyone with a stale token out of the sign-in page, which
 * is worse than the defect being fixed.
 *
 * The split follows auth-js's own classification rather than a guess about
 * status codes: lib/fetch.ts handleError raises AuthRetryableFetchError for a
 * non-Response failure (status 0) and for anything in 500-599, and
 * AuthUnknownError when a response body will not parse — those three are the
 * cases where nothing was established. Everything else it raises carries a
 * verdict.
 *
 * Erring this way on purpose: reading a transient failure as signed-out costs
 * a wrong redirect, reading a dead session as a failure costs a customer who
 * cannot reach /login at all.
 */
const COULD_NOT_TELL = ["AuthRetryableFetchError", "AuthUnknownError"];

/**
 * Whether an `auth.getUser()` error means the read failed, as opposed to
 * answering "no valid session". Exported because the surfaces that must NOT
 * throw still have to tell the two apart: middleware logs one and ignores the
 * other, and the route handlers answer 503 for one and 401 for the other.
 */
export function authReadFailed(
  // Both optional: the discriminator is `name`, but a parameter that declares
  // ONLY an optional property is a weak type, and TypeScript then refuses any
  // error object that happens not to carry a name — which is exactly the shape
  // a hand-written double has.
  error: { name?: string; message?: string } | null | undefined,
): boolean {
  return error != null && COULD_NOT_TELL.includes(error.name ?? "");
}

/**
 * The user, or null when there is genuinely no session. Throws when the read
 * itself failed, which hands the failure to app/home/error.tsx (or
 * app/error.tsx above it) — the honest answer to "we could not tell who you
 * are". A redirect to the sign-in flow would be a guess, and the wrong one.
 *
 * It is a helper rather than ten copies of the same guard because the copy is
 * how this shape reached fourteen sites: a new page starts from an old one. A
 * page that calls this cannot inherit the bug, and test/auth-user.test.ts fails
 * on a page that does not call it.
 *
 * NOT used by the route handlers (lib/api.ts, api/onboarding/complete) or by
 * either middleware. A route handler has no error boundary above it, so a throw
 * there is an unstyled 500 — they use authReadFailed and answer 503. Middleware
 * is worse: a throw there is a 500 on every matched route.
 *
 * Necessary but not sufficient. GoTrueClient's catch ends in a bare
 * `throw error` for anything that is not an AuthError (GoTrueClient.ts:3216) —
 * a cookie adapter throwing inside `_useSession`, which under @supabase/ssr
 * means a throwing `cookies.getAll()` — so that path REJECTS instead of
 * populating `error` and never reaches this function. From a page it lands on
 * the same boundary anyway, which is why the pages are covered either way.
 */
export function authedUser<T>(result: {
  data: { user: T | null };
  error: { name?: string; message: string } | null;
}): T | null {
  // The message is masked before it reaches the browser but IS written to the
  // server log, where it is the only description of what actually broke.
  if (authReadFailed(result.error)) {
    throw new Error(`auth read failed: ${result.error!.message}`);
  }
  return result.data.user;
}
