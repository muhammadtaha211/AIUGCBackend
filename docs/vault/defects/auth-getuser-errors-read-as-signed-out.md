---
type: defect
status: verified
verified: 2026-09-10
method: "CLOSED 2026-09-10. MEASURED, all against a running `next dev` on this machine with four temporary public probe routes under apps/web/src/app/zz-probe (deleted after; apps/web/.next cleared): (1) the five getUser failure shapes, against the LIVE project — see [[getuser-resolves-an-error-when-signed-out]], which is what disproved the naive fix; (2) redirect() still returns 307+Location and notFound() still returns 404 with app/error.tsx above them; (3) a server throw paints app/error.tsx on the DARK root surface — body rgb(17,17,17), card 'border-white/10 bg-white/5', dir=rtl preserved, digest 26882860 identical to the one the server logged; (4) the retry recovers in place — after removing an existence-gated sentinel out of band, clicking נסה שוב replaced the card with the real page while performance navigation type stayed 'navigate', i.e. no reload; (5) 375x812, no horizontal overflow, card 327px; (6) a REAL AuthRetryableFetchError, built by real auth-js from a failing fetch with a session-shaped cookie, thrown by the real authedUser and landing on the card with digest 818891268 = the server log's; (7) the SIGNED-OUT case of the same probe returns HTTP 200 and no card; (8) apps/web/src/middleware.ts logged ZERO auth errors across 15 anonymous requests, 8 of them /home/* 307s; (9) global-error.tsx read out of the DOM after a sentinel-gated throw in app/layout.tsx (reverted; `git diff` on that file is empty) — its own lang=he dir=rtl, rgb(17,17,17), system font stack, digest 4070783376; (10) /, /start, /login, /forgot-password, /privacy, /terms all 200 and all eight /home/* still 307 to /start. GATES: `pnpm -r --workspace-concurrency=1 typecheck` exit 0, zero 'error TS'; apps/web 328 tests (was 298) and apps/admin 34, green on three and two shuffled runs respectively; 18 mutations applied to the helper, the predicate, the call sites and both middlewares — 0 survivors, including a throwaway /home page carrying the old shape and a stray lib outside /home; prettier repo-wide 709, the same total as before the change, with all 26 touched files content-clean under --end-of-line auto. READ, NOT RUN: Next 15.5.20's isNextRouterError re-throw and the root-layout-skips-error.tsx wiring (dist/esm/client/components/error-boundary.js:11-20, create-component-tree.js) — the browser results above are consistent with them but the source was read, not stepped through; GoTrueClient.ts:3216's bare rethrow for a non-AuthError is still code-read and was never induced. NOT VERIFIED AT ALL: production behaviour. Everything above is `next dev`; React's message masking, the digest values and global-error's appearance without the dev overlay layered on top differ under `next build && next start`, which was not run."
source: code
---

# A failed `auth.getUser()` is indistinguishable from "signed out"

## Closed 2026-09-10 — 15 of the 17 sites, and the fix is NOT `if (error) throw`

The two that remain are both browser clients and both deliberate; they are named at the
bottom of this section.

**The headline is the thing that nearly shipped.** The obvious reading of this note — read
`error`, throw on it — is wrong, and wrong in a way that is worse than the defect. auth-js
populates `error` for the ORDINARY signed-out case: a request with no cookies resolves
`{ data: { user: null }, error: AuthSessionMissingError }`, which is the same non-null
`error` a GoTrue outage produces. Measured against the live project on 2026-09-10 and
written up in full in [[getuser-resolves-an-error-when-signed-out]]. `if (error) throw`
would have

- shown the Hebrew error card to **every logged-out visitor** of a `/home` page instead of
  redirecting them to `/start`,
- answered **503 to every unauthenticated API request** instead of 401, and
- logged an error in `middleware.ts` **once per anonymous pageview**, on every public page.

It would also have stranded anyone holding a stale token: `bad_jwt` is an `AuthApiError`,
so their every request would have hit an error card whose retry never clears, with no route
to `/login`.

