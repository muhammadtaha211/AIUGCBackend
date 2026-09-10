---
type: falsified
status: verified
verified: 2026-09-10
method: 'probe in apps/web/test: `await import("../src/app/api/onboarding/complete/route")` under `cd apps/web && ./node_modules/.bin/vitest run` — passed, 2746ms, module resolved and `POST` was a function (probe deleted after measuring). The standing proof is apps/web/test/onboarding-complete-route.test.ts: 4 cases against the real POST, 43ms.'
source: code
supersedes: "[[web-route-handlers-cannot-be-unit-tested]]"
---

# "No route handler in `apps/web` can be imported by a test" — false since 2026-09-10

## The claim, verbatim

From `docs/vault/facts/web-route-handlers-cannot-be-unit-tested.md` (verified 2026-09-08):

> `apps/web` has **no vitest config file at all**; `"test": "vitest run"` runs on pure defaults.
> Vite does not read `tsconfig.json`'s `paths` without a plugin or an explicit `resolve.alias`, so
> the `@/*` → `./src/*` mapping that every route handler imports through simply is not there at
> test time.

and:

> the second probe (relative path straight at the route module) then hangs rather than failing,
> because the module pulls `@aiugc/core` and its provider wiring in behind it. Two independent
> reasons, one conclusion.

## What killed it

Both reasons are gone, and neither died on purpose.

**Reason one died the same day the note was two days old.** `apps/web/vitest.config.ts` landed in
`9598b49` (2026-09-10, the error-boundary commit) and does exactly one thing: `resolve.alias`
`@` → `./src`. Its own header says it was added because `middleware.test.ts` reached an unmocked
`@/lib/auth-user`. Route handlers got the alias as a side effect.

**Reason two was never a hang — it was the 5s default test timeout.** Importing the route module
costs ~2.7s on this machine (it does pull `@aiugc/core` in), which the 2026-09-08 probe spent
inside a test body, against `testTimeout: 5000`, on a busy machine. Nothing blocks. Measured today:
the probe above resolved in 2746ms and the module's `POST` came back as a function.

Both reasons applied to the same probe run, so the note recorded them as independent when one of
them was a timeout the other had eaten into.

## What is still true

The half of the note that was guidance, not measurement, stands:

> **Say plainly what such a test proves**: the arithmetic and the shape-selection rule. It does
> **not** prove the SQL, the auth gate, the ownership check, signed-URL minting, or that a response
> body is what a client actually receives.

`apps/web/test/onboarding-complete-route.test.ts` mocks `@/lib/supabase/server` and swaps `getDb`,
`createBusiness` and `setQuestionnaire` out of `@aiugc/core` for a four-link fake of drizzle's
chain. It keeps the real `questionnaireSchema`, the real `schema` tables and the real owner lookup,
so it proves the branch and the response shape — and nothing about RLS or Postgres.

Also still true, and untouched by this: there is **no DOM**. jsdom, happy-dom and
`@testing-library/*` are not installed anywhere in the monorepo, so no React component can be
rendered in a test. Client-side logic still has to be carved into a plain module to be testable —
which is why `postParkedDraft` and `additionalWizardDraft` live in `apps/web/src/lib/onboarding.ts`
rather than in `login-form.tsx` and `onboarding-flow.tsx`. Adding a DOM is still new test
infrastructure under locked decision #10, and still a founder call.

## Related

- [[login-clears-a-draft-the-server-never-stored]] — the defect whose fix needed the route test.
- [[test-suite-inventory]] — the counts, `verified: 2026-08-23` and long stale: it has `apps/web`
  at 7 files / 212 tests, and today's run is 14 files / 347.
