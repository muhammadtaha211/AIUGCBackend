---
type: defect
status: verified
verified: 2026-08-23
method: "git show b60b5b6 -- packages/core/src/plan-format.ts packages/core/src/pipelines/demo-step-plans.ts fixtures/timelines/; then read each fixture's _comment against the new constants"
source: code
---

# Three of the four fixture comments now say the opposite of what the code does

`b60b5b6` changed the step-timing constants and re-pinned three fixtures' `dryRunSourceIndexes` —
and touched **no `_comment` block**. Those comments exist specifically to stop a human or an agent
mis-editing a pinned fixture, and three of them now mislead.

The constants that moved ([[steps-format-defaults-are-code-constants]]):
`MIN_STEP_MS` 1400 → **3000**, `MIN_RUNTIME_MS` 11,000 → **16,000**, `MAX_RUNTIME_MS` 16,000 →
**21,000**, and the `a_steps_max` fallback 8 → **7**. No `app_config` row overrides any of them.

## `real-botteacher-study-app.json` — flatly contradicted by its own file

Lines 14-15 of the comment:

> the pinned sourceIndexes are the ONLY pass condition. **There is no dryRunSourceIndexes to absorb
> a difference either.**

`b60b5b6` added one, at `fixtures/timelines/real-botteacher-study-app.json:2021-2028`:
`dryRunSourceIndexes: [1,16,40,45,51,79]`. And `demo-step-plans.ts:1392-1393` **prefers** it under
`DRY_RUN`. So both halves of that sentence are now false: there is one, and it — not
`sourceIndexes` — is the pass condition the keyless suite checks.

The trap is concrete: someone told that `sourceIndexes` is load-bearing edits it expecting the suite
to go red, and nothing happens.

## `dry-run-campaign-app.json` — the reasoning, not just a fact

Its "(c) STALE TARGET" paragraph reasons in milliseconds:

> a three-word caption needs 1600ms … So the pin is **mechanically satisfiable** (3/2/2/3/3/3 words
> totals exactly 11000ms and findPlanViolations passes it)

Both numbers are dead. With a 3,000 ms floor the read-time arithmetic no longer decides anything —
every step runs the floor or the gap, whichever is smaller — and an 11,000 ms total is now **below**
`MIN_RUNTIME_MS` of 16,000, so the configuration the paragraph calls satisfiable is unsatisfiable at
every legal caption length. The verdict inverted.

Note _what_ killed it: the 3,000 ms floor, **not** the `readTimeMs` word-counting change in the same
commit. That change only stops punctuation-only tokens counting as words, and every number the
comments cite is unaffected by it. Worth being precise, because "b60b5b6 changed readTimeMs" is the
headline and it is the one change here that broke nothing.

## `real-botteacher-file-routing.json` — same class

Its paragraph reasons about a 1,600 ms gap and a 10,000 ms overrun under the old band. Both are
arithmetic against superseded constants.

## `real-botteacher-six-word-label.json` survives

Its comment makes no millisecond claims that moved, and `b60b5b6` did not re-pin it. It is the one
fixture whose prose still matches — and, separately, the one whose `dryRunSourceIndexes` was not
re-derived. The suite is green, so the mechanical planner still returns its pinned set.

## Blast radius

**No runtime or test effect.** `fixtureSchema` (`demo-step-plans.ts:1348-1362`) names only
`questionnaire`, `timeline` and `expected`, and zod strips the rest, so `_comment` never reaches
code — every comment says so itself.

The damage is entirely to the next reader, and these are the notes a reader consults precisely when
they are about to change something they do not fully understand. A wrong map is worse than no map.

## Fix shape

Prose only, three files, no code. Rewrite the three stale paragraphs against the current constants,
and add the reason the `dryRunSourceIndexes` moved. While there, `dry-run-campaign-app.json`'s
comment labels its two reasons "(b)" and "(c)" with no "(a)" — it was born that way in `e40e0e6`.

## Related

- [[timeline-fixtures]] — the current pins and what each fixture tests
