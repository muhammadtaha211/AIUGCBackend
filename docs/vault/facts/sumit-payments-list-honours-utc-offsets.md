---
type: fact
status: verified
verified: 2026-09-21
method: "Three read-only POSTs to https://api.sumit.co.il/billing/payments/list/ with the Credentials body, against the founder's TEST Sumit business (facts/sumit-test-org-configuration), from the same scratch script as facts/sumit-payment-page-saves-the-card (keys read from apps/web/.env.local and scrubbed from the output). Target: the approved payment-page payment 2376907759, which /billing/payments/get/ reports as Date '2026-09-21T06:12:21+03:00' (03:12:21Z). (A) Date_From '2026-09-21T03:10:00.000Z', Date_To '2026-09-21T03:15:00.000Z'. (B) Date_From '2026-09-21T06:10:00+03:00', Date_To '2026-09-21T06:15:00+03:00'. (C) Date_From '2026-09-21T06:10:00.000Z', Date_To '2026-09-21T06:15:00.000Z' — the same wall-clock digits as B but labelled Z."
source: api
---

# Sumit's payments list reads the UTC offset on Date_From / Date_To

Tags: **[M]** measured.

| call | window sent                                                    | payments listed                                         |
| ---- | -------------------------------------------------------------- | ------------------------------------------------------- |
| A    | `03:10:00.000Z` – `03:15:00.000Z`                              | 2 — the approved 2376907759 and the declined 2376907143 |
| B    | `06:10:00+03:00` – `06:15:00+03:00`                            | the same 2                                              |
| C    | `06:10:00.000Z` – `06:15:00.000Z` (wall-clock digits, Z label) | 0                                                       |

A and B agree and C is empty, so the server converts the offset rather than comparing
wall-clock digits — the ".NET DateTime Kind" mistake a review raised on 2026-09-21 does not
happen here. `HttpSumitClient.listPayments` therefore sends `Date.toISOString()` (the Z form)
and `SumitGateway`'s reconcile window can stay two minutes wide instead of being padded by a
time zone.

Also seen in the same responses: a **declined** payment is listed too (`ValidPayment: false`,
`Status "003"`), payment-page payments carry their `externalidentifier` as
`ExternalIdentifier`, `HasNextPage` was `false` for both, and the list is company-wide (no
customer filter on the request) — the gateway filters on customer, amount, validity, a null
`ExternalIdentifier` and the date.

Re-measure with the same three calls against any payment whose `Date` is known; the
`sumit-call.mjs` shape is in facts/sumit-payment-page-saves-the-card's method line.
