---
type: decision
status: verified
verified: 2026-10-01
method: "Founder decision in chat, 2026-10-01, recorded from that day's task prompt; the reasons, the options and the job report are his. Grounding: two read-only production reads, 2026-10-01, each inside a `set transaction read only` transaction (packages/core/.work/legibility-gate-probe-2026-10-01.ts and legibility-gate-probe-2-2026-10-01.ts, gitignored, counts only, no screen text printed): `jobs.state->'batchResults'` of job 174c1063 counted per batch; the stored timeline of demo_analyses e4be3bce counted; every production timeline counted by status and by legibility value; app_config searched for any key, top-level or nested one level in a JSONB value, matching analysis / legib / unreadable. Code read on fix/legibility-gate-unreadable-only, branched from origin/main 06da875: packages/core/src/pipelines/demo-analysis.ts (the gate, both keys, their defaults); demo-step-plans.ts:837 and :1821 (the two unreadable-only rejections); prompts/plan_demo_steps/v14.md:125-126 and :140-141; supabase/migrations/0028_split_legibility_gate.sql; `git log -S` on both key names in demo-analysis.ts plus `git show 79a1dbc` (when each axis entered the code); a grep of apps, packages, scripts and docs for illegibleFraction, legibilityVerdict, the verdict's axis and both key names."
source: founder + db + code
---

# 0069 — The refilm gate counts `unreadable` states only; `low` stops counting

Decided 2026-10-01, the day the founder's own recording was rejected after he had judged it readable
throughout. Each claim below carries one tag: **FOUNDER-REPORTED** (his statement or reasoning, not
checkable here), **MEASURED** (a production read or the tree, see `method`), **REASONED** (inference
from what is cited), **CARRIED** (from an older note or migration, not re-measured).

## The decision

`handleAnalyzeDemo` rejects an analysis (`status 'rejected'`, the Hebrew refilm message on
`fail_reason`) only when the fraction of `unreadable` states exceeds
`a_analysis_unreadable_threshold`. `low` no longer counts toward any gate.

**What was there before.** A second axis also rejected when `low` + `unreadable` exceeded
`a_analysis_legibility_threshold`, code default **0.75** (**MEASURED**, `origin/main` 06da875). That
axis was the original gate, not 0028's addition (**MEASURED**, `git log -S`):

- `79a1dbc` (2026-08-12) introduced it as the only gate, at 0.4.
- `232c02a` (2026-08-18), the 0028 change, kept it as the second axis, raised it to 0.75, and added
  the unreadable axis beside it.

The axis is now deleted: the key read, the default, `illegibleFraction` and the verdict's `axis`
field. It was not set to a number nobody can reach.

- **The unreadable threshold is not retuned.** It stays at its code default, **0.25**.
- **The Hebrew message is unchanged.** "חלק גדול מדי מהצילום לא קריא — צלמו שוב בתאורה בלי ברק על
  המסך וביד יציבה יותר" is accurate for the case that remains. The zero-cluster rejection, which
  shares the message, is untouched.

## Why

**FOUNDER-REPORTED**, with what was checked against each reason:

- **0028 had already measured `low` as the model's ordinary verdict on a filmed screen, not a refilm
  signal.** It responded by raising the low-plus-unreadable threshold from 0.4 to 0.75 instead of
  dropping `low`. **CARRIED** from 0028's header: across the first five real analyses, low plus
  unreadable ran 0.250–0.538 and unreadable alone ran 0.000–0.019.
- **Job `174c1063` shows the model transcribing full Hebrew sentences off frames it labelled `low`.**
  **MEASURED**, below.
- **The rest of the product already treats `low` as usable.** **MEASURED**: the plan validator
  rejects only `unreadable` (`demo-step-plans.ts:837`), and `updatePlanSteps` does the same
  (`:1821`). The inventory excludes only `unreadable` ([[0064-the-inventory-is-one-tier]]). Plan
  prompt v14 forbids `unreadable` and says to avoid `low` only "unless nothing else shows that part
  of the journey" (`prompts/plan_demo_steps/v14.md:125-126`). It also tells the model to take a
  `low` home page anyway (`:140-141`). Everywhere downstream, then, `low` can be selected; the
  prompt makes it a second choice. The gate was the one place that treated it as a reason to refilm,
  and its consequence was the harshest: the whole recording refused.

## The job that prompted it

**FOUNDER-REPORTED:** `analyze_demo` job `174c1063-bd8c-42a9-b858-122ae1109ab3` (demo `207c6421…`,
analysis `e4be3bce…`) ran 2026-10-01 on `hetzner:heavy`. In the first two batches (20 states) the
labels were 10 `high` / 10 `low` / 0 `unreadable`. Every `high` was the Chrome address bar, and every
page of the site was `low`. The founder judged the recording readable throughout.

**MEASURED, 2026-10-01 (read-only):**

| batch | states | high | low | unreadable |
| ----- | -----: | ---: | --: | ---------: |
| 0     |     10 |    8 |   2 |          0 |
| 1     |     10 |    1 |   9 |          0 |
| 2–5   |     40 |    0 |  40 |          0 |
| 6     |      5 |    1 |   4 |          0 |
| all   |     65 |   10 |  55 |          0 |

