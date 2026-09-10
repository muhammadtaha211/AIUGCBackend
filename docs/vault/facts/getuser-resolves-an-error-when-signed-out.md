---
type: fact
status: verified
verified: 2026-09-10
method: "Ran a script against the LIVE project (hyaqydcmwbnbaiqqufow) using the real @supabase/ssr createServerClient + @supabase/auth-js 2.110.6 — `apps/cli/node_modules/.bin/tsx apps/web/.work/measure-getuser.ts` and two siblings, deleted after. Five cookie/transport combinations, printing only error.name/status/code (never the key). Classification cross-read at node_modules/.pnpm/@supabase+auth-js@2.110.6/node_modules/@supabase/auth-js/src/lib/fetch.ts handleError and src/lib/errors.ts:113-142. Confirmed a second time in the running app: apps/web/src/middleware.ts logged ZERO auth errors across 15 anonymous requests (8 of them /home/* 307s) once the predicate was in place."
source: code
---

# `auth.getUser()` resolves an ERROR for an ordinary signed-out request

The single fact that decides how every `auth.getUser()` call site must be written:
**`error` being non-null does not mean the read failed.** auth-js populates it for the
plain not-signed-in case too, wearing the same `data.user === null` as every other case.

## Measured, 2026-09-10, @supabase/auth-js 2.110.6

| what was sent                            | `data.user` | `error.name`              | status |
| ---------------------------------------- | ----------- | ------------------------- | ------ |
| no cookies at all (a logged-out visitor) | `null`      | `AuthSessionMissingError` | 400    |
| an unparseable auth cookie               | `null`      | `AuthSessionMissingError` | 400    |
| a real session, GoTrue rejects the fetch | `null`      | `AuthRetryableFetchError` | 0      |
| a real session, GoTrue answers 503       | `null`      | `AuthRetryableFetchError` | 503    |
| a real session, bad JWT                  | `null`      | `AuthApiError` `bad_jwt`  | 403    |

`AuthSessionMissingError` carries `code: undefined` — `errors.ts:136` passes `undefined` for
the code argument — so **`name` is the only field that identifies it.** Matching on `code`
does not work, and neither does status: 400 and 403 are both "no valid session" while 0 and
503 are both "we could not tell".

The first two rows short-circuit at `GoTrueClient.ts:3193-3195`, before any network call:

```ts
if (!data.session?.access_token && !this.hasCustomAuthorizationHeader) {
  return { data: { user: null }, error: new AuthSessionMissingError() };
}
```

That is also why a probe cannot reach the transient rows by pointing the client at a dead
host: @supabase/ssr derives the cookie's storage key from the URL's hostname, so a fake URL
means no session is found and the answer is `AuthSessionMissingError` again. The transient
rows were produced by keeping the real URL and injecting a failing `global.fetch`.

## The classification is auth-js's own

`lib/fetch.ts` `handleError` decides it, and only three outcomes mean nothing was established:

- not a fetch Response at all (network down, DNS, abort) → `AuthRetryableFetchError(msg, 0)`
- status in 500-599 → `AuthRetryableFetchError(msg, status)`
- a response body that will not parse → `AuthUnknownError`

Everything else it raises is a verdict, including the `session_not_found` code, which it
converts **into** `AuthSessionMissingError`.

## Why it matters

`if (error) throw` is the obvious reading of
[[auth-getuser-errors-read-as-signed-out]] and it is wrong in three places at once:

- every logged-out visitor to a `/home` page gets the error card instead of `/start`;
- every unauthenticated API request gets 503 instead of 401;
- `middleware.ts` runs on every public page, so it logs an error per anonymous pageview.

And the failure mode is asymmetric, which is why the fix errs the way it does: reading a
transient failure as signed-out costs one wrong redirect, while reading a dead session as a
failure puts an error card between a customer and `/login` and never clears. So
`authReadFailed` (`apps/web/src/lib/auth-user.ts`, twinned in
`apps/admin/src/lib/admin.ts`) throws **only** on the three names above and treats every
other error as the answer it is.

Related: [[auth-getuser-errors-read-as-signed-out]] (the defect this closed),
[[a-failed-businesses-query-reads-as-no-businesses]] (the same shape on PostgREST — where
`data: null` genuinely is unambiguous, which is why that helper could use the simple guard
this one cannot).
