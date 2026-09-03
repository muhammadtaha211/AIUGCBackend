---
type: defect
status: verified
verified: 2026-09-03
method: "code read at 23a06e1 — apps/web/src/middleware.ts:11-46: `setAll` writes the rotated cookies onto the `response` local (:18-24), and both early exits return a brand-new `NextResponse.redirect(...)` (:35, :42) that carries none of them. Rotation settings read from supabase/config.toml:165 (`jwt_expiry = 3600`), :171 (`enable_refresh_token_rotation = true`), :174 (`refresh_token_reuse_interval = 10`). NOT reproduced: the sign-out symptom below is predicted from the code, never observed."
source: code
---

# Middleware redirects drop the refreshed auth cookies, so the rotated refresh token never reaches the browser

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
