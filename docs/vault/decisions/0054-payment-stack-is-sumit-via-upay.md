---
type: decision
status: verified
verified: 2026-09-17
method: "Founder statements in chat, 2026-09-17, in two steps. First: the vendor is UPay, capabilities unverified. Then a correction the same day, which this note records: the payment stack is Sumit (API layer + documents) running on Upay (acquirer/מאגד); our code calls Sumit's API and never Upay; 0046 §4 (a)–(d) are closed at CAPABILITY level from Sumit's help articles, which the founder read and this session did NOT re-fetch; request/response schemas, the refund endpoint and the idempotency key are UNVERIFIED; the docs/05 table cell calling Grow's recurring 'hosted pages' was wrong; Morning's clearing runs on Grow; Sumit's own /billing/recurring/* is not used by design. Built as supabase/migrations/0044_plans_hebrew_names_sumit.sql (gateway default 'grow' → 'sumit', written before any apply — the before-read on production still showed 'grow') and 0046 (terms_acceptances), recordTermsAcceptance in packages/core/src/pipelines/billing.ts, POST /api/account/checkout in apps/web. Checked in the same pass: getBillingGateway still returns NotConfiguredGateway outside DRY_RUN, no file under packages/core/src/providers names Sumit or Upay, and no code path charges except through BillingGateway.chargeRecurring. docs/legal-review.md row T1 was read to confirm what is being reversed. 0044 and 0046 were APPLIED TO PRODUCTION 2026-09-17 (with 0045 and 0047, one push) on the founder's explicit instruction for that one push, after `migration list` + `db push --dry-run`; 0044 is guarded so it was read at both ends through packages/core/.work/readback-0044-0047.ts — BEFORE 'Pro'/'Starter'/'Studio' with all three guards matching and gateway default 'grow'::text, AFTER 'מתקדם'/'התחלה'/'פרימיום' and 'sumit'::text; terms_acceptances after-read: 7 columns, RLS on, 0 policies, [terms_acceptances_pkey, terms_acceptances_user_idx], the users FK, 0 rows. Ledger 48 rows 0000-0047, recorded by db push itself, tenth time with no repair. Proof: scripts/verify-migration-ledger.sql §RESULTS."
source: founder + code
---

# 0054 — The payment stack is Sumit via Upay; (a)–(d) closed at capability level, schemas unverified

Tags: **[M]** = measured or read from a source by a named person; **[R]** = reasoned;
**UNVERIFIED** = nobody has looked.

## The decision

**Payment stack = Sumit via Upay.** Founder decision, 2026-09-17, in chat.

- **Sumit** is the API layer and the documents vendor. **Our code calls Sumit's API, never Upay.**
  So the name a subscription carries is `sumit` (`subscriptions.gateway` default, migration 0044).
