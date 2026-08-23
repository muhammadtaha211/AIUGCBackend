---
type: fact
status: verified
verified: 2026-08-23
method: "each command timed with date +%s around it, run serially from repo root at commit b60b5b6 on branch feat/service-a-steps; logs in the session scratchpad"
source: code
---

# The six gates, timed — two are red

Run serially (never in parallel: the core suite OOMs the machine under parallel vitest).

| gate                                                     | exit  | seconds | result                     |
| -------------------------------------------------------- | ----- | ------- | -------------------------- |
| `pnpm typecheck`                                         | 0     | 33      | green, 6 of 7 projects     |
| `pnpm lint`                                              | **1** | 17      | **red** — 143 files        |
| `pnpm --filter @aiugc/core test --fileParallelism=false` | 0     | 330     | green, 339/339             |
| `pnpm --filter @aiugc/web test`                          | 0     | 22      | green, 212/212             |
| `pnpm --filter @aiugc/admin test`                        | 0     | 8       | green, 28/28               |
| `pnpm --filter @aiugc/remotion test`                     | **1** | 78      | **red** — 44/45, see below |

Total wall clock: **8 minutes**. `pnpm typecheck` reports "Scope: 6 of 7 workspace projects" —
the seventh is the repo root, which has no `typecheck` script; all six packages have one and all six
pass. The core suite is 330s of that; vitest's own report says 241s in
tests and 57s collecting.

## `pnpm lint` is red and has been for a while

`prettier --check .` reports **143 files** with style issues, spread across every app and package,
`docs/`, and `prompts/`. Four of the five files already in this vault are among them —
`README.md`, `conventions.md`, `facts/token-and-money-budgets.md`,
`falsified/v10-is-the-last-working-prompt.md` — plus all five `docs/vault/.obsidian/*.json`. Only
`decisions/0001-five-step-steps-wizard.md` is clean.

This is a whole-tree formatting debt, not a regression from any one commit. `pnpm format` fixes it
in one pass; nobody has run it.

## The remotion failure is the disk, not the code

One test fails: `packages/remotion/test/frame-delivery.test.ts` →
`ServiceASteps frame delivery > shows a new source frame on (nearly) every output frame`, after
47.9s, with:

```
ENOSPC: no space left on device, open 'C:\Users\USER\AppData\Local\Temp\react-motion-renderZ0as26\element-39.jpeg'
```

**C: had 0.18 GB free at the time of the run** — see [[disk-is-full]]. Whether this test passes on a
machine with disk space is **not established by this run**; treat the remotion gate's true colour as
unknown until it is re-run with headroom.

## Related

- [[test-suite-inventory]] — what the 624 tests are
- [[disk-is-full]]
