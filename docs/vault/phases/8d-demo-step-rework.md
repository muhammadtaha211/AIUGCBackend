---
type: phase
status: verified
verified: 2026-08-25
method: "git show ecc3dfc (the diff, not the message); git show ecc3dfc:<path> | grep -n for every historical citation; the sample assets read read-only from Supabase Storage with packages/core/.work/check-a-samples-meta.ts; gates re-run at ecc3dfc in a detached git worktree with its own pnpm install"
source: code
---

# Phase 8d — the demo step rework, and the phase that shipped last

**Commit:** `ecc3dfc`, 2026-08-22 04:30 +0300. 12 files, +1248 −97. Parent `3cf0302`.
It has a real message body, and three of its claims need adjusting against the diff — below.

## 8d has the fourth letter and the last timestamp

Ordering, from `git log --format='%h A:%ad C:%cd %P' --date=iso` (linear history, author and
committer dates identical throughout, so no rebase has moved anything):

| commit    | authored         | phase  |
| --------- | ---------------- | ------ |
| `b404482` | 2026-08-21 00:33 | 8a     |
| `9dab09a` | 2026-08-21 07:03 | 8b     |
| `0629cbb` | 2026-08-21 21:18 | 8c     |
| `269f2ce` | 2026-08-21 23:36 | **8e** |
| `ecc3dfc` | 2026-08-22 04:30 | **8d** |

**The letters are plan identifiers, not build order, and they do not follow the wizard's own order
either.** The wizard runs hook → hookStudio → demo → plan → render; the letters map to shell (8a),
step 4 (8b), an addition to step 4 (8c), step 3 (8d), step 5 (8e). What was actually built first was
the forward path to a first render — plan editor, picker, render step — and the demo step came last.

That is coherent once you see that 8d is the only one of the five that reworked something already
working. `step-demo.tsx` was not created in Phase 8: `git log --diff-filter=A --oneline -- apps/web/src/components/a-wizard/step-demo.tsx`
returns `2c66d6f` (2026-08-03), and 8a touched it by 5 lines. Everything from 8a to 8e was
construction; 8d was renovation, and it waited until the thing being renovated was on the critical
path for a real customer rather than for a first end-to-end render.

**8d did not have to repair 8e.** It touches neither `step-render.tsx` nor the `a-sets/steps` routes
(`git show --name-only ecc3dfc`). What it did have to touch is _earlier_ phases, because of a wire
contract it changed — see below.

## What shipped — read off the diff

- **A good-input example pair above the upload button.** `A_SAMPLE_RECORDING_PATH` and
  `A_SAMPLE_AD_PATH` (`apps/web/src/lib/service-a.ts:55-56`) are fixed storage paths; the demos
  route signs them short-lived in a `signedSamples` helper that returns `null` on **any** signing
  failure, so a fresh environment degrades to rules-only instead of breaking the screen.
  **Both objects exist in production.** Read read-only from the `assets` bucket on 2026-08-25:
  `samples/a-steps/recording.mp4`, 37,456,844 bytes, created `2026-08-22T00:17:58.753Z`;
  `samples/a-steps/ad.mp4`, 4,448,834 bytes, created `2026-08-22T00:17:59.764Z`. Both sign
  successfully. They were uploaded 1 h 12 m before this commit was authored.
- **A duplicate-upload brake.** `DUPLICATE_DURATION_TOLERANCE_MS = 250`
  (`apps/web/src/lib/service-a-ui.ts:94`) and `duplicateDemoMatch` (`:106`) — duration is the only
  signal the browser has before the bytes move, so a match is a question with an explicit
  upload-anyway, never a gate.
- **An abortable upload.** An `XMLHttpRequest` with `onabort`, whose cancel goes inert once
  registration commits.
