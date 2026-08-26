---
type: defect
status: verified
verified: 2026-08-26
method: "begin; insert into public.users (id, email) values (gen_random_uuid(), '<an email already in public.users>') on conflict (id) do nothing; rollback; — run against the new project over the session pooler. Raises; the same statement with an unused email inserts."
source: db
---

# A CLI-created `public.users` row permanently blocks that email from signing up

`aiugc business create --email X` calls `ensureUser`, which writes a `public.users` row with a
**generated** uuid — there is no `auth.users` row behind it. If the person behind X later signs
up or signs in with Google, GoTrue inserts into `auth.users` with a **different** uuid, and the
`on_auth_user_created` trigger fires ([[../facts/auth-users-insert-trigger]]):

```sql
INSERT INTO public.users (id, email)
VALUES (NEW.id, NEW.email)
ON CONFLICT (id) DO NOTHING;
```

The conflict target is **`id`**. The collision is on **`email`** — `users_email_unique`
(`CREATE UNIQUE INDEX users_email_unique ON public.users USING btree (email)`). So the
`ON CONFLICT` clause does not catch it, the insert raises, the trigger raises, and because the
trigger is `AFTER INSERT` on `auth.users` inside GoTrue's transaction, **the `auth.users` insert
rolls back with it**. The user cannot sign up at all; the surfaced error is GoTrue's generic
`Database error saving new user` (500), which names neither the email nor the constraint.

## Measured

```
begin; insert into public.users (id, email)
       values (gen_random_uuid(), 'hamodetaha.ht@gmail.com')
       on conflict (id) do nothing; rollback;
-- ERROR: duplicate key value violates unique constraint "users_email_unique"
-- DETAIL: Key (email)=(hamodetaha.ht@gmail.com) already exists.

-- control, same statement, unused email:
-- INSERT 0 1
```

Both rolled back; `public.users` was unchanged (1 row before and after).

## The same root cause has a second, quieter face

`users_email_unique` is a plain btree on `email`, so it is **case-sensitive**, and `ensureUser`
(`packages/core/src/pipelines/businesses.ts:37`) looks up with `where email = $1` — also exact.
Measured, both rolled back:

```
insert 'Founder@Example.com'; insert 'founder@example.com';  -- BOTH SUCCEED, 2 rows
select count(*) from public.users where email = 'founder@example.com';  -- 0, given only the mixed-case row
```

So whether this defect is loud or silent depends purely on letter case:

| CLI wrote            | Person signs in as   | Outcome                                                            |
| -------------------- | -------------------- | ------------------------------------------------------------------ |
| `founder@x.com`      | `founder@x.com`      | **Loud** — trigger raises, `auth.users` insert rolls back, no login |
| `Founder@X.com`      | `founder@x.com`      | **Silent** — no conflict; two rows for one person                   |

The silent case is worse. Signup succeeds, but `businesses.owner_user_id` still points at the
CLI's invented uuid while `auth.uid()` is the new one, so `businesses_select_own`
(`owner_user_id = auth.uid()`) matches nothing: the customer signs in, sees no business, and is
returned to the onboarding wizard forever with no error anywhere. This is precisely the failure
`apps/web/src/app/api/onboarding/complete/route.ts:50-53` warns about in a comment — "an email
match with a different id would make every subsequent RLS read return nothing" — which that route
avoids by anchoring on `users.id = auth.uid()` rather than on email.

## Does it bite in the other direction?

**Auth user first, CLI second: safe when the casing matches, silently broken when it does not.**
`ensureUser` selects by email before inserting, so an existing mirror row (id = auth uid) is found
and reused — the business gets the correct owner. But an exact-match miss on casing falls through
to the same `INSERT`, producing the silent two-row state above. There is no loud variant in this
direction, which makes it the easier one to ship without noticing.

## Blast radius

Any email that was handed to `aiugc business create` before its owner ever signed up. On the new
project that is exactly one address today — the founder's own, from the 2026-08-26 storage smoke
test ([[../facts/new-project-pipeline-storage-roundtrip]]) — which would have made the *first
real Google sign-in* fail, and looked like an OAuth misconfiguration rather than a stale row.

## Not fixed

Removing the offending row unblocks the address. The smoke row **was deleted on 2026-08-26**
(`packages/core/.work/purge-smoke-test.ts`), and the fix was confirmed by replaying the trigger's
statement for that address afterwards — it now inserts instead of raising. So no address is
currently blocked on the new project.

The underlying defect stands: the trigger cannot express "same person, different uuid" with
`ON CONFLICT (id)` while `email` is independently unique. A real fix is a migration and a
decision — candidates, none chosen:

- `ON CONFLICT (email) DO UPDATE SET id = EXCLUDED.id` — adopts the auth uuid, but silently
  repoints `businesses.owner_user_id`, which FKs to `public.users.id` (`NO ACTION`).
- Drop `users_email_unique` and let the mirror be id-only.
- Make `ensureUser` refuse to invent a uuid for an email with no `auth.users` row.

Until then: **do not run `aiugc business create --email <a real person's address>` for anyone who
has not already signed up.** Use a throwaway address for smoke tests.

Related: [[admin-flag-is-a-noop-on-existing-accounts]] — the same trigger, the other direction.
