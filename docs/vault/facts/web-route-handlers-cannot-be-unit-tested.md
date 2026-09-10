---
type: fact
status: superseded
verified: 2026-09-08
method: 'scratch probe in apps/web/test: `await import("@/lib/service-b-ui")` under `pnpm --filter @aiugc/web exec vitest run` fails with `Failed to load url @/lib/service-b-ui (resolved id: @/lib/service-b-ui). Does the file exist?`; the same probe against `../src/app/api/businesses/[businessId]/renders/route` times out at 5000ms. Probe deleted after measuring.'
source: code
---

# No route handler in `apps/web` can be imported by a test — the `@/` alias does not resolve

> **SUPERSEDED 2026-09-10 by [[web-route-handlers-cannot-be-unit-tested]] in `falsified/`.** Both
> reasons below are gone: `apps/web/vitest.config.ts` (commit `9598b49`, 2026-09-10) supplies the
> `@/` alias, and the "hang" was the 5s default test timeout eating a ~2.7s module import, not a
> block. `apps/web/test/onboarding-complete-route.test.ts` imports the real `POST` and passes.
> Kept verbatim because the guidance under **What this means for testing an API route** still holds
> — such a test proves the branch and the response shape, never the SQL, RLS or the auth gate.

`apps/web` has **no vitest config file at all**; `"test": "vitest run"` runs on pure defaults. Vite
does not read `tsconfig.json`'s `paths` without a plugin or an explicit `resolve.alias`, so the
`@/*` → `./src/*` mapping that every route handler imports through simply is not there at test time.

That is why all nine files in `apps/web/test/` import with **relative** paths
(`../src/lib/service-b-ui`), and none of them imports anything under `src/app/`.

Every route handler in the app begins with `import { … } from "@/lib/api"`. So the alias failure
alone makes them unimportable; the second probe (relative path straight at the route module) then
hangs rather than failing, because the module pulls `@aiugc/core` and its provider wiring in behind
it. Two independent reasons, one conclusion.

## What this means for testing an API route

The route is not the testable unit here — the pure function it calls is. The established shape:

- a constant + helpers in `apps/web/src/lib/*-ui.ts`, imported by **both** the route and the client
  component that consumes it, so the two cannot disagree;
- the test in `apps/web/test/*.test.ts` against the helper, by relative import.

Two live examples: `DEMO_PAGE_SIZE` (`service-a-ui.ts`) shared by the demos route and
`step-demo.tsx`, and `RENDER_PAGE_SIZE` / `rendersPageParam` / `rendersPageCount`
(`service-b-ui.ts`) shared by the renders route and `renders-library.tsx` (2026-09-08).

**Say plainly what such a test proves**: the arithmetic and the shape-selection rule. It does **not**
prove the SQL, the auth gate, the ownership check, signed-URL minting, or that a response body is
what a client actually receives. Those are curl-against-a-signed-session checks, by hand.

Adding `vitest.config.ts` with a `resolve.alias`, or jsdom, or `@testing-library`, would be new test
infrastructure under locked decision #10 — a founder call, not a drive-by.

## Related

- [[test-suite-inventory]] — the counts, and the two workspaces with no tests at all.
- [[cli-and-worker-have-no-tests]] — the other coverage hole.
