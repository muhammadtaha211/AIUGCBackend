# AIUGC — project vault

Source of truth for the project — the Service A steps pipeline ([[0020-service-a-is-hook-and-steps-only]]) and the Service B talking-head pipeline ([[0023-hook-is-a-remotion-animation-opener-clips-retired]]). Lives at `docs/vault/` inside the repo and is
git-tracked, so a note changes in the same commit as the code it describes and `git log` gives every
fact a provenance trail.

Read [[CONVENTIONS]] before writing anything.

## Why this exists

This project ran on monolithic handover documents (revisions 1 through 6). Each rewrote the whole
document, and each carried unverified claims forward. Three of them were later proven wrong by the
code — a credit balance that came from summing the ledger on the wrong key, a cited doc path that
never existed, and a prompt-version regression that was a small-sample artifact. A handover that
must be rewritten wholesale to correct one fact will keep doing that.

Atomic notes fix it: one fact per file, each declaring how it was verified and when. A stale note is
visible as a stale note instead of hiding inside a wall of confident prose.

## Structure

| Folder       | Holds                                                          | One note per   |
| ------------ | -------------------------------------------------------------- | -------------- |
| `facts/`     | Measured values — caps, balances, costs, timings, config state | thing measured |
| `decisions/` | Choices made, with the options and the reason                  | decision       |
| `falsified/` | Claims that were believed and then disproved                   | dead claim     |
| `defects/`   | Known problems, fixed or deliberately not                      | defect         |
| `phases/`    | What each build phase shipped, its gate, its commit SHAs       | phase          |

## The one rule

**Every note declares its provenance.** `status: verified` means someone ran something; `carried`
means it was inherited and not re-checked; `unknown` means don't build on it. A note that can't
honestly fill in `status` and `verified` is not ready to be written.

## Still to backfill

Marked here so the gaps are visible rather than assumed absent. Each needs verifying against the
code or the DB, not transcribing from a handover:

- ~~`facts/`~~ — **done 2026-08-23.** 15 notes: config state, credit costs, test counts, gate
  durations and results, the corpus, the fixtures, the tracer, plus five the backfill turned up
  (`first-call-violation-rate`, `events-table-is-empty`,
  `remotion-temp-leak-filled-the-disk`, `per-account-cap-blind-spot`,
  `credit-ledger-is-keyed-to-the-account`).
- ~~`falsified/`~~ — **done 2026-08-23.** The −30 credit balance, `docs/backend-handover.md`, and
  "every upload spends ₪2.40" all written.
- ~~`defects/`~~ — **done 2026-08-23.** 15 notes. All eight rev-6 §6 items were checked; two came
  back with their premise wrong and are recorded with the correction (`serve-files.ts` ranges is a
  latent suffix-range nit, not broken Range handling; the unrenderable hook line **cannot** ship —
  the generated path throws — but three _other_ burned-text paths have no character guard at all).
  The RLS diagnosis on plan diagnostics was also wrong: `getDb()` bypasses RLS, nothing queries the
  column. Seven notes came from this pass and the facts pass rather than the list, the sharpest
  being that the content-policy classifier has never been called in the repo's entire history while
  `docs/04` says it blocks renders.

  One rev-6 item was **dropped as false**: `recordAudioScriptPointerMove` is not dead code — it is
  called from `apps/web/src/app/api/audio/[id]/route.ts:31` and its zero rows are a passing
  assertion.

- ~~`phases/`~~ — **done 2026-08-25.** Five notes, 8a through 8e, each with its gate re-run at that
  exact commit in a detached worktree. Three things the backfill established that the commit log
  does not say: **8e landed 4h54m before 8d** and the letters are plan identifiers, not build order
  ([[8d-demo-step-rework]]); the gates are written down nowhere, so each phase's gate had to be read
  off the tests it added; and `pnpm lint` was already red at 8a's parent, so it is not a phase
  signal. Several commit-message claims did not survive the diff and are recorded in the notes
  themselves; one became [[plan-format-re-export-has-server-callers]].
- `decisions/` — URL identity, `?indexes=` over plan-GET signing, the `plan-format` move, the
  mount-under-cursor rule, price-on-button (`3cf0302` — see [[8e-render-step]] for the commit and
  the walkthrough it came out of)
