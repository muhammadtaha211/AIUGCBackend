---
type: falsified
status: superseded
verified: 2026-08-23
method: "sum(delta) grouped both ways over credit_ledger, with a running window function; packages/core/.work/vault-credit-forensics.ts"
source: db
---

# "BotTeacher's credit balance is −30"

## The claim

Carried in the handover series as a measured balance. Nobody could reproduce it, and the vault
README records it as "a credit balance that was never reproduced".

## It reproduces exactly — as the wrong query

The README's characterisation is too kind to the claim and too harsh on the number. **−30 is a real
figure in the ledger.** It is `sum(delta)` over `credit_ledger` filtered to
`business_id = 'b49405b0…'` (BotTeacher), and it was the standing value for a 34-hour window:

| when                 | delta | running |
| -------------------- | ----- | ------- |
| 2026-08-06 11:47     | −10   | −10     |
| 2026-08-18 13:54     | −5    | −15     |
| 2026-08-20 01:47     | −5    | −20     |
| 2026-08-20 03:01     | −5    | −25     |
| **2026-08-20 10:51** | −5    | **−30** |
| 2026-08-21 20:55     | −5    | −35     |

Any handover written between **2026-08-20 10:51 and 2026-08-21 20:55** that grouped the ledger by
`business_id` would print −30. That is the whole mechanism.

## What killed it

`creditBalance` keys on `user_id`, not `business_id` (`packages/core/src/pipelines/credits.ts:6-12`),
and every `grant_manual` row carries `business_id = NULL` because `grantCredits` has no business
parameter to fill (`credits.ts:107-121`). A per-business sum therefore sees **every debit and no
credit**. It is negative by construction and cannot be a balance.

The account's actual balance on the same data is **142**.

There is also a structural argument that needed no query at all: `debitRender`
(`credits.ts:54-73`) re-reads the balance inside its transaction behind a `SELECT … FOR UPDATE` and
throws `InsufficientCreditsError` when `balance < cost`. **No customer account can go negative.**
A negative number offered as a balance is a query bug, every time.

## What replaced it

[[credit-ledger-is-keyed-to-the-account]].

## Lesson

"Could not reproduce" and "reproduces, from a different query" are different diagnoses, and only the
second one stops the bug recurring. The first invites someone to re-run the same wrong query and
believe it. Record the query, not just the number.
