---
type: falsified
status: verified
verified: 2026-09-03
method: "grep -rn -i paddle --include=*.md --include=*.ts --include=*.tsx . (excluding node_modules): two hits only — CLAUDE.md:20, which negates it, and the legal-review line making the claim; docs/05-billing.md:9-27 read in full"
source: code
---

# "Terms §8 says ספק סליקה ישראלי; the project plan names Paddle" — false

## The claim, verbatim

From the closing list of `docs/legal-review.md`, written 2026-09-03:

> Terms §8 says "ספק סליקה ישראלי"; the project plan names Paddle (foreign merchant of record).
> Reconcile before billing ships.

It arrived as a dictated owed-item alongside the marker positions, and would have gone to counsel
as a live contradiction in the terms of use.

## What killed it

There is no contradiction. The repo names Paddle exactly once, to rule it out, and rejects the
whole merchant-of-record shape on the page where the gateway is chosen.

- `CLAUDE.md:20` — "Payments: Israeli gateway (Grow/PayPlus/Cardcom) for recurring card billing +
  Green Invoice/iCount for automatic חשבונית מס. Bit for one-offs. No Stripe (unavailable in
  Israel), **no Paddle**."
- `docs/05-billing.md:11-12` — "Stripe doesn't onboard Israeli businesses and **a merchant of
  record is the wrong shape** for a domestic customer base (~5% fees, foreign checkout, no
  חשבונית מס)."
- `docs/05-billing.md:15-27` — the comparison table and reference choice are four Israeli
  vendors: Grow (Meshulam), PayPlus, Cardcom, Sumit.

Repo-wide, case-insensitively, "paddle" appears in two files: `CLAUDE.md` (the negation above) and
the `docs/legal-review.md` line making this claim.

**Terms §8's "ספק סליקה ישראלי" is the plan, stated accurately.** The line was corrected in
`docs/legal-review.md` in the same commit as this note; the claim is preserved here verbatim
rather than in the file that goes to counsel.

## What the real open item is

Dropping the Paddle claim does not empty the row — it changes what it says. The terms describe a
payment flow that does not exist yet:

- No gateway or invoicing integration is built. `packages/core/src/pipelines/billing.ts` holds the
  state machine behind `interface BillingGateway { chargeRecurring() }`; there is no adapter.
- The final vendor is deliberately unconfirmed until the founder opens a merchant account
  (`docs/05-billing.md:26-27`) — "deliberately not a code dependency."
- Terms §8 was rewritten into the future tense for exactly this reason ("פרטי אמצעי התשלום
  יימסרו... לא יישמרו אצלנו"), so it promises nothing about a vendor that has not been chosen.

The item that genuinely needs reconciling before billing ships is the **document type**, not the
vendor's nationality: [[../defects/invoicing-plan-cannot-issue-for-an-osek-patur]].

## Why it slipped

The claim was inherited and written down without a grep — the failure mode the vault exists to
stop, in a file whose whole purpose is to be trusted by someone who cannot check it. Every other
factual statement in the two legal pages was verified against the repo on 2026-09-02; this one sat
in the closing list, which was not.

## Related

- [[../decisions/0014-legal-page-positions]] — the pass that produced the line
- [[docs-backend-handover-md]] — the same shape: a cited artefact that did not exist
