# 03 — Storage Plan

Supabase Storage, three **private** buckets, signed URLs only (no public objects, ever).
Implementation: `packages/core/src/storage.ts` — a `Storage` interface with two backends:
`SupabaseStorage` (production) and `LocalStorage` (`.storage/` — CLI phase before a Supabase
project exists, and offline dev). Tests inject a temp-dir backend. All path construction goes
through `storageKey()`, which is the single place to change when migrating providers.

## Buckets & layout

Path convention: `<bucket>/<business_id|bank>/<entity>/<id>/<filename>`

| Bucket    | Contents                                                                                     | Written by                                        |
| --------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `raw`     | user uploads exactly as received                                                             | `createDemo`                                      |
| `assets`  | normalized demos, thumbnails, hook bank, persona reference images                            | ingest handler, `bank add-*`, `persona add-image` |
| `renders` | audio previews (`audio/<id>/audio.mp3`), final videos (`video/<id>/final.mp4`), video thumbs | tts + render handlers                             |

Founder bank assets use the `bank/` prefix (no business). Everything is 1080×1920 H.264 MP4
after normalization; audio is mp3 44.1kHz.

## Retention & lifecycle

Supabase Storage has **no native lifecycle rules**, so retention is enforced by the daily
`janitor` job from DB timestamps (`pipelines/janitor.ts`): delete the object, null the path
column, **keep the row** (metadata, stars, ledger references survive).

| Class                     | Window (app_config `retention_days`) | Clock starts                                                      |
| ------------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| Raw uploads               | 30 days                              | after successful normalization (`demos.updated_at`, status ready) |
| Normalized demos + thumbs | kept while the business is active    | —                                                                 |
| Released renders          | 90 days                              | `released_at`                                                     |
| Watermarked samples       | 14 days                              | `released_at`                                                     |
| Unapproved audio previews | 30 days                              | `created_at` (approved audio is referenced by renders — kept)     |

All windows are config rows — tightening/loosening retention is an UPDATE. The janitor logs a
digest line (counts per class) daily.

## Working files

ffmpeg/Remotion intermediates live under `.work/` on the worker box (`WORK_DIR`), keyed by job —
safe to wipe any time; every durable artifact is pushed to a bucket before the job completes.

## Egress & the R2 option

Video egress is the only cost that scales with success. The escape hatch is isolated by design:
`Storage` is an interface and every path goes through `storageKey()`, so moving the `renders`
bucket to Cloudflare R2 later is one new backend class + a copy job — no pipeline changes.
Decision deferred until Supabase egress actually shows up on a bill (at V0 scale it won't).

## Access

- Browser/customer access is **signed URLs only** (`storage.signedUrl(path, expiresIn)`), minted
  by server code after an RLS-scoped ownership check on the referencing row.
- The worker and CLI use the service role key.
- fal.ai receives 1-hour signed URLs for the source image + audio inputs (see 04).
