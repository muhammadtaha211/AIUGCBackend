---
type: decision
status: verified
verified: 2026-10-12
method: "Founder decisions 1–5 of §2 of the task prompt 'social posting PR 3 (schedule, sound picker, calendar, live posts), with the failure email' (2026-10-12), each given as 'Decided on 2026-10-12 … Not up for relitigation' with his reasons; the session's plan for them (where the email is sent from, the env name, the collapse rule, the daily ceiling, no migration) approved at Stop 1 the same day. MEASURED in the tree at feat/social-posting-schedule: packages/core/src/providers/resend.ts, packages/core/src/pipelines/social-failure-email.ts, packages/core/src/social-copy.ts, packages/core/src/config.ts (RESEND_API_KEY), apps/worker/src/index.ts (sweepFailureEmails), apps/web/src/app/page.tsx (the landing sentence); packages/core/test/social-failure-email.test.ts (21) and resend.test.ts (7), passing 2026-10-13 after PR 3's adversarial review. Resend's limits read on resend.com 2026-10-12: /pricing, /docs/knowledge-base/account-quotas-and-limits, /docs/api-reference/emails/send-email, /docs/api-reference/errors, /docs/api-reference/api-keys/create-api-key. Production app_config.retention_days read the same day by a SELECT-only probe (packages/core/.work/pr3-readonly-probe.ts): released_renders 90. No email sent, no env change, no migration, no deploy."
source: founder
---

# 0107 — PR 3's five changes: a quiet AI tick, a softer landing line, a failure email, the other defaults kept, a הוק + דמו first

Tags as in [[0101-tavnit-schedules-and-posts-to-instagram-and-tiktok]]: **FOUNDER-REPORTED** (his
ruling, statement or reasoning), **MEASURED** (read in the tree, on a live page, or run),
**REASONED** (inference from what is cited), **PLANNING DEFAULT**. All five decisions are
FOUNDER-REPORTED, 2026-10-12, not up for relitigation. They change 0101,
[[0102-social-posting-label-mix-switch-key-2026-10-11]] and
[[0061-landing-positioning-two-services-no-results-claims]], whose dated pointers lead here.

> **2026-10-16 — §3's cause gains the platform ([[0115-tiktok-inbox-posting-pr4]] §9, his OK):**
> a cause is (Tavnit account, platform, failure kind), so an email never names Instagram for a
> TikTok failure; the hide check asks the post's own platform's switch. The rest of §3 stands.

## 1. The AI tick is small, muted and unticked, last on the schedule step

**His reason:** it is the customer's decision and should not be in their face. 0102 §1 stands: the
label is the post's own tick, unticked by default on every service, and Instagram's
`is_ai_generated` is sent only when it is ticked (MEASURED, `providers/meta-graph.ts`
`createReelContainer`, pinned in `meta-graph.test.ts`). Any hint beside the tick is one muted line
at most, and mentions Instagram's labelling rule only after that rule is read on Meta's own page.

## 2. The landing line softens

`#proof`'s disclosure line keeps its first half (Tavnit's own account is marked as an AI character);
the half that said we ask this of everyone who publishes becomes a recommendation. **His reason:**
the same as 1. This lifts the landing hold for that one sentence only; Terms §6 is unchanged, and
the other legal pages stay held.

- Before: «החשבון מסומן כדמות AI, כמו שאנחנו מבקשים מכל מי שמפרסם עם תבנית.»
- After (DRAFT, his approval at PR review): «החשבון מסומן כדמות AI, ואנחנו ממליצים לכל מי שמפרסם
  עם תבנית לסמן גם את הסרטונים שלו כתוכן AI.»

## 3. A failed post also sends an email

**Replaces** 0101's planning default "failures are told in the app only (no email path exists)",
and answers 0101's OPEN "whether a failure email is ever built". **His reason:** the point of
scheduling is not opening the app, so an in-app notice alone could sit unseen for days.

**His terms:** to the Tavnit account's address, in Hebrew; which post, why in plain words, what to
do, with a link to the calendar; one cause sends one email, not one per post; a daily ceiling leaves
room for sign-up confirmations, which share the same Resend allowance; an email problem never fails,
delays or retries a post, and the in-app notice stays either way; sent through Resend, which already
carries the auth mail — **he asked for this use of Resend** (locked decision 10); with no key set,
nothing is sent and nothing breaks, as with `SENTRY_DSN`.

**The session's plan for it, approved at Stop 1 (MEASURED in the tree):**

