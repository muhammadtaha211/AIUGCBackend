---
type: falsified
status: superseded
verified: 2026-08-23
method: "ls docs/ ; git log --all --diff-filter=A --name-only -- 'docs/*handover*' '*handover*' → no commits; grep -rn 'backend-handover' over the tree → no matches"
source: code
---

# "`docs/backend-handover.md`"

## The claim

Handovers cited `docs/backend-handover.md` as a source for backend behaviour.

## What killed it

The file does not exist and never has.

- `ls docs/` → `00-overview.md`, `01-schema.md`, `02-jobs.md`, `03-storage.md`,
  `04-integrations.md`, `05-billing.md`, `06-cli-first.md`, `superpowers/`, `vault/`. Nothing else.
- `git log --all --diff-filter=A --name-only -- '*handover*'` → **no commits.** Not deleted, not
  renamed, not on another branch. Never added.
- Nothing in the tree references the string `backend-handover` either, so the citation was not even
  self-consistent.

## Why it is worth a note

A path is the cheapest kind of claim to check and the most expensive kind to carry: it looks like a
citation, so it is not questioned, and every rewrite copies it forward. This one survived at least
six handover revisions.

The real backend docs are the numbered set indexed by `docs/00-overview.md`. Cite those.

## Lesson

Before citing a path, `ls` it. If it turns out not to exist, `git log --all --diff-filter=A` it too
— "it used to exist" and "it never existed" are different facts and only the second one is worth
recording.
