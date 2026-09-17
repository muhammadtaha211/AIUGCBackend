---
type: decision
status: verified
verified: 2026-09-17
method: "The acquirer's requirement list as the founder relayed it in chat 2026-09-17 (their email of 2026-09-16), applied to apps/web/src/app/(legal)/terms/page.tsx and privacy/page.tsx. Every position written into the new blocks was traced back to a sentence already on the page or a row already in docs/legal-review.md before it was written — the mapping table below is that trace, and no position in it is new. Section numbers were checked against docs/legal-review.md's citations (T1-T20, E1-E2, P1-P11 all cite section numbers) and NOT renumbered: /terms still runs 1..16 and /privacy 1..15, verified by reading the rendered HTML. Both routes served locally: HTTP 200, and the rendered text contains zero occurrences of '[', 'TODO', 'LAWYER', 'כאבול', 'כולל מע' or 'כשתתאפשר'. Tests, typecheck and prettier green (web 461, admin 39, worker 7, core 572 with 5 pre-existing ffmpeg-ENOENT failures this container cannot run, remotion 75 with 1 pre-existing Chromium-download failure)."
source: founder + code
---

# 0057 — The acquirer's site requirements are met by reorganising §8, not by re-deciding anything

## The decision

The card company behind the payment stack (Upay, via Sumit — [[0054-payment-stack-is-sumit-via-upay]])
sent a list of things the site must state before it will clear. The founder's instruction was
explicit about the shape of the answer: **reorganise and add, do not re-decide.** Every legal
position recorded in [[0014-legal-page-positions]] and `docs/legal-review.md` stands exactly as it
stood, and **no section was renumbered** — `docs/legal-review.md` cites section numbers in 33 rows,
and a renumber would have silently invalidated all of them.

So terms **§8 (קרדיטים, מחירים ותשלום)** — which was a flat list of seven bullets — became three
lead bullets plus four bold-headed sub-blocks, and everything the acquirer asked for landed inside
them. §8 is still §8. §9 through §16 did not move.

## The four blocks, and where each sentence came from

| block                | what it states                                                                                                                                                                                                                                    | where it came from                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `רכישה מקוונת ומנוי` | the monthly subscription, final prices with no VAT added, the acceptance checkbox, no rollover, auto-renewal, the 30-day price/quota notice, dunning, payment through an Israeli gateway with the details never held by us, receipts              | the old "כשתתאפשר רכישה מקוונת" sub-list, **recast to the present** — plus 0056's checkbox                                                             |
| `אספקת השירות`       | digital only, nothing shipped, no delivery charge; credits credited immediately on payment confirmation; production usually within minutes but expressly not guaranteed; failed production refunds credits; 90-day download window                | §8's own refund and 90-day bullets, §10's As-Is, and the delivery facts the acquirer asked for                                                         |
| `ביטול עסקה והחזרים` | cancel any time, at period end, no refund for the period; credits expire, manual grants do not; **upgrade rule**; **downgrade rule**; the 14/30-day price-change cancellation right; failed-render refunds; §11's pro-rata; consumer law prevails | rows E1, T11, T13, T16 gathered into one place, **plus** [[0052-upgrade-credits-are-period-credits]] and [[0053-downgrades-are-scheduled-not-applied]] |
| `אחריות בית העסק`    | we are responsible for the service and for delivering what was paid for, **subject to §§10–12**; the customer is responsible for his content and its publication (§§4, 7, 10); how to reach us                                                    | pure cross-references to §§4, 7, 10, 11, 12, 16                                                                                                        |

Two of those rows carry text that did not exist on any page before: the upgrade and downgrade
bullets. They are not new positions either — 0052 and 0053 decided them on 2026-09-17 and the
/home/plan dialogs already display them. This pass is the first time a **customer who has not
opened the dialog** can read them.

## The tense change, which is the one thing that is not cosmetic

§8's subscription sub-list opened `כשתתאפשר רכישה מקוונת, יחולו התנאים הבאים` — "when online
purchase becomes possible". It now states the terms as live.

That was already the inconsistency the previous session flagged and could not resolve alone: the
no-credits card and the /pricing FAQ say a plan loads the credits, while the terms said purchase
was not yet possible. The founder closed it in this direction. **The honest reading is that §8
describes the terms of an OFFER, not of a completed transaction** — `getBillingGateway()` still
returns `NotConfiguredGateway` and `POST /api/account/checkout` still answers 503
([[0055-plan-cards-may-show-computed-ad-counts]]'s dead end). `docs/legal-review.md` row **T12**
was amended to say exactly that, and to hand counsel the replacement question: whether the present
tense is honest while nothing can yet be charged. **[R] — it is a judgement, and it is recorded
as one.**

## Privacy, in the same pass

- **A new §6 sub-section names the payment stack**: Sumit processes the payment and issues the
  receipt, Upay (יופיי פיננסים בע"מ, ח.פ. 514672575) does the clearing, card data never reaches us.
  Row **P12**. Both vendors are Israeli, so **§7 (transfer abroad) was not touched** — a point worth
  stating, because every other vendor added to §6 since 2026-09-10 needed a §7 clause.
- **Two new data categories in §3** with matching retention in §8: the acceptance record (row E10,
  [[0056-the-purchase-step-takes-an-active-terms-checkbox]]) and the /contact form's fields
  (row E11).
- **One correction**: §3 said "אין בשירות שדות של שם, טלפון או כתובת". The public contact form
  collects a name, so that sentence would have become false the moment /contact shipped. It now
  says there is no phone or home-address field.

## Options considered

- **Renumber §8 into several top-level sections, one per requirement.** Rejected by the brief and
  correctly: 33 rows of `docs/legal-review.md` cite section numbers, and counsel reads that file
  beside the pages. Bold sub-headings inside §8 give the acquirer the same navigable structure at
  no cost.
- **Write fresh text for each requirement.** Rejected: fresh text is a fresh position. Every clause
  in the four blocks traces to a sentence that already existed or to a decision note from the same
  week, which is what the table above is for.
- **Reorganise §8, add only what no existing sentence covered, and record the trace.** Chosen.

## What would have stopped this

The instruction carried a stop condition: if a required item could not be met without taking a new
position, stop and report rather than invent one. **None triggered.** The closest was
`אחריות בית העסק` — a merchant-responsibility statement could easily have become a warranty that
contradicts §10's As-Is and §12's cap. It is written as a cross-reference subject to §§10–12
instead, which adds no obligation. That is the row counsel should look at first (**E8**).

## Related

- [[0014-legal-page-positions]] — the positions this pass preserves
- [[0056-the-purchase-step-takes-an-active-terms-checkbox]] — the one position that did change
- [[0058-the-operator-address-is-a-tel-aviv-street-address]] — the other half of the same pass
- [[0052-upgrade-credits-are-period-credits]], [[0053-downgrades-are-scheduled-not-applied]] — the
  two rules that reached a public page for the first time here
- `docs/legal-review.md` rows T12, E3–E9, P12, E10–E11
