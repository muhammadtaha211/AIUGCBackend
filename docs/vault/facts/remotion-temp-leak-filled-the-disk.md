---
type: fact
status: verified
verified: 2026-08-23
method: "Get-PSDrive C and a Get-ChildItem -Recurse | Measure-Object Length -Sum over %TEMP%\remotion-*, sampled four times across the morning; the 07:23 sample is a controlled before/after around one test run"
source: code
---

# One Remotion run leaks one temp directory, and it filled the disk

## The episode, in four measurements

| time (2026-08-23) | C: free | `%TEMP%\remotion-*` | what happened                                      |
| ----------------- | ------- | ------------------- | -------------------------------------------------- |
| ~06:45            | 0.18 GB | 90 dirs, 3.13 GB    | remotion suite fails 44/45 with `ENOSPC`           |
| ~07:00            | 0.13 GB | —                   | still falling                                      |
| ~07:20            | 6.68 GB | 0 dirs              | founder cleared space                              |
| 07:23             | 5.04 GB | **1 dir, 29.7 MB**  | one 36 s test run — and it left a directory behind |

That last row is the whole finding. The directory count went from **0 to 1 across a single
`pnpm --filter @aiugc/remotion test`**, timestamped 07:23:24, matching the run exactly. Nothing
removed it.

## What accumulated

Before the cleanup, two families:

- `remotion-v4.0.499-assets*` — ~107 MB each
- `remotion-webpack-bundle-*` — ~55.6 MB each

90 directories, oldest 2026-08-20 10:35, newest written by the very run that then ran out of room.
`%TEMP%` as a whole held 401 directories and 4.59 GB, so this project's leak was **68% of it**.

## What it broke

`packages/remotion/test/frame-delivery.test.ts` failed with
`ENOSPC: no space left on device` while the renderer wrote `element-39.jpeg`. With space freed, the
identical command passed 45/45 — see [[gate-results]]. So the failure was the disk, not the code.

Worth noting the second-order cost: the same suite took **78 s on a full disk and 36 s with
headroom**. A nearly-full disk was making every render slower, not just the failing one.

## This is not fixed

Freeing space cleared the symptom. The 07:23 measurement proves the mechanism is untouched: every
render and every remotion test run still adds a directory nobody deletes. At ~30–160 MB a run, the
06:45 state returns.

The defect note is [[remotion-temp-dirs-are-never-cleaned-up]].

## Re-measure with

```
powershell -c "$g=Get-ChildItem $env:TEMP -Directory | ? Name -match '^remotion-'; $s=0; $g | % { $s += (Get-ChildItem $_.FullName -Recurse -File -ea 0 | Measure-Object Length -Sum).Sum }; \"$($g.Count) dirs, $([math]::Round($s/1MB,1)) MB\""
```
