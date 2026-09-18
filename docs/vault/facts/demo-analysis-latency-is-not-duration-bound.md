---
type: fact
status: verified
verified: 2026-09-18
method: "production read of analyze_demo job 85d9ec0b (created_at/updated_at/locked_at) and its usage_events, against a 90-second 1080x1920 demo; state count read off the analysis row; caps read in the tree at f84e931 — packages/core/src/pipelines/demo-analysis.ts:584 (a_analysis_max_states, default 80) and :622 (a_analysis_batch_size, default 10)"
source: db
---

# A 90-second demo analyses in ~65 seconds; duration was never the latency driver

A **90-second 1080×1920 demo** — the longest the ingest probe accepts
(`DEMO_MAX_DURATION_MS = 90_000`, `pipelines/demos.ts:20`, enforced at `:158`) — analyses in
**~65 seconds of real work**, producing **~53 states** across **6 batches** at
`a_analysis_batch_size` 10.

All times UTC.

## The numbers [MEASURED]

| figure                           | value                                  |
| -------------------------------- | -------------------------------------- |
| demo duration                    | 90s, 1080×1920                         |
| states produced                  | ~53                                    |
| `a_analysis_max_states` (cap)    | 80 (`demo-analysis.ts:584`, default)   |
| thinning that occurred           | **none** — ~53 is comfortably under 80 |
| batches                          | 6 (`a_analysis_batch_size` 10, `:622`) |
| real work per successful attempt | **64–72s** (four measured executions)  |

The four executions of job `85d9ec0b` ran 72s, 65s, 66s and 64s — a tight band, and the longest of
them is still barely over a minute. The state count sits at two thirds of the cap, so the thinning
path (`thinClusters`) never ran and the analysis paid for every state the footage produced.

## What this closes

**The 90-second demo cap is settled as a PERFORMANCE matter.** The founder's proposal to cap demos
at 30 seconds for speed was a hypothesis about latency; the measurement says duration is not what
makes an analysis slow. The observed 8m19s on this very job came from three retries of a parse
failure and ~227s of backoff sleep, not from the footage —
[[analysis-parse-failure-discards-the-whole-attempt]].

A shorter _recommended_ length survives only as a possible **footage-quality** argument — fewer,
better-composed states, a tighter ad — and **never as a speed one**. Anyone reopening "shorten the
demo so the analysis is faster" is re-deriving a hypothesis this note killed.

## What it does not say

- It does not set the cap. `DEMO_MAX_DURATION_MS` is 90s by a founder decision taken in chat on
  2026-09-16 and built the same day; that decision still has no note of its own, and its Hebrew
  copy is still pending founder review.
- It does not measure the _worst_ case. ~53 states is one demo. A denser 90s recording could
  approach the 80-state cap and add a seventh batch; that has not been observed.
- The per-attempt figure is real work only. Queue wait, claim latency and backoff sit outside it.
