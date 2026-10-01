---
type: falsified
status: verified
verified: 2026-10-01
method: "Read-only query of demo_step_plans for plan ce687d4a-add1-4b0a-baef-c3d3d036a468 on 2026-10-01 (one `set transaction read only` transaction, inline tsx from packages/core): status, fail_kind, prompt_version and the three retry_violations rounds, quoted below. Clip lengths from timelineClipMs over analysis 6658999c's timeline (packages/core/test/data/analysis-6658999c.json). The claim's text is docs/vault/state-of-play.md as of commit 729714d and the subject of commit 1983bed."
source: db + code
---

# Falsified: "the PR #75 retry advice gets the model to drop the step"

## The claim

Commit `1983bed`, merged as PR #75 (`a21da11`), is titled "fix(steps): retry advice the model can
take (first live v15 plan failed)". `state-of-play.md` described it, verbatim:

> **The fix:** branch `fix/steps-plan-ladder`, not yet merged. The read-time message stops offering
> a rewrite when no 3-word caption fits, and offers "drop this step" for a screen cut. The too-short
> and too-long messages now give each step's run and the overshoot. Code only: no prompt file or
> version change, and the box plan job is the only reader.
>
> **The fix's effect on the model is REASONED, not measured.** Replaying the reconstructed rounds
> (their totals match the stored violations exactly) shows round 2 now offering the drop that
> passes. Only a live retry shows what the model does with it.

The expectation in it: told to drop a step it cannot caption, the model drops it and the plan
passes. It was proposed by the `fix/steps-plan-ladder` session on 2026-10-01 and labelled REASONED
at the time.

## What killed it

The live retry it asked for. **MEASURED:** plan `ce687d4a`, created 2026-10-01 15:17:58 UTC on
analysis `6658999c`, ended `failed` / `validator` after three calls, and its rounds carry the new
wording, so the new advice is what the model was given:

| Round | Rejected pick, its caption                | Its clip |
| ----- | ----------------------------------------- | -------- |
| 1     | state 9, "בוחרים איזה תוכן שיווקי יוצרים" | 1 200 ms |
| 1     | state 12, "בוחרו דמות לפתיח הסרטון"       | 200 ms   |
| 2     | state 11, the same caption                | 200 ms   |
| 3     | state 12, the same caption                | 200 ms   |

Every one of the four lines ends: "… and no caption of 3 or more words fits in that, so drop this
step, or select an earlier state on the same screen, or a different moment". The model dropped
state 9 after round 1, then moved the other caption from state 12 to state 11 and back. It never
dropped it.

**FOUNDER-REPORTED:** the box showed `a21da11` by `git log -1` and was restarted before this plan
ran. The wording in the stored rounds agrees with that.

## What it does not falsify

The messages themselves. They state the clip, the read time and the overshoot correctly, and they
stay in the code. What died is the expectation that wording alone moves the model off a moment it
wants.

## What replaced it

[[0074-unpickable-moments-and-the-last-round-repair]]: the model is no longer shown such a moment,
and code drops the step when the last call still carries one. The exits the advice names that may
not exist are [[plan-retry-advice-names-exits-that-may-not-exist]].
