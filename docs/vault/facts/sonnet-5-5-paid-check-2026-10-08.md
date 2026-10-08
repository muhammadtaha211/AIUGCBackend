---
type: fact
status: verified
verified: 2026-10-08
method: "PAID, on the founder's approval of the plan, 2026-10-08 (cap ₪10). Branch feat/sonnet-5-5 at 495384c, thinking off (between_tools). All scratch is in packages/core/.work/sonnet-5-5/ (gitignored), run with apps/cli/node_modules/.bin/tsx. The paid scratch scripts load ONLY ANTHROPIC_API_KEY, so they cannot reach production: classifier.ts, text-block-run.ts, copy-tail.ts and analysis-run.ts, all on PGlite. Two CLI commands wrote production rows: `DRY_RUN=0 pnpm --filter @aiugc/cli dev copy hooks|copy b-script --business 1b237001-… (Tavnit)` and `… plan regress`. Production was read only in `set transaction read only` transactions: snapshot.ts, fetch-script.ts, prod-usage.ts, tavnit-hooktexts.ts, t5-box-usage.ts, and the older .work/screens/v16-usage.ts. Spend is the code's own llmCostAgorot ($2/$10, 3.70), totalled in spend.json."
source: db + code
---

# The paid checks of the switch to `claude-sonnet-5-5`: five of five pass, ₪3.85

The checks for [[0093-every-claude-call-runs-on-sonnet-5-5]], with thinking off
([[0095-thinking-stays-off-for-the-sonnet-5-5-switch]]). Each ran once, so this shows no
run-to-run spread. **MEASURED** unless a line says otherwise.

## Spend: 385 agorot of the 1 000 cap

| check                      | model | calls |  tokens | agorot |
| -------------------------- | ----- | ----: | ------: | -----: |
| classifier, 2 texts        | 5.5   |     2 |   2 305 |      4 |
| classifier, the same 2     | 4.6   |     2 |   1 860 |      5 |
| copy (hooks, B script)     | 5.5   |     2 |  14 018 |     14 |
| copy (hook text, TTS tags) | 5.5   |     2 |   3 094 |      4 |
| גוש טקסט, 4 batches        | 5.5   |     5 |  53 299 |     69 |
| planner, `plan regress`    | 5.5   |     7 | 182 119 |    151 |
| demo analysis, T5          | 5.5   |     8 | 130 865 |    138 |
| **total**                  |       |    28 |         |    385 |

## 1. The content-policy classifier — PASS, the same verdicts as 4.6

The texts were built the way `assertContentPolicy` builds them: Tavnit's live questionnaire, and a
made-up weight-loss supplement promising a guaranteed 10 kg a month.

- **Tavnit:** not flagged on 5.5 and not flagged on 4.6.
- **Weight-loss supplement:** flagged on both, as health claims and misleading claims.
- **No refusal and no parse failure.**
- **One difference:** 5.5 wrote `reason` in English, where 4.6 wrote it in Hebrew. No customer
  sees it: the web route answers a fixed Hebrew 422 and drops `category` and `reason`
  (`apps/web/src/lib/api-errors.ts`).

## 2. Copy for Tavnit — PASS

- **`hook_lines@v7`:** 10 lines in one call, no character retry.
- **`b_script@v17`** (persona שירה, structure `problem-agitate-solve`): a script, and a hook text
  inside its caps.
- **`hook_text@v3`:** re-derived from the script, inside its caps.
- **`tts_enhance@v4`:** four tags added, and `sameWordSequence` held.
- **The opener cut mid-thought** ("אם את מייסדת אפליקציה ולא מצליחה"). That is how 4.6's
  Tavnit hook texts read too: 29 `b_script` rows, `b_script@v13`–`v17`, read-only.
- **One sample, a rule broken:** the script addresses the viewer as one woman (`את מייסדת`).
  `b_script` v17 says the audience form comes from `target_audience`, which here is
  `מייסדי אפליקציות…`, and that the speaker's gender never bleeds into it. Of 4.6's 29 hook texts
  for Tavnit, the 8 that address the viewer all use the masculine `אתה`, and none uses `את`.

## 3. גוש טקסט, the v2 run's four batches — PASS

- **Volume:** 40 texts in 5 calls, 69 agorot. The v2 run on 4.6 took 5 calls and 94 agorot.
- **Limits:** no text over 450 characters, no dash. Median 225 characters and 41 words, against
  v2's 244 and 45.
- **One retry:** Tavnit's first answer had an emoji the burner refuses (U+1F636). The code
  re-asked, as built.
- **One text is malformed and the code stored it.** For the course at male, `discovery` came back
  as the literal word `skipped` in the text field, not in the skip list. `textBlockBatchProblem`
  checks the skeleton id, the burn rule and the dash, and `skipped` passes all three. The course
  at female wrote a real `discovery` with no wow, as 4.6 did in both v1 and v2.

### Against the v2 run on 4.6, by one method on both sets

**How it was done.**

