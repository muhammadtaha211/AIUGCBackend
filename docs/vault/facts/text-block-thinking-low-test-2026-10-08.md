---
type: fact
status: verified
verified: 2026-10-08
method: "PAID, on the founder's approval in chat, 2026-10-08 (cap ₪5). Branch feat/text-block-thinking-low. Scratch in packages/core/.work/text-block-thinking/ (gitignored), run from packages/core with ../../apps/cli/node_modules/.bin/tsx. run.ts <off|low> <tag>: the shipped generateTextBlocks on PGlite, loading ANTHROPIC_API_KEY only, so it cannot reach production; an observer on the SDK's Messages.create records each call's seconds, stop_reason and usage, output_tokens_details.thinking_tokens included, without touching the request. Runs in this order: low-r1, off-r2, low-r2. off-r1 is the 2026-10-08 run (.work/text-block/fixture-texts-55.json, [[sonnet-5-5-paid-check-2026-10-08]]). mechanics.mjs: shape, skips, figure candidates, lifted wording and shared phrases, by the logic of the 10-08 scripts; it reproduces 10-08's off-r1 counts. Judging: judge-workflow.js, blind over blind/set-A..D (key in blind-key.json), the 10-08 judge prompts verbatim plus one truth item; output judging.json; tally.mjs unblinds it into report.md."
source: code + inference
---

# גוש טקסט with low-effort thinking: the model did not think

The test [[0095-thinking-stays-off-for-the-sonnet-5-5-switch]] queued. It ran `text_block@v2` on
`claude-sonnet-5-5`, through the shipped `generateTextBlocks`, on the 2026-10-08 run's four
batches: Tavnit, the Haifa plumber, and the Excel course at female and at male. There were two
runs per side. **Tags:** MEASURED is the calls and the scripts; REASONED is the judging.

## Spend: 165 agorot of the ₪5 cap — MEASURED

12 calls, one per batch. That is ₪1.65 by the code's own `llmCostAgorot`. The `usage_events` rows
of each batch agree with the observer, call for call.

## What was sent, and what came back — MEASURED

- **`low`:** `thinking: {type: "adaptive"}` and `output_config: {effort: "low", format}` (the new
  `generateObject({thinking: "low"})`).
- **`off`:** `thinking: {type: "between_tools"}` and no effort, which is production.
- **The model never thought at `low`.** None of the 8 `low` calls carried a thinking block, and
  every one reported `output_tokens_details.thinking_tokens: 0`. The field was there and was zero;
  it was not missing. So the two sides differ by the effort level alone. Both wrote without
  thinking.
- **`max_tokens` 8192 was never close.** The largest answer was 2 086 output tokens. No call
  stopped on `max_tokens`. No batch was re-asked, and none failed.

## Per batch — MEASURED

Seconds run from the request to the parsed answer. Tokens are the call's own; input is 8 756–8 902
on every call.

| run    | Tavnit                   | plumber                  | course, female           | course, male             | run total                |
| ------ | ------------------------ | ------------------------ | ------------------------ | ------------------------ | ------------------------ |
| off-r1 | 37 s, 2 calls, 29 ag     | 17 s, 14 ag              | 21 s, 13 ag              | 16 s, 13 ag              | 91 s, 5 calls, 69 ag     |
| off-r2 | 19.7 s, 2 086 out, 15 ag | 18.6 s, 1 889 out, 14 ag | 19.8 s, 1 797 out, 14 ag | 17.9 s, 1 823 out, 14 ag | 76.0 s, 7 595 out, 57 ag |
| low-r1 | 19.6 s, 1 904 out, 14 ag | 18.1 s, 1 825 out, 14 ag | 16.5 s, 1 663 out, 13 ag | 19.0 s, 1 668 out, 13 ag | 73.2 s, 7 060 out, 54 ag |
| low-r2 | 17.7 s, 1 936 out, 14 ag | 16.8 s, 1 741 out, 13 ag | 16.6 s, 1 648 out, 13 ag | 20.8 s, 1 803 out, 14 ag | 72.0 s, 7 128 out, 54 ag |

- **off-r1** recorded no input/output split and no stop reason; its Tavnit batch was re-asked once,
  for an emoji the burner refuses (U+1F636).
- **Thinking tokens: 0** on every call of off-r2, low-r1 and low-r2.

## Mechanical — MEASURED

