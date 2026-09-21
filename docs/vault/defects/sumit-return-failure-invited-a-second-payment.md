---
type: defect
status: verified
verified: 2026-09-21
method: "FIX (2026-09-21): apps/web/src/app/api/billing/sumit/return/route.ts rewritten so ?checkout=failed is reachable only for CheckoutVerificationError reason 'payment_invalid'; new exported core function recordUnconfirmedCheckoutReturn in packages/core/src/pipelines/checkout.ts. Pinned by apps/web/test/sumit-return-route.test.ts (16 cases, was 10), packages/core/test/checkout.test.ts (19 cases, was 16 — three new for the recorder), apps/web/test/billing-lib.test.ts (12, was 9), apps/web/test/plans-ui.test.ts (24, was 21). ORIGINAL FINDING (2026-09-21, unchanged below): founder-reported production incident on the real Sumit org, read from the Vercel log for the return request and from Sumit's own record of the payment; the code path was then traced in the tree at 4100cc7 (gateways/sumit.ts HttpSumitClient.post -> getPayment -> pipelines/checkout.ts completeCheckoutTx -> completeCheckout's catch -> the route's catch)."
source: founder + code
---

# A return that could not verify a real payment told the customer to pay again

## FIXED 2026-09-21 — on branch `fix/sumit-return-unconfirmed`; NOT merged, NOT deployed

The generic catch no longer lands on `?checkout=failed`. That landing — the only Hebrew line
that invites another attempt — is now reachable **only** when Sumit positively answered that
the payment is not valid (`CheckoutVerificationError` reason `payment_invalid`, i.e.
`ValidPayment: false`). Everything else a browser carrying a payment id can produce — any
`SumitApiError` of any kind, `payment_not_found`, a database error, an unexpected throw —
lands on the new `?checkout=unconfirmed`, whose line says the payment was received, is being
confirmed, and must not be paid again. `?checkout=refused` and the `checkout_refused` row are
untouched. Each unconfirmed return is recorded as a `gateway_events` row
`checkout_unconfirmed` under `sumit_unconfirmed_<payment id>`
([[../decisions/0062-hosted-checkout-via-sumit-payment-pages]], amended the same day).

**What this does NOT fix**, and is stated here so it is not re-derived as fixed:

- **The root cause is unguarded.** `SUMIT_COMPANY_ID` is `z.string().optional()`
  (`packages/core/src/config.ts`) and `HttpSumitClient.credentials()` checks presence only, so
  a malformed value passes both, `Number()` makes it `NaN`, and `JSON.stringify` sends
  `"CompanyID": null`. Nothing validates the value at boot or at first use. The symptom is now
  safe; the misconfiguration still breaks every checkout, politely.
- **Nothing retries.** An unconfirmed row sits there until the founder acts on it. The report
  for this task describes what a worker sweep would need; none is built.
- **A customer who pays and never returns** (closes the tab before the redirect) still leaves
  nothing on our side — the return leg is the only writer.

## The incident — MEASURED, production, 2026-09-21

A real ₪150 payment on the real Sumit organisation, by the founder, on the first live purchase.

1. Sumit's payment page took the card and redirected the browser to
   `/api/billing/sumit/return` with the og-* ids.
2. The route called `completeCheckout`, whose first server-to-server step is
   `/billing/payments/get/`. That call threw `SumitApiError` — "Invalid Credentials" — because
   Vercel's `SUMIT_COMPANY_ID` / `SUMIT_API_KEY` were malformed.
3. The generic catch (`route.ts`, at 4100cc7) logged `sumit return: failed for intent <id>` and
   returned `/home/plan?checkout=failed`, which renders
   **"התשלום לא הושלם. אפשר לנסות שוב."** — an invitation to pay a second time, while Sumit
   held the first payment.
4. **Nothing was written.** `completeCheckout`'s own catch writes `checkout_refused` only for
   `err instanceof CheckoutVerificationError && err.payment`; a `SumitApiError` fails both
   conjuncts, so no row existed. The log line named the intent and the error and omitted the
   payment id and the customer id — the two values needed to find the payment at Sumit.
5. After the env was fixed, **replaying the same return URL while signed in completed the
   intent normally** — the subscription activated and the credits were granted. So the payment
   was always good and the only thing wrong was our ability to ask about it.

## Why it is not one bad afternoon — REASONED

The reasoning rests on one measured fact
([[../facts/sumit-payment-page-saves-the-card]]): on the test org the payment page redirected
to the return URL **only after a payment it accepted**. The declined attempt re-rendered the
page with its error line and the browser never left it.

From which: a browser arriving at the return route with an `OG-PaymentID` has almost certainly
paid. Verification runs **after** that, against a third party over the network, and every way
it can fail without an answer — a Sumit timeout, a 5xx, a `Status 2` TechnicalError, a
credential Sumit rejects, our own pooler dropping — produces exactly this shape with a real
customer's money already taken. The incident was one cause; the class is "we could not ask",
and the old code mapped the whole class onto "you did not pay".

`payment_not_found` belongs to that class and not to the decline class, which is the
non-obvious part: a wrong key or the wrong organisation answers "Payment not found" for a
payment that genuinely exists in the other org. The one case that is genuinely a decline is
Sumit answering with the payment and `ValidPayment: false` — and, per the measurement above, a
decline should not have reached the return route at all.

## Related

- [[../decisions/0062-hosted-checkout-via-sumit-payment-pages]] — the decision this amends, and
  the `checkout_refused` half it leaves alone
- [[../facts/sumit-payment-page-saves-the-card]] — the measurement the argument rests on
- [`docs/05-billing.md`](../../05-billing.md) §"Hosted checkout" — amended in the same commit
