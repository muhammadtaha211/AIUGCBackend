---
type: defect
status: verified
verified: 2026-08-23
method: "grep -rn quoteRerollForRender packages apps (one hit, the declaration); git log -S quoteRerollForRender --oneline"
source: code
---

# `quoteRerollForRender` is exported, priced, config-backed — and called by nothing

`packages/core/src/pipelines/sets.ts:533` declares it, `packages/core/src/index.ts:27` re-exports it
via `export * from "./pipelines/sets"`, and it is the **only** caller of `quoteEndingReroll`
(`packages/core/src/pricing.ts:129-136`), which is in turn the only reader of the live
`credit_costs.a_ending_reroll_per_second` key.

Nothing calls `quoteRerollForRender`. No API route, no CLI command, no test.

`git log -S quoteRerollForRender --oneline` returns one real commit — `d8df728` (2026-08-06, "feat:
add comprehensive tests for credits and pricing models"). It was added then and has never been
referenced since, so this is **a stub for unbuilt work, not rot from a removed feature.** That
distinction matters: the ending-reroll feature does not exist anywhere else in the tree either.

## Why it is a defect at all

Because it makes a live config key look load-bearing when it is not. `credit_costs` carries
`a_ending_reroll_per_second: 1` in production, and anyone reading the row reasonably assumes tuning
it changes a price. It changes nothing a customer can reach.

`a_remix_assembly_credits: 2` is in the same position — its only pricer, `quoteAssemblyRemix`
(`pricing.ts:162`), is called from nothing but `packages/core/test/pricing.test.ts`. The comment
above it at `pricing.ts:154-160` says so honestly: "when the remix UI lands".

## Blast radius

None operationally. The cost is the misleading config surface, and the small tax of two unreachable
code paths that `pnpm typecheck` and the test suite still have to carry.

## Fix shape

Leave it, and note it — which is what this is. Deleting a stub for planned work is not obviously
right, and the `a_ending_reroll_per_second` key must stay in `credit_costs` regardless because
`creditCostsSchema` requires it (`pricing.ts:31`) and every quote path throws on a missing key.

The cheap improvement is a one-line comment on the two keys in [[credit-costs-row]] saying they are
not yet reachable — already done there.
