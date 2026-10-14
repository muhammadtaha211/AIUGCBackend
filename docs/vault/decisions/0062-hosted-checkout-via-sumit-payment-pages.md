---
type: decision
status: verified
verified: 2026-09-21
method: "Founder brief 2026-09-21 (hosted checkout via Sumit payment pages, the checkout dialog replaced by a page, a checkout_intents table, the unconfirmed-charge rule, DryRunGateway refused on production) built on branch feat/sumit-checkout and measured end to end against the founder's TEST Sumit business the same day: two payment-page purchases from the in-app browser with Sumit's published test cards (one declined 003, one approved 000), then /billing/payments/get/, /billing/paymentmethods/getforcustomer/, /billing/paymentmethods/setforcustomer/ and /accounting/documents/getdetails/ called with the Credentials body — see facts/sumit-payment-page-saves-the-card.md for every response. Request/response schemas read from the public OpenAPI spec at https://app.sumit.co.il/swagger/v1/swagger.json ('SUMIT API - Full', openapi 3.1.1, 84 paths, fetched 2026-09-21) — NOT from the login-walled developers page. Code: packages/core/src/gateways/sumit.ts, packages/core/src/pipelines/checkout.ts, supabase/migrations/0048_checkout_intents.sql, apps/web/src/app/api/account/checkout/route.ts, apps/web/src/app/api/billing/sumit/return/route.ts, apps/web/src/app/home/plan/checkout/. Pinned by packages/core/test/checkout.test.ts (PGlite, 16 cases), sumit-gateway.test.ts (mocked fetch, 21), migrations.test.ts (0048), apps/web/test/sumit-return-route.test.ts (10), account-routes.test.ts (16), billing-lib.test.ts (9). Reviewed the same day by a 16-agent adversarial pass (the pre-charge look, the session binding, the 409 and the refused landing come from its findings) and re-measured for the list window (facts/sumit-payments-list-honours-utc-offsets). Amended 2026-09-21 from a second founder brief the same day, after a real 150 shekel payment on the real organisation landed on ?checkout=failed because Vercel's credentials were malformed (defects/sumit-return-failure-invited-a-second-payment.md): the failure landing splits in two and the return route gains a gateway_events record. Code: apps/web/src/app/api/billing/sumit/return/route.ts, recordUnconfirmedCheckoutReturn in packages/core/src/pipelines/checkout.ts, apps/web/src/lib/billing.ts (sumitPaymentIdParam, sumitReturnPath), apps/web/src/lib/plans-ui.ts (CHECKOUT_UNCONFIRMED_LINE, parseCheckoutParam), apps/web/src/app/home/plan/. The test counts above move with it: apps/web/test/sumit-return-route.test.ts (16), checkout.test.ts (19), billing-lib.test.ts (12), plans-ui.test.ts (24)."
source: founder + code + browser
---

# 0062 — Checkout is a hosted Sumit payment page, entered from a page of ours, bound by an intent row

## The decision

**The first charge happens on Sumit's own payment page** (דף תשלום), one fixed-price product per
plan, reached by a URL we build. Not `/billing/payments/beginredirect/`, not the Payments
JavaScript API, not a card form of ours. The card is saved on the Sumit customer that page
creates, and every later charge — renewal, prorated upgrade — is `/billing/payments/charge/` on
that customer's saved default card through `SumitGateway`, the `BillingGateway` adapter
([[0054-payment-stack-is-sumit-via-upay]]; renewal scheduling stays ours, 0046 §4).

**The purchase is a page, not a popup** — founder decision 2026-09-21. `/home/plan/checkout?plan=<code>`
is an order summary: price, credits, "החיוב הראשון היום, הבא ב־<date>", the auto-renewal line,
the VAT footnote, the required terms checkbox exactly as the dialog carried it
([[0056-the-purchase-step-takes-an-active-terms-checkbox]]), and one button. The plan cards'
"בחירת המסלול" and "חידוש המנוי" link to it; `/home/plan?plan=<code>` (the /pricing and signup
hand-off) redirects to it. The upgrade, downgrade, cancel and undo dialogs are untouched.

