---
type: defect
status: verified
verified: 2026-08-27
method: "repo-wide enumeration of every supabase `.auth.<method>` call site over **/*.{ts,tsx} (complete set: getUser, getSession, signUp, signInWithPassword, signInWithOAuth, signOut, exchangeCodeForSession — nothing else); full reads of apps/web/src/app/auth/callback/route.ts, apps/web/src/lib/auth.ts, apps/web/src/middleware.ts, both apps' login pages; full route-tree globs of apps/web and apps/admin. Run as 4 investigators + 4 adversarial verifiers (Hebrew UI strings, raw /auth/v1 fetches, dynamic dispatch all swept); every claim confirmed."
source: code
---

# Auth round-trips that miss `/auth/callback` die silently — password recovery is the third variation

Three flows depend on an email or OAuth round-trip landing back at `/auth/callback` — the **only**
route in the repo that exchanges a PKCE code (`apps/web/src/app/auth/callback/route.ts:15`). A
round-trip that misses it falls back to the Site URL root, where nothing listens: `/` is a static
marketing page that never reads `searchParams` (`apps/web/src/app/page.tsx`), `/home` reads only
cookies, and the middleware routes purely on session state (`apps/web/src/middleware.ts:34-44`).
GoTrue makes the fallback silent by design — a link with no explicit redirect, or a redirect not on
the allow-list, is delivered to the Site URL with no error
(`docs/08-supabase-project-rebuild.md:591`).

State of the three, verified 2026-08-27 at `7f95875`:

| Flow                | Redirects to `/auth/callback`?                             | Completes?                                    |
| ------------------- | ---------------------------------------------------------- | --------------------------------------------- |
| Signup confirmation | Yes — `emailRedirectTo`, `auth.ts:65` (fixed in `02f58bb`) | Yes (latent — confirm-email is OFF)           |
| Google OAuth        | Success: yes — `auth.ts:97`, in daily use. Error return: **no** — Site URL root with unread params ([[0006-google-oauth-is-in-scope-for-launch]]) | Success yes; error path is a silent dead end  |
| Password recovery   | ~~No sending call exists at all~~ **built 2026-08-27**, via its own `/auth/recovery` route (see Fixed below) | Yes — including the expired-link path         |

## Recovery, the variation that surfaced this

- `resetPasswordForEmail` is called **nowhere** — not in apps/web, apps/admin, apps/cli, or
  packages/. There is no forgot-password link on the login page
  (`apps/web/src/app/login/login-form.tsx`, read in full: Google button, email, password, submit).
  The only recovery email possible today is the **dashboard's**, and its link redirects to the Site
  URL root.
- Observed 2026-08-27 on the founder's account: with a live session, the middleware bounced
  `/` → `/home`, the `?code=` was never read by anything, never exchanged, and the one-time link
  reported `otp_expired` on reuse.
- Even a correctly-redirected recovery link could not complete: the callback has no recovery
  branch — it exchanges and unconditionally redirects to `/start` (`route.ts:18`) — and **no
  set-new-password page exists** (full route tree: `/`, `/login`, `/start`, `/home`,
  `/home/a/new`, `/home/b/new`, `/home/demos`, `/home/new-business`; `updateUser` is called
  nowhere in the repo).

So recovery was not a missing argument; it was a flow that was never built. Building it means four
pieces: a forgot-password link, a `resetPasswordForEmail(email, { redirectTo })` call, a
recovery-aware landing, and a set-new-password page calling `updateUser`.

## FIXED (recovery only) — 2026-08-27, same session

All four pieces built, in the same working set as this note's update:

- `requestPasswordReset` / `updatePassword` in `apps/web/src/lib/auth.ts`, house error mapping.
- `/forgot-password` — request form; also the landing for a failed link (`?error=expired`), so the
  failure message and the re-request form are one screen.
- `/auth/recovery` (`apps/web/src/app/auth/recovery/route.ts`) — a **separate** exchange route, not
  `/auth/callback?next=...`: a query-carrying redirect risks GoTrue's silent Site-URL fallback, the
  exact failure this note documents. Unlike the callback, it checks the exchange result.
- `/reset-password` — session-gated set-new-password form; without a session it shows the
  request-again path instead of a dead form.

Verified in the browser (dev server): `/auth/recovery` with no code lands on the expired message;
`/reset-password` without a session shows the request-again path; the request form's invalid and
valid submits both behave. **Config dependency:** `http://localhost:3000/auth/recovery` must be on
the redirect allow-list (`docs/08-supabase-project-rebuild.md` §1 and §8B step 5) — without it the
email link silently falls back to the Site URL, reproducing the original symptom.

An adversarial review of the diff (3 lenses + refutation pass, same session) confirmed one real
bug in the first cut: the default Reset Password email template links to GoTrue's verify endpoint,
which **spends the one-time token on a bare GET** — and mail-security link scanners on business
mailboxes (Safe Links, Proofpoint class) issue that GET before the user clicks, so recovery would
fail `otp_expired` on the first click, invisibly and on every retry, for scanned mailboxes.
Mitigation shipped in the same working set: `/reset-password?token_hash=…` verifies via
`verifyOtp` **on form submit only** (`verifyRecoveryToken` in `auth.ts`; scanners follow links,
they don't submit forms), activated by the template change in `docs/08` §1. This variant also
removes the same-browser PKCE constraint. The template edit went live the same day and the founder
ran a real end-to-end recovery through it (request → email → token_hash form → new password →
`/home`): **worked**. `/auth/recovery` stays for any reset email sent before the template change.

Still open from the pattern: the OAuth **error return** dead end, and `/auth/callback` still
discarding its exchange result (below).

## Aggravator at the door itself

The callback discards `exchangeCodeForSession`'s result and redirects to `/start` regardless
(`route.ts:13-18`) — a flow that *does* reach the callback still fails silently when the exchange
fails (expired link, reused code).

## Workaround taken instead

Founder-directed, 2026-08-27: set his password directly via the GoTrue admin API rather than
building recovery now. His account (created 2026-08-26 via Google) had provider `google` only and
no password — and `apps/admin` accepts **email+password only** (`apps/admin/src/lib/auth.ts:34`;
its own header comment: "no signup and no OAuth"), so without a password the admin console was
unreachable regardless of the web app's Google button. His `public.users.role` is already `admin`.

Related: [[0005-google-oauth-deferred]] first recorded the OAuth error-return dead end;
[[0006-google-oauth-is-in-scope-for-launch]] carries the kill switch and the `access_denied`
consequence.
