---
type: defect
status: verified
verified: 2026-09-03
method: "code read at 23a06e1 — every `businesses` select whose result drives a redirect, with `error` discarded in each: apps/web/src/middleware.ts:40-43, apps/web/src/app/home/page.tsx:71-78 (HomeContent), home/a/new/page.tsx:25-29, home/b/new/page.tsx:24-28, home/demos/page.tsx:20-24, home/layout.tsx:23-29. Duplicate-business consequence traced from apps/web/src/components/onboarding/onboarding-flow.tsx (completeAdditional posts allowCreate) into apps/web/src/app/api/onboarding/complete/route.ts:69-89, where the owner guard at :71-80 is skipped and createBusiness at :85 runs unconditionally. NOT reproduced: no failing query was induced."
source: code
---

# A failed `businesses` query is indistinguishable from "this user has no businesses"

Every place that routes on business ownership destructures `data` and drops `error`:

```ts
// middleware.ts:40-43
const { data } = await supabase.from("businesses").select("id").limit(1);
if (data && data.length > 0) {
  return NextResponse.redirect(new URL("/home", request.url));
}
```

```ts
// home/page.tsx:71-78 (HomeContent)
const { data: businesses } = await supabase
  .from("businesses")
  .select("id, name, questionnaire")
  .order("created_at", { ascending: true });

if (!businesses || businesses.length === 0) redirect("/home/new-business");
```

PostgREST returns `data: null` on failure, so a pooler blip, an RLS change, or any transient
PostgREST error makes a real owner look business-less. `middleware.ts` then leaves them on
`/start`, and `HomeContent` sends them to `/home/new-business`. The same shape is in
`home/a/new/page.tsx:25-29`, `home/b/new/page.tsx:24-28`, `home/demos/page.tsx:20-24` and
`home/layout.tsx:23-29` (the last only empties the sidebar).

## What `03fc7f9` added to it

The class is pre-existing. What is new is where the misread now leads.

Before, an owner who fell through `middleware.ts:38-44` landed on the **public** wizard, whose
completion posts without `allowCreate` — and `api/onboarding/complete/route.ts:71-80` is idempotent
by owner, so it would have handed back their existing business. Fail-safe.

Now `OnboardingFlow` redirects them to `/home/new-business`, whose `completeAdditional` posts
`allowCreate: true`, which **deliberately** skips that guard (`route.ts:69-71`, comment:
_"allowCreate (signed-in הוסף עסק) deliberately skips the guard"_). `createBusiness` at `:85` then
runs. A transient query failure plus a filled-in questionnaire produces a **second business** for a
one-business customer. Fail-duplicating.

Reaching it takes a filled-in wizard, so it is not a one-click hazard — but nothing warns, and the
duplicate is a real row with real questionnaire data.

## Closure considered and deferred

Two changes were considered on 2026-09-03 and **not** made, to keep the branch to one concern:

- **`OnboardingFlow` redirects to `/home` instead of `/home/new-business`.** `/home` re-runs the
  ownership query server-side, so a transient failure would have to recur to reach the additional
  wizard, and a real owner lands on their dashboard. Costs one extra round trip on the normal path,
  and the founder's decision named `/home/new-business` explicitly
  ([[0015-signed-in-without-business-lands-on-new-business]]).
- **`HomeContent` throws on `error` instead of redirecting.** An error boundary is the honest answer
  to "we could not read your businesses"; redirecting is a guess. Same for the middleware, which
  would `return response` and let the page decide.

Deferred, not rejected.
