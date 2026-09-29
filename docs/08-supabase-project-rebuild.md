# 08 — Rebuilding on a new Supabase project

The old project (`mtpmrqltldfwhziyyzdu`, ap-south-1) started on Free and was upgraded to Pro, so
its compute is still **t4g.nano**. A project created inside a Pro org comes up on **Micro**. That
is the whole reason for the move.

**Nothing is being migrated.** The old project holds no real users and no customer videos — its
contents are test data, and the Pro upgrade bought a per-file size limit while testing a service
that no longer exists, not data volume. So this is a rebuild: run the migrations into the empty new
project, create the buckets, repoint the env vars, verify, delete the old project.

There is no dump, no restore, no storage transfer and no auth export in this document, because
none of those happened. Two schema facts discovered while scoping the move are worth knowing
before any _real_ backup is ever restored, and they live in the vault rather than here:
`docs/vault/facts/sets-video-renders-fk-cycle.md` and
`docs/vault/facts/auth-users-insert-trigger.md`.

Replace `<NEW_REF>` with the new project ref wherever it appears. Commands run on Windows from the
repo root.

---

## 1. Region — already settled

The new project is in **`eu-central-1`** (Frankfurt), confirmed from the dashboard on 2026-08-26
(`docs/vault/facts/new-project-region-eu-central-1.md`). The old project was in `ap-south-1`
(Mumbai) — roughly 120–150 ms from Israel against roughly 50–60 ms from Frankfurt, which is also
next door to where the Hetzner worker box will live (`docs/07-worker-box.md`). No
delete-and-recreate is needed; §2 onward runs against the project as it stands.

It was created with **"automatically expose new tables" OFF** and **"automatic RLS" ON** — §6
depends on both. If you ever do recreate it, use those same two settings.

Everything from here is reversible by deleting the project and starting over, right up until §8
flips the env vars. That is the line the migration gate draws (`.claude/rules/migrations.md`, CLAUDE.md until 2026-09-29).

---

## 2. The two connection strings

| Use                                | Which string           | Port     | Why                                                                                                        |
| ---------------------------------- | ---------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| **`DATABASE_URL` in every `.env`** | **Transaction pooler** | **6543** | `packages/core/src/db/index.ts` sets `prepare: false` _for this pooler_. This is the app's runtime string. |
| `supabase db push`, `psql`         | Session pooler         | 5432     | DDL needs session-level features the transaction pooler does not provide.                                  |

Dashboard → Connect. The **Transaction pooler** string goes in the env files in §7. Put the
**Session pooler** string in a shell variable and never in a file:

```
$NEW = "postgresql://postgres.hyaqydcmwbnbaiqqufow:<PW>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
```

The user is `postgres.<ref>` — with a dot, not a bare `postgres`; that form belongs to the direct
connection. The `aws-N` prefix is **`aws-0`** for this project (verified 2026-08-26; `aws-1`
answers but rejects the tenant).

The direct connection (`db.<ref>.supabase.co`) is IPv6-only without the IPv4 add-on — skip it.
Both pooler hostnames are IPv4, which is why they work from this machine. Percent-encode the
password if it contains anything outside `A-Za-z0-9._~-`.

> For **`apps/worker/.env`** specifically, 6543 is also the connection the vault blames for the
> worker's dropped connections (`docs/vault/defects/worker-exits-on-a-dropped-connection.md`);
> `c46131d` made those survivable rather than fatal. **Resolved 2026-09-03**: the box's first week
> on 6543 logged zero drop lines, and `DATABASE_URL` stays there —
> `docs/vault/decisions/0016-worker-stays-on-transaction-pooler-6543.md`.

---

## 3. Run the migrations

```
npx -y supabase db push --db-url $NEW
```

`db push` applies **every** migration in `supabase/migrations/` that the remote ledger does not
already record, and it has no flag to stop at a chosen version — the only way to hold some back is
to move their files out of the directory first.

**Works:** it lists the migrations it applied and exits 0. If any migration fails, **stop and
report it — do not patch the migration.** A migration that cannot run against an empty database is
a defect in the migration, and the old project cannot tell you about it: every one of `0008`–`0030`
was applied there by hand, so production has never proved that this sequence replays cleanly from
nothing. This run is the first time it is tested.

---

## 4. Verify the ledger and the schema

```sql
select count(*) as n, min(version) as first, max(version) as last
from supabase_migrations.schema_migrations;
```

The count must equal the number of `.sql` files in `supabase/migrations/`, with no gaps. With
`0031` in the tree that is **32 rows, `0000` through `0031`**. (The 2026-08-26 run predated `0031`
and read 31 / `0000`–`0030`.)

(The old project's ledger repair ran in two phases, `0008`–`0028` then `0029`–`0030`, recorded in
the footer of `scripts/verify-migration-ledger.sql`. Those are phases of one repair, not a stopping
point: `0029` adds `demo_step_plans.fail_kind` / `retry_violations` and `0030` adds
`demo_analyses.sections` / `sections_prompt_version`, and the plan and analysis code reads all
four.)

Then run the proof file, which checks the _artifacts_ rather than the ledger — the columns,
policies, indexes and `app_config` values `0008`–`0030` were each supposed to produce. It returns
two layers; on a rebuilt database run the structural one:

```
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" $NEW -f scripts\verify-migration-ledger.sql
```

**Works:** every `layer = 'structural'` row reads `true`, except `0020`, which reads NULL because
it is a data-only migration with no structural footprint. The three `layer = 'data'` rows assert
specific old-production rows and will read false (or pass vacuously) here — that is expected and
is not a migration failure. The file's header explains both layers.

**No repair should be needed.** `supabase migration repair` exists to reconcile a ledger with DDL
that was applied outside it. Here `db push` wrote both, so if the count is short or a check reads
`false`, something genuinely failed — repairing the ledger would only hide it.

---

## 5. Create the four buckets

**No migration creates a bucket.** Verified: `grep -rl 'storage.objects\|storage.buckets'
supabase/migrations/` matches nothing, and the live project has zero storage RLS policies (see
`docs/vault/falsified/0007-declares-catalog-rls.md`). Storage is configured entirely outside the
repo, so `db push` leaves the new project with no buckets and every upload failing with "bucket not
found".

SQL editor on the new project:

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('assets',  'assets',  false, 1073741824, null),
  ('renders', 'renders', false,  524288000, null),
  ('raw',     'raw',     false,       null,
     array['video/mp4','video/quicktime','image/jpeg','image/png','image/webp']),
  ('catalog', 'catalog', true,        null, null);
