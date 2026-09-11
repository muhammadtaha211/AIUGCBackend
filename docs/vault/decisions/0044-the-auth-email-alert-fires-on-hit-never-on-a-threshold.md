---
type: decision
status: verified
verified: 2026-09-11
method: "Founder instruction in chat, 2026-09-11, verbatim in substance: he does NOT want a proactive threshold alarm and does NOT want the Resend subscription upgraded pre-emptively — he wants to meet the real ceiling and decide on real data. Built and read back at ba6a239+: the events kind and the queue are packages/core/src/alerts.ts:35, :107, :127, :171, the writer :78; the web route apps/web/src/app/api/auth-email-failed/route.ts:28; the predicate apps/web/src/lib/auth.ts:102, wired at :137; the reporter apps/worker/src/reporting.ts:93 and the sweep apps/worker/src/index.ts:60, started at :101. The GoTrue codes it keys on were read out of the INSTALLED @supabase/auth-js 2.110.6 ErrorCode union (node_modules/.pnpm/@supabase+auth-js@2.110.6/.../dist/main/lib/error-codes.d.ts), not from memory. Pinned by packages/core/test/alerts.test.ts (10) and apps/web/test/auth-email-failure.test.ts (10)."
source: founder
---

# 0044 — The auth-email alert fires on a hit, never on a threshold

Signup has depended on Resend since 2026-09-11, and the real ceiling is **100/day at the provider**
— not the 100/hour Supabase Rate Limit, which would permit 2,400
([[../facts/auth-email-runs-through-resend]]). When it is spent Resend refuses, `signUp` returns an
error, and an account **cannot be created**. Nothing told anyone.

## What the founder decided, and what he declined

**Decided:** build the fire-on-hit alert only.

**Declined, explicitly, both of them:**

- **No proactive threshold alarm.** No warning at 80, no usage meter, no quota forecast. He wants to
  meet the real ceiling and decide on real data.
- **No pre-emptive subscription upgrade.** Do not buy headroom for a limit nobody has reached.

That is a decision about what the data is worth, not an oversight to finish later. The failure mode
the free tier actually produces is still **REASONED, not observed** — it comes from two published
limits, and what Supabase does with a provider rejection has never been watched
([[../facts/auth-email-runs-through-resend]] says so in as many words). A threshold alarm built on
top of that would be a guess wrapped in an alert.

## The shape, and why each piece is where it is

```
apps/web  signUp fails  ->  classify  ->  POST /api/auth-email-failed  ->  events row
                                                                              |
apps/worker  sweep every 60s  ->  reportAlertEvent  ->  Sentry  ->  the founder's mail
```

**The web app writes a row; the worker reports it.** [[0037-the-worker-reports-to-sentry-the-web-apps-do-not]]
puts the Sentry SDK in `apps/worker` and nowhere else, and that boundary is load-bearing — `apps/web`
runs on Vercel. So the signup path cannot report anything itself, and the only process with a DSN
polls on its behalf. 0037 carries a dated amendment recording that this second path exists and that
`apps/web` still never loads the SDK.

**Migration 0037 is the marker that makes polling safe.** 0037's own options table rejected
"worker polls the table" precisely because it "needs a 'reported' marker (a migration) or re-reports
everything on restart". `events.notified_at` is that marker, with a partial index over the unnotified
rows of the alert kinds so the every-tick sweep stays an empty index scan on a table that only grows.

**The route is unauthenticated, and three things make that safe.** The failure IS "no account was
created", so there is no session to require. It stores nothing a caller supplies — one value from a
closed list of reason codes, and a 400 otherwise, so no address and no free text can survive into a
row. It is rate-limited **in the database** (`alerts.ts:78`, one guarded `INSERT … WHERE NOT EXISTS`
against the last 5 minutes), not in process memory, because a Vercel function has no shared state
between invocations and an in-process counter would reset on every cold start — which is to say it
would not be a guard. And it is fire-and-forget from the caller, so it can never fail a signup.

## What the predicate keys on, and how that was verified

Against the `ErrorCode` union in the **installed** `@supabase/auth-js` (2.110.6), read out of
`node_modules`, not from memory. **That union contains no email-send-specific member at all** — it
carries `sms_send_failed` and no email twin — so an SMTP refusal has nowhere to land but the 500
catch-all:

| code                         | classified | why                                                                    |
| ---------------------------- | ---------- | ---------------------------------------------------------------------- |
| `unexpected_failure`, 5xx    | **yes**    | GoTrue's 500 catch-all; the only place a failed SMTP send can surface  |
| `over_email_send_rate_limit` | **yes**    | GoTrue refused to hand the mail to SMTP; same outcome for the customer |
| everything else              | no         | keeps its existing Hebrew — see below                                  |

**The negative direction is the half that matters**, and it is pinned test-by-test:
`user_already_exists`, `email_exists`, `weak_password`, `validation_failed`,
`email_address_invalid`, `signup_disabled`, `email_provider_disabled`, `over_request_rate_limit`,
`captcha_failed` and the rest all keep their own message. Reading a duplicate address as the ceiling
would tell that customer to use Google and would wake the founder for it.

**The known over-reach, accepted:** `unexpected_failure` is broad. A Supabase-side fault unrelated
to mail would also match. That is still "signup is broken", which is the thing worth being told, and
narrowing it further would mean matching on GoTrue's English message text — the exact
remembered-string guess this note refused to make.

## Rejected

| option                                                     | verdict                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Add Sentry to `apps/web` and report from the signup path   | rejected — that is 0037 and it is the founder's decision, not an oversight to finish                                            |
| Threshold alarm at 80% of 100/day                          | rejected by the founder, above                                                                                                  |
| Poll the Resend API for remaining quota                    | rejected — a paid third-party call on a schedule, for a number whose failure mode we have not observed; also locked decision 10 |
| Match GoTrue's English message text to narrow the classify | rejected — unverifiable from this repo, and exactly the remembered-string failure the brief warned against                      |
| In-process rate limit on the route                         | rejected — Vercel functions share no state; it would reset on every cold start                                                  |
| Report the row from `packages/core`                        | rejected — core is bundled into the Vercel apps; the SDK must not be reachable from there (0037)                                |

## What this does not do

It makes the ceiling **visible**, not survivable. A signup that hits it still fails; the customer is
told the confirmation email could not be sent and pointed at Google sign-in, which bypasses Resend
entirely and is the majority path anyway. Nothing retries the send, nothing queues the account, and
nothing raises the limit.

## Related

- [[../facts/auth-email-runs-through-resend]] — the two ceilings, and that the failure mode is reasoned.
- [[0037-the-worker-reports-to-sentry-the-web-apps-do-not]] — the boundary, and its amendment.
- [[../defects/resend-is-an-undisclosed-processor]] — the disclosure closed the same day.
