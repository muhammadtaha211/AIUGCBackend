---
type: decision
status: verified
verified: 2026-09-15
method: "Founder decision in chat, 2026-09-15, implemented unattended in the same commit as this note on branch labels/highlight-not-gate. Numbers cited from [[label-rule-families-2026-09-15]] (measured 2026-09-15, read-only) and [[first-call-violation-rate]] (measured 2026-08-23, now carried). Code read at 6c097d6 before the change and at this note's own commit after it: findOffScreenWords / findPlanViolations / generateStepPlan / updatePlanSteps in packages/core/src/pipelines/demo-step-plans.ts, prompts/plan_demo_steps/v14.md, apps/web/src/components/a-wizard/step-plan.tsx, apps/web/src/lib/service-a-ui.ts. The consistency section reads prompts/hook_lines/v7.md §Fabrication policy, prompts/b_script/v17.md, prompts/vo_script/v9.md and packages/core/src/pipelines/copy.ts. The legal section quotes docs/legal-review.md T9 and is REASONED, unconfirmed by counsel."
source: founder
---

# 0049 — The anti-fabrication rule on step labels is a highlight, not a gate

The per-word provenance rule on Service A step labels — every content word must appear in the
selected state's `visibleText`, the questionnaire or the customer's demo description — **keeps being
computed and stops failing plans.** It no longer drives a corrective call and can no longer be the
reason a plan fails. Its result travels with the plan as `offScreenWords` on each step, and the
editor shows those words to the customer as unverified, to check before they approve. Approval IS
the confirmation — nothing blocks it, and nothing on the approve path reads the marks. Every other
rule `findPlanViolations` enforces is untouched.

## Trigger

- **The false reject of 2026-09-14/15.** Plan `6fcd0d01` failed after three model calls, the last
  still carrying `לפי` on step 1 against state 16. `לפי` is a preposition; `FUNCTION_WORDS` had
  `לפני` and not `לפי`. The second press, nine seconds later on the same analysis with identical
  inputs, succeeded on two calls — each call samples a different plan, so the gate was deciding on
  chance. Rows, rounds and `usage_events` timestamps: [[label-rule-families-2026-09-15]] §5.
- **What the rule has actually been catching — MEASURED.** Every `retry_violations` round in
  production, classified by rule family: **3 rows, 7 rounds, 25 violation strings, all 25
  provenance.** No other rule has ever fired. All three rows carried only provenance in round 1, so
  all three would have been accepted on ONE call without the gate — 3 calls instead of 7, and the
  failed row a ready row. Of the 18 distinct words flagged, one is a preposition, two are verbs the
  instruction list does not carry, and eleven of the fifteen content words are a plural, a
  construct form, an OCR clip, a `screenName` the rule never reads, or the same word on a
  neighbouring state ([[label-rule-families-2026-09-15]] §e; the word-type column there is
  reasoned, the counts are measured).
- **The baseline the rule was designed against.** [[first-call-violation-rate]]: 15 of 15 job-backed
  first calls violated the validator, so "the corrective retry is not a safety net, it is the
  mechanism". That figure is now `carried` — its population lived in the Supabase project deleted on
  2026-08-27 — but nothing since contradicts it: 3 of 3 first calls in the current project violated
  too, all on provenance.

## Consistency with the other model-written copy

Four model-written texts reach the customer's ad. Three had no mechanical fabrication check; step
labels were the only gated path, and the lowest-risk copy of the four — captions on the customer's
own screen recording.

| copy                         | burned / spoken | customer-editable | mechanical check before this decision                                                                                                      |
| ---------------------------- | --------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| hook lines                   | burned          | yes               | none — `prompts/hook_lines/v7.md` §"Fabrication policy" LICENSES invention: its Green tier is "unlimited, no questionnaire support needed" |
| Service B `b_script`         | spoken + burned | yes               | none (`prompts/b_script/v17.md`, `copy.ts`)                                                                                                |
| `vo_script` (retired format) | spoken          | yes               | none (`prompts/vo_script/v9.md`, `copy.ts`)                                                                                                |
| step labels                  | burned          | yes               | the provenance gate — `findPlanViolations`, up to 2 corrective calls, then `PlanViolationError`                                            |

The gate was inconsistent with the rest of the product, and it was gating the copy whose source
material the customer supplied themselves.

## What changed

- `findOffScreenWords(steps, timeline, questionnaire, demoDescription)` — exported, same
  tokenization, same dup-run pooling, same three exemptions (function words, instruction verbs, a
  standalone prefix letter). Returns, per step, the label's own tokens that came from none of the
  three sources.
