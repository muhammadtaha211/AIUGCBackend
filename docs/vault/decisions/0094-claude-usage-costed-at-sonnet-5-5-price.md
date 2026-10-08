---
type: decision
status: verified
verified: 2026-10-08
method: "Item 2 of the 2026-10-07 task prompt's decisions, marked there as planning's, not the founder's. Code on feat/sonnet-5-5: grep -rn 'function llmCostAgorot' packages/core/src — one hit, packages/core/src/pricing.ts; pinned by packages/core/test/pricing.test.ts (1e6 in → 740, 1e6 out → 3700, 10k/1k → 12)."
source: code
---

# 0094 — Claude usage is costed at 5.5's price, by one formula

**PLANNING, 2026-10-07** (the task prompt marks it as planning's, not the founder's). It follows
from [[0093-every-claude-call-runs-on-sonnet-5-5]].

Every `llm_tokens` row's `cost_estimate_agorot` is computed at claude-sonnet-5-5's price, $2 in and
$10 out per million tokens, at the same 370 agorot/USD. It was $3 / $15.

The formula had four byte-identical private copies, in `copy.ts`, `tts.ts`, `demo-analysis.ts` and
`demo-step-plans.ts` ([[llm-cost-formula-is-copied-four-times]]). Since all four had to change at
once, the defect was closed the way its note describes:

- one exported `llmCostAgorot` in `packages/core/src/pricing.ts`, which imports only zod, so no
  import cycle is possible;
- the four copies deleted.

`pricing.ts` and not `providers/anthropic.ts`, though the model lives in the latter: nine test files
mock the whole provider module, and a function exported from there would vanish under their mocks.

## What the number is

It is a **local estimate against a hard-coded FX rate, never an invoice**; the token counts are the
API's.

- Cache writes and reads are still folded into input at the base rate ($2) by the vision call
  (`anthropic.ts`). That keeps the **token** count, and so the caps, conservative. It does not
  make the **agorot** an upper bound:
  - a cache read ($0.20) is costed ten times over;
  - a cache write ($2.50 for 5 minutes) is costed 20% under.

  The vision batches start in parallel, so most of them write the cache rather than read it. The
  4.6 formula had the same shape.

- The FX rate (370 agorot/USD) was not part of this decision. TTS costs ElevenLabs at USD/ILS 3.00
  ("founder-confirmed 2026-08", `tts.ts`), so the two estimates use different rates.

## Reading the history

Rows written before the switch are at $3 / $15, and rows after it at $2 / $10. Nothing in the row
says which (no model column, by [[0093-every-claude-call-runs-on-sonnet-5-5]]), and a row's side
of the switch follows its process's deploy (see 0093).

Neither number compares cleanly across the switch:

- the agorot changed rate;
- the tokens changed tokenizer. 5.5's makes about 30% more tokens for the same text, by
  Anthropic's pricing page. The ratio on our own calls is in
  [[sonnet-5-5-paid-check-2026-10-08]].

Compare one call against the same call on the other model, not one period's rows against
another's.
