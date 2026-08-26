---
type: defect
status: verified
verified: 2026-08-26
method: "read apps/cli/package.json and apps/worker/package.json scripts; apps/worker/test/worker-resilience.test.ts holds 7 tests (pnpm --filter @aiugc/worker test); find apps/cli -name '*.test.ts' still returns nothing"
source: code
---

# apps/cli has no tests; apps/worker got its first on 2026-08-26

| package       | `test` script | test files                               |
| ------------- | ------------- | ---------------------------------------- |
| `apps/cli`    | none          | 0                                        |
| `apps/worker` | `vitest run`  | 1 (`worker-resilience.test.ts`, 7 tests) |

The worker's tests came with the fix for [[worker-exits-on-a-dropped-connection]] and pin exactly
the failure modes that note recorded: a rejected claim, a failed settle write, one lane dying, and
shutdown during the supervisor's backoff. They reuse core's PGlite helper, so `pnpm -r test` picks
them up with no new infrastructure. The rest of the worker's wiring (which lane claims which types
in the real two-lane split) is still untested, and `apps/cli` is still at zero.

This matters more than a coverage percentage would suggest, because of what these two are:
`apps/cli` is the entrypoint the founder drives the whole pipeline from today, and `apps/worker` is
the process that executes every paid job — TTS, lip-sync, renders, analysis.

## The honest mitigation

Both are thin shells. The CLI's commands are argument parsing plus a call into
`packages/core/src/pipelines/*`, and the worker is a two-lane poll loop over handlers that also live
in core. **The logic is tested; the wiring is not.** `packages/core` has 339 tests covering the
pipelines both apps call.

So the real gap is narrower than "untested": it is the glue. Specifically, nothing tests

- that a CLI flag reaches the core function it names — the live example is
  [[admin-flag-is-a-noop-on-existing-accounts]], a flag that parses correctly, is passed correctly,
  and is then dropped one layer down, with no test anywhere to catch it
- ~~that the worker survives its own failure modes~~ — covered 2026-08-26 by
  `worker-resilience.test.ts` ([[worker-exits-on-a-dropped-connection]])
- that the two lanes claim the job types they are supposed to claim

Every one of those is a wiring bug, which is exactly the class a shell with no tests cannot catch.

## Blast radius

One confirmed instance so far (the `--admin` flag). The pattern is what to watch: any future CLI
flag or worker-lane change has no net under it.

## Fix shape

Not a suite — a handful of tests at the seams. The highest-value single test is one that asserts
`business create --admin` results in an `admin` role, because it would have caught the one bug this
gap has actually produced.

Deliberately not fixed here; recorded so the gap is visible.
