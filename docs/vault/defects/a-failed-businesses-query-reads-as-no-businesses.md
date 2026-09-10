---
type: defect
status: verified
verified: 2026-09-10
method: "2026-09-09 — re-swept at 182e5fb over apps/web/src and apps/admin/src on four independent lenses (PostgREST call sites, Drizzle/core call sites, redirect destinations, API routes + client components): the six sites below are unchanged and a SEVENTH has appeared, apps/web/src/app/home/renders/page.tsx:20-24, added 2026-09-08 in e33396f. The boundary question was settled by reading apps/web/node_modules/next 15.5.20: `find apps/web/src -name 'error.tsx' -o -name 'global-error.*'` returns nothing, and Next's implicit fallback is the client-side DefaultGlobalError at dist/client/components/builtin/global-error.js. The PostgREST failure shape was read at @supabase/postgrest-js 2.110.6 src/PostgrestBuilder.ts:471-576 — it RESOLVES { data: null, error }, and only throws when .throwOnError() is on the chain, so no site here can be failing by rejection. 2026-09-10 — apps/web/src/app/home/error.tsx WRITTEN, and this is the first thing in this note that was OBSERVED rather than read: a throwing server component behind a temporary public route (deleted after) tripped the boundary, the console confirmed 'handled by the <ErrorBoundaryHandler> error boundary' with digest 3104664058, and the retry button recovered the page with no reload once the throw was removed out-of-band. 2026-09-10 (second pass) — all seven sites CLOSED, and the failure was finally REPRODUCED with a real PostgREST error rather than a fabricated one: a temporary public route (deleted after) ran the real ownedBusinesses helper over a real supabase read and got 'permission denied for table businesses', which threw to home/error.tsx and painted the Hebrew card carrying digest 1166246555 — the same digest the dev server logged, so the disclosure is a working join key. The streamed case was measured too, ON next dev ONLY: a throw behind a flushed <Suspense> returns HTTP 200 with the skeleton in the HTML and the card painted client-side, while the same throw with no Suspense above it returns 500 — and review then established that NO real page has the second shape, so all five are the 200 case (see the table in the body, corrected). Still NOT exercised under the real /home tree, which is auth-gated: the probes reproduce the mechanism, not the authenticated path. The six file:line pairs below are as of 23a06e1 and have MOVED: at 182e5fb the middleware read is :49, home/page.tsx is :74-81, home/layout.tsx is :23-26. Locate by content. --- 2026-09-03 (original) — code read at 23a06e1 — every `businesses` select whose result drives a redirect, with `error` discarded in each: apps/web/src/middleware.ts:40-43, apps/web/src/app/home/page.tsx:71-78 (HomeContent), home/a/new/page.tsx:25-29, home/b/new/page.tsx:24-28, home/demos/page.tsx:20-24, home/layout.tsx:23-29. Duplicate-business consequence traced from apps/web/src/components/onboarding/onboarding-flow.tsx (completeAdditional posts allowCreate) into apps/web/src/app/api/onboarding/complete/route.ts:69-89, where the owner guard at :71-80 is skipped and createBusiness at :85 runs unconditionally. NOT reproduced: no failing query was induced."
source: code + browser
---

# A failed `businesses` query is indistinguishable from "this user has no businesses"

## Closed 2026-09-10 — all seven sites

All seven **PostgREST** `businesses` reads in `apps/web` now distinguish a failed read from an
empty one. **The duplicate-business path described below is still open** — it does not run through
any of those seven, and the two changes that would close it were both ruled out by the founder.

"Seven" counts `.from("businesses")` only. `apps/web/src` holds four **more** `businesses`
reads, all through Drizzle — `home/feedback/page.tsx`, `home/settings/page.tsx`,
`lib/api.ts` (`requireBusiness`) and `api/onboarding/complete/route.ts` (the owner guard).
None of them is an eighth site, and the reason is structural rather than lucky: **drizzle /
postgres-js REJECTS on a failed query** instead of resolving `{ data: null }`, so a failure there
cannot collapse into "owns nothing" in the first place. Neither of the two pages redirects on an
empty list either. Recorded here because a future re-audit greps `businesses` and finds eleven
reads against a note that closes seven.

