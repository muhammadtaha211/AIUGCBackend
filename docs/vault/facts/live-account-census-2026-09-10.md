---
type: fact
status: verified
verified: 2026-09-10
method: "Founder ran `select email, role from users order by created_at;` against the live project (hyaqydcmwbnbaiqqufow) on 2026-09-10 and reported the result in chat, plus the statement that all six accounts are his own. Recorded independently in docs/legal/database-definitions-document.md:133-138. The email addresses are deliberately not reproduced — see below."
source: founder
---

# Six accounts on live, one admin, and all six are the founder's

`users` holds **six** rows: **one** `role='admin'` and **five** `role='customer'`. The admin account
is the founder's (`hamodetaha.ht`, the address in CLAUDE.md's own context). **All six accounts are
the founder's own.**

**Zero third-party customers have ever signed up.**

The email addresses of the other five are not written here. They are not needed to make the point,
none of them belongs to a third party, and the reg. 2 document made the same omission deliberately
and says so in its own text (`docs/legal/database-definitions-document.md:137-138`).

## This measurement expires on an EVENT, not on a date

Every other fact in this vault ages by the 14-day rule. This one does not: it stops being true the
moment **someone who is not the founder signs up**, which could be any hour of any day. Google
sign-in is already published and in production
([[0006-google-oauth-is-in-scope-for-launch]]), so the door is open.

It is the only measurement in the vault whose validity works that way. A `verified:` date will not
protect it. Re-run the query before leaning on it, not on a schedule.

## No third-party ACCOUNT is not no third-party DATA

Two routes put other people's data in the system without an account, and **neither is counted
anywhere**:

- **Businesses approached in cold outreach** — covered by privacy §10.
- **Text transcribed off the screens in a customer's demo video** — whatever the recording happens
  to capture.

Anyone reasoning about exposure from "zero customers" has to add these back by hand.

## What this supersedes

The previous census — **four accounts, two `admin`** — was measured 2026-08-23, **against the
Supabase project that has since been deleted**. Two vault notes still carry it and are now marked
`status: superseded` at those lines:

- `docs/vault/defects/admin-flag-is-a-noop-on-existing-accounts.md:62-64`
- `docs/vault/facts/credit-ledger-is-keyed-to-the-account.md:43-52`

**Neither of those notes names a project.** The link to the deleted one is **derived**, not quoted:
both are `verified: 2026-08-23`, which predates the 2026-08-27 env flip, and
`docs/legal/database-definitions-document.md:142` states it outright. Do not restate it as something
the notes say.

**Three more copies of the same stale census are still live and were left alone** (out of scope for
the pass that wrote this note — listed so they are not mistaken for agreement):

- `docs/vault/facts/token-and-money-budgets.md:51-57` — the three-account balance restatement,
  "re-confirmed 2026-08-23".
- `docs/vault/defects/content-policy-classifier-never-runs.md:70` — "the customer set is the founder
  plus two accounts".
- `docs/vault/defects/character-guard-covers-only-generated-hook-lines.md:73` — the same phrase.

## Related

- [[credit-ledger-is-keyed-to-the-account]] — superseded census, and the balances that went with it.
- [[admin-flag-is-a-noop-on-existing-accounts]] — superseded census, and the trap it illustrates.
- [[database-definitions-document-missing]] — the reg. 2 document this was measured for.
- [[0041-content-policy-is-accepted-not-fixed]] — the decision that rests on there being no
  strangers yet.
