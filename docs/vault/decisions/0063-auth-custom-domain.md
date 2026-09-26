---
type: decision
status: verified
verified: 2026-09-26
method: "Founder-reported, in chat, 2026-09-26: the Supabase Custom Domain add-on was enabled on
  project hyaqydcmwbnbaiqqufow and auth.tavnit.ai activated on 2026-09-26 (the exact activation
  time was not given in the brief this note was written from — see Gaps below); Namecheap
  Advanced DNS (same zone as the Resend records) now carries `CNAME auth ->
  hyaqydcmwbnbaiqqufow.supabase.co.` and `TXT _acme-challenge.auth -> <an HK-... value Supabase
  issued>` (value deliberately not recorded here); the Supabase activation screen instructed
  keeping the CNAME after activation for service continuity; the Google OAuth client's Authorized
  redirect URIs now list both `https://hyaqydcmwbnbaiqqufow.supabase.co/auth/v1/callback` and
  `https://auth.tavnit.ai/auth/v1/callback`; and a Google sign-in on tavnit.ai after activation
  completed, with the account chooser reading \"tavnit.ai\" rather than the project ref or
  \"auth.tavnit.ai\". None of this dashboard, DNS or Google Cloud Console state was independently
  observed by this session — it is founder-reported. The $10/month add-on cost and the claim that
  Supabase Auth advertises the custom domain as the OAuth callback once active (while supabase.co
  keeps serving) are from Supabase's published documentation, not measured on this project. The
  claim that switching NEXT_PUBLIC_SUPABASE_URL would rename the auth cookie and sign out every
  user is REASONED, not observed: apps/web/src/app/auth/callback/route.ts:5-28 (the
  CODE_VERIFIER_SUFFIX comment) documents that @supabase/ssr's storage key defaults to
  `sb-${hostname.split(\".\")[0]}-auth-token` and is never overridden via `cookieOptions.name`
  anywhere in this repo (grepped 2026-09-26, no hits outside that comment and its own file), and
  apps/web/src/lib/supabase/client.ts:9-10 plus server.ts:12 confirm `NEXT_PUBLIC_SUPABASE_URL` is
  the URL string passed into both `createBrowserClient` and `createServerClient` — i.e. the
  hostname the cookie name is derived from today is `hyaqydcmwbnbaiqqufow`, from
  `hyaqydcmwbnbaiqqufow.supabase.co`."
source: founder
---

# Auth gets a custom domain (auth.tavnit.ai); the client URL stays on supabase.co

## What was done, and what it costs

