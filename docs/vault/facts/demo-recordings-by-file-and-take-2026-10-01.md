---
type: fact
status: verified
verified: 2026-10-01
method: "Read-only, 2026-10-01, all scratch gitignored under packages/core/.work/screen-span/. (1) export.ts: one `set transaction read only` transaction over demos, demo_analyses, demo_step_plans and the analyze_demo jobs (state->>'resumeKey', locked_by). (2) files.ts: Supabase storage list() metadata (size, eTag) of every demo's raw_path and normalized_path, plus a sha256 of each downloaded normalized.mp4. (3) signals.ts: the shipped frameHashes at 30 fps on each distinct file, and frameHashes -> clusterStates -> subsampleClusters at 5 fps compared representative by representative with each job's resumeKey. (4) same-take.ts: every pair of distinct files compared on their 30 fps dHash sequences at the best whole-frame offset within ±3 s. ffmpeg 8.1.2-full_build-www.gyan.dev on the founder's Windows machine."
source: db + code
---

# The demos are 7 files and 5 takes

**MEASURED**, 2026-10-01: the 15 ready analyses in production cover **7 distinct raw files**,
deduplicated by storage eTag and byte size.

**REASONED** from frame similarity (below): those 7 files are **5 takes**, because three of the
files are exports of one take.

- The vault's count this morning, 7 recordings among 12 analyses, counted files.
- **FOUNDER-REPORTED:** he believes there are about 5. That matches the take count. What he was
  counting is not recorded.

## By file

The raw upload and the normalized file give the same grouping. Within a group the eTags are
identical, and so is the normalized file's sha256.

| take | raw file (eTag) | raw bytes   | `duration_ms` | uploads (demos)                                                                        | ready analyses                              |
| ---- | --------------- | ----------- | ------------: | -------------------------------------------------------------------------------------- | ------------------------------------------- |
| T1   | `8b0dc639…`     | 23 149 865  |        57 498 | `0a0c6c11` `ab77ed85` `121925b0` `916bda89`                                            | `2c74fe2a` `1e66c926` `0bb10493` `2c8acb7a` |
| T2   | `133a6304…`     | 111 615 043 |        89 582 | `3915c8e2` `29c5ed05`                                                                  | `6efb1f49` `c5cb4d90`                       |
| T3   | `c36f775d…`     | 40 919 140  |        88 845 | `66d53d7d`                                                                             | `08b93a8a`                                  |
| T3   | `28ddab62…`     | 67 466 070  |        53 986 | `b398e96d`                                                                             | `bd0005b0`                                  |
| T3   | `2e303069…`     | 108 565 557 |        87 469 | `6e30f3e0`                                                                             | `91c89b65`                                  |
| T4   | `b25923dd…`     | 20 539 090  |        72 615 | `6548af7e` `32e93f95`                                                                  | `f6e343d1` `6dac02c8`                       |
| T5   | `752bf15a…`     | 40 705 651  |        84 230 | `207c6421` (analysis `e4be3bce` rejected), `dfa291b6` `28161296` `24e348bf` `6a997717` | `4113d37d` `4219e82e` `6658999c` `fc30dc8e` |

The table covers 16 of the 18 `demos` rows. The other two, `c49e6f16` and `af417754`, are
`rejected` with no normalized file, no duration and no analysis. Their raw uploads are 436 730 678
and 589 377 075 bytes.

T1 is the jobnet.co.il walkthrough. T2–T5 are walkthroughs of tavnit.ai. T5 is the founder's 84 s
recording, and `6a997717` is its newest upload ([[founder-timeline-of-the-84s-recording]]).

## Three files, one take — similarity MEASURED, the grouping REASONED

A frame "matches" when its dHash differs by 6 bits or fewer. `MAX_HAMMING`, the clustering's
same-state threshold, is 14.

| pair                    | best offset | mean dHash distance | frames matching | where they part                            |
| ----------------------- | ----------: | ------------------: | --------------: | ------------------------------------------ |
| `28ddab62` / `2e303069` |         0 s |                 3.9 |  90.2 % of 54 s | an unbroken 47.9 s match ending at 48.9 s  |
| `2e303069` / `c36f775d` |         0 s |                 5.4 |  89.8 % of 87 s | match to 82.4 s, then different endings    |
| `28ddab62` / `c36f775d` |         0 s |                 6.7 |  84.3 % of 54 s | `c36f775d` is a 478×850 source, so noisier |

Every other pair of files has a best-offset mean distance of 26–49 bits and at most 0.5 % matching
frames: different takes.

## The box clusters a file the same way every time

This was not true across machines.

- **MEASURED, box.** Every upload of one file got the identical kept set: the same `resumeKey`
  string in the `analyze_demo` job's checkpoint.
  - T1: all 4 jobs, run 2026-08-27 to 2026-09-16.
  - T2 and T4: both jobs each.
  - T5: all 5 jobs.
  - Every one of the 16 jobs was claimed by `hetzner:heavy`.
- **MEASURED, this machine.** The same three calls on the same normalized files reproduced none of
  the 7 kept sets. The box's representatives were matched exactly in:

  | file       | exact matches |
  | ---------- | ------------: |
  | `8b0dc639` |      26 of 60 |
  | `133a6304` |      20 of 53 |
  | `c36f775d` |      33 of 46 |
  | `28ddab62` |      30 of 38 |
  | `2e303069` |      31 of 46 |
  | `b25923dd` |      19 of 36 |
  | `752bf15a` |      47 of 65 |

  The first six are the same counts [[analysis-clustering-does-not-reproduce-across-machines]]
  recorded on 2026-09-28.

- **MEASURED, box, across one take.** The box gave `28ddab62` and `2e303069` the identical 34 state
  timestamps before 47 s. It gave `c36f775d`, the 478×850 export of the same take, a different set:
  27 of its 46 timestamps fall on `28ddab62`'s and 33 on `2e303069`'s. **REASONED:** the moments
  depend on the encode, not only on the take.

## Related

- [[repeat-analyses-of-one-file-2026-10-01]] — what the repeat analyses agree on.
- [[screen-spans-from-the-footage-2026-10-01]] — the spans measured on these files.