```

These four names and settings are what `packages/core/src/storage.ts` and `docs/03-storage.md`
expect. **Works:** `select id, public, file_size_limit from storage.buckets order by id;` returns
those four rows with `catalog.public = true` — if `catalog` is not public, `storage.publicUrl()`
returns URLs that 404 and the persona pickers go blank.

### Raise the project-level upload limit

There is a second ceiling: Dashboard → Storage → Settings → upload file size limit. It is
storage-api tenant config, not a column in `storage.buckets`, so the SQL above neither sets it nor
can read it back, and the effective cap on any upload is `min(project limit, bucket limit)`. A new
project starts at 50 MB.

That matters going forward, not backward: normalized demos and final renders routinely exceed it —
the old project's largest object was 135 MB. Set it to at least **200 MB** now, or the first real
demo upload fails with `413`.

---

## 6. The two settings you turned on

### 6A. Data API exposure — grant exactly two tables

With **"automatically expose new tables" OFF**, and given that **the migrations contain no `GRANT`
statements at all** (the only match for `GRANT` across `0000`–`0030` is a comment in `0012`), the
new project's tables have no grants to `anon` or `authenticated`. On the old project every table
carried full CRUD to both, purely from the Supabase default — so the new default is strictly safer,
but the browser client breaks until the tables it actually reads are granted.

Reading every supabase-js call in `apps/web` and `apps/admin`: the clients use `auth.*` and
`.from()` and nothing else — no `.rpc()`, no realtime `.channel()`, no browser-side `.storage`.
Every other `.from()` in those apps is Drizzle over `DATABASE_URL`, which Data API exposure does
not affect. That leaves exactly two tables, both **SELECT only**:

| Table        | Read by                                                                                                                                                                     | Columns                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `businesses` | `apps/web/src/middleware.ts:49`, `app/home/layout.tsx:24`, `app/home/page.tsx:72`, `app/home/demos/page.tsx:21`, `app/home/a/new/page.tsx:23`, `app/home/b/new/page.tsx:25` | `id`, `name`, `questionnaire`, `created_at` (order) |
| `users`      | `apps/admin/src/middleware.ts:72`, `apps/admin/src/app/login/login-form.tsx:38`                                                                                             | `role`, `id` (filter)                               |

All eight call sites run after `auth.getUser()` has returned a user, so `authenticated` is the only
role that needs anything. `anon` needs nothing.

```sql
grant usage on schema public to authenticated;
grant select on public.businesses to authenticated;
grant select on public.users to authenticated;
```

Nothing else. The matching policies already exist from `0002_supabase_rls.sql` and are SELECT-only,
so the grant widens nothing: `businesses_select_own` (`owner_user_id = auth.uid()`) and
`users_select_self` (`id = auth.uid()`).

**Live correction (2026-09-24), read against `information_schema.table_privileges` /
`column_privileges` on the live project — see
[`vault/facts/supabase-live-snapshot-2026-09-24.md`](vault/facts/supabase-live-snapshot-2026-09-24.md):**
the "Columns" column in the table above is what the **app** reads, not what the **grant** restricts.
The `GRANT SELECT` statements above carry no column list, so they are — and have always been —
table-wide: `authenticated` can `SELECT` every column of both tables (all 8 of `businesses`,
including `owner_user_id` and `status`; all 4 of `users`), not just the ones the app UI happens to
read. `anon` still has nothing. The only thing standing between `authenticated` and another user's
row is the two SELECT-only, own-row RLS policies above — RLS, not column scope. A **column-scoped**
grant — `GRANT SELECT (id,name,questionnaire,created_at) ON businesses TO authenticated;` and
`GRANT SELECT (id,role) ON users TO authenticated;` in place of the two `GRANT` lines above — is the
intended tightening target, tracked as a queue item in `docs/vault/state-of-play.md`; no migration
writing it exists yet.

**Also confirmed live, and true of every Supabase project regardless of any migration or setting
here:** `anon` and `authenticated` hold `TRUNCATE`, `REFERENCES` and `TRIGGER` on every table in
`public` (and, separately, `storage`) via Supabase's own platform-default ACL for future tables —
nothing in this rebuild's migrations or in this section's grants adds it, and nothing here removes it
either. No PostgREST verb maps to any of those three privileges, so this has no exploitable path
through the Data API; `TRUNCATE` does ignore RLS, though, which is why revoking it in `public` (never
in `storage` — Supabase manages that schema's own grants) is worth doing as part of the same
tightening migration above.

Also confirm `public` is listed in Dashboard → Project Settings → API → **Exposed schemas**. Table
grants and schema exposure are separate switches; with `public` unexposed, PostgREST answers
`404 PGRST106` however correct the grants are.

Verify after you have a signed-in account (§8), by querying PostgREST directly rather than through
the app:

```
curl -s -o - -w "\n%{http_code}\n" "https://<NEW_REF>.supabase.co/rest/v1/businesses?select=id,name&limit=1" -H "apikey: <PUBLISHABLE_KEY>" -H "Authorization: Bearer <access_token>"
```

**Works:** `200` and a JSON array. `401`/`403` is the grant missing; `404 PGRST106` is the schema
not exposed.

### 6B. Automatic RLS — nothing to do

**"automatic RLS" ON is a no-op for this schema.** The migrations create 27 tables and explicitly
`ENABLE ROW LEVEL SECURITY` on all 27 (in `0002`, `0007`, `0024`); two are dropped later
(`persona_clips` in `0005`, `demo_segments` in `0023`), leaving 25. The set difference "created but
never RLS-enabled" is empty, so the setting turns on only what the migrations turn on anyway, and
no migration relies on RLS being off.

**Works:**

```sql
select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
```

returns `0`. Six tables will have RLS on with zero policies — `app_config`, `events`,
`gateway_events`, `jobs`, `pronunciation_entries`, `usage_events`. That is deny-all for
`anon`/`authenticated` and is correct: the worker, CLI and API routes reach them as `postgres` over
`DATABASE_URL`, which bypasses RLS.

---

## 7. Config — nothing to do by hand

This step used to be a list of `UPDATE`s. It is now `0031_seed_unseeded_config.sql`, so `db push`
in §3 produces the right `app_config` by itself and there is nothing to type here.

That migration exists because of what this rebuild exposed. The old project had 13 `app_config`
rows; a database built from `0000`–`0030` had 8. Five knobs lived **only** in the production
database and in no migration, so a rebuild silently swapped each for whatever constant the code
carried — invisibly, because `getConfigValueOr` (`packages/core/src/appConfig.ts:18-29`) returns a
fallback for a missing key rather than failing. Two more rows had been hand-edited away from their
seeds and quietly reverted. Same class of problem as `0027`'s cap.

`0031` seeds four of the five at their production values, and corrects the two drifted rows with
guarded updates that only fire if the row still holds the original seed — a later recalibration or
founder flip is not clobbered:

| Key                     | Before `0031`               | After                                                                                                                                                                                                                       | Why it matters                                                                     |
| ----------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `poll_deadline_seconds` | absent → code constant 2400 | `900`                                                                                                                                                                                                                       | `poll.ts:14` already called 900 "the intended live setting"; 2400 is 2.7x the wait |
| `lipsync_motion_prompt` | absent → field omitted      | the 2026-08-26 placeholder, replaced by `0034` with the generic hand-free prompt (alongside `lipsync_expressiveness` `"medium"` — [vault 0022](vault/decisions/0022-heygen-expressiveness-medium-generic-motion-prompt.md)) | No fallback — its absence changes what every Service B render looks like           |
| `lipsync_resolution`    | absent → `"1080p"`          | `"1080p"`                                                                                                                                                                                                                   | Same value; seeded so OFF is a decision, not a missing row                         |
| `tts_enhance`           | absent → `false`            | `false`                                                                                                                                                                                                                     | Same                                                                               |
| `auto_release_b`        | `false` (seeded by `0001`)  | `true`                                                                                                                                                                                                                      | Standing founder instruction, CLAUDE.md decision #8                                |
| `words_per_second`      | `{"default":2.2}`           | `{"default":2.1}`                                                                                                                                                                                                           | 2.1 is calibration output; `calibrate.ts:9` calls 2.2 "a guess"                    |

`tts_stability` is deliberately **not** seeded: the old project held `0.5`, and the decision on
2026-08-26 was to let ElevenLabs' own default stand. The absence of that row is the setting, and
`0031` says so in a comment so "no row" never again reads as "nobody thought about it".

Everything else the migrations produce already matched the old project — `daily_caps.gpu_seconds`
7200 from `0022`, `per_account.llm_tokens` 1500000 from `0027`, `credit_costs` from
`0017`/`0026`/`0028`.

> Those two `daily_caps` figures describe the rebuild **as it was on 2026-08-26** and are left as
> the record of it. They are no longer the current values: `0036` (2026-09-11) set the platform caps
> to 16x their per-account pairs — `gpu_seconds` 32000 — and tightened `per_account.llm_tokens` to 500000. A rebuild today replays `0027` and then `0036` and lands on the new values. See
> `docs/05-billing.md` §Quotas and caps.

**Works:** `select count(*) from app_config;` returns 13 (12 after `0031`, plus `lipsync_expressiveness` from `0034`), `select value from app_config where key = 'auto_release_b';` returns `true`, and `lipsync_expressiveness` returns `"medium"`.
`select value from app_config where key = 'auto_release_b';` returns `true`.

---

## 8. Repoint the env vars

Five local files: `.env`, `apps/cli/.env`, `apps/worker/.env`, `apps/web/.env.local`,
`apps/admin/.env.local` (that last one carries only the Supabase keys). Each needs:

- `DATABASE_URL` → **transaction pooler, 6543** (§2)
- `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL` → `https://<NEW_REF>.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` → the service-role / secret key
- the anon / publishable key. **Corrected 2026-08-26:** this section used to say the repo "uses
  the publishable one everywhere". It does not — all five env files define
  **`NEXT_PUBLIC_SUPABASE_ANON_KEY`** and none defines `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  while `apps/web/src/lib/supabase/client.ts:16-17` resolves
  `NEXT_PUBLIC_SUPABASE_ANON_KEY ?? NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — **`ANON` wins when
  both are set.** So _replace the value of the existing `ANON` line_; adding a `PUBLISHABLE` line
  beside a stale `ANON` line sends the old project's key to the new project's URL, and every auth
  call 401s with `Invalid API key` before any redirect is computed. `apps/web/src/lib/auth.ts:75-79`
  flattens that into the Hebrew "ההתחברות עם Google לא זמינה כרגע", which reads exactly like a
  provider that was never switched on.

