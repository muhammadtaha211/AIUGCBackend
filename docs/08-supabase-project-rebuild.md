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
flips the env vars. That is the line CLAUDE.md's migration gate draws.

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
> `c46131d` made those survivable rather than fatal, and `docs/07-worker-box.md` defers the port
> decision until the worker has a week on the Hetzner box. Use 6543 now; revisit it as its own
> decision.

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
| `businesses` | `apps/web/src/middleware.ts:40`, `app/home/layout.tsx:24`, `app/home/page.tsx:72`, `app/home/demos/page.tsx:21`, `app/home/a/new/page.tsx:23`, `app/home/b/new/page.tsx:25` | `id`, `name`, `questionnaire`, `created_at` (order) |
| `users`      | `apps/admin/src/middleware.ts:63`, `apps/admin/src/app/login/login-form.tsx:38`                                                                                             | `role`, `id` (filter)                               |

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

| Key                     | Before `0031`               | After                 | Why it matters                                                                     |
| ----------------------- | --------------------------- | --------------------- | ---------------------------------------------------------------------------------- |
| `poll_deadline_seconds` | absent → code constant 2400 | `900`                 | `poll.ts:14` already called 900 "the intended live setting"; 2400 is 2.7x the wait |
| `lipsync_motion_prompt` | absent → field omitted      | the production prompt | No fallback — its absence changes what every Service B render looks like           |
| `lipsync_resolution`    | absent → `"1080p"`          | `"1080p"`             | Same value; seeded so OFF is a decision, not a missing row                         |
| `tts_enhance`           | absent → `false`            | `false`               | Same                                                                               |
| `auto_release_b`        | `false` (seeded by `0001`)  | `true`                | Standing founder instruction, CLAUDE.md decision #8                                |
| `words_per_second`      | `{"default":2.2}`           | `{"default":2.1}`     | 2.1 is calibration output; `calibrate.ts:9` calls 2.2 "a guess"                    |

`tts_stability` is deliberately **not** seeded: the old project held `0.5`, and the decision on
2026-08-26 was to let ElevenLabs' own default stand. The absence of that row is the setting, and
`0031` says so in a comment so "no row" never again reads as "nobody thought about it".

Everything else the migrations produce already matched the old project — `daily_caps.gpu_seconds`
7200 from `0022`, `per_account.llm_tokens` 1500000 from `0027`, `credit_costs` from
`0017`/`0026`/`0028`.

**Works:** `select count(*) from app_config;` returns 12, and
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
  both are set.** So *replace the value of the existing `ANON` line*; adding a `PUBLISHABLE` line
  beside a stale `ANON` line sends the old project's key to the new project's URL, and every auth
  call 401s with `Invalid API key` before any redirect is computed. `apps/web/src/lib/auth.ts:75-79`
  flattens that into the Hebrew "ההתחברות עם Google לא זמינה כרגע", which reads exactly like a
  provider that was never switched on.

Then Vercel → Environment Variables for the web project, same values, and redeploy. If the Hetzner
box is running, update its `.env` and `sudo systemctl restart aiugc-worker` (keep
`WORKER_ID=hetzner`).

Auth settings do not come from the database. On the new project: enable the **Email** provider
(it was disabled by default on the old one and signups fail with `email_provider_disabled` until
it is on), set the Site URL, and set the redirect allow-list.
`apps/web/src/lib/auth.ts:71` calls `signInWithOAuth`, so any OAuth provider you had configured
needs re-adding with new callback URLs — see §8A.

> **Always pass `--db-url`.** `supabase/.temp/` used to hold link state pointing at the OLD project
> (`project-ref`, `linked-project.json` and `pooler-url` all named `mtpmrqltldfwhziyyzdu`), so any
> `npx supabase …` command that resolved the linked project silently targeted the project
> CLAUDE.md's migration gate puts off-limits. **Removed 2026-08-26** — the directory is gitignored
> local CLI state and `supabase link` regenerates it. An unqualified command now fails loudly with
> `LegacyProjectNotLinkedError: Cannot find project ref`, which is the intended behaviour: there is
> no reason to re-link while every documented command takes an explicit `--db-url`.

---

## 8A. Google OAuth — the last thing holding the old project open

Google is the only provider configured. Nothing about it lives in the database or in any
migration: it is entirely GoTrue tenant config, which is why the rebuild did not carry it.

### Step 1 — copy two values out of the old project

Old project → **Authentication → Providers → Google**. Copy:

| Field             | Notes                                                             |
| ----------------- | ----------------------------------------------------------------- |
| **Client ID**     | ends `.apps.googleusercontent.com`                                |
| **Client Secret** | usually starts `GOCSPX-`                                          |

Also note whether **Skip nonce check** is on and whether **Authorized Client IDs** has anything
in it — if either is set, mirror it. Both are normally untouched.

### Step 2 — paste them into the new project

New project → **Authentication → Providers → Google** → toggle **Enable**, paste both values,
Save. Confirm the browser URL contains `hyaqydcmwbnbaiqqufow`; if it shows any other ref you are
editing the old project.

That screen also displays its own callback URL. It should read exactly:

```
https://hyaqydcmwbnbaiqqufow.supabase.co/auth/v1/callback
```

### Step 3 — add that callback URL in Google Cloud Console

console.cloud.google.com → **APIs & Services → Credentials** → the OAuth 2.0 Client ID whose
Client ID you just copied → **Authorized redirect URIs** → **ADD URI**:

```
https://hyaqydcmwbnbaiqqufow.supabase.co/auth/v1/callback
```

