---
type: decision
status: verified
verified: 2026-10-02
method: "Founder decisions in chat, 2026-10-02: D3 and the open swap question relayed in that day's task prompt (section 2); the failed-label-call rule in his reply approving the plan the same day. The reasons are his. Recorded on branch feat/analysis-footage-screens. The rule exists as code (packages/core/src/pipelines/analysis-screens.ts screenChanges, pinned by packages/core/test/analysis-screens.test.ts) and nothing in the pipeline calls it."
source: founder
---

# 0079 — When unsure, it is a change

**DECIDED. The rule is written and tested as a pure function; nothing calls it yet.**

## The decisions (FOUNDER-DECIDED)

1. **When unsure, it is a change (D3).**
   - **His reason:** a false change only moves a window; a missed one is a jump.
2. **A failed label call must never fail the analysis: fall back to treating the instant as a
   change.** Said in his reply approving the plan, 2026-10-02.

## Open — he said do not decide

Whether an in-place swap (same page, content replaced, e.g. "creating the ad" to "the ad is
ready") counts as a change. It is to be **stored marked as a swap** so the next task can choose.

## As written in the code

`screenChanges` turns judged instants into changes:

- no label → a change, `why: "unjudged"`;
- a label the model was not sure of → a change, `why: "unsure"`, whatever it leaned towards;
- `swap` → kind `swap`, kept marked whether sure or not;
- a sure same-screen label → no change.

One more branch is in the code as the last variant **tested, not decided**: a cut (`abrupt` 0.9 or
more) that the model explains as the camera or a scroll is a change, because a camera cannot
change the picture in one frame. It recovered T5's 9.8 s change and added false ones
([[label-call-test-2026-10-02]], run `strip-192-f1`).

## What the measurement adds — MEASURED 2026-10-02

- **The rule does not survive a total failure gracefully.** If every instant is a change, 34–74 %
  of each recording sits in "screens" shorter than 2 s
  ([[footage-screen-changes-2026-10-02]]). A false change then does more than move a window: most
  screens have no 2 s window at all. The founder has been told; `judged: false` was proposed so
  the next task can tell such a list from a judged one.
- **The API models rarely said "unsure".** 0–6 of 34–75 instants per file, so the rule rescued
  few of their misses ([[label-call-test-2026-10-02]]).

## Options

There was no menu. The founder decided it in chat.

## Related

- [[0078-screen-changes-come-from-the-footage-first]]
- [[0082-the-label-call-is-a-paid-call-tested-first]]
