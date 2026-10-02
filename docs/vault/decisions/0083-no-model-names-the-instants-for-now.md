---
type: decision
status: verified
verified: 2026-10-02
method: "Founder decisions in chat, 2026-10-02, in his reply to the report of the label call's failed test (facts/label-call-test-2026-10-02.md). His two decisions and the reasons are quoted from that reply. Recorded on branch feat/analysis-footage-screens, in the commit that builds the model-free half."
source: founder
---

# 0083 — No model names the instants for now; the model-free half is built

## The decisions (FOUNDER-DECIDED, 2026-10-02)

Put to him as two decisions after the label call failed its test
([[0082-the-label-call-is-a-paid-call-tested-first]]).

1. **Build the model-free half:** spans, every moment including failed reads, and the stored
   instants. Migration 0050 is approved to write; he pushes it himself. The same limits hold:
   nothing customer-visible changes.
2. **No model for now.** Do not adopt the label call, and do not spend the rest of the test cap
   (₪15.80 of ₪30 was left).
   - **His reasons:** it missed about one real change in ten, it is not repeatable, and it pushes
     the costliest analysis past what it earns.

## Options offered for the model's part

| option                                              | what was measured                                                                      |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- |
| adopt the label call as tested                      | 50 of 57 real changes found, 6 missed, 16 false; ₪0.34–0.74 per analysis               |
| the label call plus the stored fields               | 1 of 112 missed across 15 analyses; about 4 false per analysis, 7–8 on the newest take |
| **no model; screens left to a later task (chosen)** | free; what is stored is instants, not screen changes                                   |
| test a stronger model                               | not tested; dearer per token                                                           |

## His reasons against the measurements

- **"About one real change in ten": MEASURED.** 6 of 57 on the one run over all seven files; 12 of
  112 change-instances across the 15 analyses ([[label-call-test-2026-10-02]]).
- **"Pushes the costliest analysis past what it earns": MEASURED.** The costliest analysis on
  record cost ₪2.72 against ₪3.00 earned; the call adds ₪0.24–0.74.
- **"Not repeatable": his reason, recorder's note.** Agreement between two runs of one variant was
  never measured, because no variant was worth repeating. What was measured is that every change
  of wording or layout moved the errors to other instants. The footage instants themselves repeat
  exactly.

## What this leaves

- **Stored, per new analysis:** the instants, with no judgement on any of them. An instant is not
  a screen change: a popup, a content load or a camera move is one too, 6–7 instants for every
  real change ([[footage-screen-changes-2026-10-02]]).
- **[[0078-screen-changes-come-from-the-footage-first]] is half met:** the footage says when the
  picture changes; nothing says which of those are new screens.
- **[[0079-when-unsure-it-is-a-change]] has no code.** The mapping that was tested with the label
  call was removed from the tree with it (it is in commit `5b49335`).
- **Open, his:** what the next task does with the instants. He asked for one measurement first,
  [[instant-free-windows-2026-10-02]], and has not ruled.
- **Still open from before:** whether an in-place swap counts as a change.

## Related

- [[0077-moments-keep-their-real-start-and-end]]
- [[0080-a-moment-is-never-dropped-for-a-failed-read]]
