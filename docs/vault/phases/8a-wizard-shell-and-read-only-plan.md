---
type: phase
status: verified
verified: 2026-08-25
method: "git show b404482 (the diff, not the message); git show b404482:<path> | grep -n for every historical citation; gates re-run at b404482 in a detached git worktree with its own pnpm install"
source: code
---

# Phase 8a — the five-step wizard shell and a read-only plan surface

**Commit:** `b404482`, 2026-08-21 00:33 +0300. 17 files, +1247 −303. Parent `afe99ad`.
Prepared a day earlier by `9c323aa` ("the three exports Phase 8's picker and render step need",
2026-08-20 19:02), which created the client-safe `@aiugc/core/plan-format` entry that 8a then grew.

**Follow-on repairs, both to strings 8a itself shipped:** `f8a8dea` (+95 min) and `72e374b`
(+19 h 39 m — after 8b had already carried the string forward unchanged).

## What shipped — read off the diff

- **`aWizardSteps(format)` replaces the single `A_WIZARD_STEPS` constant.** `"steps"` returns
  `["hook","hookStudio","demo","plan","render"]`; `"full"` returns the voiced seven-step path
  (`b404482:apps/web/src/lib/service-a-ui.ts:31`). The five-step shape is the decision recorded in
  [[0001-five-step-steps-wizard]]. This commit also deleted the old pin: the diff removes exactly
  one test, `it("is one fixed path, persona first (the gallery filters by persona)")`.
- **Durable identity `?demo=&step=`** on the static route, restored once on mount and
  ownership-scoped to the selected business.
- **The read-only plan surface** — `step-plan.tsx`, new, 442 lines: thumb, label, timestamp,
  visibleText, assembled durations, `readTimeMs` headroom and a steps-only total, over GET plan
  plus a batched analysis `?indexes=`.
- **`readTimeMs` / `totalRuntimeMs` moved into `plan-format`, pure, with re-exports.** That move is
  the whole of 8a's `packages/core` change: the diff of
  `packages/core/src/pipelines/demo-step-plans.ts` is an import block, a comment, a re-export line
  and the deletion of the two function bodies. No core behaviour changed.
- **`useJobPoll` gains `pollErrorRoute` and an `activeRef` guard** — 404 becomes a normal state for
  callers that pass `onMissing`, and a late out-of-order poll delivery is dropped instead of
  regressing the surface.

### The render step was a placeholder — and the file called step-render was not it

`b404482:apps/web/src/components/a-wizard/a-wizard.tsx:261` is a Hebrew paragraph:
"יצירת הסרטון תיפתח כאן בקרוב — קודם מאשרים את תוכנית הצעדים."

`step-render.tsx` was **not touched by 8a and was not the placeholder**: at `b404482` it is the
321-line voiced `StepARender`, still taking `audioId` and `personaId`, which the steps wizard never
mounted. The placeholder is the paragraph, not the file.

## Three things the commit message says that the diff does not support

The message is unusually detailed, which makes the three places it overstates worth naming. In each
case the code's answer is below, and none of them is a defect — they are description drift.

1. **"re-exports preserving the server import surface."** There was no server import surface to
   preserve. At `b404482`, `git grep -n -E "readTimeMs|totalRuntimeMs" b404482 -- 'packages/*/src' 'apps/*/src'`
   returns **nothing**, and the full file list
   (`git grep -l "readTimeMs" b404482`) is `plan-format.ts`, `demo-step-plans.ts` itself,
   `apps/web/src/lib/service-a-ui.ts` (which imports from `@aiugc/core/plan-format` directly, not
   from the re-export) and the two test files. The only consumer of the re-export was — and at HEAD
   still is — `packages/core/test/demo-step-plans.test.ts`. The move itself is real and right; the
   sentence justifying its shape is not.
