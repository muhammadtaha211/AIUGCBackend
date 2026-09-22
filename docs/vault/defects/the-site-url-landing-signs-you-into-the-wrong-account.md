---
type: defect
status: verified
verified: 2026-09-22
method: "Code read, 2026-09-22, at 0cca4fa (branch fix/site-url-landing). Repo: apps/web/src/middleware.ts, apps/web/src/app/page.tsx, apps/web/src/app/auth/callback/route.ts, apps/web/src/lib/auth.ts, apps/web/test/middleware.test.ts read in full; repo-wide grep over apps/ and packages/ for error_description|error_code|access_denied|location.hash and for URL-param reads of `code`, excluding node_modules and .next. Installed libraries read from node_modules/.pnpm, not from docs: next 15.5.20 (dist/server/base-http/node.js, dist/server/lib/patch-set-header.js, dist/server/lib/router-server.js, dist/server/next-server.js, dist/server/lib/server-ipc/utils.js, dist/server/lib/router-utils/resolve-routes.js, dist/server/async-storage/request-store.js, dist/server/web/spec-extension/adapters/request-cookies.js, dist/compiled/@edge-runtime/cookies/index.js), @supabase/auth-js 2.110.6 (dist/main/GoTrueClient.js, dist/main/lib/constants.js, dist/main/lib/locks.js), @supabase/ssr 0.12.3 (dist/main/createBrowserClient.js, dist/main/cookies.js, dist/main/utils/chunker.js, dist/main/utils/constants.js). The symptom itself is FOUNDER-REPORTED, not observed here. The fix on this branch is pinned by tests; it has NOT been exercised against a real occurrence. The Vercel Set-Cookie merge order was MEASURED 2026-09-22, not read: `curl -sS -D - -o /dev/null <deployment>/api/probe` x3, no redirect following, against preview deployment `4cb3330yd` built from throwaway branch `probe/vercel-cookie-merge` commit `eead322` (branch and deployment since deleted); the browser-side outcome read once with document.cookie at the redirect target. Extended 2026-09-22 for the callback clear (f544619): @supabase/auth-js 2.110.6 dist/main/GoTrueClient.js (_signOut :3360-3392, _removeSession :4317-4335, _useSession :2443-2456, __loadSession :2462-2545, _callRefreshToken :4094-4235 (the whole function both times — the refresh-failure returns at :2517-2538 and the _removeSession at :4212 are what the third limit turns on), _notifyAllSubscribers :4236-4276), dist/main/GoTrueAdminApi.js :67-85, dist/main/lib/constants.js :13, and @supabase/ssr 0.12.3 dist/main/createServerClient.js :48-66 + dist/main/cookies.js :359-440 read in full, versions from each package.json; the seven cases in apps/web/test/auth-callback.test.ts run green and mutation-checked (pnpm --filter @aiugc/web exec vitest run --fileParallelism=false). No live round-trip was exercised. Extended 2026-09-22 for the allow-list: the live Redirect URLs list and Site URL MEASURED off Authentication -> URL Configuration for project hyaqydcmwbnbaiqqufow, read by the founder and pasted verbatim into the task that produced this edit; recorded in full below. That is dashboard state and nothing in this repo can confirm or refute it, and a read on 2026-09-22 says nothing about what the list held on the two undated occurrence dates."
source: code + browser + dashboard
---

# The Site-URL landing signed you into the wrong account, and destroyed the evidence

A Google round-trip that GoTrue cannot deliver to `/auth/callback` is delivered to the **Site URL
root** instead, carrying its result on the query string. `/` reads none of it, and the middleware's
owner bounce then forwarded a browser that still held an **older** session to `/home` as that
account — dropping the query on the way.

So the customer does not see a failed sign-in. They see a working app, signed in as somebody else,
with the only record of what happened already discarded.

This is the wrong-account half of
[[auth-round-trips-that-miss-the-callback-die-silently]]'s "Still open — the Site-URL landing"
section, which knew the landing was silent but not that it was also an account switch.

## Founder-reported, and the limits of it

