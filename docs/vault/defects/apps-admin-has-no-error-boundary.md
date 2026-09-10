---
type: defect
status: verified
verified: 2026-09-10
method: "`find apps/admin/src -name 'error.tsx' -o -name 'global-error.*'` returns nothing (compare apps/web, which now returns three). Consequence read at apps/admin/src/lib/api.ts (adminSession's catch) and the five callers found by `grep -rn adminSession apps/admin/src`. NOT reproduced: no admin page was made to throw — apps/web's equivalent was measured on 2026-09-10 and the Next mechanism is the same file tree, but that is inference, not a run."
source: code
---

# `apps/admin` has no error boundary at any level

`apps/web` has three boundaries as of 2026-09-10 — `app/error.tsx`, `app/global-error.tsx`
and `app/home/error.tsx`. `apps/admin` has none, so any throw in an admin page or layout
reaches Next's built-in screen: English, LTR, unbranded, and for a throw behind a flushed
`<Suspense>` it arrives at **HTTP 200**
([[a-failed-businesses-query-reads-as-no-businesses]] measured that shape).

## Why it surfaced now, and what it cost

Closing [[auth-getuser-errors-read-as-signed-out]] meant deciding, per surface, whether a
failed auth read may throw. In `apps/web` the answer for the ten `/home` sites is yes,
**because there is something to catch it**. In `apps/admin` the same reasoning forces the
opposite answer, and that shaped the code:

- `adminSession(db)` — the page-side form, called by five admin pages — catches the
  `AuthReadError` it raises internally, logs it, and returns `null`, so the founder is sent
  to `/login` on a GoTrue blip exactly as before. That is a **deliberate swallow**, and the
  only one in this change. It is narrow on purpose: a failed `users` read still propagates,
  because turning that into `/login` would be this defect class again in a new place.
- `requireAdmin(db)` — the route-handler form — answers **503** instead, because a route
  handler has a status code to tell the truth with even without a boundary.

So the admin pages keep a known-wrong behaviour (a transient failure reads as "signed out")
purely because there is nowhere to put the truth. That is the cost of this defect, stated
concretely.

## Not fixed, and why

Out of scope for the task that found it — one task, one concern — and `apps/admin` is
founder-only, behind HTTP Basic Auth plus the role gate, so the blast radius is one person.

**The fix is small and known**: an `apps/admin/src/app/error.tsx`, dark (admin never adopted
`theme-light`, so it is the one fully-dark surface in the repo), modelled on
`apps/web/src/app/error.tsx` — including the retry, which must be
`startTransition(() => { router.refresh(); reset(); })`; `reset()` alone is a dead button for
a failed server read. With it in place, `adminSession`'s catch can be deleted and the admin
pages can throw like the web ones.

Related: [[auth-getuser-errors-read-as-signed-out]] (the change that forced the decision),
[[a-failed-businesses-query-reads-as-no-businesses]] (the Next boundary mechanics and the
HTTP-200 measurement).