So the split is by what auth-js's own `lib/fetch.ts` `handleError` establishes, not by
truthiness. Only three names mean nothing was established — `AuthRetryableFetchError`
(a non-Response failure, and any 500-599) and `AuthUnknownError` (a body that will not
parse). Everything else is a verdict, and a verdict is what the caller's existing redirect
is for. The predicate is `authReadFailed`, exported from
`apps/web/src/lib/auth-user.ts` and twinned in `apps/admin/src/lib/admin.ts`.

It errs deliberately: reading a transient failure as signed-out costs one wrong redirect,
while reading a dead session as a failure puts an error card between a customer and the
sign-in page. An unnamed error is therefore treated as a verdict, not a failure.

### The boundary that had to exist first

`apps/web/src/app/error.tsx` — the root boundary, and the blocker this note named for
`home/layout.tsx`. Four things about it worth not re-deriving:

- **It is dark, and `home/error.tsx` is light, and they are deliberately NOT a shared
  component.** `home/error.tsx` renders inside `home/layout.tsx`, which supplies
  `theme-light`. This one renders directly under the root layout, whose body is
  `text-gray-100` over the charcoal `globals.css` paints. Note the premise that makes it
  so: every page outside `/home` — the landing, `/login`, `/start`,
  forgot/reset-password, `(legal)` — wraps ITSELF in `theme-light`, so the surface is
  light in normal use. A page that THREW rendered no wrapper, so what is behind the card is
  always the dark body. Verified by reading `document.body.className` on a tripped
  boundary: `font-sans text-gray-100 antialiased`, no `theme-light`.
- **It must not paint its own background.** The body carries three fixed-attachment radial
  gradients; a `bg-ink` on the card's wrapper would kill the lime glow. It sets
  `min-h-dvh` and lets the body show through.
- **`redirect()` still works underneath it**, which was the single biggest risk in adding
  it, since it sits above every redirect in the app. Measured: `307` with the Location
  header intact, and `notFound()` still `404`. Next's `ErrorBoundaryHandler`
  re-throws router errors before it ever sets state (`isNextRouterError`).
- **`reset()` alone is a dead button**, same as for `home/error.tsx`. The retry is
  `startTransition(() => { router.refresh(); reset(); })`.

`apps/web/src/app/global-error.tsx` covers the one thing `app/error.tsx` cannot: a throw
in the ROOT layout. A segment's boundary is installed in the LayoutRouter that segment hands
to its own layout as a slot, so it never wraps that layout — for the root segment that means
a root-layout throw skips `app/error.tsx` entirely. It replaces the root layout, so it
declares its own `<html lang="he" dir="rtl">`, gets no `globals.css` and therefore no
Tailwind, and loses Heebo and Secular One — hence inline styles and a system stack. Its
retry is a hard reload, because if the root layout threw there is no rendered app to refresh
into.

### What each surface does now, and why they differ

| surface                                 | on a failed read                  | why                                                                                                                                       |
| --------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| the nine `/home` pages                  | throw, via `authedUser`           | there is a boundary, and a redirect would be a guess about who you are                                                                    |
| `home/layout.tsx`                       | throw, via `authedUser`           | `app/error.tsx` catches it now; evicting the whole dashboard to `/start` WAS the defect                                                   |
| `home/layout.tsx`'s `businesses` read   | log, do not throw                 | different size of failure — it only empties the sidebar, and this layout also wraps `/home/new-business` where an empty list is the point |
| both `middleware.ts`                    | log, do not throw                 | no boundary above middleware: a throw is a 500 on EVERY matched route, including `/login` — the one page someone locked out needs         |
| `lib/api.ts`, `api/onboarding/complete` | 503 (was 401)                     | a route handler has no boundary but does have a status code; 401 tells a client to re-authenticate when the truth is "try again"          |
| `apps/admin/src/lib/api.ts`             | 503 from `requireAdmin` (was 403) | same; 403 is a verdict we never reached                                                                                                   |

The two policies inside `home/layout.tsx` are the sharpest illustration and both reads
carry a comment saying which is which.

**The one deliberate swallow** is `adminSession` in `apps/admin/src/lib/api.ts`: it
catches its own `AuthReadError`, logs, and returns `null` so the five admin pages keep
redirecting to `/login`. Not because that is right — it is the defect, preserved — but
because `apps/admin` has no error boundary at any level and a throw there reaches Next's
English screen. Written up separately as [[apps-admin-has-no-error-boundary]], with the
one-file fix that would let the swallow be deleted. The catch is narrow on purpose: a failed
`users` read still propagates.

