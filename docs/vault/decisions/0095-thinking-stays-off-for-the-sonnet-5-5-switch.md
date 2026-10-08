---
type: decision
status: verified
verified: 2026-10-08
method: "The founder's answers in the plan-mode chat of 2026-10-08, to two questions planning put after finding that the switch could not be the model id alone. Wire facts from the claude-api skill's Sonnet 5.5 migration guide (cached 2026-09-25); SDK types read in packages/core/node_modules/@anthropic-ai/sdk (0.111.0), resources/messages/messages.d.ts:1179 (ThinkingConfigParam = Enabled | Disabled | Adaptive). The two settings are pinned by packages/core/test/anthropic-request.test.ts."
source: founder
---

# 0095 — Thinking stays off for the Sonnet 5.5 switch

**FOUNDER, 2026-10-08.** Both Claude wrappers send `thinking: {type: "between_tools"}`.

## Why a choice was needed

The prompt for [[0093-every-claude-call-runs-on-sonnet-5-5]] said to change the model id and
nothing else. The tree did not allow it.

- `generateRawWithImages`, the vision call, sent `thinking: {type: "disabled"}`. On
  `claude-sonnet-5-5` that is a **400**. The wrapper maps no error, so the worker would have retried
  it as transient until every analysis job died.
- `generateObject` sent no `thinking`. That was no thinking on 4.6, but on 5.5 it is **adaptive
  thinking at effort `high`**. The thinking is billed as output, counts in the `llm_tokens` caps,
  and has to fit inside `max_tokens` (4096 on most calls).

`between_tools` is 5.5's lowest setting: no extended thinking. With no tools on the call there are
no progress notes either. SDK 0.111.0's `ThinkingConfigParam` predates it, so the wrapper casts one
constant, `NO_THINKING`.

## The options

- **Off on both, `between_tools` (chosen).** Closest to what 4.6 did, so cost, latency and
  `max_tokens` stay comparable.
- **Adaptive at effort `low` on both.** [[label-call-test-2026-10-02]] measured this on the vision
  path: 2 false changes against 4.6's 5, at 51 agorot against 67. But thinking fills `max_tokens`,
  slows the synchronous web routes, and a check would then measure the model and thinking together.
- **`between_tools` on the vision call only,** leaving `generateObject` at 5.5's default. Fewest
  lines, but the most thinking spend and the highest risk of a truncated answer.

## His reason, in his words

"Thinking stays off for this switch so the checks measure the model alone; low-effort thinking on
גוש טקסט is the next test."

## His rule for the analysis check

The CLI cannot run a demo analysis without touching production. `demo ingest` writes a production
demo and queues the job to the box, which runs whatever model it last pulled. So the check runs as
a local scratch script on the founder's own T5 recording instead, with no production writes.

In his words: "If the analysis fails or comes back malformed on 5.5, say so in the report, and
don't count the switch as safe to deploy to the box."
