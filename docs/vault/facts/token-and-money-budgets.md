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

| Cap                      | Value                   | Notes                                                                                                                                                                                      |
| ------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Platform `llm_tokens`    | 2,000,000 / 24h rolling | **No role bypass by design** — a capacity ceiling. A trip parks jobs for everyone.                                                                                                         |
| `per_account.llm_tokens` | 1,500,000               | Raised by hand from 500,000 on 2026-08-21. **Prod diverges from migration 0027 — a migration is owed.** Summed across every business the owner holds. Admin-role bypass at `budget.ts:87`. |

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

| Action                               | Cost                                                                                                                                                                                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Demo upload **that reaches `ready`** | **₪2.04–₪2.56** (mean ₪2.28) + 125k–159k platform tokens over 8–9 Claude calls; up to ₪4.35 if the job retries. Zero customer credits. Measured across all six analyses — [[analyze-demo-cost]].                                               |
| Demo upload **rejected at probe**    | Free — reject precedes the `analyze_demo` enqueue. Horizontal or <8s clips test the reject path at no cost.                                                                                                                                    |
| `plan regress` (**4** fixtures)      | The old ~6 calls / ~120k / ~₪1.50 figure was measured on three fixtures; a fourth landed 2026-08-21. Estimated ~8 calls and ~₪2.00 now — **not re-measured**, and it needs a paid run to be. No `--fixture` flag: it runs the whole directory. |
| Plan generation / retry              | **40.9k–59.3k tokens** (median 45.9k) over 2 calls. Always 2 — the corrective retry fires every time, see [[first-call-violation-rate]]. Free in credits.                                                                                      |
| Steps render                         | **5 real credits**, debited per render row inside `createSet`'s per-cell loop. The wizard only sends 1x1, so per-set and per-render coincide today.                                                                                            |
| Editing / approving a plan           | Free                                                                                                                                                                                                                                           |

## Last measured

- Platform 24h usage: **192,290 of 2,000,000 (9.6%)**, ~1.81M headroom — 2026-08-23 03:38 UTC.
  (Was 899,599 / 45.0% on 2026-08-22. It is a rolling window; this number ages in hours, not days.)
- BotTeacher / RonDiron / MyTor share one owner ledger (`moeloefow@gmail.com`, role `customer`):
  **142 credits** — unchanged, re-confirmed 2026-08-23. The founder's admin account
  (`hamodetaha.ht`) owns Ola Beauty / sdf / Matchn and holds 10; the newer customer
  `aiugc21111@gmail.com` owns Tavnit / jobnet.co.il and holds 95.
- Note a balance is `sum(delta) WHERE user_id`, never `WHERE business_id` —
  [[credit-ledger-is-keyed-to-the-account]].

## Rules

No upload without an explicit per-upload go from the founder, stating the cost. No `plan regress`
without a go. Don't touch `app_config`. Don't flip BotTeacher to admin — `sets.ts:483` sets
`chargeable = false` for admins, which would zero render debits and corrupt the ledger.