### The test that matters

`apps/web/test/auth-user.test.ts`. The unit cases are built from the five MEASURED shapes,
so the file states the contract rather than restating the implementation — and the case
"returns null for a signed-out request, which arrives WITH an error" is the one that would
have caught the naive fix.

The convention guard underneath them is the part that protects the future, because the way
this shape reached fourteen sites was copy — `/home/renders` inherited the `businesses`
version verbatim from `/home/demos` five days after that defect was written up. It scans
all of `apps/web/src`, requires every file under `app/home` that reads the session to
call `authedUser(`, and requires every reader OUTSIDE `app/home` to be on a four-entry
allowlist that names what it does instead and why. A new call site anywhere in `apps/web`
reddens one of the two rules.

Proven by mutation, 18 applied, **0 survivors** — including the two that matter most: a
throwaway `/home` page carrying the old destructure (caught, named by path), and a stray
lib outside `/home` that reads the session (caught). Also caught: the naive
`return error != null` predicate, in both apps; dropping either name from the failure list;
`if (authError)` in the middleware instead of `authReadFailed(authError)`.

One incidental fix the guard forced: `apps/web` had **no vitest config**, so `@/` did not
resolve in tests. The middleware suite passed only because every `@/` import it reached
happened to be replaced by `vi.mock`, which matches on the raw specifier; the first
unmocked one took all seven cases down. `apps/web/vitest.config.ts` now supplies the alias.

### Still open

- `components/onboarding/onboarding-flow.tsx:108` — browser client, and its error case
  already falls through to rendering the wizard. Fail-safe; left alone.
- `apps/admin/src/app/login/login-form.tsx:36` — client-side, founder-only, no boundary.
  Left alone deliberately. Worth naming what it costs: it drops the error on BOTH the
  `getUser` and the `users` read, so a transient failure shows the founder
  _"לא מצאנו חשבון עם הפרטים האלה"_ — "wrong credentials" — after signing the session back
  out, when the truth is that we could not check.
- **The rethrow path is unchanged and unclosable in middleware.** `GoTrueClient.ts:3216`
  is a bare `throw error` for anything that is not an AuthError — a cookie adapter
  throwing inside `_useSession`, which under `@supabase/ssr` means a throwing
  `cookies.getAll()`; `apps/web/src/lib/supabase/server.ts` wraps its `setAll` in
  try/catch but not its `getAll`. In a page that rejection reaches the boundary and is
  fine. In middleware it is a 500 on every matched route, and no code in that file can catch
  it; the comment there says so. Still code-read, never induced.
- **The duplicate-business ending is still reachable and no fix here touches it** — same as
  for [[a-failed-businesses-query-reads-as-no-businesses]]. What this change removes is the
  transient-auth-failure ENTRANCE to it.
- Production was never exercised. See the frontmatter.

New sibling found while sweeping the non-`getUser` auth calls:
[[a-failed-getsession-reads-as-an-expired-reset-link]].

---

Same shape as [[a-failed-businesses-query-reads-as-no-businesses]], one layer up. Every
`auth.getUser()` in both apps drops the call's `error`:

```ts
// the pattern, at all 17 sites
const {
  data: { user },
} = await supabase.auth.getUser();
if (!user) redirect("/start");
```

`@supabase/auth-js` 2.110.6 **resolves** `{ data: { user: null }, error }` for the failures
that matter here (`GoTrueClient.ts:3176-3218` — `:3194` `AuthSessionMissingError` when there
is no token, and `:3213` `_returnResult({ data: { user: null }, error })` for anything caught,
which covers a GoTrue 5xx and a network failure wrapped as `AuthRetryableFetchError`). So a live
session whose refresh call hits a blip is read as "not signed in".

**Reading `error` is necessary but not sufficient.** The same `catch` ends
`} throw error }` at `:3216`: anything that is **not** an AuthError — a cookie/storage adapter
throwing inside `_useSession`, which under `@supabase/ssr` means a throwing
`cookies.getAll()` — propagates as a rejection instead. A fix that only destructures `error`
leaves that path unhandled, and in `middleware.ts:39` an unhandled rejection is a 500 on every
matched route. Whoever closes this needs both.

