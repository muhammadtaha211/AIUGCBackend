---
type: fact
status: verified
verified: 2026-08-26
method: "aiugc business create → demo ingest (steps-demo.mp4) → desktop worker (pnpm --filter @aiugc/worker dev, WORKER_ID=local, DRY_RUN=1) → select from jobs/storage.objects → GET /storage/v1/object/raw/... with the service key"
source: db
---

# The new project's Storage takes real pipeline writes and serves them back

Until 2026-08-26 only Postgres had been proven on the new project
(`hyaqydcmwbnbaiqqufow`); Storage had never seen a write. One real job run through the desktop
worker closed that gap, at zero paid-API cost (`usage_events` count: 0):

- `aiugc business create` → business `69af5781-…` (also the first `users` row).
- `aiugc demo ingest packages/remotion/public/fixtures/steps-demo.mp4` → **CLI-side upload of
  the real 1,701,206-byte mp4 into `raw`** (createDemo uploads unconditionally, DRY_RUN or not).
- Desktop worker claimed and succeeded, attempts 0, no errors: `ingest_demo` (`local:light`),
  `analyze_demo` (`local:heavy`), `group_analysis_states`, plus the startup `janitor` (0
  deletions) and `billing_renewals` (0 renewals). Under DRY_RUN, `analyze_demo` performs **12
  real worker-side uploads** of placeholder state thumbs into `assets`
  (`demo-analysis.ts:390-405` — the DRY_RUN branch returns before the questionnaire gate, so no
  questionnaire was needed).
- `storage.objects`: 13 rows — the mp4 in `raw` + 12 thumbs in `assets`.
- Read-back: authenticated GET of the raw mp4 returned **200 with 1,701,206 bytes** —
  byte-exact round trip.

Preconditions created the same day, minutes earlier (they did not exist after `db push` alone):
the four buckets per `docs/08-supabase-project-rebuild.md` §5 (no migration creates buckets) and
the §6A grants (SELECT on `businesses`/`users` to `authenticated`). The project-level upload
limit (§5, dashboard-only) was still at its 50 MB default at the time of this test — the 1.7 MB
fixture never touched it, so that ceiling remains unverified.

The smoke rows (`Storage Smoke` business, demo `05f33a68-…`, 13 objects) were deliberately left
in place as the record of this run.

Related: [[new-project-region-eu-central-1]], [[storage-census-2026-08-26]] (the old project's
inventory this rebuild replaces).
