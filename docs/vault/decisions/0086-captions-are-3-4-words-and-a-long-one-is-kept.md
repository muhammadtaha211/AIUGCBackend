---
type: decision
status: verified
verified: 2026-10-02
method: "Founder decision D6 in the 2026-10-02 task prompt (section 2), and his answer the same day to a question put in the planning session (two options, below). The arithmetic is readTimeMs in packages/core/src/plan-format.ts."
source: founder + code
---

# 0086 — The model writes 3–4 word captions; a longer one is kept and warned about

Decided 2026-10-02, built the same day on `feat/steps-fixed-2s-clips`. Tags: **FOUNDER-DECIDED**,
**MEASURED** (the code).

## The decision (FOUNDER-DECIDED)

**D6, task prompt:** the model writes 3–4 word captions, since 2 s reads 4 words by the shipped
rule. A longer hand-written caption gets a soft warning, never a block.

- **MEASURED in the code:** `readTimeMs` is 400 ms plus 400 ms per word. Four words need exactly
  2000 ms; five need 2400.

**Asked in the planning session:** after the third model call a caption is still over 4 words.
What should the code do with that step?

| option                               | what it means                                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| **Keep it, with a warning (chosen)** | the step stays in the draft as written and the editor shows the amber long-caption line            |
| 0074 as ruled                        | the step is dropped; if it is the ending step, the plan fails with the generic "try again" message |

- **The reason offered with the chosen option:** under a fixed 2 s clip the remedy is cutting a
  word, not deleting the step.
- **This replaces two rulings of [[0074-unpickable-moments-and-the-last-round-repair]]:** "a step
  whose caption cannot be read in its clip is dropped" (D2), and "the unreadable step is the ending
  itself: fail as today".

## As built

- `MAX_LABEL_WORDS` is 4 (it was 6). On the model path a longer caption is a violation that drives
  the two corrective calls. After the last call it is no longer one: the plan is stored with the
  caption as written.
- Such a plan is **not** stamped `+repaired`: nothing was dropped from it. Its last
  `retry_violations` entry names the caption.
- The editor's warning fires when a caption needs longer to read than its clip is on screen, and
  names how many words that clip allows: «כיתוב ארוך — בזמן שהצעד מוצג מספיקים לקרוא עד 4 מילים.»
  On a 2 s step that is 5 words or more. The number is computed from the step's own length, so the
  line is true on a step stored at an older length.
- The old read-time lines under a step («הצעד נגמר לפני שיספיקו לקרוא…», «מרווח קריאה X שנ׳») are
  gone; the one line above replaces them. He approved the strings on 2026-10-02.
- The hand-edit path is never refused on caption length, as before.
- **A corner where this met 0074's floor, settled in the build (REASONED, not his ruling):** on a
  recording that can offer only one or two steps, a first answer of that size is stored (the
  minimum is waived). The same answer with a long caption went through the last-round path and
  failed 0074's "fewer than 3 steps left" floor, though nothing had been dropped. The floor now
  applies only where the recording offers 3 or more, so that answer is stored with its caption.
  Pinned in `packages/core/test/plan-repair.test.ts`.

## Related

- [[0076-every-step-is-a-fixed-2s-window-inside-its-screen]]
- [[0049-the-label-provenance-rule-is-a-highlight-not-a-gate]]