- **Mechanical, MEASURED.** `fixture-phrases.mjs` (the v2 run's own script) and
  `text-mechanics.mjs` ran over both JSON files.
- **Judgment, REASONED.** A blind workflow labelled the sets "set-1" and "set-2"
  (`.work/sonnet-5-5/blind/`), so no judge knew which set came from which model.
  - Per batch: two Hebrew readers and one content reader, reading v2.md's rules.
  - Then three independent votes per candidate; a majority kept it.
  - A Hebrew mistake counted only with a named correct form.
  - The output is in `.work/sonnet-5-5/judging.json`. 67 candidates, 51 kept; quotes found twice
    are merged below.

**Results.** None of these is confirmed by the founder.

| measure                                         |                 5.5 |          v2 on 4.6 |
| ----------------------------------------------- | ------------------: | -----------------: |
| Hebrew mistakes, distinct                       |                   6 |                 21 |
| invented figures                                |                   4 |                  6 |
| closing lines copying an example or restating   |                   0 |                  7 |
| viewer addressed in the singular or fem. plural |                   0 |                  0 |
| phrases of 4+ words repeated across batches     |  32 (6 in all four) | 31 (9 in all four) |
| `discovery` written without a wow               | 1, plus 1 malformed |                  2 |

**Lifted wording.**

All five are on v2.md's lifted-before list or were flagged in the v2 findings.

| phrase                              | v2 on 4.6 | 5.5 |
| ----------------------------------- | --------: | --: |
| `נו, כן או לא?`                     |         4 |   0 |
| the `מניסיון אישי` aside            |         4 |   2 |
| `אין לי מושג איך אתם`               |         2 |   3 |
| `אוקיי, בכנות`                      |         4 |   4 |
| `זה לא נשמע מרגש, אבל זה ההבדל בין` |         0 |   2 |

Counts are batches out of four, by regex over both JSON files. The last phrase was gone in v2 and
is back on 5.5. 5.5 also
repeats one closing question of its own, `נו מה אתם אומרים`, in 3 of 4 batches.

## 4. The steps planner, `plan regress` — PASS: 5 of 5 ready, nothing repaired

On `plan_demo_steps@v16`, the same prompt as [[v16-paid-check-2026-10-02]]:

| fixture        | 4.6 calls (tokens)  | 5.5 calls (tokens)  | first-call ratio |
| -------------- | ------------------- | ------------------- | ---------------: |
| campaign-app   | 2 (6 693 + 7 299)   | 2 (8 324 + 9 150)   |             1.24 |
| file-routing   | 2 (24 658 + 25 318) | 1 (29 562)          |             1.20 |
| six-word-label | 2 (30 441 + 31 511) | 1 (35 678)          |             1.17 |
| study-app      | 2 (30 975 + 31 818) | 2 (36 068 + 37 116) |             1.16 |
| tavnit         | 2 (22 775 + 23 210) | 1 (26 221)          |             1.15 |

- **Calls:** 7 on 5.5 against 10 on 4.6, and 182 119 tokens against 234 698. Three of five first
  calls were clean, where 4.6 needed the corrective call on every fixture.
- **Spend:** 151 agorot against 282.
- **The first-call ratio** is in + out tokens on identical input, so it is mostly the tokenizer:
  1.15–1.24.
- **Picks:** 1 of 5 fixtures matched its pinned picks exactly. The pins were taken from 4.6's run,
  and drift is "a prompt to read the plan" ([[timeline-fixtures]]). Read here:
  - campaign-app added an opening step;
  - tavnit has 9 steps against 7;
  - six-word-label and study-app kept their notes.
- **REASONED, one run:** calls dropped with five calls' worth of sample. Whether 5.5 violates less
  often on its first call needs more runs.
- `plan regress` exits 1 on any pin mismatch, so this run exited 1.

## 5. The demo analysis, T5 (`28161296`, the tavnit.ai walkthrough) — PASS

The run was local: PGlite, temp-dir storage, the shipped `analyze_demo` and
`group_analysis_states` handlers, and real ffmpeg on the 84 s recording.

- **Result:** `ready` on attempt 0, with no corrective or salvage round. The timeline parses
  against `analysisTimelineSchema`, with 63 moments; the box's T5 runs had 65. There are 5
  sections, and 37 of the 48 product screens have Hebrew names, matching the Hebrew UI.
- **Cost:** 7 vision calls (117 212 tokens, 127 agorot) plus 1 sections call (13 653 tokens, 11
  agorot), 57 s end to end.
- **The box on 4.6, the same recording, four demos** (read-only): 8–11 vision calls, 134 601–176 604
  tokens, 220–272 agorot. Fewer calls on 5.5, so fewer tokens despite the tokenizer.
- Clustering differs across machines ([[analysis-clustering-does-not-reproduce-across-machines]]),
  so this comparison is loose.

## What it does not show

- **Run-to-run spread.** Every check ran once.
- **The box running 5.5.** These are local runs of the branch's code.
- **A customer's own data.** The production rows written are on founder-owned Tavnit and the
  unowned regress rows.
