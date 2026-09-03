---
type: decision
status: verified
verified: 2026-09-03
method: "founder decision in chat, 2026-09-03"
source: founder
---

# 0015 — A signed-in user with no business lands on `/home/new-business`

## The decision

A successful `/auth/callback` exchange sends the user to `/start`, and the middleware forwards a
signed-in user to
`/home` only if they already **own** a business (`apps/web/src/middleware.ts`, the RLS-scoped
`businesses` select). A signed-in user with **no** business therefore stayed on `/start`, on the
public wizard, with nothing on the screen saying they had an account. Measured 2026-09-03: a
Google account not on the test-user list signed in at `tavnit.ai`, ended on `/start` looking
signed out, and only `/home` → `/home/new-business` proved the session existed.

The founder's call: signed in **+** no business **+** no finished draft → redirect to
`/home/new-business`, the dashboard-chromed wizard that already exists for "הוסף עסק".

`OnboardingFlow`'s signup-mode hydration effect
(`apps/web/src/components/onboarding/onboarding-flow.tsx`) now resolves the user first and routes
on three cases:

| state                              | result                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| no user                            | render the wizard, unchanged                                                                 |
| user + draft at the final step     | post it, `replace("/home")` — unchanged; a failed post keeps them on `/start` with the error |
| user + no draft, or an earlier one | `replace("/home/new-business")` before `setHydrated`, so the wizard never flashes            |

The destination is not a new screen: `apps/web/src/app/home/page.tsx` already redirects a
business-less owner to `/home/new-business`, and `home/layout.tsx`'s own comment says the layout
wraps it precisely because "an empty list is the point".

## The alternative that was rejected

**A session-aware `/start` wizard that keeps partial drafts** — one that recognises the session,
says so in the UI, and lets the user carry on filling the same localStorage draft to the end.

Rejected for **simplicity**. It means a second completion path on the public wizard (signed-in but
not signing up), signed-in chrome on a page whose whole design is the signed-out scene, and a
draft that has to stay authoritative across a route that already has its own in-memory copy. The
redirect is four lines and reuses a wizard that is already built and already reachable.

## The trade-off accepted

**A partial draft can be dropped.** The `/home/new-business` wizard keeps its state **in memory
only** (`mode: "additional"` — no `saveDraft`), so:

- Someone who fills the public wizard part-way, then signs in through `/login` with an existing
  account, is now redirected past their own localStorage draft the next time they hit `/start`.
  The draft is not deleted — the redirect deliberately leaves localStorage alone — but the only
  thing that still reads it is `login-form.tsx`'s post-sign-in POST, and a **partial** draft fails
  that (`questionnaireSchema` requires all four fields, so the route 400s and the draft is neither
  saved nor cleared). In practice they re-answer the questions in the dashboard wizard.
- That wizard's answers do not survive a refresh, where the public one's did.

**This is wider than the password path**, and an earlier draft of this note got that wrong.
`OnboardingShell`'s sticky header carries a `התחברות` link to `/login` on **every** wizard step
(`apps/web/src/components/onboarding/onboarding-shell.tsx`), and `/login` has its own Google
button — so a visitor can leave at step 2, sign in with Google, return through `/auth/callback` to
`/start`, and be redirected past a half-filled draft. Only a round-trip started from the wizard's
own final step is guaranteed to come back finished.

The landing page compounds it by one question: `WhatChooser` writes a `step: 1` draft before
pushing `/start` (`apps/web/src/components/landing/what-chooser.tsx`), and the middleware leaves a
signed-in business-less visitor on `/`. So that visitor answers `מה מפרסמים?` on the landing page,
lands on `/home/new-business` at step 0, and is asked it again — the one thing that component's
own comment promises will not happen.

Accepted anyway: the alternative is the session-aware wizard rejected above, and every path here
ends with the questions being re-asked, not with an account or a business lost.

## The loop hazard this had to avoid

The redirect is decided on `auth.getUser()`, **not** `auth.getSession()`. `getSession()` reads the
local cookie without validating it, so a stale one would send the browser to `/home/new-business`,
whose server-side `getUser()` fails and redirects back to `/start`, which would decide the same
way again — an infinite loop. `getUser()` asks GoTrue, so the client and the server reach the same
verdict. It also costs nothing when signed out: with no session it returns
`AuthSessionMissingError` locally, with no network call
(`@supabase/auth-js` 2.110.6, `GoTrueClient._getUser`).

**And it stays out of the middleware**, where a route rule would otherwise belong. The
finished-draft case lives in `localStorage`, which only the client can read. A middleware redirect
on `/start` would fire before `OnboardingFlow` ever posts a finished draft, and would break the
main signup path — the one every real customer takes.

Related: [[auth-round-trips-that-miss-the-callback-die-silently]] (the sibling change in the same
working set — a failed Google round-trip now lands on `/login` with a message),
[[0006-google-oauth-is-in-scope-for-launch]].
