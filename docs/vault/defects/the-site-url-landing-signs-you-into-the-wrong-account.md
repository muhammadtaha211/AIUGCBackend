---
type: defect
status: verified
verified: 2026-09-22
method: "Code read, 2026-09-22, at 0cca4fa (branch fix/site-url-landing). Repo: apps/web/src/middleware.ts, apps/web/src/app/page.tsx, apps/web/src/app/auth/callback/route.ts, apps/web/src/lib/auth.ts, apps/web/test/middleware.test.ts read in full; repo-wide grep over apps/ and packages/ for error_description|error_code|access_denied|location.hash and for URL-param reads of `code`, excluding node_modules and .next. Installed libraries read from node_modules/.pnpm, not from docs: next 15.5.20 (dist/server/base-http/node.js, dist/server/lib/patch-set-header.js, dist/server/lib/router-server.js, dist/server/next-server.js, dist/server/lib/server-ipc/utils.js, dist/server/lib/router-utils/resolve-routes.js, dist/server/async-storage/request-store.js, dist/server/web/spec-extension/adapters/request-cookies.js, dist/compiled/@edge-runtime/cookies/index.js), @supabase/auth-js 2.110.6 (dist/main/GoTrueClient.js, dist/main/lib/constants.js, dist/main/lib/locks.js), @supabase/ssr 0.12.3 (dist/main/createBrowserClient.js, dist/main/cookies.js, dist/main/utils/chunker.js, dist/main/utils/constants.js). The symptom itself is FOUNDER-REPORTED, not observed here. The fix on this branch is pinned by tests; it has NOT been exercised against a real occurrence. The Vercel Set-Cookie merge order was MEASURED 2026-09-22, not read: `curl -sS -D - -o /dev/null <deployment>/api/probe` x3, no redirect following, against preview deployment `4cb3330yd` built from throwaway branch `probe/vercel-cookie-merge` commit `eead322` (branch and deployment since deleted); the browser-side outcome read once with document.cookie at the redirect target."
source: code + browser
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
callback, and `/auth/callback`'s `?error=` branch, which constructs no Supabase client at all and
so writes no session of its own — `createServerSupabase()` is called only at
`app/auth/callback/route.ts:22`, inside `if (code)`, and a `?error=` landing takes the `:30-39`
path instead. See `UNVERIFIED 7`.

## FIXED on branch `fix/site-url-landing` — 2026-09-22, UNMERGED

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

## Still open

- **A stale session survives a failed exchange at the callback.** `app/auth/callback/route.ts:23-27`
  sends a failed `exchangeCodeForSession` to `/login?error=oauth` without clearing the session the
  browser arrived with. So after a forwarded `?error=` landing the customer reads the Hebrew failure
  message while still signed in as the older account, and any navigation to `/` bounces them back
  into it. **Pre-existing — this branch does not change it, and it is recorded here as an open
  question, not as something fixed.** Closing it means deciding whether a failed round-trip should
  sign the browser out, which is a product call.

## UNVERIFIED

Each with the one artefact that would settle it.

1. **What triggered the fallback on the founder's two occurrences** — a `redirect_to` origin not on
   the allow-list, or a bad/expired `state`. Not in this repo. Settled by: the origin in the address
   bar when the failed attempt started, plus the signature (`?code=` vs `?error=`) at the landing.
2. **The live Supabase Site URL and Redirect URLs list.** Dashboard state. `docs/vault/state-of-play.md`
   records Site URL `https://tavnit.ai` with `https://tavnit.ai/auth/callback` allowlisted; whether
   anything else is on it — a `www` host, any `*.vercel.app` alias — is unread. Settled by:
   Authentication → URL Configuration.
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
