---
type: decision
status: verified
verified: 2026-08-26
method: "founder decision stated in chat, 2026-08-26 session, while planning the new project's auth pass"
source: founder
---

# Google OAuth is deferred; Email is the only provider for launch

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
`login/login-form.tsx:63-74`, each sitting *above* the email form. With the provider off, clicking
one does **not** show the Hebrew fallback at `auth.ts:78`: `signInWithOAuth` performs no network
call, only `window.location.assign(...)`, so the browser leaves the app and Supabase returns the
user to the Site URL root with error params nothing reads — a silent dead end with the wizard
draft stranded in `localStorage`. **Whether to hide those buttons is a separate decision the
founder has not made yet**; it was surfaced on 2026-08-26 and deliberately left unimplemented.

Related: [[../defects/cli-created-user-blocks-that-email-from-ever-signing-up]] — the pre-flight
that any signup verification has to run first.
