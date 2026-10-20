---
type: defect
status: verified
verified: 2026-10-20
method: "Read-only, 2026-10-20: git archive origin/main supabase | tar -x into a scratch folder (main's last file is 0065_tiktok_token_expiry_and_delivery.sql), then packages/core/.work/list-from-main.mjs (push-0066-0067.mjs with --workdir <that folder> added and the push mode removed) in list and dry modes against production over the session pooler. packages/core/.work/ledger-count.ts: select count(*), min(version), max(version) from supabase_migrations.schema_migrations -> 68 / 0000 / 0067."
source: db
---

# Production's ledger has 0066 and 0067, but only the parked `feat/b-own-voice` has their files

- **How it happened.** 0066/0067 (own voice, [[0118-service-b-own-voice]]) were pushed to
  production on 2026-10-20 for the walk, before any merge. The founder then parked the feature the
  same day, so the files are on `feat/b-own-voice` and not on `main`.
- **What main's files see.**
  - `migration list` from main's `supabase/` shows 0000–0065 local == remote, then 0066 and 0067
    with an empty local column.
  - `db push --dry-run` from main's files **exits 1**: "Make sure your local git repo is up-to-date.
    If the error persists, try repairing the migration history table: supabase migration repair
    --status reverted 0066 0067".
  - So **the next migration anyone pushes from main is refused** until main has both files.
- **Do not follow the CLI's suggestion.** `repair --status reverted` would mark two applied
  migrations as unapplied while the enum values, the table and the nullable column stay in the
  database. It also writes the ledger, so it needs the founder's instruction anyway
  (`.claude/rules/migrations.md` rule 10).
- **The fix (not done; the founder's call):** put `supabase/migrations/0066_own_voice_enum_values.sql`
  and `0067_voice_recordings.sql` on main without the feature. With them should go the
  `PORTABLE_MIGRATIONS` entries and migration tests, the `schema.ts` lines (the `scribe` and
  `stt_seconds` enum values, the `voice_recordings` table, the nullable `audio_renders.voice_id`)
  and the two `verify-migration-ledger.sql` rows.
- **Why the schema half is harmless on main.**
  - The enum values are unused there.
  - `voice_recordings` is RLS-on with no policy, and nothing on main reads it.
  - Each own-voice approval leaves one voiceless `audio_renders` row, and there are two today.
    Main's `observedWordsPerSecond` has no `isNotNull(voiceId)` filter, so it groups them under a
    null voice. That group has 2 samples, under `applyWordsPerSecond`'s `minSamples` 3. A **third**
    voiceless row would let main's `aiugc calibrate` write a rate under a null voice key into
    `app_config.words_per_second`. The branch's filter prevents that once it merges, and so would
    taking the filter to main along with the files.
  - Main's janitor does not know `voice_recordings`, so the walk's two raw uploads and two
    processed files stay in storage until the branch merges or someone removes them.

## Related

- [[production-migration-push-log]]
- [[own-voice-first-production-runs-2026-10-20]]