2. **"all five plan states … render something actionable."** Five states exist and none renders
   blank, but they occupy **four branches**: `pending` and `planning` collapse into one `generating`
   branch through `isActivePlanStatus`
   (`b404482:apps/web/src/components/a-wizard/step-plan.tsx:127`). The four enum values are
   `pending`, `planning`, `ready`, `failed` (`packages/core/src/db/schema.ts:39-44`); the fifth is
   _no row at all_, held separately as `planMissing` (`…step-plan.tsx:45`) because the plan GET 404s
   until the job inserts.
3. **"the retry collapse window is disabled + surfaced."** Nothing is disabled.
   `git show b404482:apps/web/src/components/a-wizard/step-plan.tsx | grep -n "disabled"` returns
   exactly one hit — line 188, inside a _comment_ ("Generate / retry — one button, disabled through
   the collapse window"). The generating branch simply renders a spinner and no control at all.
   Stronger in effect, but not what the comment describes.

A fourth is in the code rather than the message: the comment beside the placeholder says the render
branch is "reachable only by hand-editing the URL". It is not reachable that way either.
`clampRestoredStep`, added in the same commit, clamps any restored index to at most the plan step
once the demo is ready (`b404482:apps/web/src/lib/service-a-ui.ts:140-149`), and the commit's own
test asserts it: `it("clamps a restored step to what the surviving state can support")`. The render
branch was dead UI for the 23 hours until 8e. The comment did not survive — 8e replaced it.

## The gate

**There is no phase-plan document in this repo.** `git grep -n "Phase 8"` over the tree returns one
stray mention, in [[v10-is-the-last-working-prompt]]; the two `§4` comments 8e later added point at
a section of something that was never committed. A phase's gate therefore has to be read off what
the commit itself pinned.

8a pinned **30 new tests** across four files
(`git show b404482 -- '*test*' | grep -cE '^\+\s*(it|test)\('`, then the same per file):
`apps/web/test/service-a-ui.test.ts` +22 in three new describe blocks, `service-a.test.ts` +4,
`use-api.test.ts` +3, `packages/core/test/demo-step-plans.test.ts` +1.

The sharpest is the last one: `it("the re-exports ARE the plan-format functions, not copies")`. The
`plan-format` move is only safe if the re-export resolves to the same object, and that assertion is
what says so — even though, per the point above, the test is the only thing consuming it.

### Gates re-run at `b404482` on 2026-08-25

Detached worktree at `b404482` with its own `pnpm install --frozen-lockfile`, commands serial from
that worktree's root. `apps/admin` and `packages/remotion` are untouched by every Phase 8 commit
and were not run — [[gate-results]] covers those at HEAD.

| gate                                                        | exit  | result                                                         |
| ----------------------------------------------------------- | ----- | -------------------------------------------------------------- |
| `pnpm typecheck`                                            | 0     | green, 6 of 7 projects (69 s)                                  |
| `pnpm lint`                                                 | **1** | red — and red before Phase 8 began, see below                  |
| `pnpm --filter @aiugc/web test`                             | 0     | **146 / 146** (42 s)                                           |
| `pnpm --filter @aiugc/core test -- --fileParallelism=false` | **1** | 327 passed, 1 failed (328) — the failure is the harness, below |

Note the command form. `pnpm --filter @aiugc/core test --fileParallelism=false` — the form written
in [[gate-results]]'s `method` — **does not run at all** on pnpm 9.15.9. It exits 1 in about
4 seconds with `ERROR Unknown option: 'fileParallelism'`. The flag has to come after `--`.

**The lint gate was already red before Phase 8 existed.** `pnpm lint` exits 1 at `afe99ad` (8a's
parent) and at all five phase commits. The _file count_ from a fresh worktree is not usable:
`core.autocrlf` is true on this machine, a fresh checkout materialises CRLF, and prettier's
`endOfLine: "lf"` default then flags nearly the whole tree — 307 files at `b404482` against 142 in
the founder's own working tree at HEAD. What **is** measurable per commit, free of that artifact, is
whether the files a commit touched were prettier-clean, by piping the blob:
`git show <sha>:<path> | prettier --check --stdin-filepath <path>`. **8a shipped 2 of its 17 files
dirty** — `packages/core/src/pipelines/demo-step-plans.ts` and its test.

**The single core failure belongs to the harness, and this is proven, not assumed.**
`test/e2e.test.ts > steps format: analyse -> plan -> approve gate -> flat-priced silent set` fails on
`expect(renderedProps).toContain('"steps":[{')`. The DRY_RUN renderer writes
`JSON.stringify(props).slice(0, 500)` (`packages/core/src/providers/remotion.ts:126` at HEAD, `:109`
at `b404482`), and the props carry two absolute paths before `steps`; the worktree lives under a
~110-character scratchpad path, which pushes `"steps"` past the cut. The control settles it: the
same file **passes 8/8 at HEAD in the founder's own tree and fails the same single assertion at HEAD
inside the long-path worktree**. The test file is byte-identical across the whole range —
`git log --oneline -- packages/core/test/e2e.test.ts` stops at `43f96c9` (Phase 6). The same one
failure appears at every Phase 8 commit for the same reason.

## What it left behind

| left behind                                                                 | closed by                                     |
| --------------------------------------------------------------------------- | --------------------------------------------- |
| The render step is a Hebrew "coming soon" paragraph, and unreachable        | `269f2ce` (8e), 23 h later                    |
| The plan surface is read-only — no edit, no delete, no approve, no continue | `9dab09a` (8b) and `269f2ce` (8e)             |
| A failed plan offers a live retry even when the failure was a daily quota   | `f8a8dea`, 95 min later                       |
| The negative-headroom warning states arithmetic, not consequence            | `72e374b`, 19 h 39 m later — and **untested** |

- `f8a8dea` repairs 8a's own surface, not something older. `planFailureNotice` first appears in
  `b404482` (`git log -S"planFailureNotice" --oneline`), and `f8a8dea` is the commit that adds its
  `retryable` field. `f8a8dea` also introduced `QUOTA_MARKER`
  (`apps/web/src/lib/service-a-ui.ts:541`, `git log -S"QUOTA_MARKER" --oneline`) — the
  substring-match on Hebrew copy that [[quota-marker-test-does-not-protect-it]] is about. **That
  defect belongs to `f8a8dea`, an 8a follow-on — not to 8b, where the memory index files it.**
- `72e374b` rewrote a string 8a shipped. The old copy sits at
  `b404482:apps/web/src/components/a-wizard/step-plan.tsx:415`; 8b's editor moved it to `:657`
  unchanged; `72e374b` replaced it 13 hours after 8b, with the reason in the comment — it "confused
  the founder (user #1)". It adds no test, and the new copy is still unpinned today: neither
  "קצרו את הכיתוב" nor "ייחתך לצעד הבא" appears anywhere under `apps/web/test/`, and the only
  headroom test asserts `stepHeadroomMs` arithmetic. Its own subject overstates too — the new copy
  names the consequence _and_ keeps the millisecond figure, moved into parentheses.
- **8a shipped a comment whose stated cause is wrong**, and it is still in the tree.
  `apps/web/src/lib/service-a-ui.ts:548` says "RLS hides jobs.last_error entirely";
  `git log -S"RLS hides" --oneline -- apps/web/src/lib/service-a-ui.ts` names `b404482` as its
  origin. It is not RLS — see [[plan-failure-diagnostics-are-unreachable]].

## Not verifiable from the repo

The commit message describes three adversarial review rounds and 13 mutation tests. Nothing in the
tree records either — no artefact, no fixture, no log survives them. That part of the message is
`unknown`, not carried: the review happened in a session, not in git.

## Related

- [[8b-plan-editor]] · [[8c-inventory-picker]] · [[8e-render-step]] · [[8d-demo-step-rework]]
- [[0001-five-step-steps-wizard]] — the five-step decision this commit implements
- [[gate-results]] — the same gates at HEAD
