---
type: defect
status: verified
verified: 2026-09-10
method: "read @supabase/ssr@0.12.3 in node_modules/.pnpm/@supabase+ssr@0.12.3_@supabase+supabase-js@2.110.6/node_modules/@supabase/ssr: `SetAllCookies` declares a second parameter at dist/main/types.d.ts:16-45, and `applyServerStorage` (dist/main/cookies.js:376) passes the three no-store headers into it at dist/main/cookies.js:447-449. All four `setAll` implementations in this repo declare one parameter and therefore discard it: apps/web/src/middleware.ts:27, apps/admin/src/middleware.ts:45, apps/web/src/lib/supabase/server.ts:17, apps/admin/src/lib/supabase/server.ts:17. NOT reproduced: no cached auth response was observed, and the Vercel/Next mitigation below is inference, not measurement. — Re-measured 2026-09-10: two of the four hooks fixed in `3d47d3a` (the middlewares now at apps/web/src/middleware.ts:37 and apps/admin/src/middleware.ts:54, so the two cites above no longer resolve); the mitigation paragraph falsified by `curl -sS -D - -o /dev/null` against https://tavnit.ai signed out, two hits per route ~39s apart; the replacement fact read off dist/main/cookies.js:425-427."
source: code
---

# Every `setAll` hook drops the no-store headers @supabase/ssr passes with rotated auth cookies

## FIXED 2026-09-10 for the two middlewares (`3d47d3a`); the two `server.ts` hooks are left on purpose

Two of the four hooks in the table below now take the second argument. Both middlewares declare
`setAll(cookiesToSet, headers)` — `apps/web/src/middleware.ts:37`,
`apps/admin/src/middleware.ts:54` — hold an `authHeaders` local beside `response` (web `:19`, admin
`:37`), and write it onto `response` **outside** the non-empty guard (web `:48-49`, admin `:64-65`).
**The table below still cites the pre-fix lines `:27` and `:45`. Both moved in `3d47d3a` and neither
resolves any more**; it is kept as the record of what was found on 2026-09-03.

`withAuthCookies` copies `authHeaders` onto the target alongside the cookies (web `:28`, admin
`:45`), reading the local **at call time** — the same discipline the cookie fix already needed
([[middleware-redirects-drop-refreshed-auth-cookies]]), because `setAll` **reassigns** both locals
and can fire during the `businesses` read that sits between `getUser()` and the second redirect. A
helper closing over the first map would drop exactly the rotation this note is about. That covers
web's two redirects (`:81`, `:102`) and admin's `deny()` in both arms — the 403-JSON branch and the
`/login`-redirect branch (`:91-92`).

**The non-empty guard's real job is not what it looks like**, and that is worth recording. It does
not protect the edge cache: `Object.entries({}).forEach` sets nothing, so the naive unconditional
version was inert too. What it stops is a later `{}` call **wiping an already-captured map** —
`setItem`, `removeItem` and `clearAuthCookiesAtScopes` all flush with `{}`.

Guarded by four new cases in `apps/web/test/middleware.test.ts`, which went from 7 tests to 11. The
fake `createServerClient` now calls `setAll(ROTATED, headers)` with the library's real three-header
map, copied verbatim from `cookies.js:447-449` (`:44-48`) and reset per test (`:135`). The four:
headers on the pass-through (`:277`), on the signed-out `/home` → `/start` redirect (`:286`), on the
owner's `/start` → `/home` redirect (`:293`), and an empty map adding no `Cache-Control` at all
(`:311`). Mutation-tested: deleting the `setAll` write reddens the pass-through; deleting the
`withAuthCookies` copy reddens both redirect cases; stamping `no-store` unconditionally reddens the
empty-map case.

