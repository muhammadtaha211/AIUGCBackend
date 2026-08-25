---
type: phase
status: verified
verified: 2026-08-25
method: "git show 0629cbb (the diff — the commit body is empty); git show 0629cbb:<path> | grep -n for every historical citation; gates re-run at 0629cbb in a detached git worktree with its own pnpm install"
source: code
---

# Phase 8c — the inventory picker: add-a-step from the analysed grid

**Commit:** `0629cbb`, 2026-08-21 21:18 +0300. 4 files, +650 −30.
**The commit body is empty** — `git log -1 --format=%B 0629cbb` is the subject and a
`Co-Authored-By` trailer. Everything below is the diff.

It lands 66 minutes after `72e374b` and 14 hours after 8b, with nothing committed between 07:03 and
20:12 that day.

## What shipped — read off the diff

- **`state-picker.tsx`, new, 370 lines.** Its own header comment states the shape:
  add-a-step is choosing from the analysed grid, never scrubbing a timeline. One no-query GET loads
  the whole inventory's metadata; the eligible list is paged `ANALYSIS_PAGE_SIZE` at a time, and
  thumbs are signed through `?indexes=` only for pages the customer has actually been granted, so a
  never-shown state's thumb URL is never minted.
- **Two tiers.** `pickerPools` (`0629cbb:apps/web/src/lib/service-a-ui.ts:434`) puts
  high-legibility, non-idle, non-duplicate, non-skipped states in the main grid and everything else
  in a collapsed tier. `legibility === "unreadable"` states get no tile at all — the server rejects
  them whoever picked them, so a tile would be a dead pick. Its docstring says the split mirrors
  core's quality/legal pools, and **only the quality half does**: core's `legal` pool also excludes
  skipped kinds and `sameStateAsPrevious`, while the picker's collapsed tier deliberately keeps
  them — a human may legitimately want the OAuth screen in a signup-flow ad. The wider tier is the
  right call; the word "mirroring" is not.
- **v1 analyses are handled on the data, not on a version flag.** `isSkippedScreenKind`
  (`…service-a-ui.ts:420`) treats an absent `screenKind` as "no information" and keeps the state
  visible, so a v1 timeline with no `screenKind` anywhere simply fills the main grid.
- **Adding grows the draft, and only the draft.** `insertDraftStep` (`…service-a-ui.ts:459`) appends
  a step carrying the state's `sourceIndex`, `timestampMs` and `actionType`, the trimmed label,
  `durationMs: 0` and `added: true`, then re-sorts by `timestampMs`. Nothing in the picker talks to
  the plan routes; 8b's existing save/approve machinery persists it. The zero duration is deliberate and
  surfaced — the editor's total appends
  "(בלי הצעדים החדשים — יתעדכן בשמירה)" while any `added` step is in the draft, because the server
  re-derives duration from `sourceIndex` on save.
- **Three plan-editor changes the subject does not mention.** The cards-thumb failure stopped being
  a "refresh the page" dead end and became an in-place retry (a new `cardsNonce` state, a
  `נסה שוב` button wired through a new `onRetryCards` prop, and `cardsNonce` added to the effect's
  dependency list); the cards effect's key was re-pointed from `readySteps` to `draft`, because an
  added step's card needs its state fetched before the save exists; and the editor gained
  `key={plan.planId}` so a fork remounts it. Only the last of the three has anything to do with the
  picker.

## The gate

8c pinned **6 new tests**, all in `apps/web/test/service-a-ui.test.ts`, under a new
`describe("inventory picker (8c)")` with a nested `describe("insertDraftStep (add-a-step)")`
(`git show 0629cbb -- apps/web/test/service-a-ui.test.ts | grep -cE '^\+\s*(it|test)\('`).

Three of the six are the phase's real decisions:

- `it("absent screenKind means no information — stays visible (the v1 case, on the data)")`
- `it("splits quality from legal-but-poor and drops unreadable entirely")`
- `it("re-adding a deleted step with its stored label round-trips to clean")` — the round-trip that
  makes add and delete commute with 8b's dirty detection

### Gates re-run at `0629cbb` on 2026-08-25

Same detached worktree and method as [[8a-wizard-shell-and-read-only-plan]], which explains the two
caveats.

| gate                                                        | exit  | result                                                 |
| ----------------------------------------------------------- | ----- | ------------------------------------------------------ |
| `pnpm typecheck`                                            | 0     | green, 6 of 7 projects (46 s)                          |
| `pnpm lint`                                                 | **1** | red, as it was before Phase 8 began                    |
| `pnpm --filter @aiugc/web test`                             | 0     | **181 / 181** (9 s)                                    |
| `pnpm --filter @aiugc/core test -- --fileParallelism=false` | **1** | 328 passed, 1 failed (329) — the same harness artifact |

181 is 175 (8b) + 6. `packages/core` is untouched between 8b and 8d, so the core numbers are 8b's.
The one failure is the `e2e.test.ts` `"steps":[{` assertion against a 500-character DRY_RUN props
truncation, which fails at HEAD in the same long-path worktree and passes at HEAD in the founder's
tree — see [[8a-wizard-shell-and-read-only-plan]].

**8c shipped 3 of its 4 files prettier-dirty** —
`state-picker.tsx`, `step-plan.tsx` and `service-a-ui.test.ts`
(`git show 0629cbb:<path> | prettier --check --stdin-filepath <path>`). One of those is not
cosmetic bookkeeping: the over-width line is
`0629cbb:apps/web/src/components/a-wizard/state-picker.tsx:107`, and the prettier fix for exactly
that line is inside `ecc3dfc`'s (8d's) diff.

## What it left behind

- **A silent-failure path in the picker's own thumb fetch, closed by 8d.**
  `0629cbb:…/state-picker.tsx:102` reads `const signed = (result.body.states ?? []).filter(...)`.
  A 200 that carries no `states` therefore produced an empty signed set, no error and no retry —
  skeleton tiles forever. `ecc3dfc` replaced it with an explicit
  `if (!result.body.states) return setError(INVENTORY_ERROR)`
  (`apps/web/src/components/a-wizard/state-picker.tsx:105` today), and its comment names the cause:
  the analysis route began answering `{status:"missing"}` with a 200 instead of a 404 in 8d. This is
  the one place where a later phase had to repair an earlier one's code.
- **No cap and no warning on the add side.** `insertDraftStep` has no length check
  (`apps/web/src/lib/service-a-ui.ts:712` today, unchanged in substance), and `addWarning` — the
  soft "more than `a_steps_max` steps" line — did not exist until `b60b5b6`
  (`git log -S"addWarning" --oneline`). For the two days between 8c and `b60b5b6` the editor warned
  about a plan that was too short and said nothing about one made arbitrarily long by the very
  button 8c added. The founder's ruling recorded in the code is that hand edits are never capped, so
  the warning is the whole remedy — see [[steps-format-defaults-are-code-constants]] for the cap
  itself.

## Related

- [[8a-wizard-shell-and-read-only-plan]] · [[8b-plan-editor]] · [[8e-render-step]] · [[8d-demo-step-rework]]
- [[steps-format-defaults-are-code-constants]] — `A_STEPS_MAX_DEFAULT`, and what `b60b5b6` moved
