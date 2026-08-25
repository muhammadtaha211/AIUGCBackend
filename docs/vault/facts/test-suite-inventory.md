---
type: fact
status: verified
verified: 2026-08-23
method: "vitest's own per-file counts, scraped from the four test-run logs; file list from find apps packages -name '*.test.ts*' -not -path '*/node_modules/*'"
source: code
---

# 42 test files, 624 tests, in four of six workspaces

| package             | files  | tests   | seconds |
| ------------------- | ------ | ------- | ------- |
| `packages/core`     | 29     | 339     | 330     |
| `apps/web`          | 7      | 212     | 22      |
| `packages/remotion` | 4      | 45      | 78      |
| `apps/admin`        | 2      | 28      | 8       |
| **total**           | **42** | **624** |         |

**`apps/cli` and `apps/worker` have no `test` script and no test files.** Their package.json files
declare only `typecheck` and a runner. The CLI is the founder's daily entrypoint and the worker
runs every paid job; neither is covered.

Counts are vitest's own, not a grep. A grep of `^\s*(it|test)\(` returns **622** and reproduces
`packages/core`'s 339 exactly; the two-case gap is entirely in
`apps/web/test/service-a-ui.test.ts` (grep 106, vitest 108). The file has no `.each`, so the two
extra are cases the anchored regex misses. Use 624 — the runner is the authority.

## The ten largest files

| tests | file                                         |
| ----- | -------------------------------------------- |
| 108   | `apps/web/test/service-a-ui.test.ts`         |
| 68    | `packages/core/test/demo-step-plans.test.ts` |
| 29    | `packages/remotion/test/timing.test.ts`      |
| 28    | `apps/web/test/service-b-ui.test.ts`         |
| 23    | `packages/core/test/pricing.test.ts`         |
| 21    | `apps/web/test/service-b.test.ts`            |
| 19    | `packages/core/test/jobs.test.ts`            |
| 18    | `apps/web/test/api-errors.test.ts`           |
| 18    | `apps/web/test/service-a.test.ts`            |
| 17    | `packages/core/test/credits-wiring.test.ts`  |

`service-a-ui.test.ts` grew from 108 by the 144 lines commit `b60b5b6` added, and is now the
largest file in the repo's suite by a factor of 1.6.

## No vitest config exists anywhere

`find . -name 'vitest.config*' -not -path '*/node_modules/*'` returns nothing, and there is no
`vitest.workspace.ts` either. Every suite runs on vitest 2.1.9's built-in defaults, so there is no
shared setup file, no configured environment, and no global timeout override — a test that needs
more than the default gets it per-test or not at all.

**There is also no single command that runs all 624.** `pnpm test` is `pnpm -r test`, which fans out
to four independent runners, each with its own default root. That matters on this machine: running
them in parallel OOMs, and `packages/core`'s PGlite-backed files (`e2e.test.ts`,
`migrations.test.ts`) are far slower than their 8 and 7 case counts suggest.

## Related

- [[gate-results]] — how long each suite takes and which are red