**Version, corrected.** The `method:` line above is right and a later session was wrong: both
`package.json`s declare `^0.12.3` (`apps/web/package.json:17`, `apps/admin/package.json:16`) and
`pnpm-lock.yaml` resolves 0.12.3 at all four of its `@supabase/ssr` hits. The fix was written and
verified against **0.12.3**. **Not checkable from this tree:** whether the `SetAllCookies` shape is
unchanged in 0.12.7 — no 0.12.7 exists in the checkout, the pnpm store or the npm cache, so nothing
here can confirm or deny it. Do not assert it either way without reading the published package.

### Deliberately not fixed — the two `lib/supabase/server.ts` hooks

`apps/web/src/lib/supabase/server.ts:17` and `apps/admin/src/lib/supabase/server.ts:17` still read
`setAll(cookiesToSet) {`. The two files are byte-identical. **`source: inference` — REASONED,
UNVERIFIED. The following is a judgement, not a measurement:**

- They write into Next's `cookies()` store, not a response. In a Server Component that write throws
  and is swallowed by the try/catch already around it, so no `Set-Cookie` is emitted and there is
  nothing to protect.
- In a Route Handler, calling `cookies()` forces the route dynamic. That is consistent with the one
  thing actually measured: `/api/personas` answered `X-Vercel-Cache: MISS`, `Age: 0` on both hits.
- `cookies()` cannot set response headers at all, so fixing them means threading a `NextResponse`
  through call sites that have none.

Low value, real cost, left alone. Reopen it if a route handler is ever **observed** emitting a
cached `Set-Cookie`.

### Not pinned — the admin half

`apps/admin` has a `test/` directory (`admin.test.ts`, `hooks.test.ts`) but **no middleware test and
no `vitest.config.ts`**, so the `@/` alias its middleware imports through — declared at
`apps/admin/tsconfig.json:10` — does not resolve under vitest. Pinning the admin half means a new
config file plus a new test file. Left deliberately: the admin change is logically byte-equivalent
to the mutation-tested web one, and the blast radius of a dropped header there is one founder
re-login.

---

`@supabase/ssr@0.12.3` hands `setAll` **two** arguments. The second is a header map the library
expects to be written onto the same response as the cookies:

```js
// dist/main/cookies.js:446-450, inside applyServerStorage (:376)
], {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
});
```

The library states the risk itself, in the doc comment on the parameter
(`dist/main/types.d.ts:21-25`):

> Responses that set auth cookies must not be cached by CDNs or reverse proxies, otherwise one
> user's session token can be served to a different user.

All four hooks in this repo were written against the one-argument shape and silently drop it:

| file                                    | line  | what it writes to        |
| --------------------------------------- | ----- | ------------------------ |
| `apps/web/src/middleware.ts`            | `:27` | the `response` local     |
| `apps/admin/src/middleware.ts`          | `:45` | the `response` local     |
| `apps/web/src/lib/supabase/server.ts`   | `:17` | Next's `cookies()` store |
| `apps/admin/src/lib/supabase/server.ts` | `:17` | Next's `cookies()` store |

Every one is `setAll(cookiesToSet) {`. TypeScript does not complain — a function of fewer
parameters is assignable — so nothing flagged this when the library added the argument.

Not every library call site passes real headers: the storage adapter's `setItem`
(`cookies.js:185`) and `removeItem` (`:243`), and `clearAuthCookiesAtScopes.js:65`, all pass `{}`.
The one that carries them, `applyServerStorage`, is the server-side flush path
`createServerClient` uses after a refresh — which is exactly the path the two middlewares are on.

## Which responses this actually touches

Any response that leaves the middleware carrying `Set-Cookie` for a session. Since
`c925d4a`/`ad6d5ce` that is a strictly larger set than before: the pass-through already carried
them, and now both web redirects and both admin `deny()` branches do too
([[middleware-redirects-drop-refreshed-auth-cookies]]). That fix is correct and this note is not
an argument against it — but it does mean the surface described here grew in the same commits, and
that is the honest reason the two notes belong next to each other.

## The mitigation nobody has checked

> **Falsified 2026-09-10 by measurement.** The paragraph below is kept verbatim, as the record of
> what was believed on 2026-09-03. The measurement that killed half of it follows immediately after.

