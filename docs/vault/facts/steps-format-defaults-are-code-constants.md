---
type: fact
status: verified
verified: 2026-10-02
method: "select key from app_config, read-only (13 rows; none matches a_step%, a_steps%, a_analysis% or %step% — 2026-10-01, packages/core/.work/steps-screen/export.ts) + grep -n on packages/core/src/plan-format.ts, packages/core/src/pipelines/demo-step-plans.ts and demo-analysis.ts on feat/steps-end-on-screen-change. 2026-10-02: the same app_config query re-run read-only (no step knob row) and grep for stepDurations|stepRuntimeBand over packages/ and apps/ on feat/steps-fixed-2s-clips (no match)"
source: db
---

# Every steps-format knob runs on its code constant — no row overrides any of them

`getConfigValueOr` returns the caller's default when the row is absent
(`packages/core/src/appConfig.ts:24`), and **none of these keys exists in `app_config`** — the live
table holds 13 rows and not one of them is on this list (re-read 2026-10-01). So the constants below
are not defaults in the "if someone forgot" sense. They are the production configuration.

**Since 2026-10-02 ([[0076-every-step-is-a-fixed-2s-window-inside-its-screen]], built on
`feat/steps-fixed-2s-clips`) every step is a fixed 2 s clip.** Re-read that day, read-only:
`select key, value from app_config where key like 'a\_step%' or key like 'a\_analysis%'` returns
no row. The knobs that are left:

| app_config key (absent) | constant              | value                     | defined in                                     |
| ----------------------- | --------------------- | ------------------------- | ---------------------------------------------- |
| `a_steps_min`           | `A_STEPS_MIN_DEFAULT` | `5`                       | `packages/core/src/plan-format.ts`             |
| `a_steps_max`           | `A_STEPS_MAX_DEFAULT` | `10`                      | `packages/core/src/plan-format.ts`             |
| `a_analysis_fps`        | (inline default)      | `5` → one sample = 200 ms | `packages/core/src/pipelines/demo-analysis.ts` |
| (none — a constant)     | `STEP_MS`             | `2000`                    | `packages/core/src/plan-format.ts`             |
| (none — a constant)     | `MAX_LABEL_WORDS`     | `4` (what 2 s reads)      | `packages/core/src/plan-format.ts`             |

`a_analysis_fps` is read by the analysis and by `analysisSampleMs`: the recording's end is floored
to one sample, and a clip may start up to 2 s less one sample before its moment. **Deleted on
2026-10-02:** `a_step_ms_max` / `MAX_STEP_MS`, `a_steps_runtime_min_ms` / `MIN_RUNTIME_MS`,
`a_steps_runtime_max_ms` / `MAX_RUNTIME_MS`, `MIN_GAP_MS`, `stepDurations` and `stepRuntimeBand`.
No row existed for any of the keys.

The table as it stood from 2026-10-01 to 2026-10-02 ([[0072-step-cap-no-padding-cut-early]]: a
step ran to its screen's end, capped, with no floor), kept for the history below:

| app_config key (absent)  | constant              | value                     | defined at                                           |
| ------------------------ | --------------------- | ------------------------- | ---------------------------------------------------- |
| `a_steps_min`            | `A_STEPS_MIN_DEFAULT` | `5`                       | `packages/core/src/plan-format.ts:63`                |
| `a_steps_max`            | `A_STEPS_MAX_DEFAULT` | `7`                       | `packages/core/src/plan-format.ts:72`                |
| `a_step_ms_max`          | `MAX_STEP_MS`         | `4000` (the cap)          | `packages/core/src/pipelines/demo-step-plans.ts:112` |
| `a_steps_runtime_min_ms` | `MIN_RUNTIME_MS`      | `15000`                   | `packages/core/src/pipelines/demo-step-plans.ts:124` |
| `a_steps_runtime_max_ms` | `MAX_RUNTIME_MS`      | `21000`                   | `packages/core/src/pipelines/demo-step-plans.ts:125` |
| `a_analysis_fps`         | (inline default)      | `5` → one sample = 200 ms | `packages/core/src/pipelines/demo-analysis.ts:191`   |
| (none — derived)         | `MIN_GAP_MS`          | `1600` (3-word read time) | `packages/core/src/pipelines/demo-step-plans.ts:141` |

`a_analysis_fps` is read by the analysis AND, since 0072, by `stepDurations`: a screen's cut sits one
sample after its last state. **Deleted on 2026-10-01**: `a_step_ms_min` / `MIN_STEP_MS` (3000) and
`a_step_ms_by_action` / `DEFAULT_STEP_MS` (the per-kind map). No row existed for either.

The table as it stood from `b60b5b6` to 2026-10-01, kept for the history below:

| app_config key (absent)  | constant          | value                                            |
| ------------------------ | ----------------- | ------------------------------------------------ |
| `a_step_ms_min`          | `MIN_STEP_MS`     | `3000`                                           |
| `a_step_ms_max`          | `MAX_STEP_MS`     | `4000`                                           |
| `a_steps_runtime_min_ms` | `MIN_RUNTIME_MS`  | `15000` (16000 from `b60b5b6` until 2026-08-25)  |
| `a_step_ms_by_action`    | `DEFAULT_STEP_MS` | per-kind map, all entries below the 3000ms floor |

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

That commit's 16s floor also contradicted its own 3000ms step floor: every unsqueezed step renders
exactly 3000ms, so the 5-step minimum totalled 15000ms and could never satisfy the band — the
deterministic failure class behind the founder's 4-in-a-row live failures. Fixed 2026-08-25 by
[[0002-runtime-band-floor-is-15s]]; a band-coherence test in
`packages/core/test/demo-step-plans.test.ts` pinned the arithmetic until 2026-10-02, when the band
and the test were deleted with it.

`readTimeMs` changed in the same commit (`plan-format.ts:73-85`): it now counts only tokens
containing a letter or digit (`/[\p{L}\p{N}]/u`), so a punctuation-only token such as a spaced dash
no longer counts as a word. The comment says why — a cap-legal 6-word label was reading as 7
(3200 ms), busting the 21s band on the 7-step plans the timing table licenses at the ceiling exactly.

## Guards worth knowing

The step-count pair is read min-first and the max is clamped up to it: `maxSteps =
Math.max(minSteps, …)` in `generateStepPlan`. A pair entered the wrong way round cannot make the
count unsatisfiable. That is the one guard left: until 2026-10-02 `stepRuntimeBand` had the same
shape for the band, and from 2026-10-01 `stepDurations` clamped the cap up to one analysis sample;
both functions were deleted with the band and the cap.

Until 2026-10-01 **the 3000ms step floor sat above every `DEFAULT_STEP_MS` entry** and above a
six-word caption's read time, so an unsqueezed step ran exactly the floor. The floor turned out to
be an undecided default ([[0071-the-3s-step-floor-was-an-undecided-default]]) and is gone.

## Why this note exists

Until 2026-10-02 `stepDurations` and `stepRuntimeBand` were exported _for the test that pinned
them_; `analysisSampleMs` is what is left of them. Reading the constants is the only way to know
what production runs on, because there is no row to read.
