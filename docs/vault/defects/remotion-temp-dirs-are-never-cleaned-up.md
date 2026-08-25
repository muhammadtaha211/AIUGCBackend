---
type: defect
status: verified
verified: 2026-08-23
method: "controlled before/after: %TEMP%\remotion-* counted at 0 directories after the founder cleared space, then 1 directory (29.7 MB, timestamped 07:23:24) after a single `pnpm --filter @aiugc/remotion test`"
source: code
---

# Every Remotion run leaves a temp directory behind, and nothing ever removes them

## The evidence is a controlled experiment

The founder cleared `%TEMP%` at ~07:20 on 2026-08-23, taking the `remotion-*` directory count to
**0**. One `pnpm --filter @aiugc/remotion test` at 07:23 — 36 seconds, 45 tests — left **1
directory, 29.7 MB, timestamped 07:23:24.** Nothing deleted it.

Before the cleanup, three days of accumulation: **90 directories, 3.13 GB**, oldest 2026-08-20
10:35 - 68% of everything in `%TEMP%`. Two families, `remotion-v4.0.499-assets*` and
`remotion-webpack-bundle-*`. The largest observed were ~107 MB and ~55.6 MB; treat those as
**largest, not typical** - 90 directories at those sizes would be 5-9 GB, not 3.13 GB, and the one
directory the controlled run produced was 29.7 MB. Most of the 90 were smaller or near-empty.

**Only one of the two families is a real leak.** `remotion-v4.0.499-assets*` IS torn down by the
renderer on the happy path — `select-composition.js:132` pushes `result.cleanupServer(true)` onto a
cleanup list that `:173` runs in a `.finally()`. The assets shells left behind are failed or
interrupted cleanups, which is the other reason the arithmetic does not reconcile. The
`remotion-webpack-bundle-*` family is the one nothing ever removes.

## What it cost

C: reached **0.18 GB free** and `packages/remotion/test/frame-delivery.test.ts` began failing with
`ENOSPC: no space left on device`. The same test passes in 29.8 s once there is room. The full
measurement is in [[remotion-temp-leak-filled-the-disk]].

There is a second, quieter cost: the remotion suite took **78 s on the full disk and 36 s with
headroom**. The leak was slowing every render before it broke anything.

## Why it accumulates - one bundle per PROCESS

`packages/remotion/src/render.ts:160`:

```ts
bundlePromise ??= bundle({ entryPoint: ENTRY_POINT }).catch(...)
```

`bundle()` is called with **no `outDir` and no `onDirectoryCreated`**, so `@remotion/bundler`
`mkdtemp`s its own directory under `os.tmpdir()` named `remotion-webpack-bundle-*`, and nothing in
that package ever deletes it.

The `??=` sets the rate. The bundle is memoised per process - the comment above it reads "Bundle
once per process - webpack is the slow part" - so **the leak is one directory per process lifetime,
not one per render.** A worker rendering fifty videos leaves one directory; fifty worker restarts
leave fifty. That is what the controlled experiment measured: one 36-second test run, one directory.

Every entry point reaches it - `renderServiceA`, `renderServiceASteps`, `renderServiceB`, the
`render:sample*` scripts, and the worker through `packages/core/src/providers/remotion.ts`. A
dev-server restart, a sample render and a test run each cost one.

The janitor is not a backstop: `packages/core/src/pipelines/janitor.ts` imports no `node:fs`, and
every deletion it performs is `storage.remove(...)` against Supabase. **Nothing in this system
reclaims local disk.**

## Blast radius

The rate is driven by **process count, not render count**, so exposure scales with restarts. That
makes [[worker-exits-on-a-dropped-connection]] a direct multiplier: every worker death and restart
abandons another bundle.

The failure mode is not graceful. `ENOSPC` surfaces as a _render_ failure, which the pipeline treats
as a job failure and refunds, so the symptom presents as "renders started failing" with no hint that
the cause is disk. On the founder's box it presented as a red test instead, which was luckier.

## Fix shape

One line, at `packages/remotion/src/render.ts:160`: pass an `outDir` the repo owns -
`bundle({ entryPoint: ENTRY_POINT, outDir: path.join(WORK_DIR, "remotion-bundle") })`. Because the
path is fixed, each process overwrites the same directory and accumulation stops. Check concurrent
processes first (the worker plus a `render:sample` run share `%TEMP%` today); if that is a concern,
key the directory by `WORKER_ID` and remove it on exit.

`bundle()` also accepts `onDirectoryCreated`, which hands back the path for later cleanup - the
alternative if a per-process directory is genuinely wanted.

Interim mitigation, no code: clear `%TEMP%\remotion-*` between sessions.

## Not fixed

Recorded, not fixed — the founder cleared the symptom on 2026-08-23 and the mechanism is untouched.

## What this note does not prove

The leak is proven from code and from the controlled 0-to-1 measurement. **That the leak caused the
disk-full incident is not proven.** 3.13 GB of `remotion-*` was the largest single contributor to a
`%TEMP%` holding 4.59 GB, on a drive with 232 GB used. It is a sufficient explanation for the last
few hundred megabytes, not a demonstrated cause of the whole shortfall.
