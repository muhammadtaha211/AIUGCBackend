---
type: falsified
status: superseded
verified: 2026-08-21
method: "4 live plan regress runs, prompt files moved to select versions, md5-restored"
source: db
---

# "v10 is the last prompt version that works on production-sized timelines"

## The claim

Proposed 2026-08-20 by Claude in chat, on the basis that `real-botteacher-file-routing` (61 states,
the production-shaped workload) completed 2 of 2 under v10 and 0 of 3 under v11/v12 plus the
production v11 run — with a *different* violation each time. The reading was that v11's added
instruction load (the one-beat merge rule plus the timing table) cost the model compliance headroom.

The recommendation that followed: a v13 trimming instruction load should precede Phase 8b.

## What killed it

**v10 threw on 2026-08-21**, on the same timeline, with the same violation class v11 and v12 fail on
— label words absent from `visibleText` plus a read-time overrun.

| version | completions on file-routing |
|---|---|
| v10 | 2 / 3 |
| v11 | 0 / 2 |
| v12 | 2 / 4 |

Fisher's exact on 2/3 vs 2/4 gives **p = 1.0**. One more draw either way flips the ordering. The
2-of-2 was a small-sample artifact.

Cost of the disproof: 12 calls, 242,190 tokens, ₪2.96. Worth it — it stopped an unnecessary prompt
revision.

## What replaced it

[[first-call-violation-rate]] — 18 of 18 first model calls violated the validator, across v10, v11
and v12, zero variance. The corrective retry is not a safety net, it is the mechanism; every
successful plan on record went through it. That finding has n=18 behind it where the version
question had n=7, and it points at a completely different v13.

## Lesson

A 2-of-2 is not a rate. Before building a phase plan on a fixture result, check whether one more
draw would flip it.