Then Vercel → Environment Variables for the web project, same values, and redeploy. If the Hetzner
box is running, update its `.env` and `sudo systemctl restart aiugc-worker` (keep
`WORKER_ID=hetzner`).

Auth settings do not come from the database. On the new project: enable the **Email** provider
(it is off by default and signups fail with `email_provider_disabled` until it is on), set the
Site URL, and set the redirect allow-list — the full procedure and its verification are **§8A**.
Google is deferred and was never configured on the old project either; **§8B** is the from-scratch
build for when it is revisited.

> **Always pass `--db-url`.** `supabase/.temp/` used to hold link state pointing at the OLD project
> (`project-ref`, `linked-project.json` and `pooler-url` all named `mtpmrqltldfwhziyyzdu`), so any
> `npx supabase …` command that resolved the linked project silently targeted the project
> CLAUDE.md's migration gate puts off-limits. **Removed 2026-08-26** — the directory is gitignored
> local CLI state and `supabase link` regenerates it. An unqualified command now fails loudly with
> `LegacyProjectNotLinkedError: Cannot find project ref`, which is the intended behaviour: there is
> no reason to re-link while every documented command takes an explicit `--db-url`.

---

## 8A. Email sign-up — the launch path

**Email is the only provider for launch.** Google is deferred
(`docs/vault/decisions/0005-google-oauth-deferred.md`, §8B below). Nothing about either provider
lives in the database or in a migration — it is all GoTrue tenant config, which is why the rebuild
did not carry any of it.

The Email provider is **off by default on a new project**, and until it is on, signup fails with
`email_provider_disabled`. `apps/web/src/lib/auth.ts:32-34` already maps that code to a Hebrew
message naming the fix, so the symptom is legible if it happens.

### Step 1 — dashboard settings

New project → **Authentication → Providers → Email** → **Enable**. Confirm the browser URL
contains `hyaqydcmwbnbaiqqufow` before changing anything.

Then **Authentication → URL Configuration**:

- **Site URL**: `http://localhost:3000` for now; flip it to the Vercel domain when one exists.
- **Redirect URLs**: add `http://localhost:3000/auth/callback`. Not used by the password flow
  today, but it is what the confirmation link needs with Confirm-email on — and it is ON in
  production as of 2026-09-11 (§8A.2). Also add `http://localhost:3000/auth/recovery` — the
  password-recovery flow (added 2026-08-27) sends its email link back through it, and without the
  entry GoTrue silently delivers the link to the Site URL root, where nothing reads it.
