---
type: defect
status: verified
verified: 2026-09-10
method: "code read at 182e5fb — `grep -rn 'auth.getUser()' apps/web/src apps/admin/src` returns 17 call sites and every one destructures only `data: { user }`; zero read `error`. Failure shape read at @supabase/auth-js 2.110.6 GoTrueClient.ts:3176-3218 — the two failure RETURNS in that range are both `{ data: { user: null }, error }` (:3194 and :3213), so `user` is null on error exactly as it is when signed out — but :3216 is a bare `throw error` for anything that is not an AuthError, which is a third failure mode that never populates `error` at all. Found as a side finding of the 2026-09-09 sweep for [[a-failed-businesses-query-reads-as-no-businesses]]. NOT reproduced: no failing getUser was induced. 2026-09-10 — amended after apps/web/src/app/home/error.tsx landed and was observed catching a real server throw: the ten /home page sites are no longer blocked on a missing boundary. The remaining blocks (home/layout.tsx, middleware.ts) and the GoTrueClient.ts:3216 rethrow are code-read, not reproduced."
source: code
---

# A failed `auth.getUser()` is indistinguishable from "signed out"

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
