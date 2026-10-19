# 03 — Storage Plan

Supabase Storage, three **private** buckets (signed URLs only) plus one **public** bucket
(`catalog`) for persona catalog images — founder-curated, non-business data that benefits from
stable cacheable URLs. Everything business-scoped stays private and signed.
Implementation: `packages/core/src/storage.ts` — a `Storage` interface with two backends:
`SupabaseStorage` (production) and `LocalStorage` (`.storage/` — CLI phase before a Supabase
project exists, and offline dev). Tests inject a temp-dir backend. All path construction goes
through `storageKey()`, which is the single place to change when migrating providers.

## Buckets & layout

Path convention: `<bucket>/<business_id|bank>/<entity>/<id>/<filename>`

| Bucket    | Contents                                                                                                                                                                                                                                                                                              | Written by                                                   |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `raw`     | user uploads exactly as received — demos, and own-voice recordings at `<biz>/recording/<id>/upload.<ext>` (vault 0118)                                                                                                                                                                                | `createDemo`, the recording upload-url route                 |
| `assets`  | normalized demos, thumbnails, hook bank, persona reference images                                                                                                                                                                                                                                     | ingest handler, `bank add-*`, `persona add-image`            |
| `renders` | audio previews (`audio/<id>/audio.mp3`, also an approved recording's own copy), processed own-voice recordings (`recording/<id>/audio.mp3`), Service B lip-sync plates + upscaled clips (`video/<id>/lipsync-plate.mp4`, `lipsync-upscaled.mp4`), final videos (`video/<id>/final.mp4`), video thumbs | tts, transcribe_recording, lipsync/upscale + render handlers |
| `catalog` | **public** — content-addressed copies of persona reference images (`bank/persona_image/<id>/<hash>.<ext>`, year-long cache-control), served to the pickers via `publicUrl()`                                                                                                                          | `addPersonaImage`, `persona sync-catalog`                    |

Founder bank assets use the `bank/` prefix (no business): `bank/hook_clip/<id>/clip.mp4`,
`bank/text_block_clip/<uuid>/clip.mp4` (Service C, 0052 — the one bank clip whose audio track is
played, so normalization keeps it as AAC). Everything is 1080×1920 H.264 MP4 after normalization;
audio is mp3 44.1kHz.

## Retention & lifecycle

Supabase Storage has **no native lifecycle rules**, so retention is enforced by the daily
`janitor` job from DB timestamps (`pipelines/janitor.ts`): delete the object, null the path
column, **keep the row** (metadata, stars, ledger references survive).

| Class                     | Window (app_config `retention_days`) | Clock starts                                                                                                                                                                     |
| ------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw uploads               | 30 days                              | after successful normalization (`demos.updated_at`, status ready)                                                                                                                |
| Normalized demos + thumbs | kept while the business is active    | —                                                                                                                                                                                |
| Released renders          | 90 days                              | `released_at`                                                                                                                                                                    |
| Watermarked samples       | 14 days                              | `released_at`                                                                                                                                                                    |
| Unapproved audio previews | 30 days                              | `created_at` (approved audio is referenced by renders — kept)                                                                                                                    |
| Own-voice recordings      | the raw and preview windows above    | `voice_recordings.created_at`: the upload on `raw_after_normalize`, the processed file on `audio_previews`, approved or not (an approved recording's audio row has its own copy) |

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

- Browser/customer access to business-scoped objects is **signed URLs only**
  (`storage.signedUrl(path, expiresIn)`), minted by server code after an RLS-scoped ownership
  check on the referencing row. Persona catalog images are the one exception: public copies in
  `catalog` (0007's RLS already declares them readable by any signed-in user), served via
  `storage.publicUrl(path)` so browsers/CDNs/next-image can cache them.
- A signed URL can also name the file the browser saves:
  `storage.signedUrl(path, expiresIn, { download })` serves the object as an attachment under that
  name. One caller — `GET /api/renders/[id]`, which returns it as `downloadUrl` beside the playable
  `videoUrl`. The two cannot be one URL: the attachment header would apply to the `<video>`
  element's own request (`docs/vault/decisions/0047-finished-renders-play-in-one-component.md`).
- The worker and CLI use the service role key.
- fal.ai receives 1-hour signed URLs for the source image + audio inputs (see 04).
