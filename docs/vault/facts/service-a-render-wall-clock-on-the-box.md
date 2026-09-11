---
type: fact
status: verified
verified: 2026-09-02
method: "prod db via packages/core/.work/diag-failed-render.ts (session pooler, read-only): video_renders.created_at -> updated_at for the three renders released after the af158cb deploy, cross-checked against their jobs' locked_at -> updated_at"
source: db
---

# A Service A steps render takes ~65s wall clock on the box

Three consecutive live wizard renders on `tavnit-worker` (CPX32, 4 shared vCPU, 8 GB), all
on commit `af158cb`, 2026-09-02:

| render      | enqueue → released | job lock held | attempts | last `renderProgress` |
| ----------- | ------------------ | ------------- | -------- | --------------------- |
| `6fbbf6bd…` | 64.9s              | 64.8s         | 0        | 1.00                  |
| `c3640da8…` | 64.9s              | 63.8s         | 0        | 0.92                  |
| `42b493df…` | 68.5s              | 67.2s         | 0        | 0.94                  |

Mean 66.1s, range 64.9–68.5s. Enqueue-to-release and lock-held agree to within ~1s, so
queue wait was ~0 — nothing else was competing for the heavy lane.

## The conditions, in the same breath as the number

- **Real customer footage through the live wizard**, not a fixture. This is the figure
  [[box-render-timing]] explicitly could not provide: its 45s is a 17s sample clip and
  says so.
- `6fbbf6bd…` was the **first render after a worker restart**, so it paid the webpack
  bundle build, and it was not measurably slower than the two warm ones after it. The
  bundle is memoized per process (`getBundle`), so that cost is real but small at this
  scale — do not conclude it is zero from one sample.
- Sequential, one at a time. `RENDER_CONCURRENCY` did not come into it — see
  [[render-concurrency-hardcoded-above-core-count]] before reusing this number for
  anything parallel.
- Demo length was not captured. Render time scales with output duration, so this is one
  point on a line, not a constant.

## What it corrects

`docs/02-jobs.md` sized a full customer render at **"~2–6 min wall time per video"**. Measured,
it is roughly **one minute** — 2× to 5× faster than the doc claimed. **Corrected 2026-09-11**
at `docs/02-jobs.md:168-175`, together with the two other wrong numbers on the same line: the
box was described as "8-vCPU … CPX41-class, ~€30/mo flat" and is a CPX32 at 4 shared vCPU,
~$41/mo + ~$0.72 IPv4. (This note previously cited that line as `:111`, which had been stale for
weeks — the content had moved to `:168`.)

The practical consequence is on the customer-facing wait, not on capacity: a minute is
short enough that the render step's progress bar is watched to completion rather than
abandoned, which is the assumption [[0010-where-render-progress-is-shown]] rests on.
