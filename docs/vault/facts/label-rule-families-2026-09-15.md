---
type: fact
status: verified
verified: 2026-09-15
method: "apps/cli/node_modules/.bin/tsx packages/core/.work/label-rule-census.ts (read-only, SELECT only, not committed — .work/ is gitignored) against production hyaqydcmwbnbaiqqufow: every demo_step_plans row with retry_violations IS NOT NULL, each violation string classified into ONE family by the substrings listed under Method below, copied from findPlanViolations in packages/core/src/pipelines/demo-step-plans.ts as read at 6c097d6. The pair's usage_events joined by jobs.idempotency_key = 'plan:<id>', kind = 'llm_tokens'. Companion scripts label-rule-census-pair-inputs.ts and label-rule-census-pair-row.ts (same directory, same rules) read the pair's demo/questionnaire columns and row timestamps."
source: db
---

# Every recorded plan retry violation is a provenance violation — 25 of 25

The `retry_violations` column (0029) has recorded every model round since 2026-08-25, and nobody
had classified those rounds by which rule broke. This note does. The families are **measured**; the
word-type column in the last table is **my reading** of each word and is labelled as such.

## The population is three rows, not sixteen

`demo_step_plans` in production holds **3 rows in total** — earliest 2026-08-27 10:35 UTC, latest
2026-09-14 23:42 UTC — and all three carry `retry_violations`. There is no row without it. The
project was rebuilt on 2026-08-27 (`docs/08-supabase-project-rebuild.md` §8; the old project is
deleted), so the sixteen job-backed plans that [[first-call-violation-rate]] counted on 2026-08-23
no longer exist anywhere. **That 15/15 dataset is gone; this is the whole record.**

| plan       | created (UTC)       | status | fail_kind | prompt | rounds | violations per round |
| ---------- | ------------------- | ------ | --------- | ------ | ------ | -------------------- |
| `9010eb99` | 2026-08-27 10:35:08 | ready  | —         | v13    | 2      | 12, 0                |
| `6fcd0d01` | 2026-09-14 23:41:24 | failed | validator | v13    | 3      | 4, 2, 1              |
| `0bfcfbfd` | 2026-09-14 23:42:03 | ready  | —         | v13    | 2      | 6, 0                 |

## (a) Totals

| what                                      | value |
| ----------------------------------------- | ----- |
| rows with `retry_violations`              | 3     |
| ready / failed                            | 2 / 1 |
| rounds (one round = one model call, 0029) | 7     |
| model calls implied                       | 7     |
| rows with 2 rounds / 3 rounds             | 2 / 1 |
| violation strings, every round, every row | 25    |
| rows whose round 1 was already clean      | 0     |

## (b) Per family

| family     | rounds containing it | of which ready / failed | rows whose FINAL round contains it | ready / failed |
| ---------- | -------------------- | ----------------------- | ---------------------------------- | -------------- |
| PROVENANCE | 5                    | 2 / 3                   | 1                                  | 0 / 1          |
| LENGTH     | 0                    | 0 / 0                   | 0                                  | 0 / 0          |
| SKIP_KIND  | 0                    | 0 / 0                   | 0                                  | 0 / 0          |
| ENDING     | 0                    | 0 / 0                   | 0                                  | 0 / 0          |
| COUNT      | 0                    | 0 / 0                   | 0                                  | 0 / 0          |
| SPACING    | 0                    | 0 / 0                   | 0                                  | 0 / 0          |
| RUNTIME    | 0                    | 0 / 0                   | 0                                  | 0 / 0          |
| OTHER      | 0                    | 0 / 0                   | 0                                  | 0 / 0          |

Five of the seven rounds are non-empty (the two ready rows close on an empty round), and every
non-empty round carries provenance violations and nothing else. By string count: **25 PROVENANCE,
0 in every other family, 0 unmatched.** Provenance is not the dominant family; it is the only one.

## (c) Plans that would have been accepted on ONE call under a highlight-not-gate rule

