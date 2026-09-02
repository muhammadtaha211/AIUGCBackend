---
type: defect
status: verified
verified: 2026-09-02
method: "select id, persona_id, file_path, catalog_path, is_default from persona_images; select bucket_id, name, metadata->>'size' from storage.objects where name like '%persona_image%' (packages/core/.work/persona-bank-probe.ts); code read at packages/core/src/pipelines/bank.ts tryBlurPlaceholder"
source: db | code
---

# FIXED 2026-09-02 — the admin reference-image upload stranded "pending" rows after both uploads landed

The founder uploaded a reference image for persona "Test" from the admin app twice (04:31 and
04:32 UTC) and got the generic Hebrew 500 both times. Measured state afterwards:

- two `persona_images` rows at `file_path = 'pending'`, `catalog_path NULL`, `is_default false`;
- **four** storage objects — the `assets` original and the `catalog` copy for _each_ row,
  342,433 bytes every one, same content hash (`a5203f3dc7427157`: the same file, uploaded twice).

So `addPersonaImage` threw **after** both `storage.put()` calls succeeded and **before** the
`db.update` that stamps `file_path`/`catalog_path`. The only code in that window was
`tryBlurPlaceholder`, whose `mkdirSync(WORK_DIR/persona-blur)` and `writeFileSync` sat outside
its try/catch; only the ffmpeg call was guarded. The cleanup branch (delete the placeholder
row) fires only when an _upload_ throws, so a throw here left the row stranded with its bytes
orphaned in both buckets.

The exact errno was not captured (no Vercel log was read). The throw is consistent with the
bundle directory being read-only: the admin app is written for Vercel (the comments in
`apps/admin/src/lib/hooks.ts`, `upload-image.tsx` and `api/admin/hooks/route.ts` all say "no
ffmpeg on Vercel"), and `WORK_DIR` resolves under the repo root, which is not writable there.
It does not reproduce locally, where `.work/` is writable and ffmpeg exists.

## Fix (code)

`tryBlurPlaceholder` is now fully best-effort — temp dir, temp file and ffmpeg all inside the
try; any failure yields `blur_data_url = NULL` and the upload lands. `aiugc persona
sync-catalog` backfills the blur later, as its doc already promised. Pinned by
`packages/core/test/persona-image-blur-guard.test.ts` (WORK_DIR pointed under a regular file so
`mkdirSync` throws; the upload must still resolve with its paths stamped).

## Fix (data)

`packages/core/.work/persona-image-repair.ts`, 2026-09-02: row `ff3a4f04…` repaired — `file_path`
and `catalog_path` set to the objects it already owned, `is_default = true` (the persona had no
default); `syncPersonaImageCatalog` then backfilled its blur (1 row). The byte-identical duplicate
row `4d23a910…` was deleted with its two objects. After: 1 `persona_images` row, 2 objects, both
readable.

## The general hazard this leaves

Any core function that writes under `WORK_DIR` will fail the same way when a Vercel route handler
calls it. Today the only route-reachable writer was this one; a future route that reaches
`normalizeHookClip`, `createComposite`'s temp files, or anything else under `.work/` needs the
same guard or must stay on the worker.
