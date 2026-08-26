---
type: fact
status: verified
verified: 2026-08-26
method: "packages/core/.work/storage-census.ts and storage-census5.ts — see the queries below"
source: db
---

# Storage census of the retired project — 785 objects, 2,421,869,303 bytes

**This describes `mtpmrqltldfwhziyyzdu`, which is being deleted, and none of it is being moved.**
It was measured to size a migration; the founder then established that the project holds only test
data, so the move became a rebuild (`docs/08-supabase-project-rebuild.md`) and nothing here is
transferred. Kept for two things that outlive the project: the **bucket settings**, which
`docs/08` §5 recreates by hand because no migration creates a bucket, and the **JSONB reference
finding** below, which is a property of the schema rather than of this data.

The database was 15 MB; storage was ~160x that.

| Bucket    | Public  | Objects | Bytes             | Size limit | MIME allowlist                  |
| --------- | ------- | ------- | ----------------- | ---------- | ------------------------------- |
| `assets`  | no      | 625     | 1,097,252,200     | 1 GiB      | none                            |
| `renders` | no      | 136     | 1,051,174,083     | 500 MiB    | none                            |
| `raw`     | no      | 19      | 268,273,361       | none       | mp4, quicktime, jpeg, png, webp |
| `catalog` | **yes** | 5       | 5,169,659         | none       | none                            |
| **Total** |         | **785** | **2,421,869,303** |            |                                 |

```sql
select bucket_id, count(*), sum((metadata->>'size')::bigint)
from storage.objects group by bucket_id;
```

Largest object 135 MB (`assets/.../demo/.../normalized.mp4`, three of them). Nine objects over
50 MB hold 892 MB. All 785 have complete `metadata` (no null `size`). Object names are pure ASCII,
no spaces, max length 100. All 785 have `owner_id = null` — every upload was service-role, so
nothing in storage depends on `auth.users`.

## The referencing is not where you would look for it

696 distinct paths are referenced from the database and **all of them resolve** — zero dangling
references on this date. But the references are split across two kinds of column:

- 11 `text` columns named `%path%` (`demos.raw_path`, `video_renders.file_path`, ...).
- 3 JSONB columns: `demo_analyses.timeline`, `video_renders.params`, `jobs.state`.

**524 objects are reachable only through the JSONB columns** — 501 in `assets` (36 MB of
`demo/<id>/states/<ms>.jpg` analysis frames) and 23 in `renders` (440 MB of `lipsync.mp4` /
`lipsync-upscaled.mp4` intermediates). A reachability check that walks only the text columns
reports those 524 as orphans.

89 objects (46 MB) are referenced by neither kind of column, and two of them are customer-facing
rather than scratch: `assets/samples/a-steps/recording.mp4` and `assets/samples/a-steps/ad.mp4` are
the good-input example on the demo step, at paths hardcoded in
`apps/web/src/lib/service-a.ts:55-56`. `signedSamples()` swallows any signing failure and returns
`null` (`apps/web/src/app/api/businesses/[businessId]/demos/route.ts:24-36`), so their absence is
invisible — the example just stops appearing.

**Consequence:** there is no safe subset of this bucket. Any migration or cleanup must copy all 785.

## Content

- eTags: 743 are plain 32-hex MD5, **42 are multipart-shaped** (`<md5>-<n>`). Byte-identity cannot
  be checked by comparing source eTags alone for those 42.

  The split is purely by size, with **no overlap**: plain MD5 from 3,309 bytes to 16 MB, multipart
  from 17 MB to 135 MB. Every one of the 785 was written by a single `supabase-js` `upload()` call
  through `SupabaseStorage.put()`, so the shape is decided by **storage-api**, which streams large
  bodies to S3 as a real multipart upload — not by the shape of the client request. Any reasoning
  of the form "one PUT, therefore the eTag is the content MD5" is false above ~16 MB. To prove
  byte-identity for an object in that range you must download it and hash it.

  ```sql
  select case when btrim(metadata->>'eTag','"') ~ '-[0-9]+$' then 'multipart' else 'plain md5' end,
         count(*), pg_size_pretty(min((metadata->>'size')::bigint)),
         pg_size_pretty(max((metadata->>'size')::bigint))
  from storage.objects group by 1;
  ```

- 224 distinct contents are stored more than once — **323 redundant objects, 800 MB** (33% of the
  bucket) are byte-identical duplicates by `(eTag, size)`.
- 29 objects are stored as `text/plain;charset=UTF-8` (28 in `renders`, 1 in `assets`) and are
  really mp4s — supabase-js defaults Buffer uploads to that type. Recorded, not fixed.
- `cacheControl`: `max-age=3600` on 768, `max-age=31536000` on the 5 `catalog` objects (the
  year-long cache in docs/03), `no-cache` on 12 `raw` objects.

Storage API version 1.71.0, storage schema migration 64. No `storage.prefixes` table on this
version. No RLS policies exist on `storage.objects` at all (`pg_policies` where
`schemaname='storage'` returns 0 rows) — access is service-role plus the one public bucket, which
means docs/03's claim that 0007's RLS declares `catalog` readable describes something that is not
in the database.
