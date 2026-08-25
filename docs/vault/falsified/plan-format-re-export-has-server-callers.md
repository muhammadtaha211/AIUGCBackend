---
type: falsified
status: verified
verified: 2026-08-25
method: "git grep -n -E 'readTimeMs|totalRuntimeMs' b404482 -- 'packages/*/src' 'apps/*/src' (empty); grep -rn over packages/*/src and apps/*/src at HEAD for all four re-exported symbols; git grep -l 'readTimeMs' b404482"
source: code
---

# "Every server caller already imports them from here" — none does

## The claim

`b404482` (Phase 8a) moved `readTimeMs` and `totalRuntimeMs` out of
`packages/core/src/pipelines/demo-step-plans.ts` into the client-safe `plan-format` entry, and left
a re-export behind. The commit message says:

> readTimeMs/totalRuntimeMs moved (pure) into client-safe plan-format with re-exports preserving the
> server import surface.

The code comment it shipped is blunter, and is **still in the tree** at
`packages/core/src/pipelines/demo-step-plans.ts:38-39`:

> Kept re-exported here because every server caller already imports them from here.

The same sentence covers `MAX_LABEL_CHARS` and `PLAN_SKIP_SCREEN_KINDS`, which `9c323aa` had moved
the day before under the same reasoning.

## What killed it

There is no such caller, and there never was one at that commit.

At `b404482`:

```
git grep -n -E "readTimeMs|totalRuntimeMs" b404482 -- 'packages/*/src' 'apps/*/src'
```

returns **nothing**. The full file list, `git grep -l "readTimeMs" b404482`, is `plan-format.ts`,
`demo-step-plans.ts` itself, `apps/web/src/lib/service-a-ui.ts` — which imports from
`@aiugc/core/plan-format` directly, not from the re-export — and the two test files.

At HEAD the picture is the same for all four symbols. `grep -rn` over `packages/*/src` and
`apps/*/src` finds every consumer importing from `@aiugc/core/plan-format`:
`apps/web/src/lib/service-a.ts:2`, `apps/web/src/lib/service-a-ui.ts:7-9`,
`apps/web/src/components/a-wizard/step-plan.tsx:5`,
`apps/web/src/components/a-wizard/state-picker.tsx:4`. Inside `demo-step-plans.ts` the symbols are
used at `:43`, `:441`, `:1292` and `:795` — but through its own **import** at `:19-24`, not through
the re-export at `:40`. Nothing imports any of them from `pipelines/demo-step-plans`, and nothing
imports them from the `@aiugc/core` barrel either.

The one consumer of the re-export is a test: `packages/core/test/demo-step-plans.test.ts:37` imports
from `"../src/pipelines/demo-step-plans"`, and `:1739` is
`it("the re-exports ARE the plan-format functions, not copies")`.

## Why it is worth recording

The move itself was right, and the re-export is nearly free. What is wrong is the reason attached to
it, and the reason is what a future reader will act on. As written, the comment says the re-export is
load-bearing for server code — so anyone tidying `demo-step-plans.ts` will leave it, and anyone
adding a fifth constant will copy the pattern "because that is how server callers reach these".

The truth is narrower: the re-export exists so that one test can assert the move did not fork the
function into two copies. That is a real thing to want. It is not "every server caller".

Nothing in the vault carried this claim, so no note is superseded — it is a commit message and a
live code comment.

## Related

- [[8a-wizard-shell-and-read-only-plan]] — the phase that made the move
- [[8b-plan-editor]] — the next three constants to follow the same path
- [[steps-format-defaults-are-code-constants]] — what those constants are worth today
