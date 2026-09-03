---
type: defect
status: verified
verified: 2026-09-03
method: "code read at 23a06e1 — apps/web/src/middleware.ts:11-46: `setAll` writes the rotated cookies onto the `response` local (:18-24), and both early exits return a brand-new `NextResponse.redirect(...)` (:35, :42) that carries none of them. Rotation settings read from supabase/config.toml:165 (`jwt_expiry = 3600`), :171 (`enable_refresh_token_rotation = true`), :174 (`refresh_token_reuse_interval = 10`). NOT reproduced: the sign-out symptom below is predicted from the code, never observed."
source: code
---

# Middleware redirects drop the refreshed auth cookies, so the rotated refresh token never reaches the browser

## FIXED 2026-09-03 (`c925d4a`, `ad6d5ce`)

Both redirects carry the cookies now. `apps/web/src/middleware.ts` gained a four-line
`withAuthCookies(target)` inside the middleware function — `for (const cookie of
response.cookies.getAll()) target.cookies.set(cookie)`, then return `target` — and both early
exits return through it. `return response` at the end is untouched, as are the matcher, the
`businesses` query and its error handling.

It reads `response` at call time rather than capturing it at definition, and that is the whole
trick: `setAll` reassigns the local, and it can fire during the `businesses` read that sits
between `getUser()` and the second redirect. A helper closing over the first `response` would drop
exactly the rotation this note is about.

`apps/web/test/middleware.test.ts` guards it. Three cases drive the real middleware through a fake
`createServerClient` whose `getUser()` calls the `setAll` hook it was constructed with, the way
auth-js does: the signed-out `/home` → `/start` redirect, the owner's `/start` → `/home` redirect,
and the pass-through that was already correct, kept as a regression guard. Against the unfixed file
the two redirect cases fail with `expected undefined to be 'R2'` while the pass-through passes —
the defect restated as a test. No vitest config was needed, and one thing learned here is worth
keeping: the `@/` alias does **not** resolve under vitest's defaults (`Failed to load url
@/lib/supabase/client`), but a `vi.mock` factory intercepts the specifier before Vite's resolver
reaches it. Every existing `apps/web` test imports `../src/...` relatively and so had never hit
this; any future test of a module that uses `@/` will need the same trick.

`apps/admin/src/middleware.ts` got the same four lines in `ad6d5ce`: its `deny()` returns either a
fresh `/login` redirect or a JSON 403, and both dropped the cookies identically. Its blast radius
was small — one user on one machine, so a revoked family costs the founder a re-login rather than
costing a customer their session — and it is fixed because it is the same bug, not because it was
hurting anyone. The Basic Auth 401 is left alone; it returns before the Supabase client exists and
has nothing to carry.

**Still predicted, never observed.** The test proves the cookies are carried; it does not prove the
sign-out ever happened to anyone. The Scope caveat below stands unchanged — whether the hosted
project carries the same rotation settings as `supabase/config.toml` was still not read, so the
severity argument is untouched rather than confirmed. Dropping a rotated cookie is wrong either way.

---

`apps/web/src/middleware.ts` is the only place a Server-Component request can refresh a Supabase
session. `createServerClient`'s `setAll` hook (`:18-24`) does the right thing — it re-creates
`response` and writes each rotated cookie onto it. Both redirect branches then throw that away:

```ts
if (!user && path.startsWith("/home")) {
  return NextResponse.redirect(new URL("/start", request.url)); // :35
}

if (user && (path === "/" || path === "/start")) {
  const { data } = await supabase.from("businesses").select("id").limit(1);
  if (data && data.length > 0) {
    return NextResponse.redirect(new URL("/home", request.url)); // :42
  }
}
```

Neither redirect carries the `Set-Cookie` headers `setAll` just put on `response`. `getUser()` at
`:28-30` may already have exchanged refresh token R1 for R2 **server-side**; on a redirect the
browser is never told, so it keeps presenting R1.

## Why that is not harmless

Rotation is on and the reuse window is short — `supabase/config.toml:171,174`:
`enable_refresh_token_rotation = true`, `refresh_token_reuse_interval = 10`. Ten seconds after the
rotation, R1 is outside its reuse interval, and GoTrue treats a second presentation of it as token
reuse and revokes the whole family.

**Predicted symptom, not observed.** An owner comes back after more than `jwt_expiry` (3600s) of
idle and hits `/` or `/start` — including a Next prefetch of a `<Link href="/start">`, which runs
the middleware without any click. `getUser()` refreshes R1 to R2, the `businesses` read finds a
row, `:42` returns a redirect, R2 is lost. More than 10s later the browser presents R1, the family
is revoked, `getUser()` returns null, and `:34-36` bounces them off `/home` to `/start`. They are
signed out, on the public signup wizard, in every tab.

The same drop applies to auth-js's cookie _removal_ at `:35`: dead-session cookies stay in the
browser, so every following request re-attempts the revoked refresh.

## Scope

- The two redirects in this file only. `return response` at `:46` is correct and keeps the cookies.
- The browser-side `auth.getUser()` added to `OnboardingFlow` in `03fc7f9` is **not** affected —
  `createBrowserClient` persists its own cookies from the browser, a separate request cycle.
- Not verified against the hosted project: `supabase/config.toml` is the local Supabase CLI config
  in this repo. Whether `hyaqydcmwbnbaiqqufow`'s dashboard carries the same rotation settings was
  not read. Rotation being off would remove the revocation, though the dropped refresh would
  remain.

## The fix shape

Build the redirect and copy the cookies onto it before returning — create it, then
`response.cookies.getAll().forEach((c) => redirect.cookies.set(c))`, then return the redirect.

Supabase's Next.js server-side auth guide
(<https://supabase.com/docs/guides/auth/server-side/nextjs>) is the reference for this middleware
pattern. **Citation caveat:** the specific "copy the cookies over to any new response object"
instruction was not found when that page and `.../server-side/creating-a-client` were fetched on
2026-09-03 — the returned page text had no match for it, and `@supabase/ssr` 0.12.3's own README
and source carry no such note either. The mechanism above is argued from this repo's code and from
`supabase/config.toml`, not from the guide's wording.
