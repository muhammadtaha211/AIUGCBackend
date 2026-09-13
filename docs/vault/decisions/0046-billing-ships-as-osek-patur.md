---
type: decision
status: verified
verified: 2026-09-13
method: "six founder rulings dictated in chat 2026-09-13, recorded against docs/05-billing.md §\"Gateway choice\" (pre-amendment :9-36), docs/legal-review.md rows T10-T13 and Sources §8, apps/web/src/app/(legal)/terms/page.tsx:219-240, packages/core/src/pipelines/billing.ts:16-23 and docs/01-schema.md:131-146, all read in the same pass. Checked that nothing is being built over: grep -rniE '\\bvat\\b|vat_rate|tax_rate|\\btax\\b|מע\"מ' over packages/ apps/ supabase/migrations/ scripts/ returns exactly one hit — the live terms sentence at terms/page.tsx:222. No code, schema, migration, config row or test carries a tax concept."
source: founder + code
---

# 0046 — Billing ships as עוסק פטור; conversion is a later business event

## The decision

The billing design has assumed **חשבונית מס** since it was written; the operator has been public
text as **עוסק פטור** since 2026-09-03 ([[0014-legal-page-positions]]). The contradiction was
recorded and deliberately left open — it is a business decision, not a documentation tidy-up
([[../defects/invoicing-plan-cannot-issue-for-an-osek-patur]]). On 2026-09-13 the founder closed
it with six rulings.

### 1. Billing ships while the operator is עוסק פטור

Conversion to **עוסק מורשה** happens later — before the payment that crosses the ceiling, not
before launch. Documents at launch:

- **קבלה** — issued automatically on every successful charge.
- **חשבונית עסקה** — on request.

