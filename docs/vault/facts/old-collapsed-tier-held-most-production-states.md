---
type: fact
status: verified
verified: 2026-09-28
method: "`DOTENV_CONFIG_PATH=<main checkout>/apps/cli/.env pnpm --filter @aiugc/cli dev demo audit --all --json` at 44a5b7c (branch analysis-loss-audit), 2026-09-28, production read-only: per ready analysis, timelineLength, s4 and s5 (reasons and total) from the stored timeline. The tier rule is `tierReasons` (packages/core/src/pipelines/analysis-audit.ts), the inverse of the old `pickerPools` (apps/web/src/lib/service-a-ui.ts:827 at 577272d, deleted by 0064). Parity measured the same day: `timelineLosses` over every fixtures/timelines/*.json at 577272d reproduces 0064's old-pickerPools fixture table exactly, 40 of 40 numbers (packages/core/.work/tier-parity.ts, gitignored scratch)."
source: db
---

# The old collapsed inventory tier held 334 of 494 production states

Across the **10 ready analyses** in production, the picker's collapsed "מסכים שפחות מתאימים" tier,
removed by [[0064-the-inventory-is-one-tier]], held **334 of 494 states**. That is 58% to 85% of
each analysis and 68% overall. The main grid held **154**, and 6 unreadable states had no tile
at all. **In every one of the ten, the collapsed tier held more states than the main grid.**

**Caveat: the 10 analyses are 6 distinct recordings.** `0a0c6c11`, `ab77ed85`, `121925b0` and
`916bda89` are one 57.5s recording; `3915c8e2` and `29c5ed05` are one 89.6s recording (identical
checkpoint kept lists and identical recomputed runs). They were analysed separately, and the tier
still varies within a recording: 31 to 39 of the same 57.5s recording's states, and 34 or 41 of
the 89.6s one. The labels the tier sorts by (`legibility`, `sameStateAsPrevious`, `actionType`,
`screenKind`) are the model's per-run verdicts, not properties of the footage.

## The numbers [MEASURED]

Reasons overlap, so they do not sum to the tier.

| demo (analysis)       |  states | main grid | collapsed |   share |     low |  repeat |    idle | skip-kind | unreadable |
| --------------------- | ------: | --------: | --------: | ------: | ------: | ------: | ------: | --------: | ---------: |
| `0a0c6c11` (2c74fe2a) |      60 |        22 |        38 |     63% |      24 |      20 |      23 |         1 |          0 |
| `ab77ed85` (1e66c926) |      51 |        20 |        31 |     61% |      18 |      17 |      24 |         1 |          0 |
| `121925b0` (0bb10493) |      60 |        21 |        39 |     65% |      22 |      19 |      24 |         1 |          0 |
| `916bda89` (2c8acb7a) |      60 |        25 |        35 |     58% |      19 |      18 |      22 |         1 |          0 |
| `3915c8e2` (6efb1f49) |      53 |        18 |        34 |     64% |       9 |      11 |      20 |         8 |          1 |
| `29c5ed05` (c5cb4d90) |      53 |        11 |        41 |     77% |      22 |      11 |      17 |         8 |          1 |
| `66d53d7d` (08b93a8a) |      46 |         6 |        39 |     85% |      19 |      12 |      18 |        12 |          1 |
| `b398e96d` (bd0005b0) |      38 |        12 |        25 |     66% |      17 |      11 |      17 |         1 |          1 |
| `6e30f3e0` (91c89b65) |      46 |        11 |        34 |     74% |      28 |      13 |      19 |         3 |          1 |
| `6548af7e` (f6e343d1) |      27 |         8 |        18 |     67% |       5 |       3 |       9 |         6 |          1 |
| **total**             | **494** |   **154** |   **334** | **68%** | **183** | **135** | **193** |    **42** |      **6** |

## "low" is the model's ordinary verdict

**183 of the 334 collapsed states carried `legibility: "low"`.** Migration 0028
(`supabase/migrations/0028_split_legibility_gate.sql:5-7`) had already found, on the first five
real analyses (2026-08-18), that "low" is the model's ordinary verdict on a filmed screen, not a
refilm signal. That finding is why 0028 split the footage gate and moved the low-plus-unreadable
threshold to 0.75. The old tier kept treating every "low" state as less fitting.

## What it does not say

- It does not say which moments a customer missed. It counts states behind the toggle, not the
  states anyone wanted.
- It is the tier as stored timelines classify it today. Analyses grouped before 0064 carry v1
  sections over the old quality pool; this note does not count sections.