- **Emails → Reset Password template** (recommended): replace the default link with
  `{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery`. The default
  `{{ .ConfirmationURL }}` points at GoTrue's verify endpoint, which spends the one-time token on a
  **bare GET** — mail-security link scanners on business mailboxes (Microsoft Safe Links,
  Proofpoint/Mimecast class) issue exactly that GET before the user ever clicks, so recovery fails
  with `otp_expired` on the first real click, invisibly and repeatably, for exactly the
  `name@business.co.il` audience. The token_hash form spends the token only on submit (scanners
  follow links, they don't submit forms) and also removes the same-browser PKCE constraint. Both
  paths are live in the code: `/auth/recovery` serves default-template links,
  `/reset-password?token_hash=…` serves this template.

**The dev port is not pinned.** `apps/web/package.json` is `"dev": "next dev"` with no `-p`, while
admin holds 3001. If 3000 is busy Next silently serves 3002 and every origin-derived URL follows
the address bar. Check the port Next prints before you start.

### Step 2 — verify with a real signup, ending on `/home`

`/start` proves nothing on its own. `apps/web/src/app/auth/callback/route.ts:18` redirects there
unconditionally, `apps/web/src/app/start/page.tsx` renders the wizard with no auth check, and a
signed-out visitor and a signed-in-without-a-business user see a byte-identical page. The only
surface that requires a session is `/home`: `apps/web/src/middleware.ts:43-45` bounces any `/home`
request without a user, and `apps/web/src/app/home/layout.tsx:21` does it again server-side.

**Pre-flight** — make sure no stale `public.users` row holds the address you are about to use, or
the signup fails with GoTrue's generic `Database error saving new user` and writes nothing
(`docs/vault/defects/cli-created-user-blocks-that-email-from-ever-signing-up.md`):

```sql
select id, email from public.users where email = '<the address you will use>';
-- want: zero rows
```

Then:

1. `pnpm dev`, confirm the port is **3000**, open `http://localhost:3000/start`.
2. Walk the five wizard steps (product type → name + one-liner → at least one benefit → audience
   → the signup step). The draft is mirrored to `localStorage` under `aiugc.onboarding.v1`.
3. On the last step, **use the email + password form, not the Google button** (§8B: the Google
   button still renders and will strand you). Submit.
4. **With Confirm-email OFF** (§8A.1): `signUp` returns a session immediately, the wizard
   auto-POSTs the draft to `/api/onboarding/complete`, and you land on **`/home`**. That is the
   pass.
   **With Confirm-email ON**: you get the Hebrew line "שלחנו מייל אישור. אשרו אותו ואז היכנסו דרך
   מסך הכניסה." — confirm via the emailed link, then sign in at `http://localhost:3000/login`.
5. **The gate:** navigate to `http://localhost:3000/home`.
   - **Stays on `/home`** → a session exists. Email auth works.
   - **Bounces to `/start`** → no session, regardless of what the database says.
6. Sign out, then sign back in at `/login` with the same credentials and repeat step 5. Signup and
   sign-in are different code paths (`signUp` vs `signInWithPassword`, `auth.ts:42` / `:56`); only
   testing the first leaves the returning-customer path unproven.

DevTools → Application → Cookies → `http://localhost:3000` should show
`sb-hyaqydcmwbnbaiqqufow-auth-token` (possibly chunked `.0`/`.1`).

### Step 3 — secondary confirmation in SQL

This confirms _what landed_, and only after step 2 has already passed. It is not the gate: GoTrue
writes these rows before the app is involved, so they can all be present while the browser has no
session at all.

New project's SQL editor, opened at the ref-bearing URL so a stale tab cannot point at the old
project: `https://supabase.com/dashboard/project/hyaqydcmwbnbaiqqufow/sql/new`.

```sql
select u.id, u.email, i.provider, u.email_confirmed_at,
       i.created_at, i.last_sign_in_at,
       (pu.id is not null) as mirror_row_exists, pu.role
from auth.users u
join auth.identities i on i.user_id = u.id
left join public.users pu on pu.id = u.id
where i.last_sign_in_at > now() - interval '5 minutes'
order by i.last_sign_in_at desc;
```

The `interval` is load-bearing: without it an earlier success keeps reporting success after you
have changed a setting and broken it. Note the wall-clock minute of the click before running it.

- **One row, `provider = 'email'`, `mirror_row_exists = true`** → GoTrue and the
  `handle_new_user` mirror both worked.
- **Zero rows** → nothing reached GoTrue. Disambiguate with
  `select provider, count(*) from auth.identities group by 1;` and
  `select count(*) from auth.users;` — all-zero points at the Email provider still being off; a
  row you did not expect means you are looking at the wrong project.
- **Row present but step 2 bounced** → GoTrue succeeded and the app-side session did not.

`role` will read `customer`: the trigger writes only `(id, email)` and lets the column default
stand (`docs/vault/facts/auth-users-insert-trigger.md`), so an admin account still needs its
`UPDATE public.users SET role='admin'`. `aiugc business create --admin` will **not** do it for an
existing account (`docs/vault/defects/admin-flag-is-a-noop-on-existing-accounts.md`).

### 8A.1 — Confirm email: on or off

Both positions are defensible; this section is the trade-off, not a recommendation.

**What the code does today.** `apps/web/src/lib/auth.ts:124` calls `signUp`, and that call has
passed ``emailRedirectTo: `${window.location.origin}/auth/callback` `` since commit `02f58bb`
(2026-08-27) — today at `auth.ts:132`. **No code change is needed to turn confirmation on.** The
confirmation link lands on `/auth/callback`, which exchanges the PKCE `code`
(`apps/web/src/app/auth/callback/route.ts:23`). Were that option ever dropped the link would
return to the **Site URL root**, and `apps/web/src/app/page.tsx` is a static marketing page that
never reads `searchParams` — the click would then do nothing at all: no session, no message, no
error. That is the dead end the option exists to prevent, and why it should not be removed. With
confirmation ON the Hebrew copy at `auth.ts:146` tells the user to confirm and then sign in at
`/login`.

|                                | **Confirm email OFF**                                                               | **Confirm email ON**                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Signup UX                      | One step. Session immediately, wizard auto-posts the draft, lands on `/home`.       | Two steps, split across an email client. Draft survives in `localStorage`; user must return and sign in. |
| Code change needed             | None.                                                                               | None — `emailRedirectTo` has shipped since `02f58bb` (`auth.ts:132`).                                    |
| Email delivery is a dependency | No. Nothing is sent at signup.                                                      | **Yes** — signup is blocked on an email arriving.                                                        |
| Address is proven real         | No. Typos create accounts nobody can reach; anyone can sign up as anyone's address. | Yes.                                                                                                     |
| Password reset                 | Already depends on email whenever you build it.                                     | Same.                                                                                                    |

**What "email delivery is a dependency" costs.** Supabase's built-in SMTP is explicitly a
development convenience: it is rate-limited to a small number of messages per hour, it is shared
infrastructure, and Supabase documents it as not for production use. The current cap is visible at
**Authentication → Rate Limits** — read it there rather than trusting a number written down here,
because it has been revised more than once. At founder-led onboarding volumes the built-in service
may genuinely be enough; at launch volumes it is not.

Custom SMTP is the fix, and the work is mostly DNS, not code:

1. A transactional provider — Resend, Postmark, SendGrid, Mailgun, SES. All have free or near-free
   tiers at this volume.
2. A sending domain you control, plus **SPF** and **DKIM** records (and ideally **DMARC**). This is
   the part that takes real time: DNS edits, propagation, and provider-side domain verification.
   Some providers also gate production sending behind a short review.
3. Paste host / port / username / password / sender address into **Authentication → SMTP Settings**
   and re-check **Rate Limits**, which is separately configurable once custom SMTP is on.

Realistically a couple of hours if the domain already exists and you control its DNS; a day or more
if the domain is new or the provider wants review. None of it is application code.

**The asymmetry worth noting:** turning confirmation OFF now and ON later costs nothing structural
— existing accounts stay valid, and `emailRedirectTo` already ships (`auth.ts:132`, `02f58bb`).
Turning it ON now means launch is blocked on the DNS work above.

---

### 8A.2 — Custom SMTP and the Hebrew auth templates (live since 2026-09-11)

§8A.1 above weighs confirmation on against off. **It is ON in production as of 2026-09-11**, so this
section is no longer a trade-off — it is what a rebuild has to reproduce. Everything here was
configured in the Supabase dashboard only; nothing in the repo reproduced it before this section
existed, which meant a rebuild shipped English auth email to Hebrew customers.

One correction to §8A.1 before the values, so a reader does not act on it:

- §8A.1 says custom SMTP needs "**SPF** and **DKIM** records". With Resend, SPF is delivered by two
  **CNAME** records, not a TXT SPF record. See below.

#### SMTP settings — Authentication → SMTP Settings

| Field        | Value                                                                      |
| ------------ | -------------------------------------------------------------------------- |
| Host         | `smtp.resend.com`                                                          |
| Port         | `465`                                                                      |
| Username     | `resend` — the literal string, not an address                              |
| Password     | a Resend API key — **not in this repo and never will be** (see note below) |
| Sender email | `noreply@tavnit.ai`                                                        |
| Sender name  | `תבנית`                                                                    |

**The key is not recoverable from here.** Mint a fresh API key in the Resend dashboard and paste it
into this field. Do not write it into this file, a script, a commit message or a task report — the
credential rule in `CLAUDE.md` covers exactly this, and it has already cost two rotations.

#### Resend — the provider side

Account holds the domain `tavnit.ai`, **verified**, region **Ireland (EU)**. DNS lives at Namecheap:

| Record                         | Type      | Purpose                                       |
| ------------------------------ | --------- | --------------------------------------------- |
| `resend._domainkey`            | **TXT**   | DKIM                                          |
| `rsend`, `send`                | **CNAME** | sending / SPF — two CNAMEs, **not** a TXT SPF |
| `_dmarc` = `v=DMARC1; p=none;` | **TXT**   | DMARC, monitor-only policy                    |

Receiving is deliberately **off** — no MX records. Nothing reads mail at this domain.

**The two ceilings, and the smaller one wins.** Authentication → Rate Limits was raised to
**100 emails/hour** on 2026-09-11, now that custom SMTP makes it separately configurable. That would
permit 2,400/day. Resend's free tier cuts at **100/day** and 3,000/month. The real ceiling on auth
email is therefore **100/day at the provider**, not 100/hour at Supabase — do not read the Supabase
number as available headroom. Reasoned from the two published limits, not observed: once the daily
100 is spent, Resend refuses, the confirmation email stops arriving, and a signup cannot complete.
Nothing alerts on it, and it would present as "signups mysteriously stopped working" late in a busy
day.

**Redirect URLs** must include `https://tavnit.ai/auth/callback` (§8A step 1 covers the rest).

#### The templates — Authentication → Email Templates

Paste each body with the subject shown. The `dir` attributes are **bidi fixes, not decoration**: the
outer `dir="rtl"` makes Hebrew read correctly across mail clients, and the two inner `dir="ltr"`
spans stop a Latin email address and a numeric code from being reordered mid-line. Keep the Go
template variables (`{{ .ConfirmationURL }}`, `{{ .NewEmail }}`, `{{ .Token }}`) byte-for-byte.

**Which of these actually fire today** — verified against the tree 2026-09-11, not against the
dashboard:

| Template                         | Reachable from the app?                                                                                                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Confirm signup                   | **Yes — the one that fires.** `auth.ts:68-78`, email+password signup. Google OAuth does not send it.                                                                                                        |
| Invite user                      | Dashboard-only. No app code sends an invite.                                                                                                                                                                |
| Magic link                       | **Not wired.** `apps/web/src` has no `signInWithOtp` call.                                                                                                                                                  |
| Change email address             | **Not reachable.** The only `auth.updateUser` call in `apps/web/src` is `auth.ts:144` and it sets a password; `home/settings/page.tsx:66-68` shows the address read-only with no edit control.              |
| The `{{ .Token }}` code template | **Unverified which slot this is.** The variable and the body (a bare code) read as Supabase's Reauthentication template; no app code calls `reauthenticate`. Confirm in the dashboard before relying on it. |

**Not among the five, and load-bearing:** the **Reset Password / recovery** template. It is
reachable (`auth.ts:108-118` → `/auth/recovery`, `auth.ts:128-139` verifies the token) and §8A step 1
above already pins its required body — `{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery`
— because the default link form is spent by mail-security scanners before the user clicks. **Whether
that template was translated to Hebrew in the 2026-09-11 pass is UNVERIFIED**; the five bodies below
do not include it. A rebuild must paste the token_hash form from §8A step 1 regardless of language,
or recovery breaks for exactly the `name@business.co.il` audience this product sells to.

---

Subject `אישור כתובת המייל`

```html
<div dir="rtl" style="text-align: right;">
  <h2>אישור כתובת המייל</h2>

  <p>לחצו על הקישור למטה כדי לאשר את כתובת המייל ולסיים את ההרשמה.</p>
  <p><a href="{{ .ConfirmationURL }}">אישור הכתובת</a></p>
</div>
```

Subject `הוזמנתם לתבנית`

```html
<div dir="rtl" style="text-align: right;">
  <h2>הוזמנתם לתבנית</h2>

  <p>הוזמנתם לפתוח חשבון. לחצו על הקישור למטה כדי לאשר את ההזמנה.</p>
  <p><a href="{{ .ConfirmationURL }}">אישור ההזמנה</a></p>
</div>
```

Subject `קישור הכניסה שלכם`

```html
<div dir="rtl" style="text-align: right;">
  <h2>קישור הכניסה שלכם</h2>

  <p>לחצו על הקישור למטה כדי להיכנס. הקישור תקף לזמן קצר וניתן להשתמש בו פעם אחת בלבד.</p>
  <p><a href="{{ .ConfirmationURL }}">כניסה לחשבון</a></p>
</div>
```

Subject `אישור כתובת המייל החדשה`

```html
<div dir="rtl" style="text-align: right;">
  <h2>אישור כתובת המייל החדשה</h2>

  <p>
    לחצו על הקישור למטה כדי לאשר את <span dir="ltr">{{ .NewEmail }}</span> ככתובת המייל החדשה שלכם.
  </p>
  <p><a href="{{ .ConfirmationURL }}">אישור הכתובת החדשה</a></p>

  <p>אם לא ביקשתם את השינוי הזה, אפשר להתעלם מהמייל.</p>
</div>
```

Subject `קוד האימות שלכם`

```html
<div dir="rtl" style="text-align: right;">
  <h2>קוד האימות שלכם</h2>

  <p>השתמשו בקוד הבא כדי לאמת את הזהות שלכם. הקוד תקף לזמן קצר.</p>

  <p dir="ltr" style="text-align: center; font-size: 28px; font-weight: bold; letter-spacing: 4px;">
    {{ .Token }}
  </p>
</div>
```

#### What was proven end to end, once

2026-09-11, founder-reported: signup refused immediate sign-in and showed the Hebrew "we sent a
confirmation email" line; the email arrived; the link landed on `/start` and middleware forwarded to
`/home`. That transit proves three things at once — the PKCE exchange works, a session is created,
and the account had a `businesses` row (the middleware's `businesses` query is what forwards owners).
The confirmation-ON onboarding path had never been exercised on this app before. It now has, once.

---

## 8B. Google OAuth — full setup

**Status: in scope for launch** (founder decision 2026-08-26 —
`docs/vault/decisions/0006-google-oauth-is-in-scope-for-launch.md`). **This app was published on
2026-09-03; its publishing status reads _In production_ and any Google account can sign in.**
Everything below still walks through Testing mode because this document is the rebuild recipe —
that is a procedure to repeat, not a description of where this project stands.

### Read this first: there is no verification review for this app

The app requests **no custom scopes**. `apps/web/src/lib/auth.ts:71-74` calls `signInWithOAuth`
with `provider` and `redirectTo` only — no `scopes` key — so it gets Supabase's Google defaults:

```
openid   email   profile
```

Google classifies all three as **non-sensitive**. Verification review — the queue, the demo video,
the security assessment — applies to **sensitive** and **restricted** scopes (Gmail, Drive,
Calendar, Contacts). This app touches none of them.

**So "verification" here is a form, not a review.** Publishing moves the app to production when you
click it; there is no submission to wait on and no approval to schedule around.

Two consequences worth knowing before you start:

- **Do not upload an app logo.** A custom logo triggers Google's _brand_ verification review even
  when every scope is non-sensitive. It is the one thing on the consent screen that can put you in
  a queue. Leave it blank and the app publishes immediately.
- **Testing mode needs no domain, no privacy policy and no terms.** You can have Google sign-in
  working against `localhost` today. Those artefacts gate **publishing to production**, not using
  Google yourself.

### What each mode actually requires

|                                               | **Testing** (where a rebuild starts)              | **In production** (this app, since 2026-09-03) |
| --------------------------------------------- | ------------------------------------------------- | ---------------------------------------------- |
| Who can sign in                               | Only addresses on the test-user list, max **100** | Anyone with a Google account                   |
| Test-user sessions                            | Refresh tokens expire after **7 days**            | Normal                                         |
| App name, support email, developer contact    | Required                                          | Required                                       |
| App logo                                      | Leave blank                                       | Leave blank (a logo forces a brand review)     |
| Home page URL                                 | Not required                                      | **Required**                                   |
| Privacy policy URL                            | Not required                                      | **Required**                                   |
| Terms of service URL                          | Not required                                      | Optional                                       |
| Authorized domain, verified in Search Console | Not required                                      | **Required**                                   |
| Verification review                           | None                                              | **None** — non-sensitive scopes only           |

**The domain is a prerequisite for going public, not for using Google.** It does not block a
rebuild: steps 1–6 give working Google sign-in for yourself and up to 99 other addresses, with
nothing hosted anywhere. Only step 7 needs `tavnit.ai` live — which it is, and which is why step 7
was taken on 2026-09-03.

### Does a Vercel preview URL work as the authorized domain? No — use `tavnit.ai`

Two independent reasons, either one sufficient:

1. **Preview URLs are not stable.** Vercel mints a new deployment URL per push. An authorized
   domain has to keep resolving; a per-deployment hostname does not.
2. **`vercel.app` is on the Public Suffix List.** Google requires an authorized domain to be a top
   private domain you can prove you own, and it must be verified in **Google Search Console**.
   Verifying a hostname under someone else's public suffix is the wrong side of that rule, and any
   effort spent on it is thrown away the moment you move to the real domain.

Plainly: **`tavnit.ai` must be live, serving the home page and privacy policy, and verified in
Search Console, before the app can go to production.** That is the real dependency chain —
`tavnit.ai` → Vercel deploy → Search Console verification → Publish. Nothing in steps 1–6 waits on
any of it.

### Step 1 — Google Cloud project

console.cloud.google.com → create a project (or reuse one). Everything below lives inside it.

### Step 2 — OAuth consent screen, minimal

**APIs & Services → OAuth consent screen.**

- **User type: External.** Internal only exists for Google Workspace organisations and would limit
  sign-in to your own workspace.
- **App name** — what the customer reads on the Google account-picker screen. Use the product name
  they expect, not a project codename.
- **User support email** and **Developer contact email**.
- **App logo: leave blank.** See above — a logo is the one field that forces a review.
- **App domain / privacy policy / terms**: leave blank for now. Not enforced in Testing; fill them
  in at step 7.
- **Scopes: add nothing.** The three defaults are what the app uses, and adding any sensitive scope
  here is what would turn this from a form into a review.

### Step 3 — OAuth client

**APIs & Services → Credentials → Create credentials → OAuth client ID.**

- Application type: **Web application**.
- **Authorized redirect URIs** → add:

  ```
  https://hyaqydcmwbnbaiqqufow.supabase.co/auth/v1/callback
  https://auth.tavnit.ai/auth/v1/callback
  ```

  The first is a **Supabase** endpoint, not an app route. Google returns to Supabase, and Supabase
  then returns to the app at `/auth/callback`. Putting `http://localhost:3000/auth/callback` here is
  the classic mistake and produces Google's `Error 400: redirect_uri_mismatch` before any Supabase
  code runs.

  The second is this project's **Auth custom domain**, added 2026-09-26
  (`docs/vault/decisions/0063-auth-custom-domain.md`) so Google's account chooser reads `tavnit.ai`
  instead of the raw project ref. It is kept alongside the first, never in its place — see Step 3B.
  A rebuild that has not yet bought the custom-domain add-on only needs the first URI.

- **Authorized JavaScript origins**: leave empty. This is a server-side code flow and does not need
  them.
- Save the **Client ID** and **Client Secret**. The secret goes into the Supabase dashboard and
  nowhere else — never into the repo, never onto a command line.

Google can take a few minutes to propagate a new redirect URI. A `redirect_uri_mismatch` right
after saving is worth one retry before you start debugging.

### Step 3B — Custom Auth domain (optional; done for `hyaqydcmwbnbaiqqufow` on 2026-09-26)

Supabase's **Custom Domain** add-on lets Auth serve its callback from a branded host
(`auth.tavnit.ai` here) instead of `<ref>.supabase.co`, so Google's account chooser shows the
brand instead of the raw project reference. Full reasoning and DNS in
`docs/vault/decisions/0063-auth-custom-domain.md`; the ordering constraint below is specific to a
rebuild and worth calling out in the recipe:

- **The add-on is per-project, not per-organisation.** A rebuilt project starts without it. Buying
  the domain for the old project does not carry over — the new project has to re-buy and
  re-activate Custom Domain from scratch, DNS records included.
- **Register the new project's custom-domain callback URI in Google _before_ activating the
  domain in Supabase, not after.** The moment activation completes, Supabase Auth starts sending
  Google back to the custom domain for the OAuth callback. If that URI is not already on the
  OAuth client's Authorized redirect URIs list at that moment, every Google sign-in breaks with
  `redirect_uri_mismatch` until it is added — so add both URIs (Step 3, above) first, then
  activate the domain.
- **The 20–30 minute downtime Supabase's activation screen warns about does not apply here** when
  no client URL changes — `NEXT_PUBLIC_SUPABASE_URL` stays on `<ref>.supabase.co`
  (`docs/vault/decisions/0063-auth-custom-domain.md` explains why). This is **reasoned from Supabase's
  own documentation, not measured**: this project's 2026-09-26 activation was not timed for
  downtime. Do not assume zero downtime for a rebuild that also plans to switch client URLs —
  that is a different, unmeasured case.

### Step 4 — Supabase provider

New project → **Authentication → Providers → Google**. Confirm the browser URL contains
`hyaqydcmwbnbaiqqufow` first.

| Field                          | Value                                            |
| ------------------------------ | ------------------------------------------------ |
| **Enable Sign in with Google** | on                                               |
| **Client ID**                  | from step 3 (ends `.apps.googleusercontent.com`) |
| **Client Secret**              | from step 3                                      |
| **Skip nonce check**           | leave off                                        |
| **Authorized Client IDs**      | leave empty                                      |

The same screen displays the callback URL — confirm it matches what you registered in step 3
character for character.

### Step 5 — redirect allow-list

**Authentication → URL Configuration**:

- **Site URL**: `http://localhost:3000` during a rebuild, the production domain once there is one.
  **Live value, read off the dashboard 2026-09-22: `https://tavnit.ai`** — the apex, no `www`.
- **Redirect URLs**: `http://localhost:3000/auth/callback` and
  `http://localhost:3000/auth/recovery` (password recovery), plus the same two on
  `https://<prod-domain>` once it exists. **Live list, same read: exactly those four** —
  `http://localhost:3000/auth/callback`, `http://localhost:3000/auth/recovery`,
  `https://tavnit.ai/auth/callback`, `https://tavnit.ai/auth/recovery`.

`apps/web/src/lib/auth.ts:224` builds `redirectTo` as `` `${window.location.origin}/auth/callback` ``
— computed live in the browser from no env var — so every origin the app is served from needs its
own entry.

**Which is why the list stops at four: `www.tavnit.ai` redirects to the apex rather than serving.**
Every hostname that serves the app is its own origin, with its own cookie jar and its own entry on
this list — and an origin that serves but is not listed is the whole of the defect below. On
2026-09-22 `www.tavnit.ai` was serving the app on a 200: a sign-in started there sent GoTrue a
`redirect_to` no entry matched, GoTrue fell back to the Site URL on the apex, and the PKCE verifier
stayed behind in the `www` cookie jar, so the exchange failed and the browser stayed in the account
it had arrived in. The fix was the **Vercel domain redirect** — `www.tavnit.ai` now answers
`308 → https://tavnit.ai/` — and **not** a fifth entry here, because a fifth entry would have kept
two cookie jars alive while the Site URL points at the apex, and so does everything built from it,
including the live Reset Password link (`{{ .SiteURL }}/reset-password?token_hash=…`, §8A step 1
above). A host that redirects never reaches this list; a host that serves must be on it. Full chain
and the rejected alternative:
`docs/vault/defects/the-site-url-landing-signs-you-into-the-wrong-account.md`.

The `/auth/recovery` entry is **moot in production** while §8A step 1's token_hash Reset Password
template is the live one: that template links to `/reset-password?token_hash=…`, which is an
ordinary page and not a redirect target, so recovery never uses the allow-list at all.
`/auth/recovery` still serves any reset email sent before the template change, which is why the
localhost entry stays.

**A missed allow-list entry does not error.** GoTrue silently falls back to the Site URL, so a wrong
list looks like a _successful_ sign-in that lands on the marketing page with no session, while the
SQL still shows a `google` identity. This is why the browser check below is the gate. Since
2026-09-22 the landing is no longer silent — `apps/web/src/middleware.ts` forwards `/` to
`/auth/callback` when the query carries an auth result, so the browser ends on `/login` with a
message instead of in whatever account it was already signed into
(`docs/vault/defects/the-site-url-landing-signs-you-into-the-wrong-account.md`).

### Step 6 — add yourself as a test user

**OAuth consent screen → Audience → Test users → Add users.**

Add your own address and any address you will demo with. Up to 100, and their refresh tokens expire
every 7 days, so a test account needs re-authenticating weekly.

At this point Google sign-in works end to end for those addresses. Verify it now (below) rather
than waiting for step 7.

**On the live app this list gates nobody** — it was published at step 7 on 2026-09-03, and in
production any Google account can sign in. The step stays because a rebuild starts in Testing.

### Verifying it — the gate is `/home`, same as §8A

Pre-flight the `public.users` check from §8A step 2 first. Then `pnpm dev` → confirm port **3000** →
`http://localhost:3000/start` → **המשך עם Google** → pick the account.

**The gate is the browser staying on `http://localhost:3000/home`** — for an account that already
owns a business. Only `/home` requires a session (`apps/web/src/middleware.ts:43-45`).

Two other landings are also gates now, and both are new on 2026-09-03:

- **A fresh account with no business ends on `/home/new-business`**, the dashboard-chromed
  wizard. OnboardingFlow resolves the user with `getUser()` on `/start` and sends anyone signed
  in there, unless a finished draft is waiting — see
  `docs/vault/decisions/0015-signed-in-without-business-lands-on-new-business.md`.
- **A failed round-trip ends on `/login`** with `ההתחברות עם Google לא הצליחה…`. `/auth/callback`
  now checks `exchangeCodeForSession`'s result and reads the provider's `error` /
  `error_code` / `error_description` off the query string.

So **landing back on `/start` still proves nothing** — it is where the callback goes when it has
neither a working exchange nor error params — but it is no longer where a _failure_ ends up.
Before those two changes it was: the callback redirected there unconditionally and discarded the
exchange result, so a failed exchange looked identical to a successful one.

Then the secondary SQL confirmation, time-anchored as in §8A step 3:

```sql
select u.email, i.provider, i.last_sign_in_at, (pu.id is not null) as mirror_row_exists
from auth.users u
join auth.identities i on i.user_id = u.id and i.provider = 'google'
left join public.users pu on pu.id = u.id
where i.last_sign_in_at > now() - interval '5 minutes';
```

`auth.identities.provider = 'google'` is the only trustworthy discriminator.
`auth.users.raw_app_meta_data->>'provider'` records the **first** provider ever used, so an address
that signed up with email/password first still reads `'email'` after a genuine Google sign-in. That
is account linking, not a failure.

### Step 7 — publish, once `tavnit.ai` is live

**Done — the founder published the OAuth app on 2026-09-03 and its status reads _In production_.**
The procedure stays: this document is the rebuild recipe, so it has to describe the step even
though this project has taken it.

Everything here waits on the domain. Nothing above does.

1. Deploy the app to `tavnit.ai` with two publicly reachable routes, `/privacy` and `/terms`.
   Both exist — see the table below.
2. Verify `tavnit.ai` in **Google Search Console** (DNS TXT record or HTML file).
3. Consent screen → fill in **App home page**, **privacy policy URL**, **terms URL**, and add
   `tavnit.ai` under **Authorized domains**.
4. **Publishing status → Publish app.** With non-sensitive scopes only and no logo, the status
   changes to _In production_ immediately. There is no review to wait for.

### What still has to be written

The two pages were written 2026-09-02 from a repo fact sheet and take founder-chosen,
statute-checked positions pending lawyer review (see docs/legal-review.md):

| Requirement                  | Status today                                                                                                                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/privacy` route             | **Exists** — `apps/web/src/app/(legal)/privacy/page.tsx`, static, linked from the landing footer and the signup/login consent lines. Markers resolved 2026-09-03; positions and open questions for counsel in docs/legal-review.md. |
| `/terms` route               | **Exists** — `apps/web/src/app/(legal)/terms/page.tsx`, same status.                                                                                                                                                                |
| Home page explaining the app | The marketing page at `/` exists.                                                                                                                                                                                                   |
| `tavnit.ai` Search Console   | **Verified** — founder-done a few days before 2026-09-03; the exact date was not recorded.                                                                                                                                          |

The privacy policy has to be honest about what this product collects: email address and Google
profile name, the questionnaire, the uploaded video, and the generated output. Terms is optional
for Google but conventional to ship alongside.

### What a customer sees before you publish

Everything below applies only while publishing status is **Testing**, which this app left on
2026-09-03. Kept for the rebuild.

**Google documents an exception that would have made most of this moot** — for an app requesting
only `openid`, `email` and `profile`, Testing mode does **not** require the test-user list, shows
**no** unverified-app warning, and authorizations do **not** expire after 7 days
(<https://support.google.com/cloud/answer/15549945>). That is Google's documentation, **not
measured on this app**: by the time the first off-list account signed in here, the app was already
published, so this project has no observation either way. Treat the two paragraphs below as the
pre-publish worst case, not as a contradiction of it.

**On the test-user list:** they pick their account and then see Google's unverified-app
interstitial — headed roughly "Google hasn't verified this app", with _Go back to safety_ as the
prominent button. Continuing takes a small **Advanced** link, then "Go to _app_ (unsafe)". It is
designed to look like a security warning. Warn anyone you demo to, or they will back out and you
will hear "it didn't work".

**Not on the list — any real customer:** they never reach that screen. Google refuses at the
account chooser and returns `error=access_denied`. This used to be a **silent failure**: the app
read none of those params, so `/auth/callback` got no `code`, redirected to `/start` anyway, and
the customer landed on the wizard with no session and no message. Since 2026-09-03 the callback
reads them and sends the customer to `/login` with a Hebrew message instead.

`GOOGLE_SIGN_IN_ENABLED` in `apps/web/src/lib/auth.ts` is the kill switch for both Google buttons
and the `או` divider above the email form. **This document used to advise setting it `false` for
any public window before publishing; that advice is overridden** — see the 2026-09-01 amendment in
`docs/vault/decisions/0006-google-oauth-is-in-scope-for-launch.md`. The flag stays `true`, and the
question is moot now that the app is published anyway.

---

## 9. Smoke test

There is no data to verify, so the test is that the pipeline runs end to end on a fresh account.

```
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" $NEW -c "select now();"
pnpm --filter @aiugc/worker dev      # starts and idles on an empty queue, then Ctrl-C
pnpm dev
```

The worker start is what exercises the transaction-pooler string with `prepare: false` — if you
pasted the session-pooler URL into `DATABASE_URL`, this is where it shows.

Then in the browser: sign up **with email and password** (§8A), create a business, upload one demo,
and let it normalize. That exercises Auth → the `handle_new_user` trigger → `public.users` →
`businesses` → a `raw` upload → a worker job → an `assets` write → a signed URL. A redirect loop
back to `/start` is the §6A grant missing.

Two gates sit between a fresh account and the upload screen, neither fixable from the browser, so
line them up first or the smoke test stops early:

- **Credits.** `/home/a/new` shows `אין קרדיטים בחשבון` and renders nothing else when the balance
  is 0, which is where every new account starts — nothing grants signup credits. Either
  `grantCredits` from the admin console or set the owner's `users.role = 'admin'` (which bypasses
  the check) before you start.
- **A persona with an image and a hook clip.** The demo upload is step 4 of the Service A wizard
  and is unreachable until a persona is picked in step 1 and one of _its_ clips in step 2
  (`docs/vault/decisions/0012-persona-first-steps-wizard.md`: the gallery is one persona's column
  of the hook matrix, so a clip with `persona_id NULL` unblocks nothing). `personas`, `persona_images`
  and `hook_clips` are all empty on a rebuilt project and no migration seeds them — add a persona
  with at least one reference image and one active clip assigned to it via the admin console, and
  make sure the files exist in storage.
- **Script structures.** `structures` is empty on a rebuilt project too, and the Service B script
  step returns `אין כרגע תבנית תסריט זמינה` until it has an active row (hit on 2026-09-05, the
  first B wizard walk after the rebuild). `aiugc bank seed-structures` inserts the six checked-in
  skeletons from `seed/structures/`; it skips titles already present, so re-running is safe, and
  `--update` replaces the skeletons of titles already present from the files (how an edited seed
  reaches a live row — `add-structure` is insert-only).

Uploading through the web app is deliberate here: it creates the `public.users` row from the auth
uid via the trigger. `aiugc business create` invents a uuid instead, which permanently blocks that
address from ever signing up
(`docs/vault/defects/cli-created-user-blocks-that-email-from-ever-signing-up.md`). The CLI chain
is still the right tool for a business that will never have a human sign in — use a throwaway
address for it, never one a real person will later use.

Finally re-run the §6A `curl` with the access token from your new session.

---

## 10. Delete the old project — checklist

The old project (`mtpmrqltldfwhziyyzdu`, ap-south-1) is a t4g.nano holding test data. Nothing is
known to be left in it: no real users, no customer videos, no Google credentials (Google was never
enabled on it — §8B), and no unmigrated config, since `0031` moved the last five hand-typed
`app_config` rows into the repo (§7).

Until you press delete it is still the rollback: it is untouched and running, so reverting means
putting its values back in the five env files from §8.

### Confirm one last time, in the old project's dashboard

Read-only looks. Do not change anything; nothing here needs a database connection.

1. **You are in the right project.** The dashboard URL must contain `mtpmrqltldfwhziyyzdu` and the
   region must read **ap-south-1**. The new one is `hyaqydcmwbnbaiqqufow` / eu-central-1. This is
   the only step where a mistake is unrecoverable.
2. **Storage** → each of the four buckets. Anything you would miss? The 2026-08-26 census is in
   `docs/vault/facts/storage-census-2026-08-26.md` and recorded only test artifacts, largest object
   135 MB. Download anything you want to keep **now**.
3. **Authentication → Users.** Expect only test accounts. Any address here is one you will have to
   re-register on the new project — there is no export.
4. **Table editor** → spot-check `businesses`, `demos`, `video_renders`. All test rows.
5. **Nothing points at it any more.** `grep -rl mtpmrqltldfwhziyyzdu --exclude-dir=node_modules
--exclude-dir=.git .` from the repo root should return only `.next` build artifacts and vault
   notes that describe the history. If it names an `.env` file, stop and fix that first.
6. **Vercel → the web project → Environment Variables.** If a deploy exists, its Supabase URL/key
   must already be the new project's. A stale Vercel env is the one place a "working" local setup
   hides a broken production one.
7. **Hetzner worker box**, if it is running (`docs/07-worker-box.md`): its `.env` `DATABASE_URL`
   must name the new project, and `sudo systemctl restart aiugc-worker` after any change.

### Where the delete lives

Old project → **Project Settings → General** → scroll to the bottom → **Danger Zone** →
**Delete project**. It asks you to type the project name to confirm. There is no undo and no grace
period.

### What becomes permanently unrecoverable

- **The Postgres database** — every table, row, and the `supabase_migrations` ledger. Point-in-time
  recovery and any automated backups die with the project; they are not retained after deletion.
- **Storage objects** in all four buckets. Not recoverable, not archived.
- **`auth.users` and `auth.identities`** — every test account and its password hash. There is no
  post-deletion export.
- **The project ref and its hostnames.** `mtpmrqltldfwhziyyzdu.supabase.co`,
  `db.mtpmrqltldfwhziyyzdu.supabase.co` and the pooler tenant stop resolving. Any URL you ever
  pasted anywhere that names that ref is dead — including signed URLs and the `catalog` bucket's
  public URLs.
- **The rollback path for this whole rebuild.** After this, the new project is the only copy.

Not lost: anything in the repo. The migrations, `0031`'s config seeds, the bucket DDL in §5 and the
grants in §6A all reproduce a new project from scratch.

### The billing consequence

Two Pro projects on one org means paying the extra compute for both — roughly **$10/month** for the
second instance. Deleting the old project is what takes the bill **back to $25/month**. It is the
only step that does; nothing else in this document changes what you pay.

Deletion takes effect immediately, so the charge stops accruing from that point (the current cycle
is prorated).

### Afterwards

- Confirm the new project's compute reads **Micro** (Project Settings → Compute and Disk). That was
  the point of the whole exercise — the old project was stuck on t4g.nano because it started on
  Free and was upgraded.
- Update `.env.example` if the connection-string shape changed. It did: the direct
  `db.<ref>.supabase.co` host is IPv6-only from the founder's machine, so every `.env` now uses the
  pooler host.
- Record the rebuild in `docs/vault/phases/` with the ledger count and the
  `verify-migration-ledger.sql` result.
- Delete the stale Next.js builds — `apps/web/.next` and `apps/admin/.next` still have the old
  project's URL and anon key inlined from a pre-flip build (`NEXT_PUBLIC_*` are baked in at build
  time). `pnpm dev` regenerates them; a stale `next start` would not.
