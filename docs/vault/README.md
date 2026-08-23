# AIUGC — project vault

Source of truth for the Service A steps pipeline. Lives at `docs/vault/` inside the repo and is
git-tracked, so a note changes in the same commit as the code it describes and `git log` gives every
fact a provenance trail.

Read [[CONVENTIONS]] before writing anything.

## Why this exists

This project ran on monolithic handover documents (revisions 1 through 6). Each rewrote the whole
document, and each carried unverified claims forward. Three of them were later proven wrong by the
code — a credit balance that was never reproduced, a cited doc path that never existed, and a
prompt-version regression that was a small-sample artifact. A handover that must be rewritten
wholesale to correct one fact will keep doing that.

Atomic notes fix it: one fact per file, each declaring how it was verified and when. A stale note is
visible as a stale note instead of hiding inside a wall of confident prose.

## Structure

| Folder | Holds | One note per |
|---|---|---|
| `facts/` | Measured values — caps, balances, costs, timings, config state | thing measured |
| `decisions/` | Choices made, with the options and the reason | decision |
| `falsified/` | Claims that were believed and then disproved | dead claim |
| `defects/` | Known problems, fixed or deliberately not | defect |
| `phases/` | What each build phase shipped, its gate, its commit SHAs | phase |

## The one rule

**Every note declares its provenance.** `status: verified` means someone ran something; `carried`
means it was inherited and not re-checked; `unknown` means don't build on it. A note that can't
honestly fill in `status` and `verified` is not ready to be written.

## Still to backfill

Marked here so the gaps are visible rather than assumed absent. Each needs verifying against the
code or the DB, not transcribing from a handover:

- ~~`facts/`~~ — **done 2026-08-23.** 14 notes: config state, credit costs, test counts, gate
  durations and results, the corpus, the fixtures, the tracer, plus four the backfill turned up
  (`first-call-violation-rate`, `events-table-is-empty`, `disk-is-full`,
  `credit-ledger-is-keyed-to-the-account`).
- ~~`falsified/`~~ — **done 2026-08-23.** The −30 credit balance, `docs/backend-handover.md`, and
  "every upload spends ₪2.40" all written.
- `defects/` — the rev-6 §6 list: worker restart policy, owed migration 0027→1.5M, `--admin` no-op,
  RLS-hidden validator diagnostics, `נסו שוב מחר` substring coupling, `serve-files.ts` ranges,
  unrenderable hook line, last-step-shorter-than-displayed. Add from the facts pass:
  Remotion leaks 3.13 GB of temp dirs, `study-app`'s `_comment` contradicts its own
  `dryRunSourceIndexes`, `recordAudioScriptPointerMove` is dead code, `llmCostAgorot` is
  triplicated past its own "extract at the 3rd" rule, `apps/cli` and `apps/worker` have no tests.
- `phases/` — 8a through 8e
- `decisions/` — URL identity, `?indexes=` over plan-GET signing, the `plan-format` move, the
  mount-under-cursor rule, price-on-button
