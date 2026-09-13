---
type: decision
status: verified
verified: 2026-09-11
method: "grep -rn 'getStorage()' apps/web/src --include=*.ts --include=*.tsx (12 call sites, 11 files); packages/core/src/storage.ts:284-295 is the factory; grep -rln 'storage.objects' supabase/migrations/ returns nothing across 0000-0037; git log -S 'never the service role key' -- .env.example returns exactly one commit, 29ace1e (2026-07-23)"
source: founder
---

# The web tier holds the service role key, and that is the decision

`apps/web` runs on Vercel with `SUPABASE_SERVICE_ROLE_KEY` set, and it uses it. That is
deliberate as of 2026-09-11. Until this note, nothing had ever ruled on it.

## What the web tier holds, and what it bypasses

`getStorage()` (`packages/core/src/storage.ts:284-295`) **is** the service-role client factory: given
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` it returns a `SupabaseStorage` built on
`createClient(url, serviceRoleKey)`, and falls back to `LocalStorage` only when they are absent.
`apps/web` never names the variable — it imports `getStorage` from `@aiugc/core` — so a grep for
`SUPABASE_SERVICE_ROLE_KEY` under `apps/web/src` returns nothing and reads like an absence. It is
not one. There are **12 call sites across 11 files** (listed below).

The service role key **bypasses RLS entirely**. It is not a scoped key, it is not a publishable key,
and no policy constrains it. Anything the web tier asks storage for, it gets.

The same is separately true of the database handle: `apps/web` connects on `DATABASE_URL`, the
service-role connection string ([[plan-failure-diagnostics-are-unreachable]] `:71-72`). This note
rules on the storage key; the DB posture is the same shape and has never been ruled on either.

## Why this is the architecture, not a leak

`docs/03-storage.md:56-58` prescribes exactly this:

> Browser/customer access to business-scoped objects is **signed URLs only**
> (`storage.signedUrl(path, expiresIn)`), minted by server code after an RLS-scoped ownership
> check on the referencing row.

Server code minting signed URLs is the design. Doing it needs a key that can mint them.

The clause that said otherwise — `.env.example`'s "never the service role key", live from
2026-07-23 to 2026-09-11 — was **never a security decision**. `git log -S` finds it in exactly one
commit, `29ace1e` ("connected the auth flow to the onboarding flow, added a logout button, and
created a new start page… Updated the README and .env.example files"). It arrived as an incidental
line in an auth-wiring commit and was contradicted by the same repo four lines above it, where
`SUPABASE_SERVICE_ROLE_KEY` is set in `apps/web/.env.local`. `apps/admin/.env.example` never carried
the clause at all and has always listed the key plainly.

## The invariant this rests on

**Every route that mints a signed URL must perform an RLS-scoped ownership check before minting it.**
The key is safe only while that holds. A route that mints a URL from a caller-supplied id without
first proving the caller owns the referencing row hands out an object the caller should not see, and
no storage policy will stop it — there are none.

## That invariant is UNVERIFIED as of this note

It has **not** been checked across the 12 call sites. This note does not claim it holds. It was not
checked in the PR that wrote this note, by decision — that PR was documentation-only and an audit is
its own piece of work, queued in `state-of-play.md`.

The 12 sites, for whoever runs it:

| file                                                        | line           |
| ----------------------------------------------------------- | -------------- |
| `app/api/audio/[id]/route.ts`                               | `:62`          |
| `app/api/businesses/[businessId]/demos/route.ts`            | `:113`         |
| `app/api/businesses/[businessId]/demos/upload-url/route.ts` | `:38`          |
| `app/api/businesses/[businessId]/renders/route.ts`          | `:212`         |
| `app/api/demos/[id]/analysis/route.ts`                      | `:113`, `:129` |
| `app/api/demos/[id]/route.ts`                               | `:69`          |
| `app/api/demos/[id]/video/route.ts`                         | `:33`          |
| `app/api/hooks/route.ts`                                    | `:51`          |
| `app/api/personas/[personaId]/openers/route.ts`             | `:72`          |
| `app/api/renders/[id]/route.ts`                             | `:58`          |
| `lib/persona-catalog.ts`                                    | `:69`          |

All paths relative to `apps/web/src/`.

## Alternatives not taken

Both are **REASONED**, not measured — neither was built or benchmarked.

- **Write `storage.objects` RLS policies and sign with the user's own JWT.** Would let the web tier
  drop to the anon key for storage. Not taken because the policies do not exist: across migrations
  0000–0037 nothing references `storage.objects`, and
  [[storage-census-2026-08-26]] `:86-90` measured zero rows in `pg_policies` for `schemaname='storage'`.
  With zero policies Supabase Storage denies `anon` and `authenticated` by default and only
  `service_role` passes, so this is not a configuration flip — it is a new policy surface to design,
  test and keep correct per bucket.
- **Move URL signing off the web tier** (worker-side minting, or a signing endpoint). Keeps the
  original rule literally true. Not taken because it touches all 12 call sites and the whole wizard
  upload/preview path, for a benefit the ownership-check invariant already provides if it holds.

**What would justify taking one:** the audit finding call sites that mint without an ownership check.
One failure is a defect note. Several failures mean the invariant is not something this codebase
actually maintains, and that reopens this decision in favour of one of the two alternatives above.

## Related

- [[storage-census-2026-08-26]] — the measurement that there are no storage policies at all.
- [[plan-failure-diagnostics-are-unreachable]] — the sibling fact for the database handle.
