---
type: fact
status: verified
verified: 2026-09-28
method: "`DOTENV_CONFIG_PATH=<main checkout>/apps/cli/.env pnpm --filter @aiugc/cli dev demo audit --all --json` at 44a5b7c (branch analysis-loss-audit), 2026-09-28, production read-only: S3 per analysis = the checkpoint's kept representatives absent from the stored timeline. Batch membership read in a READ ONLY transaction from `jobs.state->>'resumeKey'` of each ready analysis's analyze_demo job — kept list in order, batch = floor(kept index / batchSize), batchSize from the same key (packages/core/.work/audit-s3-batches.ts, gitignored scratch). `a_analysis_max_degraded_fraction` read from app_config the same way: no row."
source: db
---

# A vision batch can collapse to one frame and survive the corrective retry

In **2 of 10** ready analyses, one vision batch of 10 frames put **1 state** into the timeline and
dropped the other 9 (S3). This happened after `transcribeBatch`'s corrective retry: the retry's
entries merged with the first response's (`packages/core/src/pipelines/demo-analysis.ts:524`) still
left 9 of 10 positions empty. Every other batch in all ten analyses came through whole. No
analysis lost a frame anywhere else.

The same merge and the same strict gate (below) are in `4100cc7` (`:524`, `:1092`), the box's
last confirmed commit (2026-09-21). No later deploy is recorded before `6548af7e` ran on
2026-09-27. For `ab77ed85`, `main` as of 2026-09-08 (`e0c49db`) carries both (`:580`, `:624`).
The box's own commit on either day is not recorded.

**Caveat: the 10 analyses are 6 distinct recordings.** `0a0c6c11`, `ab77ed85`, `121925b0` and
`916bda89` are one 57.5s recording; `3915c8e2` and `29c5ed05` are one 89.6s recording (identical
checkpoint kept lists and identical recomputed runs). By recording, 2 of 6 had a collapse.

## The two collapses [MEASURED]

| demo (analysis)                   | batch (0-based) | sent | in timeline | states dropped                                | dropped / kept    |
| --------------------------------- | --------------- | ---: | ----------: | --------------------------------------------- | ----------------- |
| `ab77ed85` (1e66c926), 2026-09-08 | 4 of 6          |   10 |           1 | 40.6 42.0 42.4 42.8 43.4 44.0 45.0 46.2 46.6s | 9 / 60 = 0.15     |
| `6548af7e` (f6e343d1), 2026-09-27 | 2 of 4          |   10 |           1 | 41.0 43.2 45.6 47.8 50.8 53.8 55.4 59.6 63.4s | 9 / 36 = **0.25** |

**`6548af7e` passed the degraded gate exactly at the line.** The gate is strict:
`droppedCount / kept.length > maxDegradedFraction` (`demo-analysis.ts:1093`). The threshold is
`a_analysis_max_degraded_fraction`, whose default is 0.25 (`:1089`) and which has no `app_config`
row. So 9/36 = 0.25 is not greater than 0.25, and the analysis landed `ready` with 27 states. One
more dropped frame (10/36 = 0.278) would have failed it as
"חלק גדול מדי מהצילום לא נותח".

**The collapse is not a property of the footage alone.** The 57.5s recording was analysed four
times, 2026-08-27 to 2026-09-16, with identical kept sets. It collapsed a batch once (`ab77ed85`)
and came through whole three times.

## Why — REASONED, not measured

The likeliest reading is that the model merged near-identical frames into one entry. It is the
failure mode `transcribeBatch` itself names at `demo-analysis.ts:505-507`: "seen live when
near-identical frames get merged into one entry instead of repeated". The dropped windows fit
it. They are runs of short clusters whose recomputed anchor distances sit just over MAX_HAMMING
14: 15–17 in `ab77ed85`'s 40.6–46.6s and 15–23 in `6548af7e`'s 41.0–63.4s. Those distances come
from the audit's off-box recompute, so they are approximate
([[analysis-clustering-does-not-reproduce-across-machines]]).

Not measured: what each call actually returned. `9 dropped of 10 sent` is the batch's result after
the retry merge. It does not show how many entries the first response or the retry returned.
Those counts are in the worker's `analysis: batch response incomplete or invalid — corrective
retry` warn line in the box's journal, which was not read.

## Related

- [[analysis-parse-failure-discards-the-whole-attempt]] — the salvage and corrective-retry path
  these batches rode, fixed on 2026-09-20.
