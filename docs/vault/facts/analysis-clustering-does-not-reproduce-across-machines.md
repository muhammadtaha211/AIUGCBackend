---
type: fact
status: verified
verified: 2026-10-01
method: "`DOTENV_CONFIG_PATH=<main checkout>/apps/cli/.env pnpm --filter @aiugc/cli dev demo audit --all --json` at 44a5b7c (branch analysis-loss-audit), run 2026-09-28 on the founder's Windows machine with ffmpeg 8.1.2-full_build-www.gyan.dev, production read-only. Each analysis-time kept set read from `jobs.state->>'resumeKey'` of the ready analysis's analyze_demo job, in a READ ONLY transaction, and compared representative by representative with the recompute's kept set (packages/core/.work/audit-facts-verify.ts, gitignored scratch). `jobs.locked_by` and the `a_analysis_%` rows of app_config read the same way. Re-measured 2026-10-01: frameHashes -> clusterStates -> subsampleClusters at 5 fps on each distinct file compared with every analyze_demo job's resumeKey (packages/core/.work/screen-span/signals.ts, gitignored, same ffmpeg)."
source: db
---

# Demo-analysis clustering does not reproduce across machines

Re-running the deterministic half of `analyze_demo` — `frameHashes` → `clusterStates` →
`subsampleClusters`, the same code, on the same normalized file, at the same 5 fps — on the
founder's Windows machine reproduced the analysis-time kept set in **0 of 10** ready analyses.
Every analysis differs, and the differences are mostly one-frame moves of a cluster's
representative (the median frame), in both directions.

## The numbers [MEASURED]

**Caveat: the 10 analyses are 6 distinct recordings.** `0a0c6c11`, `ab77ed85`, `121925b0` and
`916bda89` are one 57.5s recording; `3915c8e2` and `29c5ed05` are one 89.6s recording. Within each
group the checkpoint kept lists are identical strings and the recomputed runs (every span and
anchor Hamming) are identical, so each group repeats one measurement; the distinct-recording counts are
given alongside. "Recording" here means a distinct file. Three of the six files (`66d53d7d`,
`b398e96d`, `6e30f3e0`) are exports of one take (REASONED from frame similarity, 2026-10-01), so the
six files are four takes ([[demo-recordings-by-file-and-take-2026-10-01]]).

| demo (analysis)       | kept at analysis | kept by recompute | same frame | moved |
| --------------------- | ---------------: | ----------------: | ---------: | ----: |
| `0a0c6c11` (2c74fe2a) |               60 |                56 |         26 |    34 |
| `ab77ed85` (1e66c926) |               60 |                56 |         26 |    34 |
| `121925b0` (0bb10493) |               60 |                56 |         26 |    34 |
| `916bda89` (2c8acb7a) |               60 |                56 |         26 |    34 |
| `3915c8e2` (6efb1f49) |               53 |                50 |         20 |    33 |
| `29c5ed05` (c5cb4d90) |               53 |                50 |         20 |    33 |
| `66d53d7d` (08b93a8a) |               46 |                48 |         33 |    13 |
| `b398e96d` (bd0005b0) |               38 |                39 |         30 |     8 |
| `6e30f3e0` (91c89b65) |               46 |                46 |         31 |    15 |
| `6548af7e` (f6e343d1) |               36 |                40 |         19 |    17 |

Each analysis-time representative the recompute did not keep, by its distance to the nearest
representative the recompute did keep:

| distance            | 10 analyses | 6 distinct recordings |
| ------------------- | ----------: | --------------------: |
| 200ms (one frame)   |   169 (66%) |              75 (63%) |
| 400ms (two frames)  |          48 |                    27 |
| 600ms – 4.6s        |          38 |                    18 |
| **moved, total**    |     **255** |               **120** |
| same frame (of all) |  257 of 512 |            159 of 279 |

The moves go both ways: most representatives land one frame early or one frame late, and the
farther ones come from runs that one side splits and the other merges.

**The box is self-consistent.** The four analyses of the 57.5s recording, run 2026-08-27 to
2026-09-16, have identical checkpoint kept lists. The two analyses of the 89.6s recording do
too. The same box on the same file gives the same clustering; it is the other machine that does
not.

**All 10 were claimed by `hetzner:heavy`** (`jobs.locked_by`, which records only the last claim).
No analysis matched this machine's recompute, so none of the ten was produced here. No
`a_analysis_%` row exists in `app_config`: fps 5, cap 80 and batch size 10 are the code defaults.

**Re-measured 2026-10-01** with the same ffmpeg (packages/core/.work/screen-span/signals.ts,
gitignored). The six earlier files gave the same "same frame" counts as above: 26, 20, 33, 30, 31
and 19. The 84 s file uploaded five times on 2026-10-01 (`752bf15a…`) reproduced 47 of 65. The box
again gave every upload of one file the identical `resumeKey`: 5 of 5 for that file, 4 of 4 for
the 57.5 s one. See [[demo-recordings-by-file-and-take-2026-10-01]].

## The cause — UNVERIFIED

The two sides ran different ffmpeg builds: 8.1.2 here, and the box's Ubuntu apt build, whose
version has never been measured (`docs/07-worker-box.md` §4 says only that "6.x" is fine).
Nothing separated the candidate causes — the ffmpeg version, the fps filter picking a different
input frame, or swscale rounding the 1080×1920 → 9×8 downscale differently on another CPU path.
**Running the audit on the box would test it, and that run was skipped by decision** (founder,
2026-09-28).

What the code at 44a5b7c rules out:

- **Code drift.** The recompute calls the handler's own `frameHashes` and `clusterStates`. Their
  bodies are unchanged since `79a1dbc` (2026-08-12, per `git log -L`), which predates every
  analysis.
- **A timing mismatch in the recompute.** It converts frame indexes with the same formulas the
  handler uses (`msAt`/`frameAt` in `packages/core/src/pipelines/analysis-audit.ts`).

**One argv difference is not ruled out.** INP-08 (`65114f8`, 2026-09-25) adds
`-protocol_whitelist` to every ffmpeg input. The recompute ran with it. The box was last
confirmed at `4100cc7` (2026-09-21), before INP-08, so it may not have it. The flag controls how
an input is opened, not how it is decoded, so it should not change the frames (REASONED, not
measured).

## What follows

- **`aiugc demo audit` off the box.** S3 is exact (read from the checkpoint), and S2 is pinned
  wherever the kept set reproduces. S1 and every per-run line are approximate, and the tool says
  so on each demo ("recompute: differs … APPROXIMATE"). Because of this measurement, a run holds
  the timeline state at its representative or, failing that, the one inside its span. Exact
  matching alone reported 227 kept states as lost.
- **A stored timeline cannot be compared frame by frame** with a clustering computed on another
  machine. The comparison has to go through the spans.
