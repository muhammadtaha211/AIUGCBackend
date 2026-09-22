---
type: defect
status: verified
verified: 2026-09-22
method: "Code read, 2026-09-22, at 0cca4fa (branch fix/site-url-landing). Repo: apps/web/src/middleware.ts, apps/web/src/app/page.tsx, apps/web/src/app/auth/callback/route.ts, apps/web/src/lib/auth.ts, apps/web/test/middleware.test.ts read in full; repo-wide grep over apps/ and packages/ for error_description|error_code|access_denied|location.hash and for URL-param reads of `code`, excluding node_modules and .next. Installed libraries read from node_modules/.pnpm, not from docs: next 15.5.20 (dist/server/base-http/node.js, dist/server/lib/patch-set-header.js, dist/server/lib/router-server.js, dist/server/next-server.js, dist/server/lib/server-ipc/utils.js, dist/server/lib/router-utils/resolve-routes.js, dist/server/async-storage/request-store.js, dist/server/web/spec-extension/adapters/request-cookies.js, dist/compiled/@edge-runtime/cookies/index.js), @supabase/auth-js 2.110.6 (dist/main/GoTrueClient.js, dist/main/lib/constants.js, dist/main/lib/locks.js), @supabase/ssr 0.12.3 (dist/main/createBrowserClient.js, dist/main/cookies.js, dist/main/utils/chunker.js, dist/main/utils/constants.js). SUPERSEDED at the end of this field, kept for the record: 'The symptom itself is FOUNDER-REPORTED, not observed here. The fix on this branch is pinned by tests; it has NOT been exercised against a real occurrence.' — true when written, and no longer true of the 2026-09-22 occurrence. The Vercel Set-Cookie merge order was MEASURED 2026-09-22, not read: `curl -sS -D - -o /dev/null <deployment>/api/probe` x3, no redirect following, against preview deployment `4cb3330yd` built from throwaway branch `probe/vercel-cookie-merge` commit `eead322` (branch and deployment since deleted); the browser-side outcome read once with document.cookie at the redirect target. Extended 2026-09-22 for the callback clear (f544619): @supabase/auth-js 2.110.6 dist/main/GoTrueClient.js (_signOut :3360-3392, _removeSession :4317-4335, _useSession :2443-2456, __loadSession :2462-2545, _callRefreshToken :4094-4235 (the whole function both times — the refresh-failure returns at :2517-2538 and the _removeSession at :4212 are what the third limit turns on), _notifyAllSubscribers :4236-4276), dist/main/GoTrueAdminApi.js :67-85, dist/main/lib/constants.js :13, and @supabase/ssr 0.12.3 dist/main/createServerClient.js :48-66 + dist/main/cookies.js :359-440 read in full, versions from each package.json; the seven cases in apps/web/test/auth-callback.test.ts run green and mutation-checked (pnpm --filter @aiugc/web exec vitest run --fileParallelism=false). SUPERSEDED likewise: 'No live round-trip was exercised.' — one has been since, on 2026-09-22. Extended 2026-09-22 for the allow-list: the live Redirect URLs list and Site URL MEASURED off Authentication -> URL Configuration for project hyaqydcmwbnbaiqqufow, read by the founder and pasted verbatim into the task that produced this edit; recorded in full below. That is dashboard state and nothing in this repo can confirm or refute it, and a read on 2026-09-22 says nothing about what the list held on the two undated occurrence dates. Extended 2026-09-22 for the trigger, which is MEASURED for one occurrence and for one only: two log exports the founder pulled and pasted — the Supabase auth log and the Vercel log, 91 entries each, both spanning 11:31–12:10 UTC on 2026-09-22 — cross-read with that browser's own URL history. Those are founder-supplied artefacts; they are not in this repo, nothing here can re-derive them, and they cover the 2026-09-22 occurrence and no other. The redirect that fixes it was measured separately: `curl -sI https://www.tavnit.ai/ --max-time 20` → 308 `Location: https://tavnit.ai/`, twice, recorded verbatim in [[www-tavnit-ai-does-not-resolve]]. Commit times behind that chain were read with TZ=UTC git log on this clone: 352484e (PR #54, the forward) 04:37:55, 13f18ea (the allow-list read) 09:37:34, 57e599d (PR #56, the clear) 11:11:34 — the last of those only 20m22s before the chain's first row, and NO deploy time for it is recorded anywhere, which is why UNVERIFIED 6 treats the forward as evidenced and the clear as not."
source: code + browser + dashboard + founder log exports
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

## Three occurrences — one measured, two founder-reported

**Two, reported 2026-09-22, undated.** On both, the founder was left in the account previously
signed in in that browser rather than the one he picked, or landed on the marketing page; both
cleared on a second attempt, in the wrong-account case after a manual sign-out. **The dates of the
occurrences were not given**, nothing was captured from either, and **the fix was not exercised
against them**. Nothing below claims otherwise, and nothing below reads the measured occurrence
backwards onto these two.

