---
type: fact
status: verified
verified: 2026-10-11
method: "grep of every supabase-js call in apps/web/src and apps/admin/src; grep -riE '\\bGRANT\\b' supabase/migrations/; information_schema.role_table_grants on prod (2026-08-26, the old project). Re-measured 2026-10-11 on the current project hyaqydcmwbnbaiqqufow, read-only: packages/core/.work/grants-census-2026-10-11.ts -> 33 public tables; anon and authenticated hold REFERENCES, TRIGGER and TRUNCATE on all 33 (the public schema's default ACL); of SELECT/INSERT/UPDATE/DELETE, authenticated holds SELECT on businesses and users and nothing else, anon nothing."
source: code
---

# The browser only reads two tables through the Data API

The whole PostgREST surface of this product is `businesses` (web) and `users` (admin), SELECT only.

| Table        | Read by                                                                                                                                                                     | Columns                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `businesses` | `apps/web/src/middleware.ts:49`, `app/home/layout.tsx:24`, `app/home/page.tsx:72`, `app/home/demos/page.tsx:21`, `app/home/a/new/page.tsx:23`, `app/home/b/new/page.tsx:25` | `id`, `name`, `questionnaire`, `created_at` (order) |
| `users`      | `apps/admin/src/middleware.ts:72`, `apps/admin/src/app/login/login-form.tsx:38`                                                                                             | `role`, `id` (filter)                               |

All eight call sites run after `auth.getUser()` has returned a user, so only `authenticated` needs
a grant. `anon` needs none.

The supabase-js clients in both apps use `auth.*` and `.from()` and nothing else — no `.rpc()`, no
realtime `.channel()`, no browser-side `.storage`. Every **other** `.from()` in `apps/web` and
`apps/admin` is Drizzle over `getDb()`/`DATABASE_URL` (API route handlers and server components),
which PostgREST exposure does not affect. Grepping `.from(` alone conflates the two; the
distinguishing mark is a string-literal table name (`from("businesses")`) versus a schema object
(`from(schema.demos)`).

## The migrations grant nothing

`grep -riE '\bGRANT\b' supabase/migrations/` matches once, and it is a comment in
`0012_rls_credit_ledger_user.sql`. Every `anon`/`authenticated` grant on the live project — full
CRUD on all 25 tables — came from Supabase's "automatically expose new tables" default, not from
this repo. (That was the old project — see the correction at the end.)

So a project created with that setting **off** gets no grants at all, and the two reads above
return empty until granted explicitly. The symptom is not an error: the middleware reads empty,
concludes "not authorised", and redirects — a loop back to `/start` (web) or `/login` (admin).

**Corrected 2026-10-11** (the stale line PR 1 of social posting noticed; the approved plan's
refuter corrected it on 2026-10-10). The note said, verbatim:

> Only RLS stands between `anon` and the data on the current project. The new default is strictly
> safer.

That was true of the project the note was written on (the old one, deleted after the 2026-08-27
env flip), where the auto-expose default had granted full CRUD. **The current project was created
with "automatically expose new tables" off, so there are two layers, not one:** no Data API grant
beyond the two hand-run SELECTs above — measured 2026-10-11: on all 33 public tables `anon` holds
no SELECT, INSERT, UPDATE or DELETE, and `authenticated` holds SELECT on `businesses` and `users`
only — and RLS on every migrated table besides (server-only tables carry no policy). Both roles do
hold REFERENCES, TRIGGER and TRUNCATE on every table through the public schema's default ACL;
PostgREST exposes none of the three. See [[every-migrated-table-enables-rls]] for the RLS half.
