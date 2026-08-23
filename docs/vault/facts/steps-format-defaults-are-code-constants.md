---
type: fact
status: verified
verified: 2026-08-23
method: "select key from app_config (13 rows, none of these) + sed -n on packages/core/src/plan-format.ts and packages/core/src/pipelines/demo-step-plans.ts"
source: db
---

# Every steps-format knob runs on its code constant — no row overrides any of them

`getConfigValueOr` returns the caller's default when the row is absent
(`packages/core/src/appConfig.ts:24`), and **none of these keys exists in `app_config`** — the live
table holds 13 rows and not one of them is on this list ([[app-config-live-state]]). So the
constants below are not defaults in the "if someone forgot" sense. They are the production
configuration.

| app_config key (absent)  | constant              | value                                            | defined at                                           |
| ------------------------ | --------------------- | ------------------------------------------------ | ---------------------------------------------------- |
| `a_steps_min`            | `A_STEPS_MIN_DEFAULT` | `5`                                              | `packages/core/src/plan-format.ts:50`                |
| `a_steps_max`            | `A_STEPS_MAX_DEFAULT` | `7`                                              | `packages/core/src/plan-format.ts:58`                |
| `a_step_ms_min`          | `MIN_STEP_MS`         | `3000`                                           | `packages/core/src/pipelines/demo-step-plans.ts:111` |
| `a_step_ms_max`          | `MAX_STEP_MS`         | `4000`                                           | `packages/core/src/pipelines/demo-step-plans.ts:112` |
| `a_steps_runtime_min_ms` | `MIN_RUNTIME_MS`      | `16000`                                          | `packages/core/src/pipelines/demo-step-plans.ts:121` |
| `a_steps_runtime_max_ms` | `MAX_RUNTIME_MS`      | `21000`                                          | `packages/core/src/pipelines/demo-step-plans.ts:122` |
| `a_step_ms_by_action`    | `DEFAULT_STEP_MS`     | per-kind map, all entries below the 3000ms floor | `packages/core/src/pipelines/demo-step-plans.ts`     |

## `b60b5b6` moved four of these, and the commit subject buries it

The subject line advertises "introduce a_steps_max configuration and enhance readTimeMs logic".
The behaviour changes are larger than that reads:

| constant                           | before               | after                         | effect                                          |
| ---------------------------------- | -------------------- | ----------------------------- | ----------------------------------------------- |
| max steps (`a_steps_max` fallback) | `8` (a bare literal) | `7` via `A_STEPS_MAX_DEFAULT` | **generated plans are capped one step tighter** |
| `MIN_STEP_MS`                      | 1400                 | 3000                          | **2.14× the step floor**                        |
| `MIN_RUNTIME_MS`                   | 11,000               | 16,000                        | the whole runtime band moved up 5s              |
| `MAX_RUNTIME_MS`                   | 16,000               | 21,000                        | same                                            |

Diffed with `git show b60b5b6 -- packages/core/src/pipelines/demo-step-plans.ts packages/core/src/plan-format.ts`.
The max was a literal `8` inline at the `getConfigValueOr` call before the constant was extracted, so
"introduce `A_STEPS_MAX_DEFAULT`" is also a cap reduction. **Anyone reading a plan row created before
2026-08-23 is reading a plan generated under an 8-step cap and an 11–16s band.**

`readTimeMs` changed in the same commit (`plan-format.ts:73-85`): it now counts only tokens
containing a letter or digit (`/[\p{L}\p{N}]/u`), so a punctuation-only token such as a spaced dash
no longer counts as a word. The comment says why — a cap-legal 6-word label was reading as 7
(3200 ms), busting the 21s band on the 7-step plans the timing table licenses at the ceiling exactly.

## Two guards worth knowing

Each pair is read min-first and the max is clamped up to it:
`maxSteps = Math.max(minSteps, …)` (`demo-step-plans.ts:968-971`), and the same shape in
`stepDurations` (`demo-step-plans.ts:737`) and `stepRuntimeBand` (`demo-step-plans.ts:752-755`). A
config pair entered the wrong way round cannot make the clamp incoherent or the band unsatisfiable.

**The 3000ms step floor sits above every `DEFAULT_STEP_MS` entry** and above a six-word caption's
read time, so an unsqueezed step runs exactly the floor and the per-kind table only matters again if
the floor drops. Noted at `demo-step-plans.ts:102-110`.

## Why this note exists

`stepDurations` and `stepRuntimeBand` are exported _for the test that pins them_ — see the comments
at `demo-step-plans.ts:722-723` and `741-745`. Reading the constants is the only way to know what
production runs on, because there is no row to read.