That is exactly what live terms §8 already promises ("קבלה, ולפי הצורך חשבונית עסקה, יופקו כנדרש
לפי דין"), so the legal pages need no change to ship. `docs/05-billing.md` was the wrong half of
the contradiction and is the half that moves.

### 2. Plan prices are NET

There is no VAT today, so net and the amount charged are the same number and `plans.price_agorot`
(`supabase/migrations/0000_init.sql:166`) needs nothing. The ruling bites at conversion: VAT is **added on
top, not absorbed**. It takes effect **from the next billing period, after 30 days' email notice
with a penalty-free cancellation right** — the mechanism terms §8 already promises and
`docs/legal-review.md` row **T11** grounds in the Standard Contracts Law s.4(4) presumption.

Rationale, in the founder's words: roughly **19 of 20 customers are businesses that reclaim it**,
so absorbing VAT would be paying a cost almost nobody actually bears.

One constraint travels with this. Terms §8 asserts that displayed prices are the final amount
payable including tax where it applies, and that they update if the status changes
(`docs/legal-review.md` row **T10**). So at conversion the **displayed** figure becomes gross while
the **stored plan** figure stays net — the markup lives in the display and the charge, never in
`plans.price_agorot`.

### 3. B2B only at launch; monthly plans only

B2B-only is unchanged from [[0014-legal-page-positions]]. **Monthly plans only — no annual, no
prepaid.** Nothing in the schema or the lifecycle offers either today; this ruling is what keeps
them out of scope rather than merely un-built.

### 4. Renewal scheduling stays ours

The worker's daily job charges a stored token through the gateway's API. `billing.ts` keeps the
state machine; the gateway keeps executing charges — the principle `docs/05-billing.md` opens with.
That makes four hard vendor requirements:

| #   | The gateway must support                                          |
| --- | ----------------------------------------------------------------- |
| a   | a hosted page that returns a **reusable token**                   |
| b   | an **API-initiated charge on that token for an arbitrary amount** |
| c   | **signed server callbacks carrying a unique event id**            |
| d   | a **sandbox with test cards**                                     |

**A vendor whose recurring runs only on its own scheduler does not fit.** (b) is the sharp one: an
upgrade charges the difference mid-period (`docs/05-billing.md` §Subscription lifecycle), so a
fixed-amount recurring authorisation is not enough.

### 5. Vendor unconfirmed; the documents vendor is chosen first

No vendor is confirmed until the merchant account opens. The **documents vendor is chosen first** —
it is the one that has to be configured for פטור, and it is the one that gets reconfigured at
conversion. Shortlist to record, **unranked**:

- **Documents** — Morning (ex-Green Invoice), iCount, Sumit.
- **Gateway** — PayPlus, Cardcom, Grow (ex-Meshulam).

Note against (4b): `docs/05-billing.md`'s own comparison table lists Grow's recurring as **hosted
pages**, which may not satisfy an API-initiated charge for an arbitrary amount. That is a question
for the onboarding call, not something to resolve in a document.

### 6. Ceiling handling is an admin alert

When **year-to-date receipts** pass a **configurable fraction (default 75%)** of a **configurable
ceiling value**, the admin console alerts. Both numbers are config, not constants — the ceiling
moves every year and the fraction is a judgement call.

This is **FUTURE code, built with the gateway adapter, not before**. It is recorded here so the
gateway work does not have to rediscover it; nothing is built by this note.

## The ceiling figure, graded honestly

The 2026 עוסק פטור ceiling is **₪122,833** (2025: ₪120,000), **[S]** — secondary sources only
(kolzchut plus accounting-firm pages; the gov.il page was unfetchable). That is exactly how
`docs/legal-review.md` Sources §8 carries it, and it is not upgraded by being repeated here.
**Verifying it on gov.il is step 1 of the runbook below**, not a background assumption.

## Options considered

- **Convert to עוסק מורשה before launch and leave the billing plan as written.** Rejected by the
  founder: the exemption is worth keeping until revenue requires conversion. Converting early buys
  VAT reporting duties before there is revenue to report, and buys them in exchange for a document
  type nobody has asked for.
- **Let the gateway run recurring on its own scheduler.** Rejected: `billing.ts` already owns the
  state machine — `processDueRenewals`, the dunning days, `suspend_after_days`, the
  `gateway_events` idempotency key. Vendor-run recurring makes that dead code and leaves **two
  sources of truth** for period bounds, status and dunning, which is the failure the opening
  principle of `docs/05-billing.md` exists to prevent.
- **Ship as עוסק פטור, keep our scheduler, write the conversion down as a runbook.** Chosen. It is
  the only option where nothing has to be un-built later: the documents vendor is configured once
  for פטור and reconfigured once at conversion, and the state machine never changes hands.

## Conversion to עוסק מורשה — the runbook

Run in order. Steps 1–3 are business actions; 4 and 7 are code that does not exist yet.

1. **Verify the current ceiling on gov.il** and set the configured ceiling value. The ₪122,833
   figure above is [S] and must not be carried into config unverified.
2. **Register as מורשה at VAT** — before the payment that crosses the ceiling, not after it.
3. **Switch the documents vendor account to מורשה** and to **חשבונית מס-קבלה**. This is the
   configuration dependency the defect note called item 1 of its fix shape, and it is the whole
   reason the documents vendor is chosen first (ruling 5).
4. **UPDATE the `vat_rate` config** — _to be added with the gateway adapter_. It does not exist
   today and this note does not create it.
5. **Email subscribers 30 days ahead**, with the penalty-free cancellation right, per
   `docs/legal-review.md` row **T11**. The new price applies from the next billing period only.
6. **Update terms §1 and §8.** Do not duplicate the wording here — the closing list in
   [`docs/legal-review.md`](../../legal-review.md) ("Facts and actions the founder still owes")
   already carries what has to change, and it is the file counsel reads.
7. **Confirm the gateway charge amount is `net × (1 + vat_rate)`.** `plans.price_agorot` stays net
   (ruling 2); the multiplication happens where the charge is built, and the displayed price
   becomes the same gross figure (T10).

## Related

- [[../defects/invoicing-plan-cannot-issue-for-an-osek-patur]] — the contradiction this closes;
  its configuration dependency stays live until the gateway adapter exists
- [[0014-legal-page-positions]] — where עוסק פטור, B2B-only and the 30-day notice became public
  text
- [`docs/05-billing.md`](../../05-billing.md) §"Gateway choice" — amended in the same commit
