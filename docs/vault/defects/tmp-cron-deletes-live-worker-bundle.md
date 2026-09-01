---
type: defect
status: verified
verified: 2026-09-01
method: "code path: render.ts memoized bundle() with no outDir -> @remotion/bundler 4.0.499 prepareOutDir mkdtemps under os.tmpdir() (dist/bundle.js:75); docs/07-worker-box.md §9 cron rm -rf's /tmp/remotion-* at -mmin +720; worker is a long-lived systemd service (§10). Incident reported by the founder in chat 2026-09-01: every Service A render on the box failing with the serve-bundle error"
source: code
---

# The box's /tmp cron deletes the live worker's webpack bundle; every render then fails until restart

## FIXED 2026-09-01 (same commit as this note)

`packages/remotion/src/render.ts` now passes a fixed, repo-owned `outDir` to `bundle()` —
`<repo>/.work/remotion-bundle` — so the bundle never lives in `os.tmpdir()` and no temp janitor
can reach it. `getBundle()` also heals: if the memoized directory's `index.html` is gone, it
re-bundles instead of failing every render until the process restarts. Both behaviors are pinned
by `packages/remotion/test/bundle-heal.test.ts` (mocked, keyless); `frame-delivery.test.ts` ran
green with a real bundle at the new location (54.9s, founder's desktop), and `%TEMP%` gained zero
new `remotion-webpack-bundle-*` dirs during that run. `docs/07-worker-box.md` §9 was rewritten in
the same change: the cron stays as a backstop for `remotion-v4.0.499-assets*` shells, which still
land in `/tmp`, and the bundle is out of its blast radius.

One caveat the fix accepts: two processes on one checkout (worker dev + a `render:sample` on the
desktop) share the directory. The overlap window is a seconds-long webpack run writing the same
filenames with the same content; the worst case is a torn read failing one render as transient,
which retries. The box runs exactly one worker process, so it has no window at all.

---

## The incident

Every Service A render on the Hetzner worker box failing with:

```
remotion render failed: Tried to serve the Webpack bundle on a HTTP server, but the file
/tmp/remotion-webpack-bundle-7LrUmX/index.html does not exist.
```

## Three deliberate choices conspire

1. **Bundle once per process.** `render.ts` memoizes `bundlePromise` — webpack is the slow part,
   renders are not. The bundle directory therefore has to outlive the *process*, not a render.
2. **No `outDir`.** `bundle()` was called bare, so `@remotion/bundler` mkdtemps
   `/tmp/remotion-webpack-bundle-*` and never deletes it — that is
   [[remotion-temp-dirs-are-never-cleaned-up]].
3. **The §9 cron.** The mitigation for that leak — `@daily find /tmp -maxdepth 1 -name
   'remotion-*' -mmin +720 -exec rm -rf {} +` — deletes any remotion dir older than 12 hours.

The cron's `-mmin +720` guard was designed around renders ("an in-flight render's dir is always
younger"), but the thing it deletes is keyed to process lifetime. The worker is a systemd service
that runs for weeks, so within 12–36 hours of any restart the cron deletes the bundle out from
under it. The memoized promise keeps resolving to the dead path; the provider classifies the
failure as transient (correctly — a restart does fix it), so jobs retry into the same process and
the same dead path, forever. The leak mitigation converted "disk fills in weeks" into "renders die
daily until someone restarts the service".

## What the fix has to hold

Any janitor — cron, `%TEMP%` clearing, a helpful cleanup script — must never be pointed at a
directory a long-lived process is still serving from. The repo-owned `outDir` moves the bundle
out of every janitor's patrol; the heal in `getBundle()` is the backstop for whatever deletes it
anyway.
