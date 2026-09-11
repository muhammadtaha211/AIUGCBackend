---
type: decision
status: verified
verified: 2026-09-11
method: "Founder decision in chat, 2026-09-11, stated as final and indefinite, with responsibility for the consequences accepted explicitly. Tree read at 3a3deda: `wc -l docs/legal/database-definitions-document.md` -> 990 (981 before the STATUS blockquote this decision added at its head; the vault's earlier notes quote 981 and are describing the same document); `grep -o \"\\[חסר\" docs/legal/database-definitions-document.md | wc -l` -> 75 raw hits, of which :63 is the legend defining the marker and :69 a prose mention, so 73 real gaps ([[../defects/database-definitions-document-missing]]); `docs/legal/reg2-open-questions.md` is 167 lines with bucket headings at :70 (FOUNDER — 34), :113 (COUNSEL — 23), :147 (VENDOR — 16) — 12 lines longer than before this decision, which added the STATUS block at :10-20. `grep -rn database-definitions-document` over the tree returns exactly one link into the document from anything a reader could follow — `reg2-open-questions.md:3`, itself internal — and no route, page or component references it. The live compliance claim it backs is privacy §11."
source: founder
---

# 0043 — The reg. 2 definitions document is deferred by decision, not pending

The founder is **deferring the מסמך הגדרות מאגר indefinitely**, with no date, and **takes full
responsibility for any consequences of that decision.** He will engage a lawyer to fill the gaps when
he sees fit.

This note exists so the record reads correctly. Until now the duty sat in two places that both
describe it as owed and unfinished — a queue item and an open-decisions bullet — which is how an
oversight looks, not how a decision looks. Nothing about the exposure changed; what changed is that
somebody decided, on the record, to carry it.

## The duty

The repo's own position is that this database is a **מאגר המנוהל בידי יחיד**, and that reg. 21(4) of
the Data Security Regulations 5777-2017 applies regs. 1, **2**, 6(א), 9(א), 11(א), 12–14 and 20 to
such a database — so a reg. 2 definitions document is still required
(`docs/legal/database-definitions-document.md:43-46`, sourced to `docs/legal-review.md:87` source 6
and row P8 at `:72`). **That classification is itself a position the document asks counsel to confirm**, not a
finding — it is COUNSEL row 1 of the worksheet (`docs/legal/reg2-open-questions.md:120`).

What makes it more than paperwork is that `/privacy` §11 already claims compliance with those
regulations, in public, today. The gap is between a live claim and an undischarged duty
([[../defects/database-definitions-document-missing]] `:116-118`).

## What exists today

| artefact                                      | state                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/legal/database-definitions-document.md` | **990 lines, Hebrew, drafted** — 981 until this decision put a STATUS blockquote at its head, which is the figure the older vault notes quote.** `# מסמך הגדרות מאגר — טיוטה` — its own first line calls it a draft. **Internal**: served by no route, rendered by no page; the only link to it from anything a reader could follow is `reg2-open-questions.md:3`, which is itself internal. |
| the gaps                                      | **73 real gaps** (75 raw `[חסר` hits; `:63` is the legend defining the marker and `:69` a prose mention). Never `grep -c` for this — it counts lines and returns 71.                                                                                                                                                                                                                         |
| `docs/legal/reg2-open-questions.md`           | **167 lines.** Every gap restated as a direct question with an owner, bucketed **FOUNDER 34** (`:70`), **COUNSEL 23** (`:113`), **VENDOR 16** (`:147`).                                                                                                                                                                                                                                      |
| closed from the repo                          | **zero, by construction.** The marker means "information the repo does not contain, and who can supply it" — every fact the repo could answer is already in the document as `[נמדד]` or `[מוסק]` with a pointer (`reg2-open-questions.md:49-55`).                                                                                                                                            |

**The collation is done. The answering is what is deferred**, and 39 of the 73 — the COUNSEL and VENDOR
buckets — need a person who is not the founder.

## The decision

**Defer. No date, no trigger, no review cadence.** Not "do it later when there is time" — a decision
to carry the exposure until the founder judges a lawyer worth paying for, taken knowing:

- `/privacy` §11's compliance claim is live and public while the document behind it is unfinished.
- The worksheet is complete, so resuming costs a lawyer's time and not another drafting pass.
- Two of the three buckets — 39 of the 73 — cannot be closed by the founder at all.

### What was NOT decided

- **Not** that the duty does not apply. The classification question is open and is COUNSEL row 1.
- **Not** that the document is finished, or that the draft may be relied on. Its own head block says
  the chapter skeleton was written from memory and never checked against the text of reg. 2
  (`database-definitions-document.md:28-33`).
- **Not** that the worksheet may be pruned. It stays whole; a resumed pass starts from it.

## REASONED — what would most plausibly make this urgent

**This section is orientation for a future reader, not a commitment.** The founder named no trigger
and agreed to no deadline; deferral is indefinite and the list below is inference from what the
document contains, not from anything he said. Do not quote it back at him as a condition he accepted,
and do not treat any item as a deadline.

- **A data-subject request or a complaint to the Privacy Protection Authority.** The document becomes
  the artefact produced on demand, and to whom and when it must be produced is itself an unanswered
  gap (`reg2-open-questions.md:122`, the `head`/`:8` row).
- **A security incident.** Reg. 2 sits inside the same duty set as the incident obligations, and an
  incident makes the whole posture inspectable at once. Two of the gaps are exactly "what is a
  reportable incident, to whom, and by when" (`:141-142` — `7יג`/`889` and `7יד`/`895`).
- **Billing going live.** It adds payment and bookkeeping records, which changes the categories of
  data and subjects in §3 — the part of the document most sensitive to the product changing.
- **Crossing the individually-managed thresholds** — more than two further authorised users, or
  10,000 subjects. The classification the whole document rests on flips, and with it the duty set.
- **A B2B buyer asking for a DPA or a vendor security review.** This is the artefact they ask for,
  and the audience the product sells to is exactly the audience that asks.

None of these is predictable from here, which is the honest reason the deferral carries no date.

## What this note replaces

`state-of-play.md` carried reg. 2 in **two** places that both read as pending: queue item 5, and an
`## Open decisions` bullet. The queue item is removed — it was work, and the work is deferred, and a
queue that holds indefinitely-deferred work stops being a queue. The open-decisions bullet is
rewritten to point here. `docs/legal-review.md`'s owed list and the head of the worksheet now say
deferred and link this note.

## Related

- [[../defects/database-definitions-document-missing]] — the defect this decision declines to close,
  and the source of the 73 / 75 / 71 count trap.
- [[0014-legal-page-positions]] — where the `/privacy` and `/terms` positions were taken, including
  the §11 compliance claim this decision leaves standing.
- [[../defects/resend-is-an-undisclosed-processor]] — the disclosure closed the same day; its transfer
  question is filed in the same worksheet and is one of the 39 that need a person who is not the
  founder.
