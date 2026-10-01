---
type: defect
status: verified
verified: 2026-10-01
method: "Read findPlanViolations in packages/core/src/pipelines/demo-step-plans.ts on fix/steps-plan-repair (the message lines cited below). Case (a) is in production: plan bd0913b4's stored round 1, read-only 2026-10-01, against the screens of analysis 4219e82e (packages/core/.work/plan-repair/screens.ts). Cases (b)-(e) were reproduced by the 2026-10-01 design review with inline scripts over synthetic timelines through the same function."
source: code + db
---

# The plan's retry advice names exits that may not exist

**Found 2026-10-01, not fixed.** The corrective prompt tells the model how to fix each violation.
Five pieces of that advice can name a way out the timeline does not have. All five predate
[[0074-unpickable-moments-and-the-last-round-repair]], which fixes none of them.

|     | Message (`demo-step-plans.ts`)                                                          | The exit that may not exist                                                                                                                              |
| --- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a   | read time, screen cut (line 1123): "or select an earlier state on the same screen"      | The pick is the first state on its screen. **MEASURED:** `bd0913b4` round 1 gave this advice for state 12, the first state of its screen (states 12–13). |
| b   | the same phrase                                                                         | The only earlier states sit in the pin's drop zone, which `withPin` removes.                                                                             |
| c   | too close (line 1080): "select a genuinely different state instead of the other"        | Every state is already selected. Dropping one of the pair is the real exit and is not named.                                                             |
| d   | too short (line 1218): "ADD one or two more distinct product states"                    | The plan is already at the 7-step maximum; the reachable fix is a swap.                                                                                  |
| e   | ending (line 1018): "select additional distinct product states from BEFORE that ending" | Every state before the ending is already used.                                                                                                           |

**What holds:** the success candidates the ending message lists and the count the minimum-steps
message gives both use the same captionable test the model's timeline does, so every index or
count they name is one the model can see.

**Why it is not fixed.** The founder ruled out prompt rewording as the fix (0074, D5), and wording
has now failed live twice ([[pr-75-retry-advice-gets-the-model-to-drop-the-step]]). With the
last-round repair in place a bad exit costs a corrective call, not the plan.

**If it is taken up:** (a) and (b) are computable from data already in scope. Offer the phrase only
when an earlier selectable state outside the drop zone shares the screen's end.
