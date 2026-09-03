---
type: fact
status: verified
verified: 2026-08-26
method: "grep of every supabase-js call in apps/web/src and apps/admin/src; grep -riE '\\bGRANT\\b' supabase/migrations/; information_schema.role_table_grants on prod"
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
this repo.

So a project created with that setting **off** gets no grants at all, and the two reads above
return empty until granted explicitly. The symptom is not an error: the middleware reads empty,
concludes "not authorised", and redirects — a loop back to `/start` (web) or `/login` (admin).

Only RLS stands between `anon` and the data on the current project. The new default is strictly
safer. See [[every-migrated-table-enables-rls]] for the RLS half.
