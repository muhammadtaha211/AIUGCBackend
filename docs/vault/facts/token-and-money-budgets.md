---
type: fact
status: verified
verified: 2026-08-22
method: "step0-8d-verify.ts (read-only), run from repo root"
source: db
---

# Token and money budgets

**Re-measure before relying on this.** Usage is a rolling 24h window and moves constantly.

## Caps

| Cap | Value | Notes |
|---|---|---|
| Platform `llm_tokens` | 2,000,000 / 24h rolling | **No role bypass by design** — a capacity ceiling. A trip parks jobs for everyone. |
| `per_account.llm_tokens` | 1,500,000 | Raised by hand from 500,000 on 2026-08-21. **Prod diverges from migration 0027 — a migration is owed.** Summed across every business the owner holds. Admin-role bypass at `budget.ts:83-87`. |

`dailyCapsSchema.per_account` is a **closed** zod object. A typo in the key path writes a key zod
silently strips — the row looks changed and the cap doesn't move. Verify with a read-back, never with
"the UPDATE succeeded". Removing a key throws on every budget read in the product.

## What things cost

| Action | Cost |
|---|---|
| Demo upload **that reaches `ready`** | ~₪2.40 + 140–159k platform tokens. Zero customer credits. |
| Demo upload **rejected at probe** | Free — reject precedes the `analyze_demo` enqueue. Horizontal or <8s clips test the reject path at no cost. |
| `plan regress` (3 fixtures) | ~6 Claude calls, ~120k tokens, ~₪1.50 per run. No `--fixture` flag — it runs the whole directory. |
| Plan generation / retry | ~38.6k tokens (2 calls). Free in credits. |
| Steps render | **5 real credits**, debited per render row inside `createSet`'s per-cell loop. The wizard only sends 1x1, so per-set and per-render coincide today. |
| Editing / approving a plan | Free |

## Last measured

- Platform 24h usage: 899,599 of 2,000,000 (45.0%), ~1.10M headroom — 2026-08-22.
- BotTeacher / RonDiron / MyTor share one owner ledger (`moeloefow@gmail.com`, role `customer`):
  **142 credits**. The founder's admin account (`hamodetaha.ht`) owns Ola Beauty / sdf / Matchn.

## Rules

No upload without an explicit per-upload go from the founder, stating the cost. No `plan regress`
without a go. Don't touch `app_config`. Don't flip BotTeacher to admin — `sets.ts:483` sets
`chargeable = false` for admins, which would zero render debits and corrupt the ledger.