- `findPlanViolations(steps, timeline, maxSteps, shape?)` no longer returns "appears neither"
  strings. Its `questionnaire` and `demoDescription` parameters went with the check — nothing in it
  read them any more.
- `generateStepPlan`: the corrective ladder runs on `findPlanViolations` only. After the accepted
  plan, `findOffScreenWords` runs once and each assembled step carries `offScreenWords: string[]`
  (empty when none). `planStepSchema` gains it as `.optional()`, so every stored jsonb row still
  parses; no migration.
- The corrective prompt no longer tells the model to replace flagged words with `visibleText`
  copies — there are no flagged words in a corrective prompt any more. The previous-plan echo and
  "minimal edits" stay.
- `violationCustomerMessage` loses the "add a short description and try again" branch — a
  provenance violation cannot be a final-round violation.
- `updatePlanSteps` never runs the rule on human labels. A step whose label the customer changed
  stores `offScreenWords: []` — the words are theirs now; a step whose label is still the model's
  keeps the stored marks. (The brief for this change said "write `[]` on every step it stores";
  that reading was rejected in review because approve is disabled while the draft is dirty, so a
  single edit, delete or added step forces a save, and a save that wiped every mark would take the
  highlight away from the labels the customer never touched — the control this decision rests on.)
- `retryViolations` keeps its meaning — the violations that drove each round — which from this
  change on never includes provenance.
- Prompt `plan_demo_steps` v14: v13 with the "checked mechanically … fails the whole plan"
  sentences replaced by the truth (unverified words are shown to the customer to check before they
  approve; product claims the customer never made are still not to be invented), the instruction
  verbs and their present-tense plurals described as never marked, and the word-by-word
  "Before you answer" pass replaced by one line. Same six variables as v13, so no restart trap.
- Web: the plan editor (`step-plan.tsx`) renders each step's label with its `offScreenWords`
  marked — as a line under the label input, which cannot carry marks itself — and one hint line for
  the whole plan while any step has marks: "the marked words do not appear in the recording, check
  they are right before approving". Editing a label clears its marks at the first keystroke
  (`labelRuns` in `service-a-ui.ts` does the splitting with core's `splitWords`). Nothing blocks,
  nothing new is fetched, no new dependency.

## What deliberately did NOT change

- The length rules (`MAX_LABEL_WORDS` 6, `MAX_LABEL_CHARS` 60, empty label), the skip-kind rule, the
  ending rule, the minimum count, the spacing rule, the runtime band and the read-time rule — all
  still hard, same corrective ladder, same `MAX_CORRECTIVE_CALLS = 2`.
- The demo description field and its prompt sentinel — it still widens the vocabulary; now it
  reduces marks instead of preventing failures.
- `PlanViolationError.failKind` stays `validator` for the remaining hard rules.
- No `temperature` on `generateObject`. Nobody decided that.
- The content-policy classifier's input ([[0042-content-policy-is-wired-at-both-choke-points]]) —
  step labels are still not sent to it. See that note's dated line.

## Legal — REASONED, unconfirmed by counsel

`docs/legal-review.md` T9 leaves this open, for counsel:

> Our exposure as author of the generated copy rather than host, and whether more is needed than
> shifting the check.

This decision rests on **no new exposure relative to the three ungated copy paths**: hook lines,
`b_script` and `vo_script` were already model-written, burned or spoken, customer-editable, and
never mechanically checked for fabrication; step captions join them, with one control the others do
not have — the unverified words are shown to the customer before approval. That is reasoning, not
advice. It has not been put to counsel, and T9's question stands exactly as it did.

## Rejected

- **Delete the check entirely.** Loses the highlight (the customer would see nothing) and the
  measurement — `offScreenWords` on the row is the only way to keep counting what the model invents
  now that `retry_violations` no longer records it.
- **Keep the gate and widen the lists only** (Task 2 of this run, alone: the prepositions and the
  present-tense narration verbs). Fixes `לפי` and nothing else; does not touch the 15/15 baseline,
  and the eleven near-miss content words in [[label-rule-families-2026-09-15]] §e would still cost
  a corrective call each time the model reached for a plural or a `screenName` word.

## Related

- [[label-rule-families-2026-09-15]] — the measurement this rests on.
- [[first-call-violation-rate]] — the carried baseline, with the dated line on comparability.
- [[0042-content-policy-is-wired-at-both-choke-points]] — the remaining gap on label text.
- [[plan-failure-diagnostics-are-unreachable]] — what `retry_violations` records, with the dated line
  on its narrowed meaning.
- [[0039-three-deploy-axes-and-the-box-is-the-one-that-forgets]] — the deploy order this change
  needs (core + prompt on the box together; web on Vercel either side).
