---
type: fact
status: carried
verified: 2026-09-11
method: "Founder-reported from the Supabase, Resend and Namecheap dashboards on 2026-09-11, plus one end-to-end signup he ran and described. NONE of it is observable from this repo — there is no API call, config file or env var here that reports SMTP settings, the sending domain, the provider plan or the Supabase rate limit. The two published plan limits (100/day, 3,000/month) are Resend's documented free tier, not a measurement. What IS repo-verified: apps/web/src/lib/auth.ts:78 passes emailRedirectTo, and the reachability table in docs/08 §8A.2 was derived by grep at 2828fd3."
source: founder
---

# Auth email runs through Resend, and the real ceiling is 100/day

**Confirm email is ON in production since 2026-09-11.** This is a live behaviour change for every new
signup: an account cannot be created unless an email is delivered. Before this date the
confirmation-ON onboarding path had **never** been exercised on this app.

The full configuration — SMTP fields, DNS records, and all five Hebrew templates verbatim — lives in
`docs/08-supabase-project-rebuild.md` **§8A.2**, which is the thing a rebuild reads. It is recorded
there rather than here because its job is reproduction, not reference. **The API key is in neither
place, by design.**

## The two ceilings, and the smaller one wins

| Limit                                   | Value                        |
| --------------------------------------- | ---------------------------- |
| Supabase → Authentication → Rate Limits | **100 emails / hour**        |
| Resend free tier                        | **100 / day**, 3,000 / month |

100/hour would permit 2,400/day. **The real ceiling on auth email is 100/day, at the provider** —
a future session must not read the Supabase number as available headroom.

**Failure mode, REASONED from the two published limits and not observed:** once the daily 100 is
spent, Resend refuses, the confirmation email stops arriving, and signups cannot complete. Nothing
alerts on it. It would present as "signups mysteriously stopped working" late in a busy day. **What
Supabase actually does with a provider rejection — surface an error, retry, or swallow it — has not
been checked**, so the shape of that failure is a prediction, not a description.

## What was proven, and how far it goes

One end-to-end signup on 2026-09-11 (founder-reported): signup refused immediate sign-in and showed
the Hebrew "we sent a confirmation email" line; the mail arrived; the link landed on `/start` and
middleware forwarded to `/home`.

That single transit proves **three** things at once, which is why it is worth recording precisely:
the PKCE exchange works, a session is created, and the account had a `businesses` row — the
middleware's `businesses` query is what forwards owners. It does **not** exercise the
zero-business path, a failed exchange, or any rate-limit behaviour.

## Region

Sending region is **Ireland (EU)**. That is not the same claim as "no US access" — Resend is a US
company. See [[resend-is-an-undisclosed-processor]]; the transfer basis is an open question for
counsel.

## Related

- [[resend-is-an-undisclosed-processor]] — Resend appears in no privacy disclosure.
- [[auth-round-trips-that-miss-the-callback-die-silently]] — the callback hardening this path relies on.