Two occurrences, **reported 2026-09-22**. On both, the founder was left in the account previously
signed in in that browser rather than the one he picked, or landed on the marketing page; both
cleared on a second attempt, in the wrong-account case after a manual sign-out. **The dates of the
occurrences were not given**, nothing was captured from either, and **the fix on this branch has not
been exercised against them**. Nothing below claims otherwise.

## The mechanism, measured

Every line reference is to this branch after the fix; the pre-fix behaviour is the same file without
`middleware.ts:39-58`.

- **`redirectTo` is built from the address bar**, with no env var anywhere:
  `apps/web/src/lib/auth.ts:224` is `` `${window.location.origin}/auth/callback` ``. There is no
  `vercel.json` in the repo and no `NEXT_PUBLIC_SITE_URL` / `VERCEL_URL` read in `apps/` or
  `packages/`, so the origin is whatever the browser was on.
- **`/` reads nothing.** `apps/web/src/app/page.tsx:611` is `export default function LandingPage()`
  with no props at all, and no component it renders imports `@/lib/supabase/client` — the only
  importers are `components/onboarding/onboarding-flow.tsx:5`,
  `app/reset-password/reset-password-form.tsx:9` and `lib/auth.ts:9` — so `/` never constructs a
  browser client either, and `detectSessionInUrl` never runs there.
- **The bounce drops the query.** `middleware.ts:150` is
  `NextResponse.redirect(new URL("/home", request.url))`; a relative `"/home"` replaces path **and**
  search. The guard above it (`:132`) fires for `path === "/"` whenever a session exists and the
  RLS `businesses` read returns a row — it does not care whose session.
- **Nothing else in the repo reads the params.** Re-grepped at HEAD: `error_description` and
  `error_code` hit only `app/auth/callback/route.ts:30-31`, `access_denied` only a comment at `:13`,
  `location.hash` nothing at all; a URL param named `code` is read only at
  `app/auth/callback/route.ts:19` and `app/auth/recovery/route.ts:14`.

## Two sub-causes, and the signature that separates them

They are not the same failure and must not be counted as one. The query string says which:

| Signature  | What GoTrue did                                                                 | `auth.identities.last_sign_in_at` |
| ---------- | ------------------------------------------------------------------------------- | --------------------------------- |
| `?code=…`  | **Completed the sign-in server-side.** Only the return leg missed.              | **moved**                         |
| `?error=…` | **Did not complete.** Bad, expired or missing `state`, so there was no sign-in. | **did not move**                  |

This matters for anyone diagnosing a later occurrence: on the `?code=` sub-case a moved
`last_sign_in_at` is **expected** and is not evidence that the Site-URL landing did not happen. A
reader who checks only the timestamp will refute the right explanation.

**What triggered the fallback on the founder's two occurrences is UNVERIFIED** and is not knowable
from this repo — see below.

## What was ruled out

Three other mechanisms could have produced a wrong-account landing. All three were read and none
survives; recording them so they are not re-derived.

- **A background tab refreshing the old session over the new one.** Ruled out.
  `@supabase/auth-js` 2.110.6 stops the ticker outright when the tab is hidden —
  `GoTrueClient.js:4682-4686` calls `_stopAutoRefresh()`, which `clearInterval`s at `:4401-4412` —
  and both `__loadSession` (`:2470`) and `_recoverAndRefresh` (`:4001`) re-read storage, which under
  `@supabase/ssr` is the shared cookie, before deciding. Surprising detail worth keeping: there is
  **no cross-tab lock** in this version (`lib/locks.js:2-9`, `GoTrueClient.js:154`, `:199-203`);
  visibility is what closes the race, not a mutex. **Not** ruled out: two _simultaneously visible_
  windows — see UNVERIFIED.
- **The middleware's rotated `Set-Cookie` overwriting the callback's new session.** Ruled out — and
  since **2026-09-22 ruled out ON VERCEL by measurement**, not by reading the self-hosted Node path.
  See "Measured on Vercel" below. The earlier reading of the installed Next.js 15.5.20 pointed the
  same way (`dist/server/base-http/node.js:124-131` implements `appendHeader` as
  `setHeader(name, [...currentValues, value])`; `dist/server/lib/patch-set-header.js:20-32`
  rebuilds the array as `[...middlewareValue, ...value]`, middleware first by design —
  `dist/server/base-server.js:525-527`, "not overridden by API routes"), but it was the wrong
  evidence for production and two of its supporting claims were wrong. Both are corrected below
  rather than deleted.