The Supabase **Custom Domain** add-on was enabled on the one production project
(`hyaqydcmwbnbaiqqufow` — CLAUDE.md, [[0006-google-oauth-is-in-scope-for-launch]]),
and **`auth.tavnit.ai` was activated as its Auth custom domain on 2026-09-26** (founder-reported;
see Gaps below for the exact time). This costs **$10/month, billed hourly, and is not covered by
the platform spend cap** (Supabase's documentation — not separately measured here).

DNS for it lives in the same Namecheap Advanced DNS zone as the Resend records
([[../state-of-play]] "External state" → Resend):

```
CNAME  auth                  -> hyaqydcmwbnbaiqqufow.supabase.co.
TXT    _acme-challenge.auth  -> <an HK-... value Supabase issued; not recorded here>
```

**The CNAME must stay.** Supabase's activation screen said to retain it after activation for
service continuity, and — independent of that instruction — deleting it would break Google
sign-in outright: once a custom domain is active, Supabase Auth begins advertising and sending
Google back to `auth.tavnit.ai` for the OAuth callback (Supabase's documentation), so a broken
`auth.tavnit.ai` breaks the live callback, not just a cosmetic label.

The Google OAuth client's Authorized redirect URIs now list both:

```
https://hyaqydcmwbnbaiqqufow.supabase.co/auth/v1/callback
https://auth.tavnit.ai/auth/v1/callback
```

The `supabase.co` entry is kept **on purpose** — it is harmless (Google does not penalise an
unused registered redirect URI) and it is the rollback path (see Rollback below).

**Founder-tested (founder-reported, not observed by this session):** Google sign-in on
`tavnit.ai` after activation completed successfully, and the account chooser read **"tavnit.ai"**
— not `auth.tavnit.ai`, and no longer the raw project ref.

## Why

Before this change, Google's account chooser showed prospects arriving from marketing videos the
raw Supabase project reference — **"hyaqydcmwbnbaiqqufow.supabase.co"** — as the site they were
signing in to. Google only shows a domain on that screen (as opposed to a verified app name and
logo) until the OAuth app clears brand verification, and the domain it was showing was whatever
host Supabase Auth was sending Google back to: the project's own `supabase.co` host. Putting a
branded domain in front of Auth changes what that screen reads, without touching brand
verification itself.

## Why `NEXT_PUBLIC_SUPABASE_URL` stays on `supabase.co`

`NEXT_PUBLIC_SUPABASE_URL` was **deliberately not changed** anywhere it is set — `.env`,
`apps/web/.env.local`, `apps/admin/.env.local`, `apps/worker/.env`, `apps/cli/.env`, or on Vercel.

The reason is the auth cookie's name, not inertia. `apps/web/src/app/auth/callback/route.ts:5-28`
(the `CODE_VERIFIER_SUFFIX` comment) documents, from reading `@supabase/ssr` and `@supabase-js`
directly, that the session/verifier cookie's storage key is never set via `cookieOptions.name`
anywhere in this repo, so it falls back to supabase-js's own default:
`` sb-${hostname.split(".")[0]}-auth-token `` (route.ts:12-13), where that hostname is whatever
URL string is handed to the client factory. `apps/web/src/lib/supabase/client.ts:9-10` and
`server.ts:12` show that string is `NEXT_PUBLIC_SUPABASE_URL` — today
`https://hyaqydcmwbnbaiqqufow.supabase.co`, giving the live cookie name
`sb-hyaqydcmwbnbaiqqufow-auth-token`.

**This is reasoned, not measured: it has never been observed.** Nobody has actually pointed
`NEXT_PUBLIC_SUPABASE_URL` at `auth.tavnit.ai` and watched the cookie rename happen. But the code
path is direct enough that the consequence follows from reading it: `hostname.split(".")[0]` of
`auth.tavnit.ai` is `"auth"`, not `"hyaqydcmwbnbaiqqufow"` — a completely different cookie name —
which would sign out every existing session on the next deploy (the old cookie stops being read,
the new one starts empty), and would need `apps/web` and `apps/admin` to flip in the same deploy
window since both read the same env var family. All of that for **no visible gain**: the account
chooser's text follows the callback host Auth advertises (already fixed by the custom domain, see
above), not the client-side `NEXT_PUBLIC_SUPABASE_URL`. So there is nothing left to buy by moving
it.

## Phase B — brand verification — deferred, not pending

Google's chooser can go further than a plain domain: with the OAuth app's **brand verified**, the
chooser shows the app's name and logo instead of just a hostname. That is a separate, larger
lift than this change, and the founder's call on 2026-09-26 was to **defer it** — the chooser now
reading `tavnit.ai` was judged enough for now. Recorded here so nobody has to rediscover the shape
of the work:

- Brand verification requires every **Authorized domain** on the OAuth consent screen to be
  verified in Google Search Console.
- `supabase.co` cannot be verified in Search Console — it is not this project's domain to verify.
  So before brand verification could even be attempted, both the `supabase.co` redirect URI
  above and `supabase.co` under Authorized domains (if it is listed there — not checked as part
  of this task) would have to be removed.
- That removal is only safe **after** confirming Auth no longer needs the `supabase.co` callback
  for anything live — i.e. after enough of a soak on the custom domain (and after the rollback
  window this note's Rollback section describes is no longer wanted).
- [[0006-google-oauth-is-in-scope-for-launch]]'s existing rule — **do not upload a
  custom app logo**, because a logo forces Google's brand review even with only non-sensitive
  scopes — **stays in force**. It is still correct advice while brand verification is deferred:
  uploading a logo now would start a review nobody has decided to run. Reversing that would take
  everything in this section first.

## Rollback

Supabase documents `supabase domains delete` (its CLI) as the way to deactivate a custom domain.
**Not exercised on this project.** It works precisely because the `supabase.co` redirect URI was
kept registered in Google rather than removed: deleting the custom domain hands the callback back
to `supabase.co`, and Google already has that URI on file, so no `redirect_uri_mismatch` follows
the rollback.

## Gaps in this note

Two facts named in the brief this note was written from were not filled in and are recorded here
as open rather than guessed:

- The **exact activation time** (with timezone) for `auth.tavnit.ai` on 2026-09-26 was not given.
  The date is founder-reported; the time is not recorded.
- Whether the **email-confirmation link** changed host after activation was not confirmed either
  way (tested vs. not tested). Not recorded as either; a future session should check the current
  confirmation-email template's link host if this becomes load-bearing.

## Related

- [[0006-google-oauth-is-in-scope-for-launch]] — the logo/brand-review rule this note
  leaves standing, and the redirect-URI/Search-Console chain Phase B would need
- [[0005-google-oauth-deferred]] — superseded, but the consent-screen constraints it
  first surfaced are the ones Phase B above would have to satisfy
- `docs/08-supabase-project-rebuild.md` §8B — Step 3's redirect URIs and the rebuild-ordering note
  this decision added
- [[../state-of-play]] — "External state", Supabase and Google OAuth lines