## The 17 sites

| Behaviour on a dropped error            | Sites                                                                                                                                                                                                                                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redirect("/start")` — the customer app | `home/layout.tsx:20`, `home/page.tsx:71`, `home/a/new/page.tsx:22`, `home/b/new/page.tsx:21`, `home/demos/page.tsx:17`, `home/demos/[demoId]/page.tsx:37`, `home/renders/page.tsx:17`, `home/settings/page.tsx:26`, `home/feedback/page.tsx:23`, `home/new-business/page.tsx:14` |
| falls through to the public wizard      | `middleware.ts:39`, `components/onboarding/onboarding-flow.tsx:108` (browser client)                                                                                                                                                                                             |
| 401 JSON                                | `lib/api.ts:31`                                                                                                                                                                                                                                                                  |
| 401 JSON                                | `api/onboarding/complete/route.ts:27`                                                                                                                                                                                                                                            |
| admin                                   | `apps/admin/src/middleware.ts:59`, `apps/admin/src/lib/api.ts:35`, `apps/admin/src/app/login/login-form.tsx:36`                                                                                                                                                                  |

`home/layout.tsx:20` is the widest: it is the shell for every `/home/*` page, so one dropped auth
error evicts the whole dashboard for that request.

**The line numbers above move.** They were exact at 182e5fb; the 2026-09-10 `businesses` change
added one import line to five of these files, so `home/page.tsx` is now :72, `a/new` :23,
`b/new` :22, `demos` :18 and `renders` :18. Locate by content, not by line — the count of 17
is what is worth trusting.

## Why it is worse than it looks

`redirect("/start")` reads as fail-closed, and on its own it is. But `/start` renders
`OnboardingFlow` in signup mode, whose own client-side `getUser()` (`:108`) runs a moment later on
a different request. If that one succeeds and finds no finished localStorage draft, it does
`replace("/home/new-business")` — the wizard whose completion posts `allowCreate: true` and skips
the owner idempotency guard (`api/onboarding/complete/route.ts:69-80`). So the same duplicate-
business ending the `businesses` note describes is reachable from a **transient auth** failure too,
not only from a transient `businesses` failure.

The two API sites answer **401** for what is really a 503. A retrying client reads 401 as "your
session is gone" rather than "try again", which is the wrong instruction.

## Not fixed, and why

Found on 2026-09-09 while sweeping for the `businesses` class, and left alone under the repo's
one-task-one-concern rule.

**Amended 2026-09-10 — the wall is gone for NINE of the ten `/home` sites.** They were blocked
on `apps/web` having no error boundary; `app/home/error.tsx` now exists and is proven to catch a
real server throw ([[a-failed-businesses-query-reads-as-no-businesses]]). The nine **pages** can
now do what the `businesses` reads did: read `error`, throw, land on the Hebrew card. The tenth
row in that table is `home/layout.tsx`, which is **not** one of them — see below.

Three parts of this note are still genuinely blocked or separate:

- **`home/layout.tsx:20`** — a layout is rendered by its PARENT's boundary and there is no
  `app/error.tsx`, so a throw there escapes to Next's built-in English screen. Needs
  `app/error.tsx` first.
- **`middleware.ts:39`** — middleware has no boundary at all; a throw there is a 500 on every
  matched route. It needs its own decision, the way the `businesses` read got one.
- **The two API sites** (`lib/api.ts:31`, `api/onboarding/complete/route.ts:27`) need no
  boundary and are the cheap half: read `error`, answer 503 with a Hebrew "try again"
  instead of 401.

And the non-obvious one, from `GoTrueClient.ts:3216`: reading `error` is necessary but not
sufficient — a non-AuthError thrown inside `_useSession` REJECTS instead of populating `error`.

Related: [[middleware-redirects-drop-refreshed-auth-cookies]] (same file, cookies rather than
errors), [[auth-round-trips-that-miss-the-callback-die-silently]] (the OAuth round trip),
[[0015-signed-in-without-business-lands-on-new-business]] (why `/start` forwards to
`/home/new-business` at all).