**What a failed read actually looks like — measured 2026-09-10.** Worth having in front of you,
because it makes the severity concrete: a `businesses` select made without a usable session does
**not** come back empty. It comes back `{ data: null, error: { message: "permission denied for
table businesses" } }` — RLS/grants refuse the anon role outright (`anon` holds no SELECT on
`public.businesses`; `authenticated` does). So a failed read is a concrete, ordinary shape, not
a hypothetical.

**But do not overstate the blast radius, as an earlier draft of this paragraph did.** An anon
request never reaches any of the seven reads: `if (!user) redirect("/start")` sits two lines
above every one of them, and the middleware gates on `user` too. What is reachable is a session
that passes `getUser()` and then hits a transient PostgREST failure on the very next call — the
scenario the 2026-09-03 note posited and which **has still never been observed in production**.
The measurement above proves the failure SHAPE is real and what the code does with it; it does not
prove the frequency.

**Closed — `middleware.ts`.** The query destructures `error`, logs it, and returns the
pass-through `response`. **The ROUTING half is behaviour-preserving, and that is the honest
description of it**: a failed read resolves `data: null`, which fails the same length check an
empty `[]` fails, so `if (data && data.length > 0)` was already falling through to the same
`return response`. What the change buys is that the exit is _named_ — so a later `data ?? []`
or `if (!data?.length) redirect(...)` rewrite cannot quietly turn the guess back on — and that
the failure is now **recorded**, which is the only part of the middleware half that is observable
at runtime.

`apps/web/test/middleware.test.ts` pins it: 5 cases, up from 3. The tests were checked by
mutation, and all three mutations that matter go red:

| mutation                                                 | caught by                                   |
| -------------------------------------------------------- | ------------------------------------------- |
| delete the whole `if (error)` block                      | the log assertion (`toHaveBeenCalledTimes`) |
| `if (error)` redirects instead of falling through        | `expect(location).toBeNull()`               |
| `if (data && data.length > 0)` narrowed to `if (!error)` | the owns-nothing case                       |

The middle one is the point of the note. The **third** was a real hole found by review: before it
was added, nothing in `apps/web` covered a signed-in user who genuinely owns nothing at
`/start` — every brand-new account's entry — so narrowing the redirect condition would have sent
all of them to `/home` with a green suite.

**Closed — `home/layout.tsx`.** Destructures `error` and `console.error`s it (the house
pattern in `apps/web`: 5 other `console.error` call sites across 4 other files —
`api/onboarding/complete/route.ts:93`, `auth/callback/route.ts:26,33`, `lib/api.ts:180`, and
`middleware.ts:57` from this same change). Behaviour is deliberately
unchanged: the sidebar still empties. An empty switcher is the right frame for both cases, a layout
has no honest way to report a failure, and it must not throw — it wraps `/home/new-business`,
where an empty list is the point. The log line is what separates the two cases afterwards.

**Closed — the five redirecting reads.** `home/page.tsx` (HomeContent), `home/a/new`,
`home/b/new`, `home/demos` and `home/renders` all now throw on a failed read and reach
`app/home/error.tsx`. The genuine empty case still redirects to `/home/new-business`, exactly
as before — that part was never wrong.

They go through **one helper**, `ownedBusinesses` in `apps/web/src/lib/businesses.ts`, rather
than five copies of `if (error) throw`. The copy is how this defect spread in the first place:
`/home/renders` was written five days after the note and inherited the shape verbatim from
`/home/demos`. A page that calls the helper cannot inherit it, and a page that forgets to call it
is one grep away.

