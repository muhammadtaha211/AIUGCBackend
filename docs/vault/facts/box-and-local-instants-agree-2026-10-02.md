---
type: fact
status: verified
verified: 2026-10-02
method: "Read-only on production, 2026-10-02, each query inside a `set transaction read only` transaction through the code's own connection (an inline apps/cli/node_modules/.bin/tsx script; nothing written): select fps, moments, instants, detector from demo_analysis_footage (one row); the same row's instants compared, as atMs, with packages/core/.work/screens/data/events-752bf15a.json (this machine's footageEvents over the same recording's file, gitignored); and the row's analysis timeline timestamps compared with analyses 4219e82e and 6658999c by packages/core/.work/screens/export-testdata.ts."
source: db + code
---

# The box's footage instants match this machine's on the one file both have seen

Measured 2026-10-02, after the founder pulled, restarted the worker box and uploaded a demo.
**MEASURED** throughout.

- **The first production footage row exists.** Analysis `ce83d265` (created 2026-10-02 03:35 UTC,
  ready): `fps` 5, 65 moments, all read, every span holding its moment (`startMs ≤ t ≤ endMs`), 61
  instants, detector `screens@1`. It was the only row in the table.
- **It is the 84 s recording (T5) again.** Its 65 moment timestamps are the same as analyses
  `4219e82e` and `6658999c`.
- **All 61 box instants have one of this machine's 61 instants within one frame (34 ms), and the
  reverse.** Neither side has an instant the other lacks.

So "the detector was only ever run on this machine"
([[instant-free-windows-2026-10-02]], [[footage-screen-changes-2026-10-02]]) no longer holds for
this file.

## What this cannot say

- One file. The other six were not analysed on the box with the new code; the backfill
  ([[0081-existing-demos-keep-working-no-paid-re-analysis]]) will write their rows, and its report
  compares rows that share a file.
- `waitedMs`, the time the analysis was held for the decode, is only in the box's log. The founder
  has not reported it.

## Related

- [[0084-clips-are-placed-from-the-footage-instants]]
- [[clip-placement-replay-2026-10-02]]
