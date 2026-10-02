---
type: decision
status: verified
verified: 2026-10-02
method: "Founder decision in chat, 2026-10-02, relayed in that day's task prompt (section 2, D2, 'not up for relitigation'); the reason is his. Recorded on branch feat/analysis-footage-screens. The measurement taken against it the same day is facts/footage-screen-changes-2026-10-02.md and facts/label-call-test-2026-10-02.md. NOT YET BUILT."
source: founder
---

# 0078 — Real screen changes come from the footage first

**DECIDED, NOT YET BUILT. The measurement below contradicts part of it; the founder has been told
and has not yet ruled on what follows.**

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
  since two label runs can differ. Not built.

## Related

- [[0079-when-unsure-it-is-a-change]]
- [[0077-moments-keep-their-real-start-and-end]]