- **Pipeline-derived progress, out of the jobs table.** `packages/core/src/jobs/queue.ts` gains
  `WORKER_HEARTBEAT_STALE_MS` (`ecc3dfc:…:233`), `JOB_DELAY_VISIBLE_MS` (`:241`), the pure
  `deriveJobProgress` (`:271`) and `getJobProgress` (`:321`), which counts the lane ahead of a
  queued job in claim order, reads the reaper singleton (or a lease-valid running lock) as the
  heartbeat, and follows a re-run key family instead of the first attempt's corpse.
- **A client-side aspect gate that really does mirror the probe.** `clientDemoAspectError`
  (`apps/web/src/lib/service-a-ui.ts:80`) returns on `height <= width`; the server throws on
  `info.height <= info.width` (`packages/core/src/pipelines/demos.ts:151`) — the same comparison and
  the same Hebrew string, "הסרטון אופקי — צריך וידאו אנכי (9:16)".
- **`useArmedOnMount`** (`apps/web/src/components/a-wizard/step-demo.tsx:88`) generalises 8e's
  `approvedActionsArmed`, and says so in its own comment: "geometry fixes are proven-failed twice".

### The contract change, and why 8d edits 8c's and 8b's files

`GET /api/demos/[id]/analysis` stopped answering 404 when no analysis row exists. It now answers
200 with `status:"missing"` plus the analyze job's progress; 404 is reserved for a missing or
unowned **demo**. The route's own comment says so
(`apps/web/src/app/api/demos/[id]/analysis/route.ts:32`).

That is what forced two edits into earlier phases inside this commit:

