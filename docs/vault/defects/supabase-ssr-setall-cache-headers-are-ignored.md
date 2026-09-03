---
type: defect
status: verified
verified: 2026-09-03
method: "read @supabase/ssr@0.12.3 in node_modules/.pnpm/@supabase+ssr@0.12.3_@supabase+supabase-js@2.110.6/node_modules/@supabase/ssr: `SetAllCookies` declares a second parameter at dist/main/types.d.ts:16-45, and `applyServerStorage` (dist/main/cookies.js:376) passes the three no-store headers into it at dist/main/cookies.js:447-449. All four `setAll` implementations in this repo declare one parameter and therefore discard it: apps/web/src/middleware.ts:27, apps/admin/src/middleware.ts:45, apps/web/src/lib/supabase/server.ts:17, apps/admin/src/lib/supabase/server.ts:17. NOT reproduced: no cached auth response was observed, and the Vercel/Next mitigation below is inference, not measurement."
source: code
---

# Every `setAll` hook drops the no-store headers @supabase/ssr passes with rotated auth cookies

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

**`source: inference`, unverified — this paragraph is reasoning, not a measurement.** Next.js marks
a route dynamic once it reads cookies and is believed to send its own
`Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` on such responses, and
Vercel is not believed to cache middleware responses at all. If both hold, the practical exposure
today is nil and this is a latent correctness gap rather than a live session-leak. Neither was
tested: no response header from a deployed environment was read, and `tavnit.ai` has no traffic to
observe. Do not treat the "nil" as established — it is the thing to measure first.

## What a fix looks like

Four independent edits, one per hook: take the second parameter and write each entry onto the
outgoing response. The library's own example (`types.d.ts:33-41`) is the middleware shape —
`Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value))`. The two
`lib/supabase/server.ts` hooks have no response object in scope and would need a different route
(`cookies()` cannot set headers), so they are not the same one-liner.

Deliberately not fixed in the commit that carries this note: the finding came out of a review of a
different defect, and the header write wants its own change with its own verification.
