---
type: decision
status: verified
verified: 2026-10-02
method: "Founder decision in chat, 2026-10-02, relayed in that day's task prompt (section 2, D2, 'not up for relitigation'); the reason is his. Recorded on branch feat/analysis-footage-screens. The measurement taken against it the same day is facts/footage-screen-changes-2026-10-02.md and facts/label-call-test-2026-10-02.md. HALF BUILT on that branch 2026-10-02: the instants are stored per analysis (demo-analysis.ts, analysis-screens.ts footageEvents); nothing names which of them are screen changes (decision 0083). Migration 0050 was pushed to production 2026-10-02 on the founder's instruction; the worker box is not on the code yet."
source: founder
---

# 0078 — Real screen changes come from the footage first

> **2026-10-02, later:** the box was pulled and restarted the same day (founder-reported), and the
> first production row was read back ([[box-and-local-instants-agree-2026-10-02]]). The line below
> about the box is the state when this note was written.
> The instants are now read: clips are placed from them
> ([[0084-clips-are-placed-from-the-footage-instants]]).

**DECIDED. HALF BUILT 2026-10-02 (PR #78, migration 0050 pushed, the box not on it yet): the footage's instants are stored; no model
names them ([[0083-no-model-names-the-instants-for-now]]). The measurement below contradicts part
of the decision; the founder has been told and has ruled the model out for now.**

## The decision (FOUNDER-DECIDED, D2)

Real screen changes come from the footage first and are repeatable for the same file. The model's
judgement is used only where the footage cannot tell.

This amends [[0070-a-step-ends-on-a-real-screen-change]]'s "same screen is the analysis model's
judgement, never a frame hash". 0070's definitions stay: a popup, typing, scrolling, camera
movement and content loading are not changes; navigation is.

**His reason:** measured on 2026-10-01, the analysis's screens miss real changes, add false ones
(5 on the newest demo) and only partly agree between analyses of one file
([[repeat-analyses-of-one-file-2026-10-01]]).

## What the footage can and cannot tell — MEASURED 2026-10-02

- **When: yes.** A pixel detector over every native frame has its own instant within 0.4 s of 56
  of the 57 real changes in the answer key; the 57th is a 0.2 s blank page that shares an instant.
  The same signatures give the same instants.
- **What kind: no.** No strength or changed-area cut separates a navigation from a popup, a content
  load or an in-place swap. On take T2 any cut that keeps all 11 real changes keeps 25 in-screen
  instants. The strongest instant in all the footage is a file-picker dialog.
- So "where the footage cannot tell" is every instant. The design put to the founder was: the
  footage finds every instant, a vision call labels each one.
- **That vision call did not pass its test** with the API models tried
  ([[label-call-test-2026-10-02]]).

Both facts are in [[footage-screen-changes-2026-10-02]].

## Options

There was no menu for D2 itself. The options offered for the model's part, and his choice, are
[[0082-the-label-call-is-a-paid-call-tested-first]].

## Proposed with it, approved 2026-10-02

- A re-upload whose normalized file has the same sha256 copies the stored result instead of asking
  again. **REASONED:** it is the only way changes repeat for the same file once a model labels them,
  since two label runs can differ. **Not built, and not needed while no model labels anything:**
  the instants are a pure function of the file. `file_sha` is stored on each row, so two analyses
  of one file can be compared.

## As built, 2026-10-02

- `analyze_demo` decodes the recording once more, on every native frame, while its vision calls
  are in flight, and stores the instants (`atMs`, `strength`, `abrupt`) with the detector's name,
  `screens@1`.
- A failed decode stores the instants as not computed and never fails the analysis (test).
- **REASONED, not measured on the box:** a fresh analysis waits no longer for it; a retry whose
  vision batches are all checkpointed waits the whole decode before it turns ready. The decode takes
  9–23 s on this machine. In production, on single-attempt jobs, 24–57 s pass before the first
  vision call returns and another 11–51 s before the last (read-only, 16 jobs,
  `packages/core/.work/screens/timing-readback.ts`). Each analysis logs `waitedMs`, the time it
  was held for the decode after everything else was done.

## Related

- [[0079-when-unsure-it-is-a-change]]
- [[0077-moments-keep-their-real-start-and-end]]