| run    | texts | median chars | median words | max chars | shared 4+ word phrases | in all four batches |
| ------ | ----: | -----------: | -----------: | --------: | ---------------------: | ------------------: |
| off-r1 |    40 |          222 |         40.5 |       393 |                     32 |                   6 |
| off-r2 |    40 |        235.5 |           43 |       366 |                     38 |                   6 |
| low-r1 |    40 |        215.5 |         39.5 |       362 |                     34 |                   7 |
| low-r2 |    40 |          215 |           40 |       390 |                     34 |                   7 |

No text over 400 characters and no long dash, in any run.

**Lifted wording, batches out of four:**

| phrase                              | off-r1 | off-r2 | low-r1 | low-r2 |
| ----------------------------------- | -----: | -----: | -----: | -----: |
| `אוקיי, בכנות`                      |      4 |      4 |      4 |      4 |
| `נו מה אתם אומרים`                  |      3 |      2 |      4 |      4 |
| the `מניסיון אישי` aside            |      2 |      4 |      0 |      2 |
| `אין לי מושג איך אתם`               |      3 |      1 |      2 |      1 |
| `זה לא נשמע מרגש, אבל זה ההבדל בין` |      2 |      2 |      2 |      0 |
| the small hours as the bad moment   |      0 |      2 |      0 |      0 |
| `נו, כן או לא?`                     |      0 |      0 |      0 |      0 |
| `נגמרו התירוציםםם`                  |      0 |      0 |      0 |      0 |

## `discovery` for the course, which has no `wow` — MEASURED

v2.md says to skip `discovery` without a `wow`. Across the 8 course batches, **7 put a placeholder
in `texts`**, which `textBlockBatchProblem` passes and `generateTextBlocks` stores as a
`text_block` row:

| run    | course, female                       | course, male          |
| ------ | ------------------------------------ | --------------------- |
| off-r1 | a real text with no wow              | `skipped`             |
| off-r2 | `skipped`, and listed in `skipped`   | `skipped`, and listed |
| low-r1 | `skip`                               | `skip`                |
| low-r2 | `discovery`, and listed in `skipped` | `skip`                |

off-r1's skip list was not recorded: its report printed a skeleton as skipped only when it had no
text. Tavnit and the plumber, which have a `wow`, wrote a real `discovery` in every run.

## Judged — REASONED

**The method is 2026-10-08's.** The runs were relabelled set-A to set-D, so no judge knew a
text's side, and off-r1 was judged again blind with the rest.

- **Readers, per set and batch:** two Hebrew readers and one content reader, with the 10-08
  prompts verbatim. The content reader had one item added: the speaker using or benefiting from
  the product.
- **Votes:** three independent votes per merged candidate; two of three kept it.
- **Size:** 237 agents, 63 candidates, 41 kept. None of this is confirmed by the founder.

| measure                                         | off-r1 | off-r2 | low-r1 | low-r2 | off | low |
| ----------------------------------------------- | -----: | -----: | -----: | -----: | --: | --: |
| Hebrew mistakes, each with a named correct form |      7 |      4 |      3 |      4 |  11 |   7 |
| invented figures                                |      2 |      4 |      0 |      1 |   6 |   1 |
| speaker uses or benefits from the product       |      1 |      0 |      2 |      0 |   1 |   2 |
| closing line copies an example or restates      |      0 |      3 |      3 |      7 |   3 |  10 |
| viewer addressed in the singular or fem. plural |      0 |      0 |      0 |      0 |   0 |   0 |

**Closing lines, mechanically (MEASURED).** A closing line identical to an example's closing line
(`מישהו יכול להסביר לי את זה?`, `אל תשאלו`) scores 0, 2, 3 and 3, in the table's order. That is
2 off against 6 low, out of 32 closing lines a side. The judges' 3 against 10 adds the near copies
and one restatement.

**Judge calibration.** Judged again blind, off-r1 kept the same 6 Hebrew mistakes the 10-08 judges
had kept, plus one (`הכי ביטחון בעולם`). Its figures moved more:

- 10-08 kept 4 figures.
- This time 2 of them were dropped (`ולא מחכים שבוע`, `מלמד לעשות את זה בלחיצה`).
- `חיי העבודה שלי השתנו` was re-filed as a truth break.
- One figure is new (`שחצי יום הולך על לחפש`).

**The side differences are about the size of the run-to-run spread inside a side.**

- Figures and Hebrew lean `low`: figures 0–1 against 2–4; Hebrew 3–4 against 4–7.
- Copied closing lines lean `off`: verbatim copies 0–2 against 3–3.

## What it does not show

- **Thinking.** The model thought on none of the 8 `low` calls. The test measured effort `low`
  against `high`, both without thinking. What thinking itself would do needs a level at which the
  model thinks.
- **More than two runs a side.** Two runs per side, with one shared prompt and one set of four
  questionnaires.