**A `checkout_intents` row is written before the browser leaves, and the return binds on it.**
Migration 0048: `user_id`, `plan_code`, `price_agorot` snapshotted at creation, `status`
(`pending | completed | expired`), `sumit_payment_id` UNIQUE, `sumit_customer_id`,
`terms_acceptance_id`, timestamps; index `(user_id, status)`; 0046's server-only RLS. The
intent id travels to Sumit as `externalidentifier` and comes back as `og-externalidentifier`.

## Why the intent table exists

The browser comes back to `/api/billing/sumit/return` with five plain-text query parameters and
no signature. Nothing on that URL can be trusted. So the activation rests on three things that
are ours: **the intent** — which account, which plan, at which price, written by an
authenticated request; **the session** — only the intent's own account may complete it (a
foreign session is a 403; no session completes nothing and goes through `/login` with the
return URL itself as `next`, so signing in finishes the payment); and **a server-to-server read
of the payment** (`/billing/payments/get/`) that must agree with the intent: `ValidPayment`
true, `Amount` equal to the intent's `price_agorot`, `CustomerID` equal to `og-customerid`, and
— measured — the payment's own `ExternalIdentifier` equal to the intent id. A price edited in
`plans` mid-checkout, a tampered amount, someone else's payment id, or a payment id from a
different intent all fail one of those four and change nothing. The session requirement is what
stops whoever's browser hits the URL from binding whatever Sumit customer paid to the intent's
account — a stranger's card as the recurring ref, or a stranger's account on the customer's
card (review finding 2026-09-21). Its cost: a browser that lost its cookies between leaving and
returning and then signs in with Google lands on `/home` instead of the return URL; the intent
stays pending with the payment beside it at Sumit.

The same row is the idempotency key for the return leg: it is locked `FOR UPDATE`. A completed
intent hit again with the **same** payment id is a reloaded return URL and returns its existing
outcome; with a **different** payment id it is money taken twice (two tabs on one reused intent,
both paid) and is refused loudly — nothing is activated twice, and the second payment is on
record for a refund. An **expired** intent is still completable: expiry only stops the row being
reused by a new click, while the Sumit page carrying the id stays payable as long as the
customer keeps it open, and refusing that payment would take the money and activate nothing.
`sumit_payment_id` is UNIQUE so one payment completes one intent. The row also answers queue
item 12 — a second click on the same plan within 30 minutes reuses the pending intent instead
of writing another `terms_acceptances` row; pending intents older than 24 h are expired lazily
on the next create. And `createCheckoutIntent` refuses an account whose subscription is live and
not suspended before writing anything (`POST /api/account/checkout` → 409): a payment-page URL
handed to such an account would take money the return leg could never activate on.

## What the measurement changed

Two things the brief could not know and the walkthrough did
([[../facts/sumit-payment-page-saves-the-card]]):

1. **The saved default card can be the wrong card.** A card tried first and declined stays the
   customer's default; the card that then paid is tokenised but not made the default. A renewal
   against that default would hit the declined card. `completeCheckout` therefore compares the
   default's token to the paying card's and, when they differ, calls
   `/billing/paymentmethods/setforcustomer/` with the paying card's token **and expiry** (the
   token alone is refused, the method id alone answers TechnicalError). A failure there is logged
   and does not block the activation — the customer paid, and a renewal that fails into dunning
   is recoverable where a refused activation after a successful payment is not.
