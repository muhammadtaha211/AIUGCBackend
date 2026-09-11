---
type: defect
status: verified
verified: 2026-09-11
method: "Original finding read at 91e4470. Re-read at ab0245e on 2026-09-11 before the fix: apps/web/src/middleware.ts:54-57 still calls supabase.auth.getUser() (a round trip to the Auth server) on every matched request, :86 still runs `supabase.from('businesses').select('id').limit(1)` inside the `path === '/' || path === '/start'` branch opened at :84, the matcher at :109-111 still excludes only _next/static, _next/image, favicon.ico and image extensions, and there is still no `export const runtime` in the file. Fix verified by grep: `עוגיית ההתחברות בלבד` returns nothing in apps/web/src/app/(legal)/privacy/page.tsx. docs/legal-review.md:67 is item P3."
source: code
---

# /privacy says the edge check reads "the login cookie only". It runs a database query.

## FIXED 2026-09-11 (option (a) — the copy was corrected, the middleware was not)

Of the three options this note recorded, **(a) correct §6 to describe what the edge actually does**
was taken. The §6 Vercel bullet now says the check verifies the session against the authentication
server on every request, and that on the home page and the service's entry page it also runs a
query limited to the visitor's own data to see whether a business is already registered to them —
reading one id and nothing more. The corrected sentence is
`apps/web/src/app/(legal)/privacy/page.tsx:173-177`, inside the Vercel bullet at `:171-178`.

**(b) — moving the `businesses` read off the edge — was deliberately NOT taken.** It is the only
option that reduces what crosses the border, and it remains available; it is a behaviour change to
`middleware.ts` and therefore the founder's call, not a copy fix. `apps/web/src/middleware.ts` is
byte-for-byte unchanged by this fix.

**(c)** is partly discharged as a side effect: `docs/legal-review.md:67` (P3) no longer puts the
false premise to counsel. Its Position column now states the session verification and the
RLS-scoped `SELECT`, and its question asks about both. The question itself is left open — this
note's author did not answer it.

The §7 claim in P3's old Position ("§7 says so too") was checked against the page and is false in
the direction that costs nothing: §7 cross-references the §6 bullet
(`page.tsx:243`, `…ובדיקת ההתחברות עשויה להתבצע בשרת קצה הקרוב אליכם (סעיף 6)`) instead of
restating the characterisation, so correcting §6 corrected §7 with it. **§7 was not edited.**

---

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
