---
type: fact
status: verified
verified: 2026-09-21
method: "The database half was READ BACK from production the same day, read-only, with the connection string taken out of the repo-root .env inside the script and never printed: packages/core/.work/go-live-readback.ts and go-live-account-check.ts (gitignored), run with apps/cli/node_modules/.bin/tsx, SELECT only — checkout_intents, terms_acceptances, gateway_events, subscriptions, credit_ledger, and a count of every checkout_refused/checkout_unconfirmed row ever written. The browser half (which card, which page, what the return did on screen, the cancel) is the founder's account of it in chat 2026-09-21. The failure and the replay are recorded in full at ../defects/sumit-return-failure-invited-a-second-payment.md."
source: db + founder
---

# The first real purchase, 2026-09-21 — ₪150 on the real org, and what it does and does not prove

Tags: **[MEASURED]** read out of production by this session; **[FOUNDER-REPORTED]** his account in
chat; **[REASONED]**; **[UNVERIFIED]**.

**This subscription is a TEST. Exclude it from every revenue figure.** The founder bought his own
product with his own card, from his own customer account, and did not refund it
([[../decisions/0046-billing-ships-as-osek-patur]] is unaffected; the receipt is a self-purchase and
the accountant has to be told).

## What is in the database [MEASURED]

| thing                 | value                                                                       |
| --------------------- | --------------------------------------------------------------------------- |
| account               | `tavnit.support@gmail.com`, `users.role = customer`, created 2026-09-11     |
| intent                | `ce6316d5-fb7b-40de-bb9e-0dbf3421e429`, plan `starter`, 15000 agorot        |
| intent status         | `completed`, created **12:41:17.830Z**, completed **13:23:15.750Z**         |
| terms acceptance      | one row, version `17.09.2026`, context `checkout`, IP and UA recorded       |
| Sumit payment         | `2377117745`; Sumit customer `2377117742`; document `2377117748`            |
| gateway event         | one row, `kind = checkout_charge`, key = the payment id, amount 15000       |
| subscription          | `7e687b6b-…`, `starter`, **active**, gateway `sumit`, ref = the customer id |
| period                | 2026-09-21T13:23:15.750Z → **2026-10-21T13:23:15.750Z**                     |
| cancel_at_period_end  | **true**, set at 13:24:22.602Z — 67 seconds after activation                |
| credits               | one `grant_period` row, **+1000**, balance 1000                             |
| refused / unconfirmed | **0 rows, all time**, every kind                                            |

**The 42-minute gap is the incident.** The intent was written at 12:41:17 and completed at
13:23:15. In between, the payment succeeded at Sumit and the return route could not verify it
because Vercel's credentials were malformed; the customer was shown "התשלום לא הושלם. אפשר לנסות
שוב.". After the environment was fixed, **replaying the same return URL while signed in completed
the intent normally** — the subscription, the event row and the credit grant above are all from
that replay. Full account: [[../defects/sumit-return-failure-invited-a-second-payment]].

**Zero `checkout_refused` rows, ever** — which is the same reading as
[[events-table-is-empty]]: the machinery has not fired in production, and a session finding silence
must not read it as broken.

**Two more intents exist and are still `pending`** [MEASURED]: `pro` at 12:42:43 and `studio` at
12:42:53, same account, prices 30000 and 50000, never paid. They are evidence about the
configuration, because `POST /api/account/checkout` returns its 503 **before** it writes anything
(`apps/web/src/app/api/account/checkout/route.ts` — `if (!page) return jsonError(503, …)` precedes
`createCheckoutIntent`): an intent row exists only if `SUMIT_CHECKOUT_PAGES` parsed **and** held
that plan code. So all three plan codes resolve to a page and all three got as far as a redirect
URL. Nothing about the מתקדם and פרימיום pages' own settings follows from that.

## What the founder reports [FOUNDER-REPORTED]

He opened the התחלה checkout on `tavnit.ai`, paid ₪150 with his own card on Sumit's page, was
returned to `?checkout=failed` while Sumit's dashboard showed the payment, and after the env fix
replayed the return URL and saw the plan and the credits. He then cancelled in-app — the period
runs to about 21.10.2026 — and chose **not** to refund for now. Whether the bank asked for 3DS, and
what the receipt shows, he has not said: **[UNVERIFIED]**.

## What this proves — and only for התחלה [REASONED, from the activation plus completeCheckout's own checks]

Every item below follows from the fact that `completeCheckout` verified the payment server-to-server
before it wrote anything: `ValidPayment` true, `Amount` = the intent's snapshotted price,
`CustomerID` = the returned customer, the payment's `ExternalIdentifier` = our intent id, and a
saved card present.

- the live Upay terminal takes a customer-present payment on the real org
- the page returns to `https://tavnit.ai/api/billing/sumit/return` with our intent id echoed back
- the amount charged equals the plan price in `plans` (15000 agorot, measured on both sides)
- the real org **saved the card** — an activation with none is refused `no_saved_card`
- Vercel's re-entered Sumit credentials authenticate
- **replaying a return URL recovers a stuck return**, which is the cheapest recovery we have while
  a new terminal has no Upay balance to refund from ([[sumit-real-org-configuration]])

## What it does NOT prove

- the מתקדם and פרימיום **return URLs and per-catalogue settings** (no payment went through them)
- **`/billing/payments/charge/` on the real terminal** — every renewal and every prorated upgrade
  takes that path and it has never run against Upay, including the CVV exemption for a
  customer-not-present charge. The founder deferred testing it with a day-0 upgrade (₪150) until
  real sales give Upay a balance that could absorb the refund.
- whether the bank asked for **3DS**, and what the **receipt** shows [UNVERIFIED]
- **refunds**, in any form

## Related

- [[../defects/sumit-return-failure-invited-a-second-payment]] — the failure in the middle of this
- [[sumit-real-org-configuration]] — the organisation it was bought from
- [[env-values-differ-between-the-box-and-vercel]] — why the return leg failed
- [[../decisions/0062-hosted-checkout-via-sumit-payment-pages]] — the mechanism it exercised