The helper is also the first time this decision has been **testable** —
`apps/web/test/businesses.test.ts` covers the four shapes postgrest-js can resolve, and both
mutations were checked: dropping the `throw` reddens "throws when the read failed", dropping the
`?? []` reddens the `{ data: null, error: null }` case.

The same file carries a **convention guard**, which is the part that actually protects against a
recurrence. Unit tests cannot see the failure mode that produced the seventh site: a NEW page
copying the old shape is valid code that no unit test or typecheck touches. So the guard scans
`apps/web/src/app/home/**` and asserts that every file containing `.from("businesses")` also
calls `ownedBusinesses(`, with `layout.tsx` on a one-line allowlist that must still contain
`console.error`. Verified by reproducing the regression: dropping in a page copied from
`/home/demos` with the unguarded shape turns the suite red, naming the offending file.
298 tests in `apps/web` (was 285 before any of this).

`home/layout.tsx` deliberately does **not** use it. A layout is rendered by its PARENT's error
boundary and there is no `app/error.tsx`, so a throw there would escape `home/error.tsx` and
reach Next's built-in English screen. The layout logs and empties the sidebar instead.

**What is still open, precisely.** The middleware change does **not** close the duplicate-business
path, and closing it there was ruled out by the founder in the same instruction. The path runs:
owner hits `/` or `/start` → the read fails → the middleware (by design, before and after) does
not redirect → `/start` renders `OnboardingFlow` → its client `getUser()` succeeds, finds no
finished draft, and `replace("/home/new-business")` → a filled-in wizard posts `allowCreate`.
Neither the middleware nor `/home/new-business` reads `businesses` on that path, so no
error-handling fix at any of the seven sites reaches it. It is closable only by the two changes the
section at the bottom records as rejected.

## Why the five could not throw on 2026-09-09 — there was no error boundary

_Historical. The boundary was written on 2026-09-10; see "The boundary" below. Kept because it is
the argument that decided the sequencing, and because the Next internals it establishes are still
what governs the boundary's reach._

Checked 2026-09-09 at 182e5fb: `apps/web/src` contains **no `error.tsx` and no
`global-error.tsx`** at any level. Next 15.5.20 does supply an implicit fallback, but reading
`apps/web/node_modules/next/dist` shows it is not the thing this note wants:

- `client/components/builtin/global-error.js` is a `'use client'` component that reads
  `window.location.hostname` — the server never runs error boundaries at all
  (`react-dom-server.edge.production.js` contains zero `getDerivedStateFromError`).
- With no `error.tsx`, `server/app-render/create-component-tree.js:84` resolves
  `ErrorComponent` to `undefined` and `client/components/error-boundary.js:115` returns the
  children unwrapped — so there is no segment-level boundary anywhere, and the root fallback is the
  only catcher.
- `HomeContent` sits behind a `<Suspense>` whose shell flushes first, so the throw never
  reaches the `res.statusCode = 500` path at `server/app-render/app-render.js:1419`. The
  response stays **HTTP 200**, React flips the boundary to client-rendered
  (`$RX`, `react-dom-server.edge.production.js:2570`), and the browser replaces the **entire
  document** with the default screen.
- That screen reads _"Application error: a server-side exception has occurred while loading
  tavnit.ai (see the server logs for more information). Digest: …"_ — English, LTR, unbranded, on a
  Hebrew-first RTL product. It is not `noindex`ed (`app-render.js:155-166` only emits that
  above status 400), and Next re-classifies it as **uncaught**
  (`client/react-client-callbacks/error-boundary-callbacks.js`), so it also fires
  `window.onerror`.

So a throw on 2026-09-09 would have been a 200 that uptime checks call healthy, that crawlers may
index, and that destroyed the whole page instead of the failing pane. That was worse than the
redirect it would have replaced, which is why the five were not changed that day.

