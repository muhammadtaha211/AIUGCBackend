---
type: defect
status: verified
verified: 2026-09-01
method: "select over jobs/video_renders via packages/core/.work/inspect-tonight-renders.ts: render:4f324277… and render:92ecd773… both dead after 5 attempts, lastError 'Tried to serve the Webpack bundle … /tmp/remotion-webpack-bundle-7LrUmX/index.html does not exist'"
source: db
---

# The box's /tmp cleanup cron deletes the live worker's memoized Remotion bundle

## What is verified

The two newest Service A renders on prod are dead with the identical error and the
**identical bundle directory**:

- `render:4f324277…` — created 2026-09-01 03:54Z, dead after 5 attempts
- `render:92ecd773…` — created 2026-08-28 19:51Z, dead after 5 attempts
- both: `remotion render failed: Tried to serve the Webpack bundle on a HTTP
  server, but the file /tmp/remotion-webpack-bundle-7LrUmX/index.html does not
  exist.`
- the last successful render was 2026-08-27 10:40Z.

Same directory name across four days proves one worker process has held one
memoized bundle path since before 2026-08-28
([[remotion-temp-dirs-are-never-cleaned-up]]: `bundlePromise ??=` — one bundle
per process lifetime), and that the directory no longer exists.

## The inferred cause (source: inference — not verified on the box)

`docs/07-worker-box.md` §9 installs a `@daily` cron on the Hetzner box:
`find /tmp -maxdepth 1 -name 'remotion-*' -user aiugc -mmin +720 -exec rm -rf {} +`
— the mitigation for [[remotion-temp-leak-filled-the-disk]]. A worker process
that lives past 12h has its own bundle directory aged into deletion. The
mitigation for the leak defect is what kills the renders. Not verified: the
box's crontab and worker process start time were not inspected for this note.

## Consequence

Every render on the box fails (5 attempts, then dead → fail+refund machinery)
until the worker process restarts and re-bundles. Restarting the worker is the
interim repair; every restart also re-leaks one directory, which is the original
defect's loop.

## Not fixed

Recorded 2026-09-01, not fixed — the fix belongs in `packages/remotion`
(`render.ts`: pass a repo-owned `outDir`, or re-bundle when the memoized path no
longer exists), which was out of scope for the incident that surfaced this
([[raw-sql-date-params-crash-postgres-js]]). The "Fix shape" section of
[[remotion-temp-dirs-are-never-cleaned-up]] retires this defect and the leak at
once.