- **A stale cookie chunk shadowing the new session.** Ruled out _for this app's configuration_, not
  in general. The real hazard exists: `@supabase/ssr/dist/main/utils/chunker.js:66-70` —
  `combineChunks` reads the **unchunked base name first** and never looks at `.0` if it is truthy —
  and both its read loop (`:72-79`) and `deleteChunks` (`:85-97`) stop at the first missing index.
  It is unreachable here because both write paths delete every stale `isChunkLike` cookie
  (`cookies.js:186-197` browser, `:379-400` server) and **no `cookieOptions` is configured anywhere**
  — `apps/web` and `apps/admin` both call `createBrowserClient(url, key)` bare — so there is only one
  cookie scope for a stale one to hide in. If a `domain` is ever set, re-open this.

## Measured on Vercel — 2026-09-22

`UNVERIFIED 4` asked for exactly one artefact: `curl -sD -` against a deployed route that writes the
same cookie name in both middleware and handler. Here it is.

A throwaway branch `probe/vercel-cookie-merge` (commit `eead322`, preview deployment `4cb3330yd`;
branch and deployment both deleted after the run) put the callback's shape behind `/api/probe` —
the middleware wrote `probe=mw` onto `NextResponse.next({ request })` and returned it, and the route
handler wrote `probe=route` through `next/headers` and returned `NextResponse.redirect(...)`, a 307
carrying cookies. `curl -sS -D - -o /dev/null <deployment>/api/probe`, no redirect following, three
runs. Run 1 verbatim:

```
HTTP/1.1 307 Temporary Redirect
Age: 0
Cache-Control: public, max-age=0, must-revalidate
Content-Length: 0
Date: Tue, 22 Sep 2026 05:42:34 GMT
Location: https://<deployment>/
Server: Vercel
Set-Cookie: probe=mw; Path=/
Set-Cookie: probe=route; Path=/
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch
X-Matched-Path: /api/probe
X-Robots-Tag: noindex
X-Vercel-Cache: MISS
X-Vercel-Id: fra1::fra1::mn8g5-1790055753982-02577c07b38a
```

Runs 2 and 3 were byte-identical except for the two headers that cannot repeat — the host in
`Location` is elided here, not in the capture:

```
Date: Tue, 22 Sep 2026 05:42:35 GMT   X-Vercel-Id: fra1::fra1::gvsxl-1790055755233-2852b32d8f13
Set-Cookie: probe=mw; Path=/
Set-Cookie: probe=route; Path=/

Date: Tue, 22 Sep 2026 05:42:35 GMT   X-Vercel-Id: fra1::fra1::4mldr-1790055755671-c81721a2d0ef
Set-Cookie: probe=mw; Path=/
Set-Cookie: probe=route; Path=/
```

**Two `probe=` headers. Both survive. `mw` first, `route` last — every run.** And the browser keeps
the last one, measured rather than inferred from RFC 6265: loading the same URL in a browser and
reading `document.cookie` at the redirect target returned `probe=route`.

**So the hypothesis is dead at Vercel too.** A route handler that writes the session itself beats a
middleware that rotated the same cookie name on the same request, on the production serving path as
well as the self-hosted one.

### Two supporting claims that were wrong

- **`patch-set-header.js` is not the mechanism on Vercel, and cannot be.** Its only data source is
  request meta `middlewareCookie`, written in exactly one place in the whole package —
  `dist/server/next-server.js:1293`, inside `async runMiddleware` (`:1162`), which opens with
  `if (process.env.NEXT_MINIMAL) throw ... 'runMiddleware should not be called in minimal mode'`
  (`:1163-1169`). Wherever middleware runs as its own function instead of in-process, that merge
  cannot run at all. (That Vercel's builder sets `NEXT_MINIMAL` is **REASONED** — `@vercel/next` is
  not installed in this tree.) The ordering above is Vercel's proxy's, and this note does not claim
  to know which code produced it.
