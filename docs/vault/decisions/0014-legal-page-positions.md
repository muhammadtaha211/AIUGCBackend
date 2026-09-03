---
type: decision
status: verified
verified: 2026-09-03
method: "founder instruction in chat 2026-09-03, one dictated position per marker; applied and checked by grep -rn 'Lawyer|LAWYER|211924196' apps/web/src (no matches), npx tsc --noEmit in apps/web (exit 0), npx prettier --check on the changed files (clean), and both routes served locally: HTTP 200, zero occurrences of LAWYER in the rendered HTML"
source: founder + code
---

# 0014 — The legal pages take founder-chosen positions; the markers are gone

## The decision

`/terms` and `/privacy` shipped on 2026-09-02 carrying 29 visible `[LAWYER: …]` markers — amber
English notes rendered on the live page, one per sentence whose legal position had not been
decided. The founder checked the statutes, decided a position for each, and on 2026-09-03 all 29
were applied and the marker component deleted (commit `6b788b5`). Two sentences with no marker were added at the same
time (a Standard Contracts Law notice period on credit-price changes; a Privacy Protection Law
s.11(1) voluntariness statement).

**The pages no longer flag anything to the reader.** Lawyer review is still owed, but it no longer
blocks publishing — which is what unblocked the Google OAuth publication (it needs two
reachable, presentable legal routes). Published 2026-09-03.

Every marker, its verbatim text, the position taken, the statute it rests on, and the one thing
counsel must confirm are in [`docs/legal-review.md`](../../legal-review.md). That file is the
review artefact; this note records that the decision was made and what it costs us.

## Three standing facts the pages now assert

These came from the founder and are now public text, so they constrain later work:

- The operator is a sole trader registered as **עוסק פטור**. Both pages say so; neither shows the
  ID number any more (it was on the live pages until 2026-09-03). The dealer number is on receipts
  and given on request.
- The service is **B2B only**, stated as a condition of use rather than as a user declaration,
  with an express clause that mandatory Consumer Protection Law provisions win if they ever apply.
- All user-facing legal text stays Hebrew. The only English left is inside `<Ltr>` islands
  (vendor names, `tavnit.ai`, numbers).

## The positions that cost something

Most of the 31 edits are wording. Four are commitments with a price, and they are the ones to
remember before writing billing or support code:

| Commitment                                                                    | Where         | What it obliges                                                        |
| ----------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------- |
| Liability cap = **greater of** 12 months' payments **or ₪500**                | terms §12     | The cap is never zero, even for an account that has paid nothing       |
| **30 days'** email notice before a subscription price/quota change            | terms §8      | Needs an email path and a per-account notice record when billing ships |
| **14 days'** email notice before a credit-price rise or a material T&C change | terms §8, §14 | Same                                                                   |
| **7 days** to cure a curable breach before account closure                    | terms §11     | Suspension tooling must support notice-then-wait, not just close       |

Also newly promised: a pro-rata money refund of unused credits if **we** close an account with no
breach by the customer (terms §11), and reasonable prior notice before discontinuing a material
feature (terms §10).

## What was deliberately left unchanged

- **Acceptance by use, no clickwrap** (terms intro). Signup and login still show a one-line notice
  with links above the buttons — no checkbox, no stored acceptance record. The founder kept it;
  counsel is asked whether that forms the contract.
- **The AI-disclosure sentence** (terms §4) and **the prohibited-content list** (terms §7). No
  enacted Israeli rule reaches commercial ads today; the only labelling rules found are for
  election propaganda.
- **Every factual statement in both pages.** Retention periods, vendor list and regions, cookie and
  storage key names, the automatic technical checks, the credit and quota mechanics — all verified
  against the repo on 2026-09-02 and untouched by this pass.

## Options considered

- **Wait for a lawyer before publishing.** Rejected: the OAuth publication is a hard gate on all
  traffic (0006), and unreviewed-but-decided text is better than text that visibly says "we have
  not decided this" to every visitor.
- **Delete the markers and change nothing else.** Rejected: several flagged sentences were
  positions the founder did not actually want to defend — an uncapped one-sided indemnity, an
  exclusive Tel Aviv venue, credits as the sole remedy, a zero-value liability cap.
- **Decide each position against the statutes, remove the markers, and hand counsel a written
  record.** Chosen. The record is `docs/legal-review.md`; sources there carry a grade `[R]/[M]/[S]`
  because `nevo.co.il` and `he.wikisource.org` were both unreachable during the check.

## What this surfaced and did not fix

- [[../defects/invoicing-plan-cannot-issue-for-an-osek-patur]] — the billing plan assumes
  חשבונית מס, which an עוסק פטור cannot issue. Terms §8 now promises only קבלה / חשבונית עסקה.
- [[../defects/database-definitions-document-missing]] — privacy §11 now asserts compliance with
  the 2017 Data Security Regulations, whose reg. 2 document does not exist.
- [[../falsified/plan-names-paddle]] — an owed-list line claimed the project plan names Paddle. It
  does not; the repo says the opposite in two places.

The rest of what the founder still owes (vendor DPA undertakings, the ElevenLabs voice licence
question, the עוסק פטור ceiling) is the closing list in `docs/legal-review.md`.

## Related

- [[0006-google-oauth-is-in-scope-for-launch]] — why the pages had to exist at all
- `docs/08-supabase-project-rebuild.md` §"What still has to be written"
