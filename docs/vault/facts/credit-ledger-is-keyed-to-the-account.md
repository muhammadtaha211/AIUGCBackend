---
type: fact
status: verified
verified: 2026-08-23
method: "packages/core/src/pipelines/credits.ts:6-12 read directly; both sums run side by side in packages/core/.work/vault-credit-forensics.ts"
source: code
---

# A balance is `sum(delta) WHERE user_id`. Summing by `business_id` is not a balance.

```ts
// packages/core/src/pipelines/credits.ts:6-12
export async function creditBalance(db: Db, userId: string): Promise<number> {
  const rows = await db
    .select({ balance: sql<string>`coalesce(sum(${creditLedger.delta}), 0)` })
    .from(creditLedger)
    .where(eq(creditLedger.userId, userId));
  return Number(rows[0]?.balance ?? 0);
}
```

`credit_ledger` carries **both** `user_id` and `business_id`. Only `user_id` is the account key.
`business_id` is provenance — which business the spend was for — and it is **nullable**.

## Why that matters: grants have no business

All three `grant_manual` rows in production carry `business_id = NULL`, and that is by design, not
an omission: `grantCredits` (`credits.ts:107-121`) takes `{ userId, credits, note }` and has no
business parameter to set. `debitRender` (`credits.ts:54-73`) is the only writer that fills
`business_id`.

So a per-business sum sees every debit and no credit. It is negative by construction for any account
whose grants arrived that way, and it can never be a balance.

| grouping                                          | moeloefow@gmail.com   |
| ------------------------------------------------- | --------------------- |
| `sum(delta) by user_id`                           | **142** ← the balance |
| `sum(delta) by business_id`, BotTeacher only      | **−35**               |
| `sum(delta) by business_id`, all three businesses | **−58**               |

## Current balances

> **`status: superseded` as of 2026-09-10** — [[live-account-census-2026-09-10]]. This table was
> measured 2026-08-23 against the Supabase project that has since been deleted (derived from the
> date, which predates the 2026-08-27 env flip; this note never named a project). Live today is
> **six accounts, one `admin`, all six the founder's own**, and these balances do not carry over.
> Kept verbatim as the record. **The claim this note exists to make is unaffected** — a balance is
> `sum(delta) WHERE user_id`, never `WHERE business_id`.

| account                    | role     | balance |
| -------------------------- | -------- | ------- |
| `moeloefow@gmail.com`      | customer | 142     |
| `aiugc21111@gmail.com`     | customer | 95      |
| `hamodetaha.ht@gmail.com`  | admin    | 10      |
| `muhammedtah211@gmail.com` | admin    | 0       |

`moeloefow` owns BotTeacher, RonDiron and MyTor; `aiugc21111` owns Tavnit and jobnet.co.il;
`hamodetaha.ht` (the founder) owns Ola Beauty, sdf and Matchn. Both admin accounts bypass credits
entirely at `packages/core/src/pipelines/sets.ts:483`, so their balances are decorative.

## A negative balance is structurally impossible

`debitRender` (`credits.ts:54-73`) re-reads the balance inside the transaction behind a
`SELECT … FOR UPDATE` on the owner row and throws `InsufficientCreditsError` when
`balance < cost`. No code path can drive a customer account below zero. **Any negative number
presented as a balance is a query bug, not a ledger state.**

That is exactly what happened once — see [[botteacher-balance-is-minus-30]].