- **"The window was narrow regardless … refreshes only inside `EXPIRY_MARGIN_MS` = 90 000 ms" was
  misleading**, and misleading in the direction that mattered. The condition at
  `@supabase/auth-js/dist/main/GoTrueClient.js:2489-2491` is
  `expires_at * 1000 - Date.now() < EXPIRY_MARGIN_MS`, which **every already-expired session
  satisfies**, however long it has been expired. The window is 90 s before expiry and unbounded
  after it — so it never narrowed the hazard for the expired-session case this defect is about. The
  ruling-out now rests on the measurement alone, which is stronger anyway.

### What this probe does not settle

Both writers used one cookie name at `Path=/`, so it settles count and order **for a name both
sides write**. It says nothing about a name the route handler never writes — the live shapes being
a chunked `sb-<ref>-auth-token.0`/`.1` from the middleware against an unchunked write from the
callback. **Corrected 2026-09-22 for `f544619`:** this paragraph used to end "and `/auth/callback`'s
`?error=` branch, which constructs no Supabase client at all and so writes no session of its own",
citing `createServerSupabase()` as called only inside `if (code)`. That stopped being true in the
same session — that branch now builds a client and emits cookie REMOVAL headers for a browser that
had a session. The probe still settles nothing about a name the handler does not write, which is
what the paragraph is for; it is the example that went stale. See `UNVERIFIED 7`.

## FIXED (the forward) — 2026-09-22, merged in #54 (`352484e`)

`apps/web/src/middleware.ts:39-58` forwards `/` to `/auth/callback` with `request.nextUrl.search`
verbatim when the query carries `error`, `error_code`, `error_description`, or a `code` matching
`AUTH_CODE_RE` (`:13`). It runs **before** the Supabase client is constructed, so no refresh has
happened and there is nothing to carry forward; `apps/web/test/middleware.test.ts` pins that
placement by asserting the forward emits no `Set-Cookie`.

`/` only, because the Site URL root is the one place the fallback delivers. `/start` is deliberately
untouched and still bounces an owner to `/home`.

**The UUID guard is a deliberate narrowing, and rests on an assumption.** GoTrue's PKCE auth codes
being UUIDs is **REASONED** — nothing in this tree pins it, and it was not measured against a live
code. The cost of the assumption is bounded by design: a `code` that is not UUID-shaped simply keeps
the old behaviour, and the reason to accept that is that `/` is the public landing page, where a
future `?code=PROMO10` must never be routed into auth.

Six test cases cover it, three of which fail without the guard (verified by reverting
`middleware.ts` and re-running).

## FIXED (the stale session behind the failure message) — 2026-09-22, `f544619`, branch `fix/callback-clears-stale-session`

The forward above closed the routing half: a Site-URL landing now reaches a route that reads it. It
did not close what happens next. `/auth/callback` had four outcomes and **two of them left the
browser signed in as whoever it was before** — a failed `exchangeCodeForSession` redirected to
`/login?error=oauth` without clearing, and the no-code/`?error=` branch never built a Supabase
client at all. The forward routes a cross-origin landing into exactly those two branches, so the
wrong-account case arrived there.

Both now call `auth.signOut({ scope: "local" })` before redirecting
(`apps/web/src/app/auth/callback/route.ts`, helper `endPreviousSession`). The error-params branch
creates the client it never had. The success branch and the neither-branch are untouched, and the
auth code still reaches no log line.

**`local`, not `global`.** The person's other devices keep their sessions; only the browser whose
round-trip failed is signed out. `global` would have turned a cancelled sign-in on a laptop into a
sign-out on a phone.

**Best-effort by construction.** The failure message is the point, so the clear is wrapped and a
failure is logged without moving the redirect — and the client the error-params branch needs is
built INSIDE that guard, because as an argument it would be evaluated outside it and a factory
throw would answer 500 on the one branch whose job is the message.

`apps/web/test/auth-callback.test.ts` pins nine cases, every one of them verified by mutation
rather than by passing (baseline 9/9; each row is one edit to `route.ts`, reverted after):

