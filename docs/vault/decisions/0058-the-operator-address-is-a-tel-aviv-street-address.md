---
type: decision
status: verified
verified: 2026-09-17
method: "Founder instruction in chat 2026-09-17: 'Operator address for every public page: ברזיל 14, תל אביב, ישראל. Replace כאבול in terms §1 and privacy §1.' Applied as a single exported constant, apps/web/src/app/(legal)/legal.tsx OPERATOR_ADDRESS, read by four surfaces. Verified by grep: 'כאבול' returns 0 hits under apps/web/src (it returned 2 before — terms/page.tsx:36 and privacy/page.tsx:46), and the rendered HTML of /terms, /privacy, /about and /contact each contains the new address exactly once, all four routes HTTP 200 locally. The registration mismatch below is UNVERIFIED — founder-reported, nobody has seen the עוסק פטור file."
source: founder
---

# 0058 — The operator's public address is a Tel Aviv street address, in one constant

## The decision

Every public page states the operator's address as **ברזיל 14, תל אביב, ישראל**. It replaces
**כאבול, ישראל**, which /terms §1 and /privacy §1 had carried since 2026-09-03
([[0014-legal-page-positions]]).

Founder instruction, 2026-09-17, alongside the acquirer's site requirements
([[0057-the-upay-site-requirements-are-met-by-reorganising-not-re-deciding]]) — a card company
wants a reachable operator, and a town name is not one.

## It lives in exactly one place

`apps/web/src/app/(legal)/legal.tsx` exports `OPERATOR_ADDRESS`. Four surfaces read it:
/terms §1, /terms §16, /privacy §1 and the new /about and /contact pages.

That is the whole point of the constant and worth stating, because the alternative was live for
two weeks: the address was a literal in two files, and the pass that changed it had to find both.
A fifth surface that hardcodes the string is the failure mode — an address that disagrees with
itself across a site is worse than an out-of-date one, because neither copy looks wrong on its own.

`CONTACT_EMAIL` was already in that file and already shared; `OPERATOR_ADDRESS` follows it rather
than inventing a new home. The two marketing pages import across the route group
(`@/app/(legal)/legal`), which the checkout route already does for `UPDATED` — an established
idiom here, not a new one.

## The mismatch this creates, and who owns it

**The עוסק פטור registration still records כאבול.** The founder said so when he gave the
instruction, and said he is updating it. Nobody in this session has seen the file.

So until he does, the public pages and the registration disagree. Recorded as an **owed founder
action, UNVERIFIED** — in `docs/legal-review.md`'s closing list and in the handover — and
**deliberately not as a defect in the pages**: the pages carry what the founder instructed them to
carry, and the instruction was given knowing the registration lags. A defect note here would file
the founder's own pending errand as a code problem.

It is worth watching for one reason: a receipt issued as an עוסק פטור carries the dealer's
registered details, so a receipt and the site could print different addresses in the window before
the registration moves. Nothing breaks; it is a thing a customer could notice.

## Options considered

- **Wait for the registration to change before changing the pages.** Rejected: the acquirer is
  waiting on the site, and the registration is a separate errand with its own clock. The pages
  state where the business operates from; the founder gave that address.
- **Put the address in each page as a literal, as כאבול was.** Rejected — see above. Two literals
  is exactly how a third gets missed.
- **One exported constant, and the mismatch written down as owed.** Chosen.

## Related

- [[0014-legal-page-positions]] — where כאבול became public text
- [[0057-the-upay-site-requirements-are-met-by-reorganising-not-re-deciding]] — the same pass
- `docs/legal-review.md` rows T2, P1 (amended) and the owed list