- **Upay** (יופיי פיננסים בע"מ, ח.פ. 514672575) is the acquirer (מאגד) behind it. Company details
  as the founder gave them in chat; not checked against a registry.

An earlier statement the same day named UPay as "the gateway" with its capabilities unverified.
That was superseded within the session, before anything was applied or committed; the migration
was written with `'sumit'` and the production before-read still showed `'grow'`, so no fix-up
migration is owed.

## 0046 §4, requirement by requirement

[[0046-billing-ships-as-osek-patur]] §4 set four hard requirements. **All four are closed at
CAPABILITY level from Sumit's help articles** — **[M] founder-read, 2026-09-17; this session did
not re-fetch the articles**, so what is recorded is the founder's reading, not a second one.

| #   | requirement                                          | how Sumit meets it                                                                                                        |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| a   | hosted page returning a reusable token               | hosted first charge: `/billing/payments/beginredirect/` — the card is saved on that first charge [M]                      |
| b   | API-initiated charge on that token, arbitrary amount | `/billing/payments/charge/` on the saved card; **auto-issues the document** [M]                                           |
| c   | signed callbacks with a unique event id              | webhooks via `/triggers/triggers/subscribe/` — **need the Growth plan**; otherwise **poll** `/billing/payments/list/` [M] |
| d   | sandbox with test cards                              | a free test company, separate from the real org [M]                                                                       |

**[R]** (c) is the soft one: below the Growth plan there are no callbacks, and "poll the payments
list" is a different mechanism from "signed callbacks with a unique event id". `gateway_events`'
idempotency on `gateway_event_id` still works with a polled payment id, so the design holds
either way; which one is used is the adapter task's decision, not this note's.

**(b) closes the question 0046 §5 left open** — an upgrade charges an arbitrary difference
mid-period ([[0052-upgrade-credits-are-period-credits]]), and `/billing/payments/charge/` is an
arbitrary-amount charge on a saved card. Its auto-issued document is also what 0046 §1 needs (קבלה
per successful charge) without document code on our side.

**Sumit's own `/billing/recurring/*` is NOT used, by design.** Renewal scheduling stays ours —
`processDueRenewals` on the worker — which is the principle `docs/05-billing.md` opens with and
the option 0046 chose. A Sumit-run recurring would make the state machine dead code and leave two
sources of truth for period bounds. [R]

## UNVERIFIED, listed

- Request and response **schemas** of every endpoint above.
- The **refund endpoint** (needed for the failed-render refund path only if money ever moves at
  charge time, which it does not today — refunds are ledger rows).
- The **idempotency key**: whether `/billing/payments/charge/` accepts one, and what it is.
- Whether the sandbox company can exercise webhooks without the Growth plan.

## Corrections this note carries

- **`docs/05-billing.md`'s comparison table said Grow's recurring was "hosted pages"** and raised
  it as a doubt against (b). **Wrong — Grow does support API token charges** (founder, 2026-09-17).
  The cell is corrected in the same commit; 0046 §5's "note against (4b)" is left as the
  historical question it was.
- **Morning's (ex-Green Invoice) own clearing runs on Grow.** Recorded in the table so the Grow
  fallback and the Morning documents option are understood as one stack, not two.

## Terms acceptance at purchase: checkbox + stored record

The card company behind the stack requires that the customer actively accept the terms at
purchase and that the acceptance be recorded. So `POST /api/account/checkout` refuses any body
without `acceptedTerms: true` (a 400) and writes a `terms_acceptances` row (migration 0046) —
user, the terms page's dated version string (`UPDATED` in `apps/web/src/app/(legal)/legal.tsx`,
`11.09.2026` at the time of writing), `'checkout'`, the first hop of `x-forwarded-for`, the user
agent — before answering **503 `התשלום המקוון יופעל בקרוב.`** The record is real; the payment is
not yet. Checkout is a deliberate dead end until the adapter exists.

This **reverses `docs/legal-review.md` row T1 for the purchase step only**. T1 records that the
site takes acceptance by use — "no checkbox and no acceptance record" at signup and login — and
asks counsel whether that forms the contract. Signup and login are unchanged. [R], not
counsel-confirmed: the reversal is driven by the card company's requirement, not by an answer to
T1.

## What deliberately does not exist yet

- **No Sumit adapter.** `getBillingGateway()` returns `NotConfiguredGateway` outside `DRY_RUN`, so
  production throws on any real charge attempt and the web tier maps that to the 503 above.
- **No `requires_new_card` state.** A saved card that stops working needs a state the
  subscription machine does not have; it is queued for the adapter task and was explicitly kept
  out of this one (founder, 2026-09-17).
- **No change to charge descriptions or `gateway_events` kinds.** `recurring_charge_*` and
  `plan_change_charge_*` are as this branch defined them.

## Related

- [[0050-subscriptions-are-keyed-on-the-account]] — said the `'grow'` default was deliberately
  kept; superseded on that one point by migration 0044, and marked so in place
- [[0046-billing-ships-as-osek-patur]] — the four requirements; the documents vendor is now
  Sumit by this decision
- [[0052-upgrade-credits-are-period-credits]] — the mid-period charge that needs (b)
- [[0053-downgrades-are-scheduled-not-applied]] — the same ruling's other half
- [`docs/05-billing.md`](../../05-billing.md) §"Gateway choice" — amended in the same commit