| Mutation                                             | Cases that go red |
| ---------------------------------------------------- | ----------------- |
| revert `route.ts` to `origin/main` (no clear at all) | 6                 |
| `void endPreviousSession(...)` instead of `await`    | 3                 |
| delete the `try`/`catch`                             | 3                 |
| delete the `{ error }` log                           | 1                 |
| build the client outside the guard                   | 1                 |
| `scope: "global"` instead of `"local"`               | 2                 |
| 200 + `Location` instead of `NextResponse.redirect`  | 2                 |
| also clear on the SUCCESS branch                     | 1                 |

The `void` row is the one that matters most: it is the single edit that turns the whole commit into
a no-op the eye cannot see, because the real clear writes its cookie removals only AFTER the
`/logout` round-trip — so an un-awaited clear produces a redirect with no `Set-Cookie` on it. One
case exists purely to hold that line.

### Three measured limits of the clear

Read at `@supabase/auth-js` 2.110.6, `@supabase/ssr` 0.12.3 — the installed versions, read from each
package's own `package.json`.

- **`scope: "local"` is not a local-only operation.** `_signOut` passes the scope straight to
  `admin.signOut` whenever an access token is present, and that POSTs `/auth/v1/logout?scope=local`
  (`GoTrueClient.js:3371-3373`, `GoTrueAdminApi.js:67-84`). `local` names what the SERVER revokes —
  this session's refresh token only. So the failure redirect now carries one outbound call, and
  `__loadSession` can add a second (`/token?grant_type=refresh_token`) when the stored access token
  is inside `EXPIRY_MARGIN_MS` = 90 000 ms of expiry (`GoTrueClient.js:2489-2491`,
  `lib/constants.js:13`). **Handling both failure modes does not bound either call in time**, and
  the earlier draft of this line claimed it did. auth-js sets no `AbortController`, `signal` or
  timeout anywhere in `dist/main/lib/fetch.js` (grep: zero hits), and the refresh leg retries with
  exponential backoff, bounded only by 30 000 ms of ACCUMULATED backoff, not by any per-request
  deadline (`GoTrueClient.js:3942-3958`). A GoTrue that hangs rather than errors therefore holds the
  failure redirect until the Vercel function's own timeout, and the customer gets a platform error
  page instead of `ההתחברות עם Google לא הצליחה` — the one thing the try/catch exists to guarantee.
  **Not a property of this change alone**, which is why no bespoke timeout was added here: every
  auth-js call in the app is unbounded the same way, including the `exchangeCodeForSession` on the
  branch above and the `getUser()` the middleware runs on every matched request. Whether to bound
  them is a decision, and it belongs to all of them at once.
- **The clear does nothing in exactly one case, and an earlier draft of this note got both halves
  of it wrong.** It said the clear no-ops "when the stored session is past expiry and its refresh
  fails", and that the hole was bounded because such a cookie "does not authenticate". Reading
  `_callRefreshToken`'s catch (`GoTrueClient.js:4191-4214`) and `__loadSession`'s refresh-failure
  branch (`:2517-2538`) in full, a refresh failure inside `signOut` splits three ways:

  | Access token                                            | Refresh rejected                     | What happens                                                                                                                                                                      |
  | ------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | still valid (proactive refresh, inside the 90 s margin) | either                               | `__loadSession` returns the session with **`error: null`** (`:2528-2535`) — `_signOut` never early-returns and **the clear runs**                                                 |
  | expired                                                 | NON-retryably (revoked token)        | `_callRefreshToken` has **already** called `_removeSession()` (`:4212`) — the removal went out before signOut returned its error                                                  |
  | expired                                                 | RETRYABLY (GoTrue 5xx / unreachable) | `:4195` skips that removal, the session **stays in storage**, `__loadSession` returns the error at `:2538`, and `_signOut` returns early at `:3368-3370` — **nothing is cleared** |

  So the hole is the third row only: **the access token is expired AND Supabase Auth is
  unreachable at that moment**. And it is NOT bounded. The surviving cookie holds an intact refresh
  token: during the outage `authReadFailed` classifies the retryable error as "could not tell"
  (`apps/web/src/lib/auth-user.ts`), so the middleware routes nobody and the bounce cannot fire —
  but once GoTrue recovers the refresh succeeds and the `/` → `/home` owner bounce fires into the
  old account again. The wrong-account landing is **deferred, not prevented**. Left open rather
  than closed: closing it means writing the cookie removals by hand instead of asking auth-js to,
  which is a different change. Correlation worth noting: a round-trip that fails and a GoTrue that
  is unreachable have a common cause, so this is not the remote corner it looks like.