**`source: inference`, unverified — this paragraph is reasoning, not a measurement.** Next.js marks
a route dynamic once it reads cookies and is believed to send its own
`Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` on such responses, and
Vercel is not believed to cache middleware responses at all. If both hold, the practical exposure
today is nil and this is a latent correctness gap rather than a live session-leak. Neither was
tested: no response header from a deployed environment was read, and `tavnit.ai` has no traffic to
observe. Do not treat the "nil" as established — it is the thing to measure first.

## What the deployed headers actually say — MEASURED 2026-09-10

Against `https://tavnit.ai` production, **signed out**, 2026-09-09/10, with
`curl -sS -D - -o /dev/null`, two requests per route about 39 seconds apart:

| route               | first hit                                       | repeat                     |
| ------------------- | ----------------------------------------------- | -------------------------- |
| `GET /`             | 200, `X-Vercel-Cache: PRERENDER`, `Age: 0`      | `HIT`, `Age: 38` then `39` |
| `GET /start`        | 200, `PRERENDER`, `Age: 0`                      | `HIT`, `Age: 39`           |
| `GET /home`         | 307 → `/start`, **no** `x-vercel-cache`, no age | identical                  |
| `GET /api/personas` | 401, `X-Vercel-Cache: MISS`, `Age: 0`           | `MISS`, `Age: 0`           |

Every one of the four carried `Cache-Control: public, max-age=0, must-revalidate`. `/` and `/start`
returned the same ETag `62305e249885421ae84ba73bfbc226a4` across hits and varied on the four
rsc/next-router headers; `/home` carried no `Vary` at all. **No route emitted `Expires`, `Pragma`,
or `Set-Cookie`** — a signed-out request never rotates a session, so none of them had headers to
carry in the first place.

**"Vercel is not believed to cache middleware responses at all" is false.** `/` and `/start` are
edge-cached _after_ the middleware runs, with real `HIT`s and real `Age` growth. The other half of
the paragraph survives — `/api/personas` reads cookies through `requireUser` → the Supabase server
client and measured `MISS`/`Age: 0` on both hits — but it was never the load-bearing half.

## The better fact that replaces it — MEASURED 2026-09-10

Read off `@supabase/ssr@0.12.3` on disk. `applyServerStorage` early-returns **before** calling
`setAll` when there is nothing to write. `dist/main/cookies.js:425-427`, the last statement before
the function's only `await setAll(` at `:428`:

```js
if (removeCookiesToWrite.length === 0 && setCookiesToWrite.length === 0) {
  return;
}
```

So an anonymous request to `/` never reaches the hook at all. **That**, and not the dead mitigation,
is why the marketing homepage keeps its `HIT` — the exposure is bounded by "did this request rotate
a session", which is the right boundary and was never the one being argued about.

Two more things fell out of the same read:

- The `{}` call sites at `cookies.js:240` and `:293` are inside the **browser**-client storage
  adapter — the block `if (!isServerClient) {` opens at `:158` and closes at `:297` — so they are
  unreachable from `createServerClient`. (These are the `setAll(…, {})` **calls**; the `:185` and
  `:243` cited above are the `setItem`/`removeItem` **declarations**. Both sets of numbers are real;
  they point at different lines of the same two functions.)
- `clearAuthCookiesAtScopes` has **no caller anywhere in this repo**. Its five repo-wide mentions
  are all prose: two middleware comments, two lines of a test doc comment, and this note.

## What a fix looks like

Four independent edits, one per hook: take the second parameter and write each entry onto the
outgoing response. The library's own example (`types.d.ts:33-41`) is the middleware shape —
`Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value))`. The two
`lib/supabase/server.ts` hooks have no response object in scope and would need a different route
(`cookies()` cannot set headers), so they are not the same one-liner.

Deliberately not fixed in the commit that carries this note: the finding came out of a review of a
different defect, and the header write wants its own change with its own verification.
