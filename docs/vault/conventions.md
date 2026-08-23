# Conventions

## Frontmatter — required on every note

```yaml
---
type: fact | decision | falsified | defect | phase
status: verified | carried | unknown | superseded
verified: 2026-08-23          # date of last actual measurement, not last edit
method: "select value from app_config where key='daily_caps'"
source: db | code | browser | founder | inference
supersedes: "[[old-note]]"    # optional
---
```

`method` is the point. A fact without the command or file:line that produced it is a rumour with a
date on it. `source: inference` is allowed but must say what it was inferred from.

## When to read

- **Session start**: `README.md` and this file.
- **Before asserting any project fact** — a cap, a balance, a version, a cost, a decision, a file
  path — grep the vault. If a note exists, use it and name the file. If `verified` is more than 14
  days old, re-measure before relying on it, then update the note.
- **Before proposing an approach**: grep `falsified/`. Do not re-derive a dead hypothesis.

## When to write

Exactly these moments:

- A phase gate closes → `phases/`, with gate results and commit SHAs.
- A number is measured → `facts/`, with the exact command.
- The founder makes a decision → `decisions/`, with the options offered and the reason chosen.
- A claim is disproved → `falsified/`, and the original note gets `status: superseded`.
- A defect is found and not fixed → `defects/`.

## When not to write

Mid-task speculation, plans in progress, or inference dressed as measurement. If the honest
frontmatter would be `status: unknown`, either verify it or leave it out. The vault is not a
scratchpad — that's what the session is for.

## The falsification rule

**Never delete a note that turned out to be wrong.** Move it to `falsified/`, keep the original
claim verbatim, and record what killed it, when, and who proposed it.

Half the value produced on this project came from claims being disproved. A vault that only records
what's currently true loses the record of what was believed and why it was wrong — which is exactly
the thing that stops a dead hypothesis being re-derived six weeks later.

## Naming and linking

- Files: lowercase, hyphenated, descriptive — `platform-token-caps.md`, not `caps.md` or `note-3.md`.
- Decisions get a number: `decisions/0007-what-was-decided.md`.
- Link with `[[wikilinks]]`. A defect that caused a decision should link to it and back.
- One claim per note. If a note needs two `verified` dates, it's two notes.
