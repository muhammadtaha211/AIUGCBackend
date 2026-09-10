---
type: defect
status: verified
verified: 2026-09-10
method: "Read at 91e4470. apps/web/src/app/(legal)/privacy/page.tsx:175 claims the edge check reads the login cookie only; apps/web/src/middleware.ts:54-57 calls supabase.auth.getUser() (a round trip to the Auth server) on every matched request, and :86 runs `supabase.from('businesses').select('id').limit(1)` inside the `path === '/' || path === '/start'` branch opened at :84. Matcher at :109-111 excludes only _next/static, _next/image, favicon.ico and image extensions; no `export const runtime` in the file. docs/legal-review.md:67 is item P3."
source: code
---

# /privacy says the edge check reads "the login cookie only". It runs a database query.

## What the page claims

`apps/web/src/app/(legal)/privacy/page.tsx:175`, closing the Vercel bullet of §6
(`למי המידע מועבר`, heading at `:160`):

> היא בודקת את עוגיית ההתחברות בלבד.

("It checks the login cookie only.") The sentence begins at `:173`, saying the login check runs on
Vercel's edge network at the server nearest the visitor and may therefore run outside Germany.

**§7 does not repeat the claim.** `:229` is §7 (`העברת מידע מחוץ לישראל`) and its only reference is
`:232-233`, which says the check may run on a nearby edge server and cross-references §6. It
inherits the characterisation rather than restating it — worth knowing, because
`docs/legal-review.md:67` asserts "§7 says so too".

## What the middleware actually does

Two things, neither of which is reading a cookie.

**On every matched request** — `apps/web/src/middleware.ts:54-57`:

```ts
const {
  data: { user },
  error: authError,
} = await supabase.auth.getUser();
```

`getUser()` is a **network call to the Supabase Auth server**. It does not merely parse or verify
the cookie locally.

**On `/` and `/start`, for every signed-in visitor** — `middleware.ts:86`, inside the branch opened
at `:84`:

```ts
const { data, error } = await supabase.from("businesses").select("id").limit(1);
```

That is an authenticated, RLS-scoped PostgREST query issued **from the edge node nearest the
visitor** — on the marketing homepage and the wizard entry, the two most-visited routes in the app.

The matcher (`:109-111`) is a negative lookahead excluding only `_next/static`, `_next/image`,
`favicon.ico` and image extensions, so the middleware runs on essentially every route. There is no
`export const runtime` in the file, so it runs on the edge runtime by default.

## Why this is more than a copy fix

`docs/legal-review.md:67`, item P3, puts a question to counsel that **rests on the false
characterisation**:

> Whether an edge check that only reads a session cookie is a transfer that needs the reg. 2 basis
> at all.

The premise is wrong. The edge check also runs a database query against the visitor's own business
rows. Counsel answering the question as asked would be answering about a system that does not exist,
and the answer could plausibly flip — a cookie read and an RLS-scoped `SELECT` are not obviously the
same kind of processing for transfer purposes.

P3's Position column carries the same error twice over: "reads only the login cookie" and "§7 says
so too".

## Deliberately not fixed here

**Neither the privacy page nor `docs/legal-review.md` was edited.** Both are the founder's call —
one is published copy making a factual claim to visitors, the other is a document going to counsel.
This note records the discrepancy; it does not resolve it.

The options, so they are not re-derived: correct §6 to describe what the edge actually does; or
change the middleware so the claim becomes true (move the `businesses` read out of the edge); or
leave both and tell counsel the premise of P3 is wrong. They are not equivalent — the second is the
only one that reduces what crosses the border.

## Related

- [[database-definitions-document-missing]] — the reg. 2 document P3 feeds.
- [[sentry-is-an-undisclosed-processor]] — the other §6 recipient problem found the same day.
- [[a-failed-businesses-query-reads-as-no-businesses]] — the same `businesses` read, from the
  correctness side.
