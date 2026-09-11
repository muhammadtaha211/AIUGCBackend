---
type: fact
status: verified
verified: 2026-09-11
method: "OOM observed during the overnight run of 2026-09-11 on the founder's machine. Mechanism verified read-only at 2828fd3: root package.json:12 is `pnpm -r test`; five package.json files declare `test: vitest run`; `pnpm recursive --help` (pnpm 9.15.9) documents --workspace-concurrency 'Default is 4' and --sort on by default; no .npmrc exists anywhere (`find . -maxdepth 3 -name .npmrc` empty) and pnpm-workspace.yaml carries only the package globs. Serial form confirmed resolvable: `pnpm --filter <pkg> exec vitest --version` -> vitest/2.1.9 in all five."
source: code
---

# `pnpm -r test` OOMs this machine — the real gate is five serial invocations

**"`pnpm -r test` green" is not a runnable stop condition on the founder's machine**, and it is the
stop condition written into essentially every prompt this repo has been given. Use the five commands
below instead. They run the identical test set.

```bash
pnpm --filter @aiugc/remotion exec vitest run --fileParallelism=false
pnpm --filter @aiugc/core     exec vitest run --fileParallelism=false
pnpm --filter @aiugc/worker   exec vitest run --fileParallelism=false
pnpm --filter @aiugc/web      exec vitest run --fileParallelism=false
pnpm --filter @aiugc/admin    exec vitest run --fileParallelism=false
```

## Why the recursive form dies

Root `package.json:12` is `"test": "pnpm -r test"`. Five packages declare `"test": "vitest run"` —
`@aiugc/core` (`:20`), `@aiugc/remotion` (`:14`), `@aiugc/web` (`:11`), `@aiugc/admin` (`:11`),
`@aiugc/worker` (`:8`). `@aiugc/cli` declares none.

pnpm 9.15.9 runs recursive scripts **topologically sorted, four at a time** (`--sort` on by default,
`--workspace-concurrency` default 4). Nothing in the repo overrides it: there is no `.npmrc`
anywhere and `pnpm-workspace.yaml` holds only the globs.

The dependency graph is `remotion → core → {worker, web, admin}`, so the last wave is **three vitest
processes at once, each itself file-parallel by default**. That wave is the OOM. _(The "three at
once" shape is DERIVED from the dep graph plus the documented default — the OOM itself was observed,
the wave composition was not instrumented.)_

`--fileParallelism=false` is doing the second half of the work: parallel vitest inside a single
package already OOMs this machine independently of the recursive fan-out.

## The flag has to come after `exec`

`pnpm --filter @aiugc/core test --fileParallelism=false` **fails** — `ERROR Unknown option:
'fileParallelism'` — because pnpm 9 eats the flag before `vitest` sees it, even after `--`. The
`exec vitest run` form is the one that works
([[8a-wizard-shell-and-read-only-plan]] records the original failure).

No `vitest.config.*` sets `fileParallelism` or `pool`; the only config in the tree is
`apps/web/vitest.config.ts`, which sets the `@` → `./src` alias and nothing else. So the flag must be
typed every time.

## Where this is still written wrong

`CLAUDE.md:110` documents the script as `pnpm test  # core tests (PGlite, no Docker)`. That is
doubly misleading: it fans out to **five** packages, not core alone, and it says nothing about the
concurrency that makes it unusable here. Correcting that line is queued.

## Scope

**This machine.** The OOM is a property of the founder's desktop, not of the test suite — nothing
here says the recursive form fails in CI or on the Linux box, and neither has been tried. Test
counts are not recorded in this note on purpose; they move.

## Related

- [[ban-rule-test-collides-with-a-curated-hook]] — a genuinely flaky test in that same suite, at
  12% per run of its file. A red core suite is not automatically a real failure.
- [[8a-wizard-shell-and-read-only-plan]] — where the `--fileParallelism` flag form was first burned.
