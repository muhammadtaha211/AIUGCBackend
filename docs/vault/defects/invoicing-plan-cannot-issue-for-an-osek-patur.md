---
type: defect
status: verified
verified: 2026-09-03
method: "read CLAUDE.md:20, docs/05-billing.md:11-27 and apps/web/src/app/(legal)/terms/page.tsx:236-239 side by side; the osek-patur invoicing rule itself is secondary-sourced — docs/legal-review.md Sources §8, graded [S]"
source: code + founder
---

# The billing plan issues חשבונית מס; an עוסק פטור cannot

## Resolution 2026-09-13 — ship as עוסק פטור ([[../decisions/0046-billing-ships-as-osek-patur]])

The founder took the first branch of "Fix shape" below: **ship billing as עוסק פטור**, documents
= קבלה automatically per successful charge and חשבונית עסקה on request, with conversion to
עוסק מורשה as a later business event before the payment that crosses the ceiling. The billing doc
moved and the terms did not, exactly as this note argued — `docs/05-billing.md` §"Gateway choice"
was amended in the same commit, so the `:19` and `:23-25` cites in the table below are now
historical rather than live.

**Item 1 of "Fix shape" stays open.** A decision does not discharge a configuration dependency:
whichever documents vendor is chosen still has to be set to issue קבלה / חשבונית עסקה and not
חשבונית מס, and that lands when the gateway adapter and the merchant account exist.
[[../decisions/0046-billing-ships-as-osek-patur]] carries the runbook that moves it across
conversion.

---

## The contradiction

As of 2026-09-03 the operator's dealer status is public text on both legal pages: **עוסק פטור**
([[../decisions/0014-legal-page-positions]]). The billing design predates that and assumes the
other status.

| Where                      | What it says                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| `CLAUDE.md:20`             | "Green Invoice/iCount for **automatic חשבונית מס**"                                       |
| `docs/05-billing.md:19`    | Invoicing row of the gateway comparison is headed "**חשבונית מס קבלה**"                   |
| `docs/05-billing.md:23-25` | "invoices are auto-issued per charge by the integration — zero invoice code on our side"  |
| `docs/05-billing.md:12`    | rejects a merchant of record partly because it gives "no חשבונית מס"                      |
| terms §8 (live text)       | "**קבלה, ולפי הצורך חשבונית עסקה**, יופקו כנדרש לפי דין ויישלחו לכתובת האימייל של החשבון" |

An עוסק פטור issues **קבלה** and, where a document is needed for the buyer, **חשבונית עסקה**. It
cannot issue **חשבונית מס**, because it charges no VAT and there is none to pass on. That is why
terms §8 was written the way it was. The billing doc still describes the other document, and it is
the billing doc that is wrong for today's status — not the terms.

Grade the tax point honestly: it comes from secondary sources (kolzchut plus accounting-firm
pages; the gov.il page could not be fetched), recorded as source 8 in `docs/legal-review.md` and
graded `[S]` there. The _contradiction between the two texts_ is verified by reading them; the tax
rule behind it is not first-party sourced.

## Why it is not urgent, and why it is not free

No money moves today. There is no gateway adapter, no invoicing integration, and no online
purchase path — credits are loaded by hand in coordination with the founder (terms §8 says so).
Nothing is currently issuing the wrong document, because nothing is issuing any document.

It stops being free at the moment billing ships, in two ways:

1. **Configuration, not code.** Whichever vendor is chosen, its invoicing integration has to be set
   to issue קבלה / חשבונית עסקה rather than חשבונית מס. Discovering this while wiring the callback
   means reopening a settled design; discovering it after the first charge means reissuing
   documents to a paying customer.
2. **It interacts with the ceiling.** The founder must convert to עוסק מורשה before the payment
   that crosses the 2026 עוסק פטור ceiling (₪122,833 per secondary sources — verify on gov.il).
   After conversion, חשבונית מס is exactly right and `docs/05-billing.md` becomes correct again.
   So the fix is genuinely conditional on a business event, which is why this is recorded rather
   than patched away.

## Fix shape

Not a code change. Three lines of text and one decision:

- Decide the sequencing: ship billing as עוסק פטור (documents = קבלה / חשבונית עסקה), or convert
  to עוסק מורשה first and leave the plan as written.
- Whichever way, `CLAUDE.md:20` and `docs/05-billing.md:19,23-25` need a clause naming the
  dependency. Neither was touched in this pass — `CLAUDE.md` is the founder's file, and changing
  the billing plan's document type is a business decision, not a documentation tidy-up.
- Terms §8 and the VAT sentence in §8 both need updating on conversion; that is already on the
  closing list in `docs/legal-review.md`.

## Related

- [[../decisions/0014-legal-page-positions]] — where the dealer status became public text
- [[../falsified/plan-names-paddle]] — the other billing claim this pass produced, and killed