**One, on 2026-09-22, MEASURED end to end** — the first occurrence anyone has the whole of. It ran
after the forward was live (PR #54 merged ~7h earlier, and the chain shows it running) and after PR
#56 merged, 20m22s earlier, though whether the clear was actually **serving** by then is not
established — `UNVERIFIED 6`. The second origin was `www.tavnit.ai`, the chain is transcribed under
"The trigger, measured" below, and it is what moves `UNVERIFIED 1` from a guess to a reading for
that occurrence alone.

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

**What triggered the fallback on the two undated occurrences is UNVERIFIED** and is not knowable
from this repo — see below. For the 2026-09-22 occurrence it is measured, and it is the `?code=`
row of that table.

## The trigger, measured — 2026-09-22

`UNVERIFIED 1` asked for one artefact: the origin the failed attempt started from, plus the
signature at the landing. For the 2026-09-22 occurrence both are now read.

**Method, and its limit.** Two log exports the founder pulled and pasted — the Supabase auth log
and the Vercel log, **91 entries each, both spanning 11:31–12:10 UTC** — cross-read with that
browser's own URL history. They are founder-supplied artefacts, not repo state; nothing here can
re-derive them, and they cover this occurrence and no other. The two accounts appear below by the
first eight characters of their ids and nothing else.

**The second origin was `www.tavnit.ai`.** Not a `*.vercel.app` preview, which is what
"What the guard costs" below had assumed the exposed path would be. The apex and the `www` host
were **both serving the app** — and two serving origins are two cookie jars.

| UTC        | What the exports show                                                                                                                                                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `11:31:56` | `tavnit.ai/home`. The middleware refreshes the session of `2ce072ce…` — the account this browser was already in.                                                                                                                                          |
| `11:31:59` | `www.tavnit.ai/` → **200, static**. A live second origin: no redirect to the apex, and an empty cookie jar.                                                                                                                                               |
| `11:32:02` | `www.tavnit.ai/login`.                                                                                                                                                                                                                                    |
| `11:32:05` | GoTrue `/authorize`, `redirect_to=https://www.tavnit.ai/auth/callback` — **not on the four-entry allow-list**.                                                                                                                                            |
| `11:32:10` | GoTrue `/callback` 302 → the **Site URL**: `tavnit.ai/?code=0ec38b77…` → the middleware forward → `/auth/callback` → **`PKCE code verifier not found in storage`**, the verifier being in the `www` jar. The middleware refreshed `2ce072ce…` again here. |
| `11:32:11` | `/login?error=oauth`, and **nothing was cleared**. The founder reads that as `startedHere` finding no verifier; the exports cannot separate it from the clear not yet serving — `UNVERIFIED 6`.                                                           |
| `11:32:13` | `/` → `/home` as `2ce072ce…`. **The original wrong-account symptom — now sitting behind the failure message rather than instead of it.**                                                                                                                  |
| `11:32:35` | Retry from the apex: `/authorize`, `redirect_to=https://tavnit.ai/auth/callback`.                                                                                                                                                                         |
| `11:32:39` | PKCE exchange **200**; `/home` as `636cc9d3…`, the account actually picked at Google.                                                                                                                                                                     |

**What it settles.** The fallback fired because `redirect_to` carried an origin the allow-list does
not hold — `www.tavnit.ai` — and not because of a bad or expired `state`. The signature is `?code=`,
so GoTrue completed the sign-in server-side and only the return leg was misdelivered; by the table
above, `last_sign_in_at` for `636cc9d3…` is expected to have moved at `11:32:10` and is not evidence
against this reading. It settles one of the two shipped halves and not the other: the **forward**
demonstrably ran at `11:32:10` — the landing was routed instead of dying on `/`, and the customer
read a failure message at `11:32:11` rather than nothing — while **no clear ran**, which is the
outcome and not a verdict on the clear's code, because PR #56 merged 20m22s before the first row
and the exports cannot tell a guard that found nothing from a deploy that had not landed. Either
way `11:32:13` is the wrong-account landing happening anyway. See `UNVERIFIED 6`.

**What it does not settle.** The two undated occurrences. A mechanism shown once is consistent with
them; it is not a reading of them. `UNVERIFIED 1` stays open for those two, and the `www` host's own
history (below) is why it cannot be closed by inference either.

### The fix chosen: the Vercel redirect, not a fifth allow-list entry

`www.tavnit.ai` now **308s to the apex** — measured the same day, verbatim in
[[www-tavnit-ai-does-not-resolve]]. Vercel domain configuration; no repo change, and the allow-list
is untouched at four entries.

**Adding `https://www.tavnit.ai/auth/callback` to the allow-list was the obvious alternative and was
rejected.** It would have fixed this one flow — the round-trip would have been delivered back to
`www`, where the verifier was, and the exchange would have succeeded. It would also have made the
split permanent. **Two serving origins are two cookie jars**: a session established on `www` is not
a session on the apex, so the same person is signed in on one host and not the other, and every
crossing between them looks like the bug this note is about. And the crossings are not
hypothetical — **the Site URL is `https://tavnit.ai`** (measured, in "The allow-list, measured"
below), and it is both where GoTrue's fallback delivers and the base at least one live email
template is built from: the Reset Password body is literally
`{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery`
(`docs/08-supabase-project-rebuild.md:336`, `:544`). Four of the other five templates link through
`{{ .ConfirmationURL }}` (`:559`, `:570`, `:581`, `:594`) and the fifth is an OTP code with no link
at all; what `ConfirmationURL` resolves to is **not pinned anywhere in this tree**, so the claim
here is the recovery link and not all of them. One is enough: a person who signed in on `www` and
opened a password-reset email arrives on the apex as nobody, or as whoever they were before.

Redirecting collapses the two jars into one before any of that is reachable, and it does it for
every path at once rather than for `/auth/callback` alone. The allow-list entry would have
sanctioned the second origin; the redirect removes it.

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

### What the guard costs — and it has now been observed costing it

**A cross-origin `?code=` landing no longer clears.** The verifier lives on the origin the flow
started from, so a round-trip begun elsewhere and delivered by GoTrue's fallback to the Site URL
`tavnit.ai` arrives at an origin that never wrote one. `startedHere` is false, no clear runs, and
that visitor gets the failure message **and stays in the old account** — precisely the wrong-account
landing this whole note is about, reopened for exactly one path.

**This stopped being a prediction on 2026-09-22.** It is the `11:32:11` and `11:32:13` rows of the
trigger table above: the exchange failed with `PKCE code verifier not found in storage`, no verifier
existed on the apex because the flow had started on `www`, nothing was cleared, and two seconds
later `/` → `/home` put the browser back in `2ce072ce…`. **That the GUARD is what suppressed the
clear is the founder's reading of the exports, not a separable measurement** — PR #56 merged
20m22s before the first row and no deploy time is recorded, so "the guard found nothing" and "the
clear was not serving yet" produce the identical log; see `UNVERIFIED 6`. Either way no clear ran
and the browser kept the wrong session, which is the cost this heading is about. It is measured at
the price
the note said it would be, on the exact path the note named — with one correction: **the second
origin was `www.tavnit.ai`, not a preview host.** Previews are still exposed the same way; they were
simply not what bit first, and nothing had established that the `www` host was serving at all (see
[[www-tavnit-ai-does-not-resolve]], where it had measured `000` two weeks earlier). That is the
correction carried into the paragraph two below.

That specific instance is closed by the redirect, not by the guard: with `www` 308ing to the apex
there is one jar, the verifier is written where the landing arrives, and the exchange succeeds
instead of failing. The guard's cost remains for any _other_ origin the app is served from —
`UNVERIFIED 3`.

An earlier draft of this paragraph called that "the founder's own preview/localhost path" and named
`localhost:3000` beside the preview hosts. The measurement below removes the localhost half:
`http://localhost:3000/auth/callback` **is** allowlisted, so a round-trip started there is delivered
there and never falls back. **That draft then ended "the cost is the preview hosts only", and the
2026-09-22 occurrence falsified it within hours**: `www.tavnit.ai` was a serving origin nobody had
enumerated, and it is the one that bit. The honest form is the one `UNVERIFIED 3` asks for — the
cost is every serving origin that is not on the list, and this note has never known that set.

That is accepted rather than worked around, because **the fix for that path is upstream of the
callback**, not in it: a round-trip whose `redirect_to` origin never reaches GoTrue as an unknown
origin does not fall back to the Site URL in the first place, and never reaches this branch.
`UNVERIFIED 2` asked for that list and it is now read — immediately below. `UNVERIFIED 3`, the set
of serving origins such a list would have to cover, is what remains.

**There are two upstream fixes, and which one is right depends on whether the origin is a duplicate
of the apex or a genuinely separate deployment.** For `www.tavnit.ai` — same app, same data, no
reason to exist as its own host — the fix is the redirect, taken 2026-09-22, for the cookie-jar
reason set out under "The fix chosen" above. For a `*.vercel.app` preview the redirect is not
available: the preview IS a different deployment and must stay reachable as itself, so the only
lever left is an allow-list entry. The sentence this paragraph replaced said "the allow-list" flatly,
which was right for previews and would have been the wrong call for `www`.

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

**The missing `www` entry is what the 2026-09-22 occurrence walked into, under two hours after this
list was read** — the read is recorded by `13f18ea`, committed 09:37:34 UTC, and the chain's first
row is 11:31:56 UTC. So this is not a list reconstructed after the fact: it is the list that was
live when the round-trip failed. It is still four URLs, deliberately — `www.tavnit.ai` 308s to the
apex now, so there is no `www` origin left for an entry to describe.

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
(`docs/08-supabase-project-rebuild.md:781-785`, renumbered from `:764-768` by the `www` paragraph
added to §8B step 5 in the same commit as this section). It matters here for one reason only: it is proof
the list is edited, which is why nothing below reads this list backwards in time.

**The trigger for the two undated occurrences stays UNVERIFIED.** A list with no `www` and no
preview entry is a _possible_ cause of a Site-URL landing on days nobody logged, not an observed
one. Their dates were never given, nothing was captured from either, and a dashboard read on
2026-09-22 cannot establish what the list held on two earlier days — the recovery entry alone shows
it changes, and so does the `www` host, which measured `000` on 2026-09-08 and served a 200 on
2026-09-22. `UNVERIFIED 1` stands as written **for those two**; for the 2026-09-22 occurrence it is
settled above by the log exports.

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

1. **What triggered the fallback — SETTLED for the 2026-09-22 occurrence, still open for the two
   undated ones.** The artefact this line asked for is exactly what arrived: the origin the failed
   attempt started from (`https://www.tavnit.ai`, not on the allow-list) and the signature at the
   landing (`?code=`, so GoTrue completed and only the return leg missed) — see "The trigger,
   measured" above. It is NOT a bad or expired `state`, for that occurrence. The two undated reports
   are untouched by this: nothing was captured from either, and the `www` host's own state changed
   inside the window they fall in ([[www-tavnit-ai-does-not-resolve]]), so they cannot be assigned
   this cause by inference. Settled for those two by: the same pair of artefacts, which do not
   exist for them.
2. ~~**The live Supabase Site URL and Redirect URLs list.**~~ **SETTLED 2026-09-22** by the artefact
   this line asked for — see "The allow-list, measured" above, where all four URLs and the Site URL
   are recorded verbatim. No `www` host, no `*.vercel.app` alias, no fifth entry. Kept in place
   rather than deleted so the numbering does not shift.
3. **Every origin `apps/web` is actually served from.** Vercel assigns per-deployment and
   per-branch `*.vercel.app` hosts; `state-of-play.md` records `apps/admin` as reachable on one.
   That `apps/web` has the same is REASONED, not read. Settled by: the Vercel project's Domains page.
   **Partially read 2026-09-22, and it cost an occurrence to read it:** `www.tavnit.ai` was one, it
   was serving a 200 at `11:31:59`, and nobody knew — this note had assumed the exposed set was
   previews. It is a redirect now, so the set this note can NAME is back to the apex plus the
   previews — that `www` was the only unknown one is exactly what is not established. The Domains
   page is still the artefact, and the reason to look at it is that the last origin to come off
   this list came off it through a customer-visible failure rather than through looking.
4. ~~**Vercel's own `Set-Cookie` merge order.**~~ **SETTLED 2026-09-22** by the artefact this line
   asked for — see "Measured on Vercel" above. Both headers survive, middleware first and route
   last, and the browser keeps the route's value. Kept in place rather than deleted so the numbering
   below does not shift.
5. **The two-visible-windows refresh race.** Nothing serializes two foreground tabs. Runtime
   interleaving; code cannot settle it.
6. **Whether the fix resolves the founder's symptom — ANSWERED for the forward, STILL OPEN for the
   clear.** The occurrence in "The trigger, measured" is the first real one either half has met.
   **The forward is evidenced**: PR #54 (`352484e`) merged 04:37:55 UTC, ~7h earlier, and the
   `11:32:10` → `11:32:11` rows cannot happen without it — a `/?code=` that reaches
   `/auth/callback` and ends on `/login?error=oauth` is the forward running. **The clear is not
   evidenced either way**, and saying otherwise would be the inference-as-measurement this vault
   forbids: PR #56 (`57e599d`) merged **11:11:34 UTC, 20m22s before the first row**, no deploy
   time for it is recorded anywhere, and — even if it was serving — "nothing was cleared" is
   exactly what the verifier guard produces on an origin that did not start the flow, which is
   byte-for-byte what `origin/main` did before the clear existed. The exports cannot separate
   _guard suppressed the clear_ from _the clear was not live yet_. What is measured either way is
   the outcome: `11:32:13` put the browser back in `2ce072ce…`, so the symptom this note is named
   for happened, with a failure message in front of it. What removed it was the redirect, upstream
   of both halves. Settled by: a `/auth/v1/logout` entry, or its absence, in a future export where
   the flow started on this origin.
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
history), [[www-tavnit-ai-does-not-resolve]] (the second origin, and the redirect that removed it).