- **A no-session request writes no `Set-Cookie` at all.** `applyServerStorage` returns before
  calling `setAll` when nothing is present to remove (`@supabase/ssr cookies.js:425-427`), so the
  clear is a genuine no-op rather than a spurious removal header.

### REASONED, not observed

**No occurrence was reproduced.** The founder's two reports stay attributed to nothing confirmed —
their dates were never given, nothing was captured from either, and this change has not been
exercised against them any more than the forward was. What is measured here is the code path: the
two branches that did not clear, the library behaviour above, and the tests. That a real occurrence
would have been fixed by it is inference from the mechanism, not a result.

### The product consequence, plainly

**A signed-in user who starts a Google sign-in from `/login` and cancels at Google ends up signed
out.** Google's refusal comes back as `error=access_denied` on `redirect_to`, which is
`/auth/callback` — the error-params branch — and that branch now ends the session the browser
arrived with. Before this commit they stayed signed in and read a failure message; now they read
the same message and have to sign in again.

That is the trade the fix makes, and it is the right way round for this defect: the alternative is
the wrong-account landing, where the browser keeps a session the user did not choose and the `/` →
`/home` bounce hides it. It is not free, and it is the reason the question below is open.

**The second consequence, which the brief did not name and which was the larger one.**
`GET /auth/callback?error=anything` became an **unauthenticated, externally-triggerable sign-out**.
The branch is entered on `searchParams.get("error")` alone, and Supabase's auth cookies are written
`SameSite=Lax` (`@supabase/ssr` `DEFAULT_COOKIE_OPTIONS`, `dist/main/utils/constants.js:4-11`) —
which the browser DOES send on a top-level cross-site GET. So that URL, posted anywhere, signed out
any signed-in visitor who followed it and dropped them on `/login` reading a Google failure they
never triggered. On `origin/main` the same request left them signed in, and the `?code=` branch
behaved the same way with any non-empty junk code. Nuisance rather than takeover — nothing is read,
written or disclosed — but a new externally-reachable side effect on a GET route handler.

### CLOSED by the verifier guard — 2026-09-22, founder-directed, same branch

The first draft of this section said "no cheap correct guard exists". That was wrong, and the
founder named the thing it missed: **the PKCE code verifier**. `startedHere(cookieStore)` in
`route.ts` requires a cookie whose name ends `-auth-token-code-verifier` and whose value is
non-empty, and the clear runs on the two failure branches **only** when it does. Without it each
branch is byte-for-byte its `origin/main` self — same redirect, same log, no client built at all on
the error-params branch.

**Where the name comes from**, read rather than recalled, because the guard is coupled to two
libraries at once: `@supabase/ssr` forces `flowType: "pkce"` on both factories
(`createServerClient.js:33`, `createBrowserClient.js:40`) and overrides the storage key only from
`cookieOptions.name` (`:29-31`), which is set **nowhere in this repo** — so the key stays
supabase-js's default `sb-${hostname.split(".")[0]}-auth-token` (supabase-js
`dist/index.cjs:1270`), and auth-js writes the verifier at `` `${storageKey}-code-verifier` ``
(`lib/helpers.js:269-275`, from the PKCE branch of `_getUrlForProvider`,
`GoTrueClient.js:4702-4703`). Matched by SUFFIX, not rebuilt from the project ref, so the derivation
is not duplicated here and left to drift. Never chunked: 56 characters
(`lib/helpers.js:235`) against a 3180-byte threshold (`utils/chunker.js:8`).

**Why Lax cuts both ways, and why the guard still works.** GoTrue's redirect back here is itself a
cross-site top-level GET, so the verifier rides it exactly as the session does. The guard does not
ask "was this navigation same-site" — it could not, and a `Referer` check would be unreliable. It
asks whether this browser holds evidence it started a flow **on this origin**, which an attacker
cannot plant.

