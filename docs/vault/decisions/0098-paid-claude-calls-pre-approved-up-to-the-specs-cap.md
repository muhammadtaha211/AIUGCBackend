---
type: decision
status: verified
verified: 2026-10-08
method: "The founder's task prompt of 2026-10-08 (§2 item 8), and his message in the same chat reporting the cloud key's spend limit. That no app code reads the key's name is pinned by packages/core/test/unattended-guard.test.ts. The wrapper's key variable was read at packages/core/src/providers/anthropic.ts (getEnv().ANTHROPIC_API_KEY), and the cost formula at packages/core/src/pricing.ts (llmCostAgorot)."
source: founder
---

# 0098 — Paid Claude calls in an unattended run are pre-approved up to the spec's cap

**FOUNDER, 2026-10-08.** In an unattended run ([[0096-unattended-runs-happen-in-a-cloud-session]]),
paid Claude calls are pre-approved up to the cap the spec names, in ₪, where 0 means none. Above the
cap, or on any other provider, his explicit OK is needed as before.

- **Reason (his, 2026-10-08):** he accepted this change to the spend rule.
- **What it amends.** Every past paid check ran on an explicit go with a cap
  ([[token-and-money-budgets]], [[0082-the-label-call-is-a-paid-call-tested-first]]). For unattended
  runs, and for Claude only, the spec's cap is that go. CLAUDE.md's "no code path that calls a paid API
  in a loop without an explicit cap" still holds.

## The key

- **One name only.** The key is exposed only as `PAID_CHECK_ANTHROPIC_KEY`. App code and the test
  gate never read that name. A paid check passes it explicitly to the one command that spends:
  `ANTHROPIC_API_KEY="$PAID_CHECK_ANTHROPIC_KEY" DRY_RUN=0 <tsx> <script>`.
  - **Reason (planning's):** nothing spends by accident.
  - The wrapper reads only `ANTHROPIC_API_KEY`. The test pins that no `packages/*/src` or `apps/*/src`
    file names the paid-check variable.
- **Spend limit, FOUNDER-REPORTED 2026-10-08:** "a 20$ monthly spend limit on the scoped anthropic
  api key for cloud sessions". This is the hard ceiling above every per-run cap.
- **Never printing it is instruction only**
  ([[0097-push-to-main-refused-by-a-git-hook-the-rest-instruction-only]]). If it appears in any
  output, the run stops and asks so he can replace it.

## Each paid check reports its own spend

Production's usage ledger is out of reach from the cloud, so each paid check reports its own calls,
tokens and cost:

- **Cost:** in agorot, by `llmCostAgorot`. That is an estimate at $2/$10 per million and 370 agorot
  to the dollar, not an invoice.
- **Who enforces the cap:** the script does, by reserving each call's worst case in the run's
  `log.md` before sending it.
- **Why the script:** on PGlite, `assertBudget` reads an empty `usage_events` and caps nothing.

## What a cloud clone lacks for a paid check

The spec supplies these through the template's §6.

1. **The script.** `.work/` is gitignored and absent from a clone. The run writes the script under
   `packages/core/.work/<slug>/` and calls the shipped function the spec names.
2. **The inputs.** Past checks read questionnaires and fixtures from `.work/` or from production. The
   spec inlines them or names committed files. The five committed timeline fixtures need nothing.
3. **A database.** Every shipped Claude-calling function reads one. The script uses `createTestDb()`
   from `packages/core/test/helpers/pglite.ts` and seeds the rows the function reads. `DATABASE_URL`
   is never set.
4. **What cannot run in the cloud:** a check that needs a production read, or a recording that isn't
   committed.
