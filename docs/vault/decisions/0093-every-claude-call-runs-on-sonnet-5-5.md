---
type: decision
status: verified
verified: 2026-10-08
method: "The founder's decision in the planning chat of 2026-10-07, as the task prompt of that day recorded it. Price: web-read 2026-10-07 from two third-party pages (the prompt), confirmed the same day on Anthropic's own page, platform.claude.com/docs/en/about-claude/pricing (model pricing table and its tokenizer note). Model constant: packages/core/src/providers/anthropic.ts, set on feat/sonnet-5-5 on 2026-10-08 and pinned by packages/core/test/anthropic-request.test.ts."
source: founder
---

# 0093 — Every Claude call runs on `claude-sonnet-5-5`

**FOUNDER, 2026-10-07.** Every Claude call in the product moves from `claude-sonnet-4-6` to
`claude-sonnet-5-5`, now, in one change:

- copy (hook lines, the B script, hook text, benefit captions, the VO script);
- the demo analysis (the vision batches and the sections step);
- the steps planner;
- the content-policy classifier;
- the TTS tags;
- גוש טקסט.

It ends the line in `docs/04-integrations.md` that read "Model locked by product decision:
`claude-sonnet-4-6`". No vault note had recorded that lock; it lived only there and in a comment
on the constant.

## The options

- **Move גוש טקסט first,** and the rest only after each passes its own check. Planning offered this.
- **Everything at once.** Chosen.

## His reason

It is the same model family, cheaper and more efficient. Opus 5.5, at twice Sonnet 5.5's price, is
more than these calls need. He takes responsibility if the switch breaks something.

## The price

| model               | input / MTok | output / MTok | cache write (5 min) | cache read |
| ------------------- | -----------: | ------------: | ------------------: | ---------: |
| `claude-sonnet-5-5` |           $2 |           $10 |               $2.50 |      $0.20 |
| `claude-sonnet-4-6` |           $3 |           $15 |               $3.75 |      $0.30 |

The founder web-read it from two third-party pages; it was **confirmed on Anthropic's own pricing
page on 2026-10-07**. The same page says models from 4.7 on use a newer tokenizer that makes about
30% more tokens for the same text, and Sonnet 4.6 uses the old one. So the token caps
([[token-and-money-budgets]]) bind sooner per action. They were left unchanged, by the prompt's
limits.

## How it is done

- One constant: `CLAUDE_MODEL` in `providers/anthropic.ts`. No env var or `app_config` row holds a
  model, so no environment changed.
- 5.5 rejects `thinking: {type: "disabled"}`, which the vision call sent, and it runs adaptive
  thinking when the field is omitted, as every other call did. So the switch also needed a thinking
  setting: [[0095-thinking-stays-off-for-the-sonnet-5-5-switch]].
- Usage is costed at 5.5's price: [[0094-claude-usage-costed-at-sonnet-5-5-price]].
- `usage_events` records no model, and no column was added. The founder's prompt made this note
  the record of the switch. The decision is dated 2026-10-07; the code changed on 2026-10-08. In
  production the switch is not one moment: a row's model follows the deploy of the process that
  wrote it.
  - Vercel's web and admin run 5.5 from the merge's deploy.
  - The box runs 5.5 from its pull and restart after the merge. That can be later, and it is gated
    on the analysis check ([[0095-thinking-stays-off-for-the-sonnet-5-5-switch]]).
  - Rows between those two moments are mixed. `state-of-play.md` records both moments when they
    happen.

## Related

- [[label-call-test-2026-10-02]] — the only 5.5 calls before this decision: vision, through the SDK
  directly, with adaptive thinking.
- [[0041-content-policy-is-accepted-not-fixed]], [[0082-the-label-call-is-a-paid-call-tested-first]],
  [[0091-text-block-texts-ten-skeletons-truth-rules-free-edit]] — measured on 4.6; they stay as
  history.
