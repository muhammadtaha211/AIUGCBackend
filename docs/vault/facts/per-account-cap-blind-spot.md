---
type: fact
status: verified
verified: 2026-08-23
method: "select business_id is null, count(*), sum(quantity) from usage_events where kind='llm_tokens' group by 1 (packages/core/.work/vault-final-checks.ts); read against packages/core/src/budget.ts:90-100"
source: db
---

# The per-account cap cannot see 36% of recorded LLM spend

`assertAccountBudget` sums usage through an **INNER JOIN** to `businesses`
(`packages/core/src/budget.ts:95-97`):

```ts
.from(usageEvents)
.innerJoin(businesses, eq(usageEvents.businessId, businesses.id))
```

A `usage_events` row with `business_id = NULL` joins to nothing and is dropped. Those rows are
common:

| `business_id` | rows | tokens        | share of tokens |
| ------------- | ---- | ------------- | --------------- |
| present       | 306  | 2,551,516     | 63.6%           |
| **NULL**      | 77   | **1,460,553** | **36.4%**       |

The platform cap (`assertBudget`, `budget.ts:29-36`) has no such join and counts all 383 rows. So
**the two ceilings measure different populations over the same window**, and the per-account one
always measures the smaller.

## Why it does not matter yet, and when it would

The NULL-business rows are CLI and regression traffic — `generateStepPlan` takes `businessId` as an
optional field (`demo-step-plans.ts:960`) and `runPlanRegression` passes none
(`demo-step-plans.ts:1396-1399`). Today that is the founder's own spend, and the founder's accounts
bypass the per-account cap anyway (`budget.ts:87`).

It becomes a hole the moment any customer-triggered path forgets to thread `businessId` through. The
spend still lands on the platform ceiling, so it is not invisible — but the abuse ceiling, which is
the one that exists to stop a stranger, would not count it.

## The related gap: there is no per-account `images` cap at all

`daily_caps` has a platform `images: 100` but **`per_account` has no `images` key**
(`packages/core/src/config.ts:49-53`). This is not a silent no-cap — it is a compile error to write
one, because `assertAccountBudget`'s `kind` parameter is typed as
`keyof …["per_account"]` (`budget.ts:75`). There is no call site.

Note a DB-only fix is impossible: adding `per_account.images` by SQL would be stripped on read by
the plain `z.object` at `config.ts:49`. The schema has to change with it.

Zero `usage_events` rows of kind `images` exist, so this has never been exercised.

## Related

- [[token-and-money-budgets]] — the cap values themselves
- [[events-table-is-empty]] — the platform cap has never tripped