**3 of 3.** Every row's round 1 carried ONLY provenance violations (12, 4 and 6 of them). No row
mixed provenance with another family, no row violated without provenance, and no row's round 1 was
clean. Of the 7 rounds spent, **0** carried a violation from any other family — so with the
provenance rule computed but not enforced, each of these three plans would have been accepted after
its first call: 3 calls instead of 7, and the failed row would have been a ready row.

## (d) Provenance introduced by a corrective call

**0 rows.** Provenance was present from round 1 in all three.

## (e) The off-screen words

18 distinct words, 25 occurrences. Counts and the screen text are measured — the census printed
`screenName` and the pooled `visibleText` of every state a violation names, and the "nearest
on-screen form" column quotes from that output. **The "reading" column is my reading of each word,
not a measurement.**

| word    | n   | flagged against                          | nearest on-screen form (measured)                                                         | reading (reasoned)                       |
| ------- | --- | ---------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------- |
| אזור    | 3   | state 26 (×2, both analyses), state 16   | `כל האזורים` on 16 and 26 — definite plural; `screenName` of 26 is `פילטר אזור`           | CONTENT noun (plural on screen)          |
| לפי     | 3   | state 16, three rounds of the failed row | not on 16; `היקף משרה: לפי שעות` is on state 36 of the same timeline                      | preposition                              |
| ואזור   | 2   | states 16 and 26                         | as אזור                                                                                   | CONTENT noun, ו-prefixed                 |
| טופס    | 2   | states 47 and 46 (one per analysis)      | not in `visibleText`; both states' `screenName` is `טופס הגשת מועמדות - …`                | CONTENT noun (screenName only)           |
| מצאו    | 2   | state 36, both analyses                  | `נמצאו 10 משרות` — passive, נ-initial, outside the prefix set                             | narration / instruction verb, not listed |
| jobnet  | 1   | state 16 (2c74fe2a)                      | not in `visibleText`; `screenName` is `לוח דרושים - jobnet`                               | CONTENT (product / domain name)          |
| הגשת    | 1   | state 47                                 | `screenName` only (as טופס)                                                               | CONTENT noun (screenName only)           |
| הפרטים  | 1   | state 46                                 | absent                                                                                    | CONTENT noun                             |
| וקבלו   | 1   | state 26                                 | absent                                                                                    | narration / instruction verb, not listed |
| ותפקיד  | 1   | state 24                                 | `תפקידים` on state 16, not on 24                                                          | CONTENT noun (plural, other state)       |
| להפצה   | 1   | state 26                                 | `נא לבחור אזורים להפצה:` on states 46/47, not on 26                                       | CONTENT noun (other state)               |
| לחיפוש  | 1   | state 24                                 | `חיפוש` on 16 and 26, not on 24                                                           | CONTENT noun (other state)               |
| מועמדות | 1   | state 47                                 | `screenName` only (as טופס)                                                               | CONTENT noun (screenName only)           |
| משרת    | 1   | state 36 (0bb10493)                      | `משרות`, `משרה` on 36; `למשרת` on 46, not on 36                                           | CONTENT noun (construct form)            |
| מתאימה  | 1   | state 36 (0bb10493)                      | absent                                                                                    | CONTENT adjective                        |
| מתאימות | 1   | state 36 (2c74fe2a)                      | absent                                                                                    | CONTENT adjective                        |
| פנויות  | 1   | state 36 (2c74fe2a)                      | `רשימת משרות פנויו` — the OCR clipped the last letter on this analysis; whole on 0bb10493 | CONTENT adjective (OCR clip)             |
| תחום    | 1   | state 24                                 | `כל התחומים` on 24; `מתחום` on 16                                                         | CONTENT noun (plural on screen)          |

Read down the "nearest on-screen form" column: of the 18 words, **one** is a bare preposition
(לפי), **two** are verbs the instruction list does not carry (מצאו, וקבלו), and **fifteen** are
content words. But of those fifteen, only four (הפרטים, מתאימה, מתאימות and — arguably — jobnet as
a name the screen shows elsewhere) are absent from the recording altogether; the other eleven are a
plural, a construct form, an OCR clip, a `screenName` the rule never reads, or the same word on a
neighbouring state. That is the shape of what the rule has been catching.