2. **The return keys are mixed case** (`OG-CustomerID`, not the article's `og-customerid`), so
   the route matches them case-insensitively.

## The unconfirmed-charge rule (renewals and upgrades)

`/billing/payments/charge/` has **no merchant reference** (read from the spec: the request
carries `Customer`, `Items`, document flags and nothing of ours; `Payment.ExternalIdentifier`
on the response is only ever set by the page or beginredirect, and a listed payment carries no
description, item or reference either). So a charge whose answer is lost — a 30-second timeout,
a 5xx, a `Status 2`, a `Status 0` with no `Payment` in it — cannot be looked up by our id.
`SumitGateway` then looks for it through `/billing/payments/list/` three times over ~20 seconds
(at 0, 5 and 15 s — a client-side abort cuts the socket while Sumit is still authorising, and
the payment reaches the list seconds later): **this customer, exactly this amount, valid, an
API charge (no `ExternalIdentifier` — payment-page payments carry an intent id), dated no
earlier than two minutes before the attempt began** (clock skew, nothing more). Found → `ok`
with its id; not found → `ok: false, error: "unconfirmed"` → `past_due`, and dunning retries on
its configured days. A clear decline (`Status 0`, `ValidPayment false`, code "003") is answered
as a decline under Sumit's own payment id; a business refusal (`Status 1`) is Sumit's message
under `sumit_refused_<attempt>`; neither reads the list. The list window is sent as ISO-8601 Z
and Sumit honours the offset ([[../facts/sumit-payments-list-honours-utc-offsets]]).

**The look is narrow on purpose, and there is no look before charging.** The review of
2026-09-21 first found the reconcile too eager (it ran the moment a 15-second abort fired, and
a dunning retry never reconciled at all — a slow success would be charged again), and the first
fix — a seven-day look BEFORE every charge for a same-amount payment — was itself refuted: with
nothing on a Sumit payment that names our attempt, "same customer, same amount" is the whole
match, and on the 0043 ladder a day-0 upgrade starter → pro is ₪150 exactly like the starter
renewal an hour earlier. That look would have counted the renewal as the upgrade's own payment
and granted every such upgrade for nothing, silently. So the rule errs the other way: a charge
Sumit completes but does not list within ~50 seconds is reported unconfirmed, goes to dunning,
and the retry charges again — a second receipt in the customer's inbox and in the founder's
Sumit list, visible and refundable. That residual is accepted and stated in the gateway's
header; a per-attempt reference on the charge (which the spec does not offer) is what would
close it.

## What else the decision fixed

- **`getBillingGateway()` refuses `DryRunGateway` against the production database** (queue item
  13). Every local `.env` sets `DRY_RUN=1` while pointing at the one project that holds real
  data; a dry-run "charge" there granted real credits for no money. The predicate is the same
  `isProductionDatabaseUrl` the job claim uses. `SUMIT_COMPANY_ID` + `SUMIT_API_KEY` without
  `DRY_RUN` → `SumitGateway`; neither → `NotConfiguredGateway` and the 503, as before.
- **The renewal description is `תבנית — מסלול <name>, חידוש חודשי`** and the upgrade's
  `תבנית — מסלול <name>, שדרוג` (queue item 11); both are the document line on the receipt.
- **Charges are sent `VATIncluded: true`** so the customer is charged exactly the agorot the
  state machine asked for, whatever the organisation's VAT setting — today עוסק פטור prints VAT 0
  ([[0046-billing-ships-as-osek-patur]]); at conversion the caller passes the gross amount.
- **A refusal after a verified payment is on record and says so.** Every verification refusal
  raised after `/billing/payments/get/` confirmed a valid payment — a price that no longer
  matches, another customer or intent id on the payment, no saved card, an account that went
  live in between, a second payment on a completed intent — writes a `gateway_events` row
  `checkout_refused` under `sumit_refused_<payment id>` (intent, reason, amount, document)
  outside the rolled-back transaction, and lands the browser on `/home/plan?checkout=refused`,
  whose line says the payment was received and NOT to pay again. Refusals with nothing verified
  to have moved (an unknown intent, a payment Sumit does not know, an invalid one) land on
  `?checkout=failed` ("try again") as before.
  _(Amended on this last sentence only, 2026-09-21: of those three, only an INVALID payment
  still lands on `?checkout=failed`. See the amendment at the end of this note. Everything
  else in this bullet — the `checkout_refused` row, its `sumit_refused_<payment id>` key and
  the refused landing — stands.)_
- **Bit is excluded** — Sumit does not return the og-* parameters for a Bit payment, so a Bit
  purchase could never complete an intent. The founder keeps Bit off on the pages.
- **Which Sumit organisation** (the test business or the real one) is decided by the env values
  alone: `SUMIT_COMPANY_ID`, `SUMIT_API_KEY`, `SUMIT_CHECKOUT_PAGES` (JSON, plan code → the
  product's payment-page URL). Nothing in code knows the difference.

## Options considered

- **`/billing/payments/beginredirect/`** — a hosted page created per purchase by API, with
  `RedirectURL` and `ExternalIdentifier` in the request. Rejected for now: it needs an
  authenticated API call before every purchase and returns `OG-CustomerID`/`OG-PaymentID` the
  same way; the founder's pages already exist per product and carry the fixed price, and the
  saved-card behaviour is the same mechanism. The brief named it as the fallback if the page did
  not save a card; it did.
- **The Payments JavaScript API** (`payments.js`, `SingleUseToken`) — a card form of ours.
  Rejected: terms §8 promises card data never touches us, and PCI scope would follow.
- **Sumit-run recurring** (`/billing/recurring/*`) — rejected by 0046 §4 and 0054; the state
  machine is ours.
- **Keeping the checkout in the dialog** — rejected by the founder: no payment from a popup.
- **A signed return URL instead of an intent table** — not available; Sumit signs nothing on the
  redirect. The intent is what a signature would have been, plus a price snapshot.

## Deliberately not done

- **No `requires_new_card` state** (queue item 10, still deferred). A default card that stops
  working ends in `suspended` via dunning; the customer's way back is the checkout page, which
  reactivates the suspended subscription in place with the new customer id.
- **No refund path.** `/accounting/documents/cancel/` exists (DocumentID + Description) but
  what it does to the money is UNVERIFIED; refunds go through Sumit's UI at launch.
- **No webhooks** (Growth plan). The return leg plus payments/get is the callback.
- **No `vat_rate` config yet** (0046 §6) — `VATIncluded: true` makes the eventual change a
  caller-side multiplication, not an adapter change.

## Amended 2026-09-21 (founder, in chat, after the first real purchase) — a failure to VERIFY is not a decline

The bullet above split refusals two ways: money moved (`?checkout=refused`) or nothing did
(`?checkout=failed`). A real 150 shekel payment on the real organisation found the third case
the same day. Sumit's page took the card and redirected; `/billing/payments/get/` then threw
`SumitApiError` because Vercel's `SUMIT_COMPANY_ID` / `SUMIT_API_KEY` were malformed; the
generic catch landed on `?checkout=failed` — **"התשלום לא הושלם. אפשר לנסות שוב."** — with the
payment sitting at Sumit, and wrote nothing. Replaying the same return URL after the env was
fixed completed the intent normally. Measured in full at
[[../defects/sumit-return-failure-invited-a-second-payment]].

**The rule now.** After the session and intent-ownership checks pass, `?checkout=failed` is
reachable **only** when Sumit positively answered that this payment is not valid — reason
`payment_invalid`, `ValidPayment: false`. Every other failure lands on a fourth value,
`?checkout=unconfirmed`: payment received, being confirmed, do not pay again. That covers any
`SumitApiError` of any kind, a database error, an unexpected throw, and — the non-obvious one
— `payment_not_found`, which a wrong key or the wrong organisation answers for a payment that
genuinely exists.

**Why a third value and not `refused`.** They differ in what the founder must do. `refused` is
a verdict: Sumit answered, the payment is good, we declined to activate on it, and the row
that says so is written by `completeCheckout` itself under `sumit_refused_<payment id>`.
`unconfirmed` is the absence of a verdict: nobody knows yet whether that payment is ours to
activate on. The first is settled by refunding or activating by hand; the second is settled by
fixing the cause and replaying the return URL, which is what actually worked.

**Why the default flips to reassurance.** [[../facts/sumit-payment-page-saves-the-card]]
measured that the page redirects to the return URL only after a payment it accepted — the
declined attempt re-rendered and never redirected. So a browser holding an `OG-PaymentID` has
almost certainly paid, and "try again" is the one thing that must not be said on a guess.
Before the ownership check has run — malformed parameters, an unknown intent — only the LINE
changes: a non-empty `OG-PaymentID` of any casing lands on `?checkout=unconfirmed`, without
one it lands on `?checkout=failed`, and **nothing is written** either way, because those
requests have proved nothing about who is asking. No session still goes through `/login`
exactly as before.

**The record.** A new exported core function, `recordUnconfirmedCheckoutReturn`, writes a
`gateway_events` row beside the `checkout_refused` write — gateway `sumit`,
`sumit_unconfirmed_<payment id>`, kind `checkout_unconfirmed`, payload `{ intentId,
sumitPaymentId, sumitCustomerId, reason, detail, returnPath }`, `onConflictDoNothing` on the
id, `processed_at` left null. `completeCheckout` itself is unchanged: this is the ROUTE's
record of a return it could not finish, not a verification verdict, and the route calls it
from its own catch. It is best-effort — a failure to record is logged and never changes the
landing, and when the failure IS the database the write fails with it, which is why every
failure log line now carries the intent, payment and customer ids and the replayable return
path (og-* parameters only). **Resolved** is not a column: an unconfirmed row is resolved when
a `checkout_charge` row exists under the same payment id. The query is in
[`docs/05-billing.md`](../../05-billing.md).

`gateway_events.kind` is plain `text` with no CHECK and no enum, and nothing in the tree
enumerates kinds, so **no migration was needed** (measured across all 49 files in
`supabase/migrations/` and `packages/core/src/db/schema.ts`).

**What this did not touch**: `completeCheckout`'s verification order and its success and replay
paths, `checkout_refused`, `POST /api/account/checkout`, the gateway and renewals, the Sumit
client, pricing and plans. **And what it did not fix**: nothing validates the shape of
`SUMIT_COMPANY_ID` / `SUMIT_API_KEY` at boot or at first use, so the same misconfiguration
still breaks every checkout — it just fails politely now. No automatic retry was built.

**Not merged, not deployed** when this was written: branch `fix/sumit-return-unconfirmed`. The
Hebrew line for the new landing is marked COPY PENDING FOUNDER REVIEW in
`apps/web/src/lib/plans-ui.ts`. _(Merged 2026-09-22 as PR #53, `0cca4fa`. It is an ancestor of
`origin/main` `d57b60a`, MEASURED 2026-10-01. Serving on Vercel production is founder-reported,
2026-10-01.)_

## Related

- [[../defects/sumit-return-failure-invited-a-second-payment]] — the incident that amended this
  note, and what the fix leaves open
- [`docs/05-billing.md`](../../05-billing.md) §"Hosted checkout" — amended in the same commit
- [[0054-payment-stack-is-sumit-via-upay]] — the vendor; its UNVERIFIED list is closed here
- [[0056-the-purchase-step-takes-an-active-terms-checkbox]] — the checkbox the page keeps
- [[0052-upgrade-credits-are-period-credits]], [[0053-downgrades-are-scheduled-not-applied]] —
  the dialogs this leaves alone
- [[../facts/sumit-payment-page-saves-the-card]] — what was measured
- [[../facts/sumit-payments-list-honours-utc-offsets]] — the reconcile window's timestamps
- [[../facts/sumit-test-org-configuration]] — the organisation it was measured on

_(Pointer 2026-10-14, the ₪5 intro offer: a second kind of intent rides this checkout —
`checkout_intents.kind = 'intro'`, no plan, 500 agorot — through the same return route and the
same server-to-server verification (except that an intro needs no saved card), on its own page
(`SUMIT_INTRO_PAGE`). Its "continue" charges the card this note's page saved through
`/billing/payments/charge/` at the customer's click, writing the attempt before the charge, and a
lost answer there is settled later by a narrow list look that is safe for a trial-only customer
(nothing else charges it while the attempt is open) — unlike this note's renewals. The unconfirmed-returns query now also resolves
on `intro_charge`. [[0109-a-five-shekel-intro-offer]].)_