- **Where:** a sweep on the worker every 60 s, beside the alert sweep
  (`apps/worker/src/index.ts` `sweepFailureEmails`, one tick at a time), with the logic in core
  (`pipelines/social-failure-email.ts`) and one wrapper for Resend (`providers/resend.ts`: plain
  `fetch` to `POST /emails`, 10 s timeout, the status and Resend's error name logged, never the
  address or the body). It is not part of `publish_post`, so posting cannot depend on it. The CLI's
  `work --once` and the web apps never run it.
- **Env:** `RESEND_API_KEY`, on the box only (`apps/worker/.env`) — his sending-only key. The sender
  is a constant, `תבנית <noreply@tavnit.ai>`, the auth mail's own (docs/08 §8A.2). No key, an empty
  key, `DRY_RUN`, or a `local`/`cli` worker against production → no call and no row.
- **The collapse rule:** a cause is (Tavnit account, `failure_kind`); at most one email per cause per
  24 h; a failure of the same cause inside the 24 h after an email is folded (never emailed, shown on
  the calendar and in the notice); a cause goes out once its newest failure is 2 minutes old; only
  failures from the last 24 h are ever emailed. REASONED consequence, put to him at Stop 1: an account
  that stays expired with a post failing a day sends one reminder a day.
- **The ceiling:** 20 failure emails per UTC day (Resend's own day), platform-wide — 80 of the free
  plan's 100 a day, and at least 2,380 of its 3,000 a month, left for the auth mail. Over it, a
  failure still under 24 h old goes out after 00:00 UTC, otherwise never. A `daily_quota_exceeded`
  pauses the sweep until 00:00 UTC; any other retryable refusal pauses it 5 minutes.
- **Never twice:** an `Idempotency-Key` from the cause and its oldest due post (Resend keeps it
  24 h), so the key holds while a burst grows; the log row after the send. A refusal of the message
  itself (400/422) is logged and never retried; a 401/403 is the account's (key or domain) — no row,
  an hour's pause. (The plan said "the newest post" and "a 4xx other than 429 is logged"; PR 3's
  review found both let a cause email twice or lose its email, and the build changed them.)
- **No migration:** the log is `events` rows of kind `post_failure_email` (actor = the account;
  payload: the failure kind, the post ids, the outcome — no address, no caption), served by the
  existing `events_kind_created_idx`; `scheduled_posts.failed_at` already exists. The kind is not an
  `ALERT_EVENT_KINDS` kind, so it never reaches Sentry. No `recordUsage`: the free plan costs nothing
  per email, and `usage_provider` is an enum.
- **A hidden account gets no email**: the sweep checks `getPostingAccess` per cause, so a switch
  narrowed after a post was scheduled leaves no trace.

**Resend, read on its own pages (MEASURED, 2026-10-12):** the free plan is "limited to 100 emails per
day", 3,000 a month; the day "is a UTC calendar day (00:00–24:00 UTC)"; `daily_quota_exceeded` and
`rate_limit_exceeded` are both 429; a `sending_access` key "Can only send emails" and can be held to
one domain; an idempotency key expires after 24 hours. Whether Supabase's SMTP sends count toward the
same daily figure is **not stated** on the quotas page; REASONED yes, since both go out through the
same Resend team.

## 4. The other six planning defaults stand

Put to him on 2026-10-12, none struck: hourly deferral for up to a day on a spent Instagram quota;
the 30-day horizon within the file's life; `share_to_feed` on; one calendar per Tavnit account; the
browser's time zone; cancelled posts hidden from the grid. MEASURED for the horizon: production's
`retention_days.released_renders` is 90, so a render's posts may be scheduled up to the earlier of
30 days ahead and 88 days after its release (`postingHorizon`, `HORIZON_RETENTION_MARGIN_DAYS` 2).

## 5. The first live post is a הוק + דמו with a sound

**His reason:** those files have no audio stream (MEASURED: `muted: true` on the steps render,
0061 §4), Meta's docs do not say such a file is accepted, and it is his main use. If Meta refuses
it, the session stops and reports; a silent audio track is its own task (0101).

## Reported by him the same day (FOUNDER-REPORTED, 2026-10-12)

- Resend is on the **free** plan — this corrects the earlier "paid plan" line in state-of-play's
  security-audit section. He will watch usage and upgrade if needed.
- He will create a second Resend key, for sending only, for the worker.
- He can now add Instagram accounts with no issue.

## Related

- [[auth-email-runs-through-resend]] — the auth mail's path and the 100-a-day ceiling this shares.
- [[0044-the-auth-email-alert-fires-on-hit-never-on-a-threshold]] — the auth mail's own alert.
- [[0037-the-worker-reports-to-sentry-the-web-apps-do-not]] — why the sweep lives on the worker only.
- [[resend-is-an-undisclosed-processor]] — the privacy page names Resend for the two auth emails
  only; the sentence on which emails Tavnit sends is owed, not edited (the legal pages stay held).