**Caveat resolved 2026-09-10 — the contested link was MEASURED, and the derived answer was
right.** Adversarial review had disputed whether the `catch` holding `res.statusCode = 500` is
entered when the throw sits behind an already-flushed `<Suspense>`: one read said the catch only
runs when `renderToReadableStream` itself rejects, another pointed at
`app-render.js:1395,1418` where the 500 is gated on the error **kind**. Two probes settled it on
`next dev`:

| probe shape                                      | status  | server HTML                        |
| ------------------------------------------------ | ------- | ---------------------------------- |
| sync shell + `<Suspense>` + throwing async child | **200** | skeleton; card painted client-side |
| throw with no `<Suspense>` above it              | **500** | `__next_error__`, empty body       |

So the streamed 200 is real, and with it the rest of that paragraph: a throw on `/home` was a
response uptime checks call healthy.

**Correction — which row the real pages sit on.** An earlier draft labelled the second row "(= the
other four pages)". That is wrong, and review caught it. `/home/a/new`, `/home/b/new`,
`/home/demos` and `/home/renders` each have their **own `loading.tsx`**, and
`app/home/loading.tsx` sits above all of them. Next builds a real SSR `<Suspense>` out of a
`loading.tsx` (`layout-router.js` `LoadingBoundary`) and places it **inside** the
`ErrorBoundary` — so every one of the five is the first row, not the second. **All five failed at
HTTP 200 before this change**, which is worse than it sounds: not one of them would have shown up
in a status-code check. The 500 row is a shape no page in this app actually has; it is kept because
it is what isolated the mechanism.

**Measured on `next dev`, not on `next build && next start`** — the masking and digest
behaviour differ between the two, and only the production build was read rather than run.

## The boundary — written 2026-09-10

`apps/web/src/app/home/error.tsx` exists. `create-component-tree.js:84` now resolves a real
component, so a throw anywhere under `/home` is caught by it instead of reaching the default
screen. Four things about it that a future session should not have to re-derive:

- **It is pane-scoped, not page-scoped.** Next positions a segment's boundary inside the segment's
  CHILDREN slot, so it renders inside `home/layout.tsx` — the sidebar, switcher and credits card
  stay mounted and only `<main>` swaps. Verified by eye: the harness's sidebar stand-in survived
  the trip and the recovery. It shares that slot with `home/loading.tsx`, so it copies that
  file's wrapper (`mx-auto w-full max-w-2xl px-6 pt-8`) to stop the swap jumping.
- **`reset()` alone would have been a dead button.** `ErrorBoundaryHandler.reset` is only
  `this.setState({ error: null })` (`dist/esm/client/components/error-boundary.js:74-78`; zero
  hits for `refresh` in that file), after which React re-reads the SAME rejected RSC payload from
  the cache node and the boundary trips again on the next frame. The retry is
  `startTransition(() => { router.refresh(); reset(); })`. **Measured**: the click fires
  `GET /zz-preview-error?_rsc=…` and, with the server-side throw removed out of band, the real
  page appeared with no manual reload.
- **Its blind spot is `home/layout.tsx` itself.** A layout is rendered by its PARENT's boundary,
  and there is no `app/error.tsx`, so a throw in the layout still reaches the default screen.
  This is exactly why the layout logs its failed `businesses` read instead of throwing on it —
  and it is the reason the "closed" bullet above is not simply "make the layout throw too".
- **It costs something on the happy path.** The module is loaded server-side on every render of
  the `/home` segment and its client chunk is fetched and evaluated on every `/home` page load,
  thrown or not, even though it renders nothing. Its CSS is not injected unless it trips. Keep its
  imports lean — today they are `react`, `next/navigation` and `@/components/ui/button`.

Still open, and a separate file: there is no `app/error.tsx` and no `global-error.tsx`, so the
root layout, the marketing pages, `/start`, `/login` and `home/layout.tsx` are all still
uncovered. A `global-error.tsx` replaces the root layout entirely, so it would have to re-declare
`<html lang="he" dir="rtl">` and the fonts itself — the single biggest bidi trap in this area.

## The seventh site

