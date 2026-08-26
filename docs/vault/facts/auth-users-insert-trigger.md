---
type: fact
status: verified
verified: 2026-08-26
method: "select relnamespace::regnamespace, relname, tgname, proname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_proc p on p.oid=t.tgfoid where not t.tgisinternal; and supabase/migrations/0002_supabase_rls.sql:11-26"
source: db
---

# Every `auth.users` insert mirrors a row into `public.users`

`0002_supabase_rls.sql:11-26` defines `public.handle_new_user()` and attaches it to `auth.users`
as the `on_auth_user_created` trigger. Its whole body is:

```sql
INSERT INTO public.users (id, email)
VALUES (NEW.id, NEW.email)
ON CONFLICT (id) DO NOTHING;
```

Verified on the live project: it is one of only two non-internal triggers outside the `storage`
and `realtime` schemas, and the mirroring holds — `public.users` and `auth.users` both have 4 rows
and all 4 ids join.

## What it constrains

**`public.users.id` is the auth uid, but nothing enforces it.** There is no foreign key from
`public.users` to `auth.users` — the trigger is the only thing keeping them aligned. Nor is there
one from `businesses.owner_user_id` to `auth.users`; that FK points at `public.users`. So if an
auth user is ever recreated with a fresh uuid, `businesses.owner_user_id` silently points at a
row that no longer corresponds to any login, and no constraint fires. Preserve the uuids, or
expect ownership to detach without an error.

**The trigger writes the DEFAULT role.** It supplies only `(id, email)`, so `users.role` falls to
its column default (`customer`). It never upgrades an existing row — that is the `ON CONFLICT
(id) DO NOTHING`. Two consequences:

- Any process that creates `auth.users` rows before the corresponding `public.users` rows exist
  gets `customer` accounts, and the later write has to be an `UPDATE`, not an `INSERT`. If
  `public.users` is written **first**, the trigger's insert is a no-op and the intended role
  survives.
- This is the same mechanism behind
  [[../defects/admin-flag-is-a-noop-on-existing-accounts]]: role assignment is not idempotent in
  the direction people expect.

`SET session_replication_role = replica` suspends this trigger along with FK checks — relevant
whenever `auth.users` rows are loaded in bulk rather than created through GoTrue.

Related: [[sets-video-renders-fk-cycle]].