**That the verifier cookie actually reaches this route in production is not an open question**, and
it is closed by evidence that already existed rather than by anything newly measured. Every
successful exchange here reads the verifier off that same cookie on that same request:
`_exchangeCodeForSession` fetches it from storage as its first act (`GoTrueClient.js:1577`), throws
`AuthPKCECodeVerifierMissingError` without it (`:1580-1581`) **before any network call**, and sends
it as `code_verifier` (`:1587`). A sign-in that works is therefore itself the proof the cookie
arrived. Every Google sign-in on `tavnit.ai` since `5646529` (2026-09-03) has gone through that line
with it unchanged, so the guard reads a cookie whose delivery the success path has been
demonstrating daily.

**The read sits BEFORE `exchangeCodeForSession`, and that placement is load-bearing.**
`_exchangeCodeForSession` removes the verifier on every outcome it has: `GoTrueClient.js:1591`,
ahead of the `if (error) throw` on the very next line, and again at `:1609` in its own catch. A read
placed after the exchange would find nothing and the clear would silently stop happening on the
branch that needs it most. One test exists purely to hold that line — its fake exchange deletes the
verifier from the store, and a read moved after it goes red.

### What the guard costs

**A cross-origin `?code=` landing no longer clears.** The verifier lives on the origin the flow
started from, so a round-trip begun on a `*.vercel.app` preview and delivered by GoTrue's fallback
to the Site URL `tavnit.ai` arrives at an origin that never wrote one. `startedHere` is false, no
clear runs, and that visitor gets the failure message **and stays in the old account** — precisely
the wrong-account landing this whole note is about, reopened for exactly one path.

An earlier draft of this paragraph called that "the founder's own preview/localhost path" and named
`localhost:3000` beside the preview hosts. The measurement below removes the localhost half:
`http://localhost:3000/auth/callback` **is** allowlisted, so a round-trip started there is delivered
there and never falls back. The cost is the preview hosts only.

That is accepted rather than worked around, because **the fix for that path is the allow-list**, not
the callback: a round-trip whose `redirect_to` origin is allowlisted never falls back to the Site
URL in the first place, and never reaches this branch. `UNVERIFIED 2` asked for that list and it is
now read — immediately below. `UNVERIFIED 3`, the set of preview origins such a list would have to
cover, is what remains.

### The allow-list, measured — 2026-09-22

Read off **Authentication → URL Configuration** for project `hyaqydcmwbnbaiqqufow` on 2026-09-22 by
the founder and pasted verbatim. Dashboard state; nothing in this repo can confirm or refute it.

```
http://localhost:3000/auth/callback
http://localhost:3000/auth/recovery
https://tavnit.ai/auth/callback
https://tavnit.ai/auth/recovery
Total URLs: 4

Site URL: https://tavnit.ai
```

**No `*.vercel.app` entry. No `www` host. Four URLs, and that is the entire list.** So the fallback
this note opens with is not a corner case — it is the defined behaviour for **every origin but those
two**, and the per-deployment and per-branch `*.vercel.app` hosts Vercel assigns are all outside it.
The precondition for the whole defect is now measured instead of assumed.

**Localhost is listed on port 3000 only**, the port `pnpm dev` serves `apps/web` on. A dev server
moved to any other port stops being allowlisted and starts landing on `tavnit.ai`.

**Both live origins carry both paths**, which is what `apps/web` actually needs: `signInWithOAuth`
(`lib/auth.ts:224`) and the signup `emailRedirectTo` (`:132`) build `/auth/callback`, and
`resetPasswordForEmail` (`:174`) builds `/auth/recovery` — three origin-derived targets, two paths.
`apps/admin` has no auth surface at all and needs no entry.

**`https://tavnit.ai/auth/recovery` reads `https://` because it was corrected today.** It had been
written `http://`; the founder fixed the scheme in the same sitting as this read. Recorded rather
than celebrated, because the entry is **moot in production** either way while the token_hash Reset
Password template is live — that template links to `/reset-password?token_hash=…`, an ordinary page
and not a redirect target, so recovery never consults the allow-list
(`docs/08-supabase-project-rebuild.md:764-768`). It matters here for one reason only: it is proof
the list is edited, which is why nothing below reads this list backwards in time.

