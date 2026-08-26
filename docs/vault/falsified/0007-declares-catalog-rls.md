---
type: falsified
status: verified
verified: 2026-08-26
method: "grep -rln 'storage.objects|storage.buckets' supabase/migrations/ (no matches); select count(*) from pg_policies where schemaname='storage' (0 rows)"
source: code
---

# "0007's RLS already declares catalog readable by any signed-in user" — false

## The claim, verbatim

From `docs/03-storage.md`, in the Access section:

> Persona catalog images are the one exception: public copies in `catalog` (0007's RLS already
> declares them readable by any signed-in user), served via `storage.publicUrl(path)`...

## What killed it

Found while measuring storage ahead of the project rebuild (`docs/08-supabase-project-rebuild.md`).

- `0007_rls_composites_persona_images.sql` does not contain the string `storage` at all.
- **No migration in `0000`–`0030` touches the `storage` schema.**
- On the live project, `select count(*) from pg_policies where schemaname = 'storage'` returns
  **0**. There are no storage RLS policies of any kind — not on `catalog`, not on anything.

The `catalog` bucket is readable because `storage.buckets.public = true`, which was set outside the
migrations (by hand, or by the dashboard) when the bucket was created on 2026-08-05. Nothing in the
repo creates or configures any bucket.

## Why it matters

The observable behaviour is correct — `publicUrl()` works — so this hid easily. It matters in two
places:

1. **Rebuilding the project from migrations does not reproduce storage.** `supabase db push` on an
   empty project creates zero buckets. §5 of `docs/08-supabase-project-rebuild.md` creates all four
   by hand precisely because of this; anyone trusting docs/03 would expect `db push` to have done
   it and would find every upload failing with "bucket not found". This is the note's load-bearing
   consequence — it is what makes the bucket step a required part of a rebuild rather than an
   optional tidy-up.
2. It implies a signed-in-user read policy exists that could be tightened or relied on. There is
   nothing to tighten. `catalog` is world-readable to anyone with the URL, signed in or not — which
   is the intended design (docs/03 calls it founder-curated, non-business data), but it is achieved
   by the bucket's `public` flag alone.

`docs/03-storage.md` still carries the sentence; correcting it is a separate change.

Related: [[../facts/storage-census-2026-08-26]].
