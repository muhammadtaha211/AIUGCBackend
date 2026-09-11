---
type: decision
status: verified
verified: 2026-08-26
method: "founder decision stated in chat, 2026-08-26 session: 'Google: I want it working, not deferred. Set it up properly.'"
source: founder
supersedes: "[[0005-google-oauth-deferred]]"
---

# Google OAuth is in scope for launch, alongside Email

Google sign-in is being set up properly rather than deferred. Email + password stays as the
guaranteed path and is what launch is gated on; Google is the preferred path once Google's review
clears.

## What changed from [[0005-google-oauth-deferred]]

Nothing about the underlying constraints — they were correct and still hold. The consent screen,
the domain verification, the missing privacy and terms pages, and Google's verification queue are
all still required. The founder's call was that these are **work to schedule, not a reason to
skip**, made the same day 0005 was written.

## What this decision carries with it

- **Four sibling decisions taken in the same message**, all one concern ("nobody falls silently out
  of signup"): Confirm-email stays **OFF** for launch but the missing `emailRedirectTo` is fixed
  anyway so it is not a latent break; the `users`/`auth.users` collision is fixed by **guarding
  `ensureUser`**, explicitly not by touching the schema (no FK `ON UPDATE CASCADE`, nothing near
  `credit_ledger`); and the email **casing gap** is closed in the same commit as the guard.
- **A kill switch, not a hope.** `GOOGLE_SIGN_IN_ENABLED` in `apps/web/src/lib/auth.ts` gates both
  Google buttons and the `או` divider above the email form. It defaults to `true`. The founder's
  requirement was one switch to flip if review comes back badly — the resolution of the open
  sub-decision 0005 left dangling.
- **The reason the switch matters.** Until publishing status reads _In production_, an address not
  on the test-user list is refused by Google at the account chooser and returned with
  `error=access_denied`, which this app does not read — the user lands back on `/start` with no
  session and no message. See `docs/08-supabase-project-rebuild.md` §8B.

## Scope facts established while deciding

Corrected 2026-08-27 after checking what the code actually requests, which changes the
sequencing materially:

- The app requests **no custom OAuth scopes** — `auth.ts:71-74` passes `provider` and `redirectTo`
  only, so it gets Supabase's Google defaults: `openid`, `email`, `profile`. All three are
  **non-sensitive**.
- **There is therefore no verification review.** Review queues apply to sensitive and restricted
  scopes (Gmail, Drive, Calendar, Contacts). Publishing this app moves it to production on click.
  The earlier note in this file that verification meant "days, not minutes" was wrong.
- **One trap:** uploading a custom app **logo** triggers Google's brand review even with
  non-sensitive scopes. Leave it blank.
- **Testing mode needs no domain, no privacy policy and no terms** — Google sign-in works against
  `localhost` for up to 100 listed test users today. Those artefacts gate _publishing_, not use.
- `apps/web` has **no `/privacy` or `/terms` routes** and no such copy anywhere. Writing them, plus
  verifying `tavnit.ai` in Search Console, is what gates going public.
- **A Vercel preview URL cannot serve as the authorized domain**: preview hostnames change per
  deployment, and `vercel.app` is on the Public Suffix List. `tavnit.ai` must be live and verified.
  So the chain is tavnit.ai -> deploy -> Search Console -> Publish, and **none of it blocks using
  Google yourself.**

Full procedure: `docs/08-supabase-project-rebuild.md` §8B.

## Amendment 2026-09-01 — the kill switch stays `true` through the public-domain window

The planned flip of `GOOGLE_SIGN_IN_ENABLED` to `false` for the window between `tavnit.ai` going
live and the OAuth app publishing is **cancelled** (founder, in chat, 2026-09-01). Reasoning: the
site will not be advertised at all until Google sign-in works properly — so hiding the broken
button buys nothing, and the real consequence is that **publishing the OAuth app is now a hard
gate on ANY traffic**, not just on Google users. This overrides `docs/08-supabase-project-rebuild.md`
§8B's recommendation to keep the flag `false` for any public window. The constant is already
`true` in `apps/web/src/lib/auth.ts`; no code change — the decision is that it does not move.

## Amendment 2026-09-11 — the app is published, and two claims above have expired

Publishing status has read _In production_ since **2026-09-03**. The body above is kept as
written; this records what it no longer describes.

- **`:34-37` — "Until publishing status reads _In production_, an address not on the test-user
  list is refused…" no longer describes anything live.** The app is published, so no address is
  refused for being off the list. The bullet's second half was fixed independently on the same
  day: `/auth/callback` now reads `error` / `error_code` / `error_description` and sends the
  customer to `/login` with a Hebrew message, instead of dropping them on `/start` with no session
  and no message.
- **`:54-55` — "`apps/web` has **no `/privacy` or `/terms` routes**" is false.** Both ship, at
  `apps/web/src/app/(legal)/privacy/` and `.../terms/`. That gate is closed, and closing it is
  what made step 7 possible.
- `:52-53`'s Testing-mode facts remain historically accurate; they are simply no longer the mode
  this app is in.
- `:44` cites `auth.ts:71-74` for the scope-free `signInWithOAuth` call. The cite has drifted —
  the call is at `apps/web/src/lib/auth.ts:222` today. The claim it supports (no `scopes` key, so
  Google's `openid`/`email`/`profile` defaults, all non-sensitive) still holds.

Nothing here retracts the decision: Google was put in scope for launch and it shipped.
`docs/08-supabase-project-rebuild.md` §8B carries the published state.