## (5) The founder's pair, 2026-09-14/15

Same demo (`121925b0`), same analysis (`0bb10493`), same prompt (`plan_demo_steps@v13`). The demo
has **no description** (`demos.description` is empty) and the questionnaire contains none of
`לפי`, `אזור` or `איזור`; `demos.updated_at` is 23:40:53 UTC, before either press. On the columns
that feed the rule, the two presses had identical inputs.

**Failed — `6fcd0d01`, created 23:41:24.357 UTC**, `fail_kind = validator`, `fail_reason` is the
Hebrew "add a short description" line. Job `98e375e0`, `attempts = 0`, three `llm_tokens` events:
23:41:42.585, 23:41:48.749, 23:41:54.176 (25,357 / 26,154 / 26,090 tokens; 31 agorot each).

- round 1 (4): step 1 `לפי` and `ואזור` vs state 16; step 2 `ואזור` vs state 26; step 4 `הפרטים`
  vs state 46
- round 2 (2): step 1 `לפי` and `אזור` vs state 16
- round 3 (1): step 1 `לפי` vs state 16

**Ready — `0bfcfbfd`, created 23:42:03.947 UTC**, nine seconds after the failure was written. Job
`80ec8784`, `attempts = 0`, two `llm_tokens` events: 23:42:16.684 and 23:42:23.733 (25,370 / 26,250
tokens; 31 and 32 agorot).

- round 1 (6): step 2 `אזור` and `וקבלו` vs state 26; step 3 `מצאו`, `משרת`, `מתאימה` vs state 36;
  step 4 `טופס` vs state 46
- round 2 (0)

Approved 23:46:08 UTC. Its stored steps run `[4] כנסו לjobnet.co.il | [16] בחרו תחום וחפשו משרות
חופשי | [26] בחרו באיזור | [46] מלאו קורות חיים ושלחו | [52] קורות החיים נשלחו בהצלחה`. **Reasoned,
not measured:** `באיזור` on state 26 is a word the rule as written would flag (state 26 shows
`האזורים`, and neither the questionnaire nor the description carries `איזור`), while round 2 is
empty — so the label the model returned at 23:42:23 was not this one, and the stored label is a
human edit made before approval. `updatePlanSteps` never runs the rule on human labels
(`demo-step-plans.ts:1402-1403`), and `approvePlan` overwrites `updated_at`, so the edit left no
timestamp of its own.

## Method

The classification substrings, copied from `findPlanViolations` at `6c097d6` — each string lands in
the first family whose substring it contains, and the substrings are disjoint:

| family     | substring(s) matched                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| PROVENANCE | `appears neither in state` (`:538`)                                                                                  |
| LENGTH     | `label is over` (`:505`, the char cap), `label is empty` (`:511`), `/is over \d+ words/` (`:515`, the word cap)      |
| SKIP_KIND  | `screens are never steps` (`:501`)                                                                                   |
| ENDING     | `the last step must be the result/success state` (`:575`)                                                            |
| COUNT      | `fewer than the minimum` (`:623`)                                                                                    |
| SPACING    | `ms apart — a step is at least` (`:643`)                                                                             |
| RUNTIME    | `it is too SHORT` (`:754`), `it is too LONG` (`:758`)                                                                |
| OTHER      | anything else, verbatim — the zero-steps, max-steps, out-of-range, selected-twice, unreadable and read-time messages |

There is **no minimum-words message** in `findPlanViolations`; `MIN_LABEL_WORDS` is deliberately
unenforced (`plan-format.ts`), so LENGTH has three shapes, not four. The read-time message ("is on
screen for … but needs … to be read", `:672`) is not one of the eight families the brief named and
would have landed in OTHER; it never occurred.

Re-measure with:

```
apps/cli/node_modules/.bin/tsx packages/core/.work/label-rule-census.ts
```

## Related

- [[first-call-violation-rate]] — the 15/15 baseline this note's population no longer contains.
- [[plan-failure-diagnostics-are-unreachable]] — the defect 0029 closed, which is what made this
  measurable.
