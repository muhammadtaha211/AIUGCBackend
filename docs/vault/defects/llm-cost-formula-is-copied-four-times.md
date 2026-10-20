---
type: defect
status: verified
verified: 2026-10-08
method: "2026-08-23: grep -rn 'function llmCostAgorot' packages/core/src — four hits; md5 of each body's return line — all four are 7832a8b4612d. Re-measured 2026-10-08 on feat/sonnet-5-5, before the fix: still four, byte-identical, at copy.ts:29-31, tts.ts:138-140, demo-analysis.ts:205-207, demo-step-plans.ts:167-169. After it: the same grep returns one hit, packages/core/src/pricing.ts; grep -rn 'llmCostAgorot(' packages/core/src — five call sites, all importing it from ../pricing."
source: code
---

# `llmCostAgorot` is copy-pasted four times, and the comment policing it says three

## FIXED 2026-10-08 on branch `feat/sonnet-5-5`

The rate change this note warned about arrived: every call moved to `claude-sonnet-5-5`
([[0093-every-claude-call-runs-on-sonnet-5-5]]), costed at $2 / $10
([[0094-claude-usage-costed-at-sonnet-5-5-price]]). The fix is the shape below. One exported
`llmCostAgorot` in `packages/core/src/pricing.ts`, all four private copies deleted along with their
comments (the miscounting one included). The five call sites are `copy.ts` (`callClaude`),
`tts.ts`, two in `demo-analysis.ts`, and `demo-step-plans.ts`. `pricing.test.ts` pins the rate,
which nothing did before. _(2026-10-20: `tts.ts`'s call was the `tts_enhance` pass, retired by
[[0119-tts-is-eleven-v4-plain-text]], so four call sites remain.)_

What follows is the defect as it stood, with its 2026-08-23 line numbers.

Four private copies, all byte-identical:

| file:line                                            | feeds                             |
| ---------------------------------------------------- | --------------------------------- |
| `packages/core/src/pipelines/copy.ts:17`             | hook lines, B scripts, VO scripts |
| `packages/core/src/pipelines/tts.ts:138`             | `tts_enhance`                     |
| `packages/core/src/pipelines/demo-analysis.ts:113`   | `analyze_demo`                    |
| `packages/core/src/pipelines/demo-step-plans.ts:219` | `plan_demo_steps`                 |

```ts
function llmCostAgorot(inputTokens: number, outputTokens: number): number {
  return Math.ceil(((inputTokens * 3 + outputTokens * 15) / 1_000_000) * 370);
}
```

Every body hashes to `7832a8b4612d`. **No drift** — which is the good case, and the reason this is a
low-severity note.

## The self-imposed rule was breached, and the comment miscounts

`packages/core/src/pipelines/demo-analysis.ts:112`:

> Rough cost bookkeeping — same math as pipelines/copy.ts (2nd use; extract at the 3rd).

There are four uses. The comment is not merely unheeded — it is numerically wrong, and the copy it
misses is the easiest one to miss. `tts.ts:138` sits in the TTS pipeline, so nobody grepping for
"LLM cost" thinks to look there. It is a genuine Anthropic path all the same: `generateObject` at
`tts.ts:183`, then `recordUsage` with `provider: "anthropic"`, `kind: "llm_tokens"` at `tts.ts:189`.
A fourth copy, not a lookalike.

## Blast radius

Nothing today; all four agree. The exposure is the **next rate change**. Two constants will move —
Claude's per-Mtok price (`3` in, `15` out) and the ILS/USD rate (`370` agorot). When they do, the
fix lands in three of four places and the cost history splits silently by pipeline: analyses at one
rate, plans at another, hook copy at a third, TTS enhancement at a fourth. `usage_events` records
the number and never which copy produced it, so the split would be undetectable afterwards.

Worth carrying alongside every shekel figure in this vault: they all come out of this formula. It is
a **local estimate against a hard-coded FX rate**, never an invoice. The token counts are the API's.

## Fix shape

Export one `llmCostAgorot` — `packages/core/src/pricing.ts` is the natural home, next to the other
cost math — and delete **all four** private copies. Zero behaviour change, because the bodies are
identical. Fix or drop the miscounting comment while there.

## Related

- [[analyze-demo-cost]] — the ILS figures this formula produced