Keep the old project's URI there too until the old project is deleted, so a rollback still works.
This is a **Supabase** endpoint, not an app route — Google returns to Supabase, and Supabase then
returns to the app. Registering `http://localhost:3000/auth/callback` here instead is the classic
error and produces Google's `Error 400: redirect_uri_mismatch` before any Supabase code runs.

Google propagation can take a few minutes; a mismatch error immediately after saving is worth one
retry before you start debugging.

### Step 4 — Site URL and the redirect allow-list

New project → **Authentication → URL Configuration**:

- **Site URL**: `http://localhost:3000` for now; flip it to the Vercel domain when one exists.
- **Redirect URLs**: add `http://localhost:3000/auth/callback`, and
  `https://<prod-domain>/auth/callback` once there is a prod domain.

`apps/web/src/lib/auth.ts:73` builds `redirectTo` as `` `${window.location.origin}/auth/callback` ``
— computed live in the browser, from no env var — so whatever origin the tab is on must be
covered.

Two traps here, both verified in the source:

- **A missed allow-list entry does not error.** GoTrue silently falls back to the **Site URL**. So
  a wrong list looks like a *successful* sign-in that lands you on the marketing page with no
  session — and the SQL in step 6 still reports success. This is why step 5 is the real gate.
- **The dev port is not pinned.** `apps/web/package.json` is `"dev": "next dev"` with no `-p`,
  while admin holds 3001. If 3000 is busy, Next silently serves 3002 and `redirectTo` follows the
  address bar. Check the port Next prints before clicking the Google button.

### Step 5 — verify in the browser (this is the pass/fail gate)

**Before clicking anything**, make sure no stale `public.users` row holds the address you are
about to sign in with — see
`docs/vault/defects/cli-created-user-blocks-that-email-from-ever-signing-up.md`. If one does, the
sign-in fails with GoTrue's generic `Database error saving new user` and writes **nothing**, which
is indistinguishable from "the provider is off".

```sql
select id, email from public.users where email = '<the address you will use>';
-- want: zero rows
```

Then: `pnpm dev` → `http://localhost:3000/start` → **המשך עם Google** → pick the account.

Expected: Google → `/auth/callback?code=…` → the onboarding wizard at `/start`. Landing on
`/start` is correct for a brand-new account and is **not** by itself proof — the callback route
redirects there unconditionally (`apps/web/src/app/auth/callback/route.ts:18`), and it also
discards the result of `exchangeCodeForSession` (`:15`), so a failed exchange looks identical.

**The actual proof is a session.** Navigate to `http://localhost:3000/home`:

- **Stays on `/home`** → signed in. OAuth works. `apps/web/src/middleware.ts:34-36` redirects any
  request to `/home` without a user, so staying there cannot happen without a session.
- **Bounces to `/start`** → no session. The identity may still exist in the database (see below);
  the app-side half failed — allow-list, port, or the PKCE exchange.

DevTools → Application → Cookies → `http://localhost:3000` should show
`sb-hyaqydcmwbnbaiqqufow-auth-token` (possibly chunked `.0`/`.1`).

### Step 6 — confirm what actually landed in the database

New project's SQL editor, opened at the ref-bearing URL so there is no stale-tab risk:
`https://supabase.com/dashboard/project/hyaqydcmwbnbaiqqufow/sql/new`.

```sql
select u.id, u.email, i.provider, i.created_at, i.last_sign_in_at,
       (pu.id is not null) as mirror_row_exists, pu.role
from auth.users u
join auth.identities i on i.user_id = u.id and i.provider = 'google'
left join public.users pu on pu.id = u.id
where i.last_sign_in_at > now() - interval '5 minutes'
order by i.last_sign_in_at desc;
```

The `interval` is load-bearing: without it an *earlier* successful attempt keeps reporting success
after you have changed a setting and broken it.

- **One row, `mirror_row_exists = true`** → GoTrue and the `handle_new_user` mirror both worked.
  Combined with step 5's `/home` result, OAuth is proven end to end.
- **Zero rows** → nothing reached GoTrue. Disambiguate with
  `select provider, count(*) from auth.identities group by 1;` and `select count(*) from auth.users;`
  — all-zero means the provider toggle or the Google-side URI; a row you did not expect means you
  are in the wrong project.
- **Row present but step 5 bounced** → GoTrue succeeded and the app-side exchange did not. Look at
  the allow-list and the dev port, not at Google.

`auth.identities.provider = 'google'` is the only trustworthy discriminator here.
`auth.users.raw_app_meta_data->>'provider'` records the **first** provider ever used, so if the
address was signed up with email/password earlier it stays `'email'` after a genuine Google
sign-in — that is account linking, not a failure. Likewise `role` will read `customer`: the
trigger writes only `(id, email)` and lets the column default stand
(`docs/vault/facts/auth-users-insert-trigger.md`), so an admin account still needs its
`UPDATE public.users SET role='admin'`.

**Only after step 5 stays on `/home` and step 6 returns its row is the old project free to
delete** (§10).

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

Then in the browser: sign up, create a business, upload one demo, and let it normalize. That
exercises Auth → the `handle_new_user` trigger → `public.users` → `businesses` → a `raw` upload → a
worker job → an `assets` write → a signed URL. A redirect loop back to `/start` is the §6A grant
missing.

Finally re-run the §6A `curl` with the access token from your new session.

---

## 10. Delete the old project

Only after §9 passes. Until then the old project is the rollback: it is untouched and still running,
so reverting means putting its values back in the six places from §8.

Once the new project works, the old one is a t4g.nano holding test data and costing Pro compute.
Delete it, and confirm the new project's compute reads **Micro** — that was the point of the whole
exercise.

Afterwards: update `.env.example` if the connection-string shape changed, and record the rebuild in
`docs/vault/phases/` with the ledger count and the `verify-migration-ledger.sql` result.
