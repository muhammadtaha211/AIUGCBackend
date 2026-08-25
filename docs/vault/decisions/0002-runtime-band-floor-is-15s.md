---
type: decision
status: verified
verified: 2026-08-25
method: "founder chose in chat (AskUserQuestion, 2026-08-25 session) between the two options below"
source: founder
---

# The steps runtime band floor is 15s, not 16s

`MIN_RUNTIME_MS` = 15000 (`packages/core/src/pipelines/demo-step-plans.ts:125`). The finished ad is
hook (~4s) + 15–21s of steps ≈ 19–25s.

## The problem forcing a decision

[[steps-format-defaults-are-code-constants]]: since `b60b5b6` every unsqueezed step renders exactly
the 3000ms floor, so a plan's total is `3000 × N`. With `A_STEPS_MIN_DEFAULT = 5` and a 16000ms band
floor, the 5-step minimum totalled 15000ms — arithmetically incapable of validating — while
`prompts/plan_demo_steps/v12.md` told the model "if the journey honestly holds only five beats, keep
five and write the uncapped ones long" (false: caption length cannot move the total). Every 5-step
plan burned the corrective retry and failed. This is the deterministic half of the founder's
4-failures-in-a-row on 2026-08-25.

## Options offered

1. **Lower the band floor to 15000** — one constant; every 5/6/7-step shape fits by construction
   (5×3000=15000 ≥ floor, 7×3000=21000 ≤ ceiling, ceiling check is strict `>`); ads may run ~19s
   with the hook.
2. **Raise `a_steps_min` to 6** — keeps 16–21s, but forces a 6th step onto timelines that honestly
   hold 5 beats; the live failure record shows what the model pads with (a loading screen — itself a
   violation, with no call left to fix it).

## Chosen: option 1, founder in chat 2026-08-25

Reason: kills the failure class structurally without adding fabrication pressure. The uniform-3s
pacing (every step exactly the floor) stands as the format's shipped behaviour; the per-kind table
and caption-length timing rules stay in code, revivable via `app_config` rows.
