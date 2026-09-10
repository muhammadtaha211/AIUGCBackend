---
type: fact
status: verified
verified: 2026-08-25
method: "pnpm --filter @aiugc/cli dev plan regress (LIVE, founder go 2026-08-25) at 733ff9b — v13, 3-call ladder, 15s band floor"
source: code
---

# First live regress on v13 + the 3-call ladder: 1 of 4 fixtures completes generation

Selection pins aside (the harness conflates drift with failure —
[[timeline-fixtures]]), the GENERATION outcome per fixture:

| fixture                          | outcome after 3 calls                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| `real-botteacher-six-word-label` | **COMPLETED** — valid plan, Hebrew refilm note with zero index references (the v13 rule) |
| `real-botteacher-study-app`      | failed: two fabricated words (`עוזר`, `אישי`) survived every corrective call             |
| `real-botteacher-file-routing`   | failed: loading-screen pick + a 2800ms pair + **14800ms total, 200ms under the floor**   |
| `dry-run-campaign-app`           | failed: fabricated words + three sub-3000ms pairs + **14500ms total, 500ms under**       |

~11 model calls, ~₪2-3.

## What it says, and does not say

- **The founder's 4-in-a-row failure class is dead.** No fixture failed the way production
  did (a well-spaced 5-step plan violating the band by arithmetic). The band-coherence test
  pins that permanently.
- **The near-miss pattern is new information:** two failures land 200-500ms UNDER the 15s
  floor because a squeezed pair (gap < 3000ms renders short) undercuts an otherwise-exact
  5×3000 total. The model keeps selecting states closer than the 3s step floor on timelines
  whose real beats ARE closer than 3s — the `b60b5b6` floor raise made tightly-paced
  recordings structurally harder to plan, and no prompt wording changes that arithmetic.
- **The fixtures are adversarial and description-less.** Both botteacher reds were red on
  the live path before this work ([[timeline-fixtures]]); three of four `_comment` blocks
  are stale arithmetic ([[fixture-comments-are-arithmetic-against-superseded-constants]]);
  and none carries a `demoDescription` — the study-app fabrication (`עוזר אישי`) is exactly
  the class a customer's one-line description now legalizes, and the classified failure
  message now tells them so. Production traffic ≠ this corpus.
- **The ≤5% target is now measurable on live traffic** — `fail_kind` + `retry_violations`
  land on every plan row since 0029. Judge the target there, not here.

## If the tail needs more

The remaining lever is founder-level, not prompt-level: recordings whose beats sit under 3s
fight the 3s step floor itself. Options if live traffic shows it: a per-account/config drop
of `a_step_ms_min`, or upload guidance ("hold each screen ~3s"). Recorded, not proposed.
