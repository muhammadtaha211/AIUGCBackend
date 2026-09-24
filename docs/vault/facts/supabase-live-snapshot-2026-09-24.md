---
type: fact
status: verified
verified: 2026-09-24
method: "founder-run, read-only: 12-query `begin; set transaction read only; ... rollback;` block (`.work/security/live-catalog.sql`, session-local, not in this repo) against the live project's SQL editor; separately, one `GET {SUPABASE_URL}/auth/v1/settings` with the anon key (`.work/security/live-auth-settings.sh`, same session-local location). This session ran neither — the founder did, and reported the results back."
source: db + founder
supersedes: null
---

# Supabase RLS/grants and GoTrue settings, live-verified 2026-09-24

**The 14-day staleness rule in `docs/vault/CONVENTIONS.md` applies to this note like any other fact
note.** Re-measure after 2026-10-08 before relying on any line here for a security claim.

This is the founder's own independent read, one day after the same catalogue was queried during the
project's Supabase security-audit phase (2026-09-23, session-local, `.work/security/02-supabase.md` —
not in this repo). The two runs agree on every point below; nothing here is a new finding, it is a
second, independently-run confirmation of the 2026-09-23 read.

## RLS, policies, functions, triggers, storage (project `hyaqydcmwbnbaiqqufow`)

- RLS enabled on **all 29 `public` tables**; forced (`FORCE ROW LEVEL SECURITY`) on none.
- **Exactly 20 active policies**, all `cmd = 'SELECT'`. **Zero** policies on `storage.objects` or
  `storage.buckets`.
- **3 functions** in `public` (not the 2 the migration ledger alone would suggest): the third,
  `rls_auto_enable`, is Supabase's own platform-injected implementation of the "automatic RLS"
  project setting `docs/08-supabase-project-rebuild.md` §1 records as founder-configured ON — not an
  undocumented change.
- **0 views** (materialized or not) in `public`.
- **1 trigger** on `auth.users` — inserts `(id, email)` with `ON CONFLICT DO NOTHING`, matching
  `0002_supabase_rls.sql` byte-for-byte.
- **4 storage buckets**: `assets`, `catalog`, `raw`, `renders`. `raw`'s `file_size_limit` is **`NULL`
  at the bucket-row level** — no server/bucket-enforced size bound exists for it today. Separately,
  the founder read the Storage dashboard's per-bucket size field for `raw` as **"unset (1 GB)"** —
  the UI's own placeholder/effective-default readout when no explicit limit has been set, not a
  stored value; the two readings agree that nothing has been set.
- The `supabase_realtime` publication is **empty** (0 rows).
- **Platform default ACL**: `anon` and `authenticated` hold `TRUNCATE`, `REFERENCES` and `TRIGGER` on
  every table in `public` via Supabase's own bootstrap default for future tables owned by `postgres`
  — every Supabase project has this, no migration or hand-run grant added it. No PostgREST verb maps
  to any of those three privileges, so there is no exploitable path through the exposed Data API
  surface today; `TRUNCATE` does ignore RLS, which is the reason revoking it (in `public` only — see
  below) is still worth doing.
- Extensions installed: `pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp` —
  5 total. **No** `pg_net`, `pg_cron`, `http`, or `pg_graphql`.
- **0 tables** exist in `public` outside the 29 the migration ledger (`0000`–`0048`) creates.
- `auth.users`: **7 accounts** (2 `email`, 5 `google`), **0** `is_anonymous`.

### The grant that contradicts `docs/08`'s recipe as written (SB-5)

`authenticated` holds `SELECT` on exactly `businesses` and `users`, and **the grant is table-wide,
all columns** — not the column-scoped `businesses(id,name,questionnaire,created_at)` /
`users(id,role)` grant `docs/08-supabase-project-rebuild.md` §6A's table implies. `anon` holds
**zero** `SELECT`/`INSERT`/`UPDATE`/`DELETE` grants anywhere. Corrected in `docs/08` §6A directly.
Exposure is contained entirely by the two SELECT-only, own-row RLS policies
(`businesses_select_own`, `users_select_self`) — RLS, not column scope. A column-scoped grant is the
intended tightening target; no migration writing it exists yet
(`docs/vault/state-of-play.md` queue).

