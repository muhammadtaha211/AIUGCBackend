---
type: defect
status: verified
verified: 2026-09-03
method: "grep -rn 'הגדרות מאגר|database definitions|definitions document' --include=*.md . (excluding node_modules and .claude/worktrees): two hits, both inside docs/legal-review.md describing the duty — no such document exists; the live assertion is apps/web/src/app/(legal)/privacy/page.tsx:313-314"
source: code + founder
---

# Privacy §11 claims compliance with the 2017 Data Security Regs; the reg. 2 document does not exist

## What the page now says

Added 2026-09-03 as the resolution of the P8 marker
([[../decisions/0014-legal-page-positions]]), privacy §11 closes with:

> אנחנו פועלים לפי החובות החלות עלינו לפי תקנות הגנת הפרטיות (אבטחת מידע), התשע״ז-2017.

The sentence is a compliance claim addressed to every visitor. It is deliberately modest — it names
no security level and promises no specific control — but it is still a claim.

## What is missing

The database is a **מאגר המנוהל בידי יחיד** (managed by an individual, at most two further
authorised users, well under 10,000 subjects, not a data broker, no professional-secrecy data).
That is the lightest category in the regulations, and it is easy to read it as "the regulations
mostly don't apply to me". Reg. 21(4) says otherwise: such a database is still subject to regs. 1,
**2**, 6(א), 9(א), 11(א), 12–14 and 20.

Reg. 2 is the **מסמך הגדרות מאגר** — the database-definitions document. **It has never been
written.** Repo-wide the phrase appears only inside `docs/legal-review.md`, twice, both times
describing the duty rather than discharging it.

The regulation text is mirror-sourced, not first-party: `industry.org.il`, graded `[M]` as source 6
in `docs/legal-review.md`, because `nevo.co.il` and `he.wikisource.org` were both unreachable.
Counsel is asked to confirm the classification and the duty set.

## Why it matters more than it looks

The exposure is not the missing paperwork on its own. It is the gap between a public compliance
claim and an unstarted obligation, at the exact moment the account list stops being the founder
plus two test accounts. Queue item 1 opens the service to strangers; the claim is already live.

Everything the document has to describe already exists and is written down — it is a collation
job, not an investigation:

- what the database holds and why → privacy §3 and §5
- who the recipients are and where they sit → privacy §6, and `docs/04-integrations.md`
- retention and deletion → privacy §8 and §12, and `docs/03-storage.md`
- access control and the signed-URL model → privacy §11, and the RLS rules in
  `supabase/migrations/`
- transfers abroad and their basis → privacy §7

## Fix shape

Write the document. It is one file, not a system: the identity of the database owner, the purposes,
the categories of data and subjects, the transfers abroad, the systems it runs on, the access
holders, and the main risks. It does not belong in `apps/` — it is an operator record, and
`docs/` is where it should sit so it changes in the same commit as the pages it mirrors.

It is listed first in the closing "still owes" list of `docs/legal-review.md`, which is where a
lawyer will look for it.

## Related

- [[../decisions/0014-legal-page-positions]] — the pass that added the assertion
- [[content-policy-classifier-never-runs]] — the same shape: a document describing a control that
  does not exist
