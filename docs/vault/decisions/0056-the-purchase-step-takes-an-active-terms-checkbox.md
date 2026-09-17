---
type: decision
status: verified
verified: 2026-09-17
method: "Founder statement in chat 2026-09-17 ('purchase requires an active checkbox accepting the terms, and a record is kept') applied to the public text. Read in the same pass, and quoted below: docs/legal-review.md row T1 (the position being reversed), apps/web/src/app/api/account/checkout/route.ts (the route that writes the record — NOT changed by this task), packages/core/src/pipelines/billing.ts recordTermsAcceptance, supabase/migrations/0046_terms_acceptances.sql (the columns), packages/core/src/db/schema.ts:716-732, and apps/web/src/lib/plans-ui.ts TERMS_CHECKBOX_PREFIX / TERMS_LINK_LABEL (the checkbox the dialog already renders). The public text was written to match the code, not the other way round. Verified by serving /terms locally: HTTP 200, and the rendered HTML carries the intro sentence and the §8 bullet with zero occurrences of '[', 'TODO' or 'LAWYER'."
source: founder + code
---

# 0056 — The purchase step takes an active checkbox, and the record dates the text

## The decision

**An online purchase requires the customer to tick a box accepting the terms, and the acceptance
is recorded.** Signup and login are untouched — they keep acceptance by use, a one-line notice
with links above the buttons, no checkbox and no record.

This is a **reversal of `docs/legal-review.md` row T1, for the purchase step only.** T1 records
the 0014 position — "acceptance by use kept, no checkbox and no acceptance record added" — and
asks counsel whether notice-and-links forms the contract. That question is still open for signup
and login. It is closed for a purchase, and not by an answer to it: the acquirer behind the
payment stack requires it ([[0054-payment-stack-is-sumit-via-upay]]), so the requirement arrives
from the card company, not from the statute. **[R], not counsel-confirmed.**

[[0054-payment-stack-is-sumit-via-upay]] already recorded the mechanism when it built the route.
This note records the **public text** that now states it, and the one thing that text forced.

## What the pages say now

- **Terms intro**, one sentence: an online purchase also requires ticking the acceptance box, and
  the acceptance — its date and the terms version shown at the head of the page — is recorded.
- **Terms §8**, in the `רכישה מקוונת ומנוי` block: the same, as a bullet, naming what is stored —
  who accepted, when, and which version was shown.
- **Privacy §3**, a new data category `רכישות ואישור התנאים`: the account id, the terms version,
  the time, the IP and the user agent, with the purpose stated as the single one it has (proof the
  terms were accepted before the charge) and a retention line. **Privacy §8** carries the matching
  retention bullet.

`docs/legal-review.md` rows: **T1** amended, **E3** for the §8 bullet, **E10** for the privacy
category.

## The thing it forced: `UPDATED` had to move

`apps/web/src/app/(legal)/legal.tsx` exports `UPDATED`, which does two jobs: it is the "עודכן
לאחרונה" date at the head of /terms, **and** it is the string `POST /api/account/checkout` writes
into `terms_acceptances.terms_version`. So the version string and the text are only in step if
`UPDATED` moves whenever the text does.

This change rewrote §8 and the intro. **`UPDATED` therefore moved `11.09.2026` → `17.09.2026`**,
and the constant now carries a comment saying why it must. Leaving it would have produced the exact
failure the record exists to prevent: a stored acceptance pointing at a version string the
customer never read.

Safe to move today, and it will not be after the first sale: `terms_acceptances` held **0 rows**
in production when 0046 was applied (read back 2026-09-17, `scripts/verify-migration-ledger.sql`
§RESULTS), so no existing record is invalidated. `apps/web/test/account-routes.test.ts` mocks the
legal module (`vi.mock("@/app/(legal)/legal", () => ({ UPDATED: fixture.termsVersion }))`), so the
test pins the plumbing, not the value, and did not need editing.

## Options considered

- **Leave `UPDATED` at 11.09.2026 and change the text.** Rejected: it makes the acceptance record
  false in the one way that matters. The record's whole content is "this person saw THIS text".
- **Split the displayed date from the stored version.** Rejected as premature: two strings to keep
  in step where one already works, and no caller wants them to differ.
- **Move `UPDATED` and say so in the constant.** Chosen. The comment is the durable part — the next
  session to touch the terms text needs to know the date is load-bearing, and nothing else in the
  tree says so.

## What this does NOT do

- **It does not close T1 for signup and login.** Those still take acceptance by use, and counsel
  is still asked whether that forms the contract.
- **It does not add a second write path.** The record is written by the checkout route, which this
  task did not touch; the pages only describe what it does.
- **It does not cap or dedupe the record.** Checkout inserts a row on every valid request, so a
  customer who opens the dialog five times leaves five rows. Known, deliberate for now, and queued
  with the adapter task.

## Related

- [[0054-payment-stack-is-sumit-via-upay]] — where the requirement comes from and what built it
- [[0014-legal-page-positions]] — the T1 position this narrows
- [[0057-the-upay-site-requirements-are-met-by-reorganising-not-re-deciding]] — the rest of the
  same site-requirements pass
- `docs/legal-review.md` rows T1, E3, E10 — amended in the same commit