**The trigger for the founder's two occurrences stays UNVERIFIED.** A list with no preview entry is
a _possible_ cause of a Site-URL landing, not an observed one. The occurrence dates were never
given, nothing was captured from either, and a dashboard read on 2026-09-22 cannot establish what
the list held on two undated earlier days — the recovery entry alone shows it changes. `UNVERIFIED 1`
stands exactly as written.

### The residual

**An abandoned verifier keeps the drive-by open for that browser.** Someone who clicks "כניסה עם
Google" and closes the tab leaves a live verifier cookie behind; until the next exchange or sign-out
removes it (`GoTrueClient.js:1591`, `:1609`, `:4329`), a crafted link WILL sign that browser out.
The window is per-browser and self-closing, not a standing hole, and it is the price of using the
only evidence the browser actually has.

## Still open

- **Whether `/login` should redirect a signed-in user.** Nothing does today, deliberately — the
  middleware's only two rules are `/start` for a signed-out browser on `/home`, and `/home` for an
  owner sitting on `/` or `/start`; `fix/callback-clears-stale-session` adds none. A signed-in browser can therefore
  sit on `/login` and start a Google round-trip, which is the one path on which the consequence
  above bites. Closing it is a product call, not a bug fix: it decides whether an already-signed-in
  person is allowed to switch accounts from that page at all.

## UNVERIFIED

Each with the one artefact that would settle it.

1. **What triggered the fallback on the founder's two occurrences** — a `redirect_to` origin not on
   the allow-list, or a bad/expired `state`. Not in this repo. Settled by: the origin in the address
   bar when the failed attempt started, plus the signature (`?code=` vs `?error=`) at the landing.
2. ~~**The live Supabase Site URL and Redirect URLs list.**~~ **SETTLED 2026-09-22** by the artefact
   this line asked for — see "The allow-list, measured" above, where all four URLs and the Site URL
   are recorded verbatim. No `www` host, no `*.vercel.app` alias, no fifth entry. Kept in place
   rather than deleted so the numbering does not shift.
3. **Every origin `apps/web` is actually served from.** Vercel assigns per-deployment and
   per-branch `*.vercel.app` hosts; `state-of-play.md` records `apps/admin` as reachable on one.
   That `apps/web` has the same is REASONED, not read. Settled by: the Vercel project's Domains page.
4. ~~**Vercel's own `Set-Cookie` merge order.**~~ **SETTLED 2026-09-22** by the artefact this line
   asked for — see "Measured on Vercel" above. Both headers survive, middleware first and route
   last, and the browser keeps the route's value. Kept in place rather than deleted so the numbering
   below does not shift.
5. **The two-visible-windows refresh race.** Nothing serializes two foreground tabs. Runtime
   interleaving; code cannot settle it.
6. **Whether the fix resolves the founder's symptom.** It is pinned by tests and unexercised against
   a real occurrence.
7. **Whether `x-middleware-set-cookie` reaches the origin function on Vercel** — and so whether a
   route handler re-emits the middleware's cookies for names it does not itself write. On the
   installed Next that seeding is real: `dist/server/async-storage/request-store.js:112-118` passes
   the mutating proxy to `mergeMiddlewareCookies`, whose `set` trap marks each name modified
   (`adapters/request-cookies.js:146-155`), and `route-modules/app-route/module.js:482` emits them
   on the handler's own response. It is also what would let `@supabase/ssr` 0.12.3's stale-chunk
   sweep (`dist/main/cookies.js:388-402`) see an orphaned chunk from the other account and delete
   it — the mitigation only exists if the seeding happens. The two-header result above is consistent
   with the seeding happening AND with it not happening, so it does not settle this. Settled by: a
   probe route that returns `(await cookies()).get("probe")` while the middleware sets it.

Related: [[auth-round-trips-that-miss-the-callback-die-silently]] (the parent defect and its
`/auth/callback` error handling), [[0006-google-oauth-is-in-scope-for-launch]] (the `access_denied`
history).