`apps/web/src/app/home/renders/page.tsx:20-24` carries the identical shape and the identical
`redirect("/home/new-business")`. The 2026-09-03 note did not miss it — the page did not exist
then; it landed 2026-09-08 in `e33396f` (`web: all-renders page, demo library edit flow`),
copied from `home/demos/page.tsx`. **The pattern is still propagating by copy**, which is the
strongest argument for closing it rather than documenting it again.

---

Every place that routes on business ownership destructures `data` and drops `error`:

```ts
// middleware.ts:40-43
const { data } = await supabase.from("businesses").select("id").limit(1);
if (data && data.length > 0) {
  return NextResponse.redirect(new URL("/home", request.url));
}
```

```ts
// home/page.tsx:71-78 (HomeContent)
const { data: businesses } = await supabase
  .from("businesses")
  .select("id, name, questionnaire")
  .order("created_at", { ascending: true });

if (!businesses || businesses.length === 0) redirect("/home/new-business");
```

PostgREST returns `data: null` on failure, so a pooler blip, an RLS change, or any transient
PostgREST error makes a real owner look business-less. `middleware.ts` then leaves them on
`/start`, and `HomeContent` sends them to `/home/new-business`. The same shape is in
`home/a/new/page.tsx:25-29`, `home/b/new/page.tsx:24-28`, `home/demos/page.tsx:20-24` and
`home/layout.tsx:23-29` (the last only empties the sidebar).

## What `03fc7f9` added to it

The class is pre-existing. What is new is where the misread now leads.

Before, an owner who fell through `middleware.ts:38-44` landed on the **public** wizard, whose
completion posts without `allowCreate` — and `api/onboarding/complete/route.ts:71-80` is idempotent
by owner, so it would have handed back their existing business. Fail-safe.

Now `OnboardingFlow` redirects them to `/home/new-business`, whose `completeAdditional` posts
`allowCreate: true`, which **deliberately** skips that guard (`route.ts:69-71`, comment:
_"allowCreate (signed-in הוסף עסק) deliberately skips the guard"_). `createBusiness` at `:85` then
runs. A transient query failure plus a filled-in questionnaire produces a **second business** for a
one-business customer. Fail-duplicating.

Reaching it takes a filled-in wizard, so it is not a one-click hazard — but nothing warns, and the
duplicate is a real row with real questionnaire data.

## Closure considered — which one was taken

Two changes were considered on 2026-09-03 and deferred. On **2026-09-09 the founder chose the
second**, and it was taken **only at the two sites where it does not need an error boundary**:

- **`OnboardingFlow` redirects to `/home` instead of `/home/new-business`.** `/home` re-runs the
  ownership query server-side, so a transient failure would have to recur to reach the additional
  wizard, and a real owner lands on their dashboard. Costs one extra round trip on the normal path,
  and the founder's decision named `/home/new-business` explicitly
  ([[0015-signed-in-without-business-lands-on-new-business]]).
  → **Rejected 2026-09-09**, explicitly, for that reason. It is also the only one of the two that
  would have closed the `/start` path described above.
- **`HomeContent` throws on `error` instead of redirecting.** An error boundary is the honest answer
  to "we could not read your businesses"; redirecting is a guess. Same for the middleware, which
  would `return response` and let the page decide.
  → **Taken, and finished 2026-09-10.** The middleware half shipped on 2026-09-09. The throwing
  half was blocked that day on the missing error boundary; `app/home/error.tsx` was written on
  2026-09-10 and all five pages now throw through `ownedBusinesses`. Nothing in this closure is
  outstanding.

A third change was ruled out before it was considered: **`allowCreate` and the guard it skips stay
as they are.** Adding a business is a legitimate flow and the skip is deliberate
(`api/onboarding/complete/route.ts:69-71`).

Related: [[auth-getuser-errors-read-as-signed-out]] — the same "an error is not an empty result"
shape on `auth.getUser()`, found in the 2026-09-09 sweep, at 17 call sites across both apps.
