---
type: decision
status: superseded
verified: 2026-08-26
method: "founder decision stated in chat, 2026-08-26 session, while planning the new project's auth pass"
source: founder
---

# Google OAuth is deferred; Email is the only provider for launch

> **SUPERSEDED 2026-08-26 by [[0006-google-oauth-is-in-scope-for-launch]]**, the same day and the
> same session. The founder reversed it: "Google: I want it working, not deferred." Kept verbatim
> because the _reasoning_ below is still the live constraint — the consent screen, the missing
> privacy/terms pages and Google's verification queue did not go away, they became work to do
> rather than a reason to skip. The "known consequence" section is also now resolved: the buttons
> are gated behind `GOOGLE_SIGN_IN_ENABLED`.
>
> **Two claims in this banner and in the body below have since been falsified** — the verification
> queue never applied to this app, and the privacy/terms pages now exist. Both are kept as written;
> see the 2026-09-11 amendment at the foot of this note.

Launch ships with **email + password only**. Google sign-in is not configured on the new project
and will not be before launch.

## Why

- **Google was never enabled on the old project either.** There is nothing to migrate, so this is
  not a rebuild gap — it would be a from-scratch build, and the old project's deletion does not
  depend on it. (This corrected an earlier working assumption in this same session that Google was
  live and was the last thing holding the old project open.)
- **Standing it up is not just an API key.** It needs a Google Cloud project, an OAuth consent
  screen with a privacy policy and terms URL on a verified domain, an OAuth client, and then
  **Google's own verification before external users can sign in at all**. Until the app is
  published and verified, only listed test users (max 100, 7-day sessions) can authenticate.
- **Email is a complete signup path on its own.** `apps/web/src/lib/auth.ts` implements
  `signUp`/`signIn` over `signInWithPassword` with full Hebrew error mapping, and the onboarding
  wizard persists the business through `/api/onboarding/complete` on either path. Nothing in the
  product requires Google.

## Revisitable at launch

This is a sequencing decision, not a rejection. The from-scratch procedure is written up in
`docs/08-supabase-project-rebuild.md` §8B so a future session does not have to rediscover the
consent-screen and verification requirements. Turning Google on later costs nothing already built:
`signInWithOAuth` is already wired (`auth.ts:69-85`) and `/auth/callback` already exchanges the
code.

## Known consequence, not yet decided

Both Google buttons still render unconditionally — `steps/step-signup.tsx:114-125` and
`login/login-form.tsx:63-74`, each sitting _above_ the email form. With the provider off, clicking
one does **not** show the Hebrew fallback at `auth.ts:229`: `signInWithOAuth` performs no network
call, only `window.location.assign(...)`, so the browser leaves the app and Supabase returns the
user to the Site URL root with error params nothing reads — a silent dead end with the wizard
draft stranded in `localStorage`. **Whether to hide those buttons is a separate decision the
founder has not made yet**; it was surfaced on 2026-08-26 and deliberately left unimplemented.

Related: [[../defects/cli-created-user-blocks-that-email-from-ever-signing-up]] — the pre-flight
that any signup verification has to run first.

## Amendment 2026-09-11 — the verification queue this note feared never applied

This note is `status: superseded` and its body and banner are kept verbatim, per CONVENTIONS'
falsification rule. Two of its claims are now known to be wrong; they are recorded here rather
than edited above.

- **There was never a verification review for this app.** `:29-30` ("**Google's own verification
  before external users can sign in at all**… only listed test users (max 100, 7-day sessions)")
  and the banner's "Google's verification queue" at `:14` both describe a queue that does not
  apply here: the app requests only `openid`, `email` and `profile`, all **non-sensitive**, and
  review queues apply to sensitive and restricted scopes. Established 2026-08-27, one day after
  this note was written ([[0006-google-oauth-is-in-scope-for-launch]] `:47-49`). Publishing moved
  the app to _In production_ on click, on **2026-09-03**.
- **The banner's "missing privacy/terms pages" are no longer missing** — both ship, at
  `apps/web/src/app/(legal)/privacy/` and `.../terms/`.

What this note was kept for still stands in shape: standing Google up was real work rather than
an API key. It was simply less work, and less waiting, than this note believed.
