---
type: defect
status: verified
verified: 2026-08-23
method: "read apps/cli/package.json and apps/worker/package.json scripts; find apps/cli apps/worker -name '*.test.ts' returns nothing"
source: code
---

# The two processes that actually run the business have no tests

| package       | `test` script | test files |
| ------------- | ------------- | ---------- |
| `apps/cli`    | none          | 0          |
| `apps/worker` | none          | 0          |

Their `package.json` files declare only `typecheck` and a runner. The other four workspaces have
both — 42 files, 624 tests ([[test-suite-inventory]]).

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
- that the worker survives its own failure modes — see [[worker-exits-on-a-dropped-connection]]
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