- **The job** is `analyze_demo`, `succeeded`, attempts 0, `last_error` null, locked by
  `hetzner:heavy`. It was created 00:59:00 UTC and last updated 01:00:20 UTC. Its resumeKey prefix
  is `analyze_demo@v3/5/10`, and all 65 slots are non-null.
- **The analysis** (`e4be3bce-dc46-46b4-8b05-b025bf49646a`) is `rejected`, with `state_count` 65 and
  `prompt_version` `analyze_demo@v3`. Its stored timeline holds the same 10 / 55 / 0, and
  `fail_reason` is the refilm message.
- **REASONED, from the counts above and the gate code: the retired axis rejected it.** Unreadable is
  0/65, which passes 0.25. Low plus unreadable is 55/65 ≈ **0.846**, above 0.75. Under the gate as
  changed, the same timeline lands `ready`. A unit test pins exactly this mix.
- **All 55 `low` frames carry non-empty Hebrew `visibleText`, and 52 of the 55 hold a Hebrew line of
  four or more words.** These are counts only; the read never printed the text. All 10 `high` frames
  do too.
- **The founder's 20-state count is off by one.** Batches 0 and 1 measure 9 `high` / 11 `low`, not
  10 / 10. The tenth `high` is in batch 6. This does not change the decision.
- **Not verified:** that every `high` is the address bar and every site page is `low`. Checking it
  means reading screen content, which this read deliberately did not do.

## Every other production analysis — MEASURED, 2026-10-01

- **12 analyses carry a non-empty timeline.** 11 are `ready`, with unreadable at 0.000–0.037 and low
  plus unreadable at 0.189–0.630. `e4be3bce` is the only `rejected` one.
- **Legibility values across every stored timeline:** `high` 337, `low` 251, `unreadable` 7. No value
  falls outside the enum's three.
- **REASONED: this change re-gates nothing.** The gate runs only when an analysis job finishes, and
  none of the 11 is near 0.25 on the unreadable axis.
- **`e4be3bce` stays `rejected`.** It is not re-run and not re-gated, on the founder's instruction;
  he re-uploads instead.

## Where the knobs lived — MEASURED

- **Both thresholds were code defaults** read through `getConfigValueOr` in `handleAnalyzeDemo`:
  `a_analysis_unreadable_threshold` at **0.25** (kept) and `a_analysis_legibility_threshold` at
  **0.75** (deleted).
- **There was no live row for either.** `app_config` holds 13 rows. Searched top-level and one level
  into each JSONB value, the only key matching analysis / legib / unreadable is
  `credit_costs.a_demo_analysis_credits`, a price. So no migration was written, and none is pending.
  **CARRIED** (0028's header, lines 26-30; [[credit-costs-row]]): the deleted key did once sit in
  `app_config`, nested inside `credit_costs` by a tuning attempt, and 0028 stripped it.
- **What still names the deleted key, kept on purpose:** migration 0028 itself, its test in
  `packages/core/test/migrations.test.ts`, and `scripts/verify-migration-ledger.sql:300-306`. They
  pin what 0028 did to the database, which is history; nothing reads the key at runtime.

## Options offered and not chosen

- **Retune 0.75 upward.** Rejected. **FOUNDER-REPORTED** reason: the same mistake with a different
  number.
- **Reframe the gate as "enough readable states to build a plan from."** Deferred, not rejected.
  **It is the next step if false rejects persist on `unreadable` alone.**

## What this does not change

The degraded-fraction gate (`a_analysis_max_degraded_fraction`), the zero-cluster rejection, the plan
pass, `updatePlanSteps`' unreadable rejection, the inventory ([[0064-the-inventory-is-one-tier]]),
`prompts/analyze_demo/*`, `promptVersion`, `resumeKey`, the Hebrew copy and the legibility enum.

## Pinned by

- **`packages/core/test/analysis-seam.test.ts`**, block "the legibility gate at the production seam
  (unreadable alone decides)". It is the handler, DRY_RUN off, with ffmpeg and the vision provider
  mocked, and it holds two tests:
  - "every state low and none unreadable: the analysis lands ready" (failed before the change with
    `expected 'rejected' to be 'ready'`);
  - "unreadable above the threshold: rejected with the refilm message, timeline kept".

  Before this, the rejection branch was pinned by no test.

- **`packages/core/test/demo-analysis.test.ts`**, block "the legibility gate counts unreadable alone
  (0069)". It holds five tests: both real-botteacher fixtures pass; all-`low` passes, including job
  `174c1063`'s 10 / 55 / 0; `low` never adds to `unreadable`; above the threshold fails, `low` or not;
  an empty timeline always fails.

## To take effect

The gate runs on the worker box, not on Vercel. It needs the merge, then the box deploy with its
restart (`docs/07-worker-box.md` §11, [[0039-three-deploy-axes-and-the-box-is-the-one-that-forgets]]).
Until then the box keeps rejecting recordings like this one, so the founder re-uploads only after
`git log -1` on the box shows the merge.
