---
type: defect
status: verified
verified: 2026-09-01
method: "fix verified: bundle() now gets outDir <repo>/.work/remotion-bundle (render.ts); frame-delivery.test.ts green with the bundle at the new location and zero new %TEMP%\\remotion-webpack-bundle-* dirs created during the run; bundle-heal.test.ts pins outDir + re-bundle-on-deletion. Original leak measurement (2026-08-23) preserved below"
source: code
---

# Every Remotion run leaves a temp directory behind, and nothing ever removes them

## FIXED 2026-09-01 (webpack-bundle family — the one this note is about)

The **Fix shape** below landed, both halves: `bundle()` gets a repo-owned
`outDir` (`<repo>/.work/remotion-bundle`), so every process overwrites the same directory and the
one-dir-per-process accumulation stops; and `getBundle()` re-bundles when the memoized directory
no longer exists on disk, because the cron mitigation this note's 2026-08-27 section describes
turned out to *delete the live worker's bundle* and kill every render until restart — that
incident is its own note, [[tmp-cron-deletes-live-worker-bundle]]. Pinned by
`packages/remotion/test/bundle-heal.test.ts`; `frame-delivery.test.ts` rendered for real from the
new location, leaving nothing in `%TEMP%`.

The concurrency question Fix shape raised was checked and accepted rather than engineered around:
the box runs one worker process; on the desktop two processes bundling at once write the same
filenames with the same content for a few seconds, worst case one transient render failure that
retries. Chunk filenames are stable numeric ids (verified in a real bundle dir), so overwrite is
in place and re-bundles do not accumulate stale chunks.

**Still open, deliberately:** the `remotion-v4.0.499-assets*` family — happy-path cleanup with
failed/interrupted shells left behind — is untouched, small, and covered on the box by the §9
cron, which stays. The two-machines-carrying-a-workaround tax below is retired for bundles;
the assets shells are all the cron has left to catch.

---

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

## As of 2026-08-27 the workaround has to be carried on a second machine

`docs/07-worker-box.md` §9 gives the Hetzner box its own mitigation — a `@daily` cron running
`find /tmp -maxdepth 1 -name 'remotion-*' -user aiugc -mmin +720 -exec rm -rf {} +` — because the
desktop's version of it ("the founder notices and clears space") does not transfer to a headless VPS
nobody logs into. The runbook sizes the exposure there at weeks rather than days, and the failure
mode is the ungraceful one described above: `ENOSPC` presenting as renders that started failing.

So anywhere that runbook is followed there are now **two machines carrying a workaround for a
one-line code fix**, in two dialects — `%TEMP%\remotion-*` cleared by hand on Windows,
`/tmp/remotion-*` cleared by cron on Linux — and the box's half lives in a runbook rather than in
the repo, invisible to anyone reading `render.ts`. Each further machine repeats the tax. The
`outDir` change in **Fix shape** above retires both at once.

Nothing about the defect itself was re-measured for this section; the `verified` date stands at
2026-08-23.