- `state-picker.tsx` (8c's file, +11): `(result.body.states ?? [])` became an explicit
  `if (!result.body.states) return setError(INVENTORY_ERROR)`. Under the old 404 contract the empty
  fallback was harmless; under the new one it would have left skeleton tiles forever with no error
  anywhere. One of the eleven lines is also just the prettier fix for the over-width line 8c
  shipped.
- `step-plan.tsx` (8a's file, 8b's editor, +66): the analysis wait was rewritten from an
  unconditional spinner onto `analysisWaitView(analysis?.job)`, with three outcomes — a dead analyze
  job renders as failure instead of an eternal spinner, a stale heartbeat renders as an honest
  "stuck", and everything else keeps the spinner with a real line under it.

## Three things the message says that the diff does not support

1. **"…(queue position, elapsed, lease-aware worker heartbeat, re-run key families) on both the demo
   and plan steps."** Only the heartbeat-derived stuck/dead state reached the demo step.
   `ingestStuckView` (`ecc3dfc:apps/web/src/lib/service-a-ui.ts:231`) returns exactly three things —
   `null`, `{dead: true}` on a failed job, `{dead: false}` on a stale heartbeat. Queue position,
   elapsed and the re-run key family are all in `analysisWaitView` (`:184`), which is the plan step.
   The demo step got elapsed a day later, in `b60b5b6`'s `ingestPhaseView`.
2. **"a sample recording+ad pair (assets bucket, founder-replaceable)"** is true, but the code
   comment shipped alongside it is now stale: `apps/web/src/lib/service-a.ts:53` still says
   "Currently placeholders; see `packages/core/.work/upload-a-samples.ts`." The referenced script is
   not in the repo (`.work/` is gitignored), and the objects were uploaded before this commit
   landed. Whether the _footage_ is placeholder footage is not something the repo can answer —
   that one is `unknown`.
3. **The duplicate brake's docblock names the wrong artifact.**
   `apps/web/src/lib/service-a-ui.ts:90` says "Browser-decoded duration vs ffprobe-on-normalized
   rarely agree exactly". The stored `demos.durationMs` the brake compares against is
   `info.durationMs` from `probe(localRaw)` — ffprobe on the **raw downloaded file**
   (`packages/core/src/pipelines/demos.ts:149` and `:184`), before `normalizeVideo` runs. Both sides
   measure the same bytes, which makes 250 ms more conservative than the comment implies. Harmless,
   but the comment is the thing anyone tuning the tolerance will read.

## The gate

8d pinned **21 new tests** — 13 in `apps/web/test/service-a-ui.test.ts` under a new
`describe("the demo step rework (8d)")` with nested describes for the duplicate brake,
`analysisWaitView` and `ingestStuckView`; 8 in `packages/core/test/jobs.test.ts`
(`git show ecc3dfc -- '<file>' | grep -cE '^\+\s*(it|test)\('`). It is the largest gate of the five,
and the only one that pins core behaviour rather than a pure UI helper.

The ones that carry the phase's actual decisions:

- `it("a dead analyze job is a failure, never an eternal spinner — even with a stale heartbeat")`
- `it("a stale heartbeat over live work reads as stuck; unknown does NOT (fresh envs)")` — the
  three-valued heartbeat is what stops a fresh environment with no reaper reading as broken
- `it("a budget-parked or deep-backoff job reads as paused, never 'starts soon'")`
- `it("getJobProgress counts the lane ahead of a queued job in claim order")`
- `it("newestMatching follows a re-run key family instead of the first attempt's corpse")`
- `it("aspect gate: horizontal and square fail with the probe's own Hebrew; vertical passes")`

### Gates re-run at `ecc3dfc` on 2026-08-25

Same detached worktree and method as [[8a-wizard-shell-and-read-only-plan]], which explains both
caveats.

| gate                                                        | exit  | result                                                 |
| ----------------------------------------------------------- | ----- | ------------------------------------------------------ |
| `pnpm typecheck`                                            | 0     | green, 6 of 7 projects (62 s)                          |
| `pnpm lint`                                                 | **1** | red, as it was before Phase 8 began                    |
| `pnpm --filter @aiugc/web test`                             | 0     | **200 / 200** (13 s)                                   |
| `pnpm --filter @aiugc/core test -- --fileParallelism=false` | **1** | 336 passed, 1 failed (337) — the same harness artifact |

200 is 186 (8e) + 1 (`3cf0302`) + 13. Core moves for the first time since 8b: 329 → 337, exactly the
8 tests `jobs.test.ts` gained. The single failure is the `e2e.test.ts` `"steps":[{` assertion against
a 500-character DRY_RUN props truncation — it fails at HEAD inside the same long-path worktree and
passes at HEAD in the founder's own tree, so it is the harness, not the commit.

**8d shipped all 12 of its files prettier-clean**, like 8e before it
(`git show ecc3dfc:<path> | prettier --check --stdin-filepath <path>`).

## What it left behind

- **The honest-progress pattern was only half-applied.** 8d built `analysisWaitView` for the plan
  step and `ingestStuckView` for the demo step. `b60b5b6` then added `ingestPhaseView` (elapsed on
  the demo step), `planWaitView` (the plan-generation twin) and `renderWaitView` (8e's screen), and
  extended `deriveJobProgress` with a `progress` fraction read defensively off the render job's
  `state.renderProgress` checkpoint. Read as a pair, 8d is the mechanism and `b60b5b6` is the rest
  of its surface.
- **The `.work/upload-a-samples.ts` reference in `service-a.ts:53`** points at a gitignored file, so
  replacing the founder-curated example is not a documented procedure anywhere a future reader can
  follow.

## Not verifiable from the repo

The message reports "34 findings, 24 upheld -> 8 distinct defects, all fixed; 12/12 fresh skeptics
upheld the fixes" and "10 mutation tests pin the decisions". No artefact of any of it exists in the
tree. `unknown`, and recorded as such rather than repeated — the same call as in
[[8a-wizard-shell-and-read-only-plan]].

## Related

- [[8a-wizard-shell-and-read-only-plan]] · [[8b-plan-editor]] · [[8c-inventory-picker]] · [[8e-render-step]]
- [[worker-exits-on-a-dropped-connection]] — the worker whose heartbeat this phase learned to read
- [[events-table-is-empty]] · [[gate-results]]
