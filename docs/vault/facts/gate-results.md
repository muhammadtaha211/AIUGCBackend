---
type: fact
status: verified
verified: 2026-08-23
method: "each command timed with date +%s around it, run serially from repo root at commit b60b5b6 on branch feat/service-a-steps; the remotion suite re-run at 07:23 after disk was freed"
source: code
---

# The six gates, timed — one is red

Run serially (never in parallel: the core suite OOMs the machine under parallel vitest).

**One gate is red: `pnpm lint`.** Everything else passes.

| gate                                                     | exit  | seconds | result                   |
| -------------------------------------------------------- | ----- | ------- | ------------------------ |
| `pnpm typecheck`                                         | 0     | 33      | green, all 6 packages    |
| `pnpm lint`                                              | **1** | 17      | **red** — 143 files      |
| `pnpm --filter @aiugc/core test --fileParallelism=false` | 0     | 330     | green, 339/339           |
| `pnpm --filter @aiugc/web test`                          | 0     | 22      | green, 212/212           |
| `pnpm --filter @aiugc/admin test`                        | 0     | 8       | green, 28/28             |
| `pnpm --filter @aiugc/remotion test`                     | 0     | 36      | green, 45/45 — see below |

Total wall clock: **7 minutes**. `pnpm typecheck` reports "Scope: 6 of 7 workspace projects" —
the seventh is the repo root, which has no `typecheck` script; all six packages have one and all six
pass. The core suite is 330s of that; vitest's own report says 241s in
tests and 57s collecting.

## `pnpm lint` is red and has been for a while

`prettier --check .` reported **143 files** at `b60b5b6` and **142** after the vault backfill
(`facts/token-and-money-budgets.md` was formatted while being corrected). The debt is spread across
every app and package, `docs/`, and `prompts/`.

Eight of the 142 are inside this vault: all five `docs/vault/.obsidian/*.json`, plus `README.md`,
`CONVENTIONS.md` and `falsified/v10-is-the-last-working-prompt.md`. Every note written in the
backfill is prettier-clean.

This is whole-tree formatting debt, not a regression from any one commit. `pnpm format` fixes it in
one pass and nobody has run it — **and nothing makes them**: there is no pre-commit hook, no git
hook and no CI workflow in the repo that runs `lint`. A red gate with no brake behind it is the
actual finding here, not the number.

## The remotion gate was red for 45 minutes, and it was the disk

At 06:41 the suite failed 44/45. `packages/remotion/test/frame-delivery.test.ts` →
`ServiceASteps frame delivery > shows a new source frame on (nearly) every output frame` died after
47.9s with `ENOSPC: no space left on device` while the renderer wrote `element-39.jpeg` into its
temp dir. C: had 0.18 GB free.

The founder cleared space to 6.68 GB, and the identical command re-run at 07:23 passed **45/45 in
36 s**, with that same test green in 29.8 s.

So the diagnosis holds in both directions: the failure was purely `ENOSPC`, and **the remotion gate
is green.** Note the wall clock too — 78 s while thrashing a full disk, 36 s with headroom. See
[[remotion-temp-dirs-are-never-cleaned-up]] for the leak that caused it.

## Related

- [[test-suite-inventory]] — what the 624 tests are
- [[remotion-temp-leak-filled-the-disk]]
