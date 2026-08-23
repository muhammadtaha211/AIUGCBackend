---
type: fact
status: verified
verified: 2026-08-23
method: "Get-PSDrive C (PowerShell) twice, ~15 minutes apart; leftover temp dirs sized with Get-ChildItem -Recurse | Measure-Object Length -Sum"
source: code
---

# The dev machine's C: drive is out of space, and it is already breaking the suite

| measured at       | free   |
| ----------------- | ------ |
| 2026-08-23 ~06:45 | 184 MB |
| 2026-08-23 ~07:00 | 126 MB |

Used: 232.07 GB. It is still falling.

## What it already broke

`packages/remotion/test/frame-delivery.test.ts` fails with `ENOSPC: no space left on device` while
the renderer writes `element-39.jpeg` into its temp dir. That is the only failure in the remotion
suite and the reason `pnpm --filter @aiugc/remotion test` exits 1 — see [[gate-results]]. It is an
environment failure, not a code failure, and it means the remotion gate's true colour is currently
**unmeasurable**.

## Where the space went

`%TEMP%` holds **401 directories, 4.59 GB**. Of that, **90 directories named `remotion-*` account
for 3.13 GB**:

- `remotion-v4.0.499-assets*` — ~107 MB each
- `remotion-webpack-bundle-*` — ~55.6 MB each

Oldest: 2026-08-20 10:35. Newest: 2026-08-23 06:42 — written by the very test run that then ran out
of room. Nothing removes them; every render and every remotion test run adds more.

`%TEMP%` is not the whole 232 GB, so clearing it is a reprieve, not a fix. But 3.13 GB of it is
this project's own leak and is the cheapest thing to reclaim.

## What to do about it

Nothing here, deliberately — this note records the measurement. The leak itself is
[[remotion-leaks-temp-dirs]] once that folder is written.

## Re-measure with

```
powershell -c "Get-PSDrive C | Select-Object @{n='FreeMB';e={[math]::Round(\$_.Free/1MB,1)}}"
```
