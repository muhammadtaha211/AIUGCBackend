---
type: defect
status: verified
verified: 2026-09-02
method: "cause verified on the box: `crontab -l` (founder, 2026-09-01) shows `@daily find /tmp -maxdepth 1 -name 'remotion-*' -user aiugc -mmin +720 -exec rm -rf {} +` — remotion-webpack-bundle-* matches remotion-*, owner matches, 720min is the 12h threshold. Effect verified in prod db via packages/core/.work/inspect-tonight-renders.ts: render:4f324277… and render:92ecd773… both dead after 5 attempts, lastError 'Tried to serve the Webpack bundle … /tmp/remotion-webpack-bundle-7LrUmX/index.html does not exist'. Code path: render.ts memoized bundle() with no outDir -> @remotion/bundler 4.0.499 prepareOutDir mkdtemps under os.tmpdir() (dist/bundle.js:75)"
source: db + box crontab
---

# The box's /tmp cron deletes the live worker's webpack bundle; every render then fails until restart

## REOPENED 2026-09-02 — fixed in the repo, NOT running on the box

Render `bb8a3c51-610c-4687-8e1f-abbcf296158d` (created 2026-09-02T01:57:36Z) died 5/5 with the
identical error and a **`/tmp`** bundle path (`/tmp/remotion-webpack-bundle-0iONhy`). Code carrying
`9543cc3` cannot produce that path, and its heal would have rescued attempt 2 of 5 — so the box is
running pre-fix code. The "deployed the same night" claim below is disproved and recorded in
[[bundle-fix-reached-the-worker-box]]; the 2026-09-01 04:41 success it rested on is fully explained
by the worker restart alone, which is the same temporary remedy this defect always had.

**The remedy is unchanged and unrun:** `cd ~/AIUGCBackend && git pull && pnpm install && sudo
systemctl restart aiugc-worker` (docs/07-worker-box.md §11), then verify the ARTIFACT rather than
the symptom — `git log -1 --oneline` on the box shows `9543cc3` or later, and
`ls -d ~/AIUGCBackend/.work/remotion-bundle` exists after the next render. Note that
`docs/07-worker-box.md` §9 currently describes the fixed behaviour as present tense; it is
describing the repo, not the box.

## The code fix, 2026-09-01 (in the repo, unverified in production)

`packages/remotion/src/render.ts` now passes a fixed, repo-owned `outDir` to `bundle()` —
`<repo>/.work/remotion-bundle` — so the bundle never lives in `os.tmpdir()` and no temp janitor
can reach it. `getBundle()` also heals: if the memoized directory's `index.html` is gone, it
re-bundles instead of failing every render until the process restarts. Both behaviors are pinned
by `packages/remotion/test/bundle-heal.test.ts` (mocked, keyless); `frame-delivery.test.ts` ran
green with a real bundle at the new location (54.9s, founder's desktop), and `%TEMP%` gained zero
new `remotion-webpack-bundle-*` dirs during that run. `docs/07-worker-box.md` §9 was rewritten in
the same change: the cron stays as a backstop for `remotion-v4.0.499-assets*` shells, which still
land in `/tmp`, and the bundle is out of its blast radius. Deployed to the box the same night
(§11 run, worker restarted); a full wizard render then completed end to end.

One caveat the fix accepts: two processes on one checkout (worker dev + a `render:sample` on the
desktop) share the directory. The overlap window is a seconds-long webpack run writing the same
filenames with the same content; the worst case is a torn read failing one render as transient,
which retries. The box runs exactly one worker process, so it has no window at all.

---

## The incident — verified in the prod db

The two newest Service A renders were dead with the identical error and the **identical bundle
directory**:

- `render:4f324277…` — created 2026-09-01 03:54Z, dead after 5 attempts
- `render:92ecd773…` — created 2026-08-28 19:51Z, dead after 5 attempts
- both: `remotion render failed: Tried to serve the Webpack bundle on a HTTP server, but the file
/tmp/remotion-webpack-bundle-7LrUmX/index.html does not exist.`
- the last successful render before the fix was 2026-08-27 10:40Z.

Same directory name across four days proves one worker process held one memoized bundle path
since before 2026-08-28, and that the directory no longer existed.

## Three deliberate choices conspire

1. **Bundle once per process.** `render.ts` memoizes `bundlePromise` — webpack is the slow part,
   renders are not. The bundle directory therefore has to outlive the _process_, not a render.
2. **No `outDir`.** `bundle()` was called bare, so `@remotion/bundler` mkdtemps
   `/tmp/remotion-webpack-bundle-*` and never deletes it — that is
   [[remotion-temp-dirs-are-never-cleaned-up]].
3. **The §9 cron.** The mitigation for that leak — `@daily find /tmp -maxdepth 1 -name
'remotion-*' -mmin +720 -exec rm -rf {} +` (verified verbatim via `crontab -l` on the box,
   2026-09-01) — deletes any remotion dir older than 12 hours.

The cron's `-mmin +720` guard was designed around renders ("an in-flight render's dir is always
younger"), but the thing it deletes is keyed to process lifetime. The worker is a systemd service
that runs for weeks, so within 12–36 hours of any restart the cron deletes the bundle out from
under it. The memoized promise keeps resolving to the dead path; the provider classifies the
failure as transient (correctly — a restart does fix it), so jobs retry into the same process and
the same dead path, forever. The leak mitigation converted "disk fills in weeks" into "renders die
daily until someone restarts the service".

**Why it was intermittent rather than nightly:** the cron fires at midnight but only deletes dirs
older than 12 hours. A bundle built at 1pm is 11h old at that midnight and survives; it dies at
the _next_ midnight. So the failure window depended on when the worker last restarted, not on any
render pattern.

## What the fix has to hold

Any janitor — cron, `%TEMP%` clearing, a helpful cleanup script — must never be pointed at a
directory a long-lived process is still serving from. The repo-owned `outDir` moves the bundle
out of every janitor's patrol; the heal in `getBundle()` is the backstop for whatever deletes it
anyway.
