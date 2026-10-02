---
type: fact
status: verified
verified: 2026-08-23
method: "step0-8d-verify.ts, then re-measured 2026-08-23 with packages/core/.work/vault-facts-probe.ts, vault-credit-forensics.ts and vault-firstcall.ts (all read-only), run from repo root"
source: db
---

# Token and money budgets

**Re-measure before relying on this.** Usage is a rolling 24h window and moves constantly.

## Caps

**Changed by migration 0036 on 2026-09-11** — [[0040-the-hard-ceiling-moves-to-the-providers]],
[[daily-caps-were-hand-edited-before-0036]]. Values below are the migration's literals
(`supabase/migrations/0036_daily_caps_runaway_detector.sql`), repo-verified 2026-09-11; the live row
was confirmed by read-back through `packages/core/scripts/verify-daily-caps.ts`, founder-reported.

| Cap                       | Value (since 0036) | Was       | Notes                                                                                                                                                                                                                                       |
| ------------------------- | ------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform `llm_tokens`     | 8,000,000 / 24h    | 2,000,000 | **No role bypass by design.** A trip **parks** jobs for everyone, so it is sized as a runaway detector, not a budget.                                                                                                                       |
| Platform `tts_chars`      | 400,000 / 24h      | 100,000   | 16× its per-account pair.                                                                                                                                                                                                                   |
| Platform `gpu_seconds`    | 32,000 / 24h       | 7,200     | 16× its per-account pair.                                                                                                                                                                                                                   |
| Platform `images`         | 400 / 24h          | 100       | **No per-account pair**, so the 16× rule does not apply; raised 4× so it does not become the effective ceiling alone.                                                                                                                       |
| `per_account.llm_tokens`  | **500,000**        | 1,500,000 | The only per-account value 0036 moved. At 1.5M one account could legitimately consume 75% of the platform's daily budget and two heavy users tripped it. Summed across every business the owner holds. Admin-role bypass at `budget.ts:87`. |
| `per_account.tts_chars`   | 25,000             | 25,000    | Untouched.                                                                                                                                                                                                                                  |
| `per_account.gpu_seconds` | 2,000              | 2,000     | Untouched.                                                                                                                                                                                                                                  |

**The 16× rule** is what makes these re-derivable: every platform cap that has a per-account pair is
exactly 16× it, so sixteen simultaneously-maxed accounts are needed to trip a breaker whose failure
mode is parking jobs forever. `images` is the exception — no pair.

**The two levels are not the same kind of number.** `per_account` throws `AccountBudgetError` before
anything is enqueued — an immediate Hebrew rejection, safe to trip. The platform cap throws
`BudgetError`, which **parks** the job at +1h; the 6h valve (`MAX_BUDGET_PARK_MS`,
`pipelines/janitor.ts:25`) only reaches `render_video` and `lipsync`, so a parked `synth_tts` or
`analyze_demo` re-queues forever with its row stuck mid-state. That asymmetry is why the platform
numbers are high and the per-account ones are not.

~~**Prod diverges from migration 0027 — a migration is owed.**~~ **Corrected 2026-09-10: it does
not**, and 0036 has since superseded the value anyway. `0027_llm_caps_account_first.sql:24` still
seeds `'1500000'` and 0027 runs _before_ 0036, so a rebuilt database replays 1,500,000 and then
0036 lowers it to 500,000 — the lineage is intact ([[migration-0027-still-seeds-the-old-llm-cap]]).

`dailyCapsSchema.per_account` is a plain `z.object` (`config.ts:49`), i.e. **strip mode, not
`.strict()`**. Two precisions, because the original wording had both backwards:

- The strip happens **on read**, at the single `dailyCapsSchema.parse` in `getDailyCaps`
  (`budget.ts:138`). **Nothing validates writes to `app_config` at all** — a mistyped key survives
  in the row forever and the code simply never sees it.
- A `.strict()` object would _throw_ on an unknown key rather than strip it, so "closed, silently
  stripped" cannot both be true.

The operational advice stands and is the important half: the row looks changed and the cap doesn't
move, so **verify with a read-back, never with "the UPDATE succeeded"**. Removing a key still throws
on every budget read in the product.

The per-account cap also has a blind spot worth knowing before trusting its number — see
[[per-account-cap-blind-spot]].

## What things cost

| Action                               | Cost                                                                                                                                                                                                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Demo upload **that reaches `ready`** | **₪2.04–₪2.56** (mean ₪2.28) + 125k–159k platform tokens over 8–9 Claude calls; up to ₪4.35 if the job retries. Zero customer credits. Measured across all six analyses — [[analyze-demo-cost]].                                                                      |
| Demo upload **rejected at probe**    | Free — reject precedes the `analyze_demo` enqueue. Horizontal or <8s clips test the reject path at no cost.                                                                                                                                                           |
| `plan regress` (**5** fixtures)      | **MEASURED 2026-10-02 under `plan_demo_steps@v16`: 10 calls, 234,698 tokens, ₪2.82** — every fixture took its second call ([[v16-paid-check-2026-10-02]]). REASONED worst case: 15 calls at that mean, about ₪4.25. No `--fixture` flag: it runs the whole directory. |
| Plan generation / retry              | **40.9k–59.3k tokens** (median 45.9k) over 2 calls. Always 2 — the corrective retry fires every time, see [[first-call-violation-rate]]. Free in credits.                                                                                                             |
| Steps render                         | **5 real credits**, debited per render row inside `createSet`'s per-cell loop. The wizard only sends 1x1, so per-set and per-render coincide today.                                                                                                                   |
| Editing / approving a plan           | Free                                                                                                                                                                                                                                                                  |

## Last measured

- Platform 24h usage: **192,290 of 2,000,000 (9.6%)**, ~1.81M headroom — 2026-08-23 03:38 UTC.
  (Was 899,599 / 45.0% on 2026-08-22. It is a rolling window; this number ages in hours, not days.)
  **This is a snapshot, not a maximum.** The 192,290 figure gets quoted as "the busiest window ever
  recorded"; it is not — the 899,599 on the next line is 4.7× larger and is the largest recorded.
  Cite the larger one when sizing a cap ([[0040-the-hard-ceiling-moves-to-the-providers]]).
- BotTeacher / RonDiron / MyTor share one owner ledger (`moeloefow@gmail.com`, role `customer`):
  **142 credits** — unchanged, re-confirmed 2026-08-23. The founder's admin account
  (`hamodetaha.ht`) owns Ola Beauty / sdf / Matchn and holds 10; the newer customer
  `aiugc21111@gmail.com` owns Tavnit / jobnet.co.il and holds 95.
- Note a balance is `sum(delta) WHERE user_id`, never `WHERE business_id` —
  [[credit-ledger-is-keyed-to-the-account]].

## Rules

No upload without an explicit per-upload go from the founder, stating the cost. No `plan regress`
without a go. Don't touch `app_config`. Don't flip BotTeacher to admin — `sets.ts:745` (re-read
2026-09-11; was `:483`) sets
`chargeable = false` for admins, which would zero render debits and corrupt the ledger.