### Anon black-box probe (`.work/security/live-probe.sh`, session-local)

**29 of 29 tables denied** for the anon key; the one side-effect-free RPC and the storage-bucket/
object listings returned nothing. `plans` and `app_config` returned HTTP 400 rather than a clean
deny, because the probe script selected a literal `id` column and those two tables' primary keys are
`code` and `key` respectively — Postgres reports a missing column before it ever checks permissions,
so the 400 is a probe-script artifact, not a signal. (The script's `select=id` was the bug; a rerun
should select no explicit column, so PostgREST falls back to `*` and works regardless of a table's
key column — fixed in the session-local copy.) The **all-29-denied** result is expected and correct:
`anon` has zero grants on any table, including `businesses`/`users`, so even those two — reachable
for `authenticated` — correctly deny for `anon` at the grant layer before RLS is ever evaluated.
**The authenticated-role pass was not run this session.**

## GoTrue `/auth/v1/settings` (anon key, HTTPS GET)

| Field                             | Live value                         | Expected (`.work/security/03-auth.md` §15, session-local) | Match                      |
| --------------------------------- | ---------------------------------- | --------------------------------------------------------- | -------------------------- |
| `external.email`                  | `true`                             | `true`                                                    | yes                        |
| `external.google`                 | `true`                             | `true`                                                    | yes                        |
| every other `external.<provider>` | `false`                            | `false`                                                   | yes                        |
| `external.anonymous_users`        | `false`                            | `false`                                                   | yes                        |
| `external.phone`                  | `false`                            | `false`                                                   | yes                        |
| `disable_signup`                  | `false`                            | `false` (open signups)                                    | yes                        |
| `mailer_autoconfirm`              | `false`                            | `false` (Confirm email ON)                                | yes                        |
| `phone_autoconfirm`               | `false`                            | `false`                                                   | yes                        |
| `saml_enabled`                    | `false`                            | `false`                                                   | yes                        |
| `passkeys_enabled`                | `false`                            | not in the expected table (an extra field)                | n/a — informational        |
| `mfa_enabled`                     | **field absent from the response** | `true` expected, if present                               | cannot resolve — see below |

**`mfa_enabled`'s absence is data to reconcile, not a finding** — neither the installed `auth-js` nor
this repo defines GoTrue's settings document, so an unexpected or missing key was already flagged as
a possibility before this read. MFA availability stays readable only from the dashboard
(`Authentication → Multi-Factor`) — **this closes nothing about MFA**; it remains open exactly as
before.

**What this read closes that was previously dashboard-only or EXTERNAL:** Confirm-email being ON
(`mailer_autoconfirm: false`) is now independently confirmed via a direct API read, not just the
dashboard card. The anonymous-sign-in **setting** (as opposed to observed usage) was previously
recorded as "still EXTERNAL — not queryable from SQL" in the 2026-09-23 audit read; `external.
anonymous_users: false` closes that specific gap — the toggle itself, not just the fact that no
anonymous account has ever been created, is now confirmed off.

## Related

- [[worker-box-network-perimeter-2026-09-24]] — the same day's other external-state measurement.
- `docs/08-supabase-project-rebuild.md` §6A (corrected in place) and its new platform-default-ACL
  paragraph.
- [[data-api-surface-is-two-tables]] — the app-call-site half of the same two-table picture; that
  note's own claims about which tables the browser reads are unaffected by this note's grant-scope
  correction.
- `docs/vault/state-of-play.md` — two queue items opened from this note: the non-sudo service user
  (A8) and the grant-tightening migration.
