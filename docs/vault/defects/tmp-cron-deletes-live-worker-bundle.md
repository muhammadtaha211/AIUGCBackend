---
type: defect
status: verified
verified: 2026-09-02
method: "cause verified on the box: `crontab -l` (founder, 2026-09-01) shows `@daily find /tmp -maxdepth 1 -name 'remotion-*' -user aiugc -mmin +720 -exec rm -rf {} +` — remotion-webpack-bundle-* matches remotion-*, owner matches, 720min is the 12h threshold. Effect verified in prod db via packages/core/.work/inspect-tonight-renders.ts: render:4f324277… and render:92ecd773… both dead after 5 attempts, lastError 'Tried to serve the Webpack bundle … /tmp/remotion-webpack-bundle-7LrUmX/index.html does not exist'. Code path: render.ts memoized bundle() with no outDir -> @remotion/bundler 4.0.499 prepareOutDir mkdtemps under os.tmpdir() (dist/bundle.js:75)"
source: db + box crontab
---

# The box's /tmp cron deletes the live worker's webpack bundle; every render then fails until restart

## CLOSED 2026-09-02 — verified on the box, mechanism eliminated

```
$ ls -d ~/AIUGCBackend/.work/remotion-bundle; ls -d /tmp/remotion-webpack-bundle-* 2>/dev/null | wc -l
/home/aiugc/AIUGCBackend/.work/remotion-bundle
0
```

That is decisive, and it is decisive for a reason worth spelling out: the three renders that
had just run (02:36–03:02, [[service-a-render-wall-clock-on-the-box]]) were under three hours
old, and `@remotion/bundler` never deletes its own temp dirs. Had the running process been
bundling into `os.tmpdir()`, that directory would still have been sitting there — well under
the cron's 12h threshold — and the count would have been at least 1. It is 0, and the
repo-owned path exists. **The live worker is serving from `<repo>/.work/remotion-bundle`.**

The cron (`find /tmp -maxdepth 1 -name 'remotion-*' …`) only ever touches `/tmp`. With the
bundle outside `/tmp`, the causal chain is broken at the link that mattered: the janitor can
no longer reach the thing a long-lived process is serving from. `getBundle()`'s re-bundle heal
remains as a backstop for anything else that deletes it.

Not observed, and now a formality rather than a risk: a render succeeding more than 12h past
the restart, i.e. on the far side of a cron run. The mechanism is gone; that observation would
only be the calendar agreeing.

## The two-day detour, kept because it is the lesson

**2026-09-01 — closed on bad evidence.** The fix was committed (`9543cc3`) and this note was
marked FIXED the same night, on the strength of a render succeeding afterwards. It had not
been deployed. Full autopsy: [[bundle-fix-reached-the-worker-box]].

**2026-09-02 — reopened by a fourth death.** Render `bb8a3c51-610c-4687-8e1f-abbcf296158d`
died 5/5 with a **`/tmp`** bundle path (`…-0iONhy`). Code carrying `9543cc3` cannot produce
that path, and its heal would have rescued attempt 2 of 5 — so the box was provably running
pre-fix code. It was sitting at `48584e7`, the merge's other parent.

**2026-09-02 — actually deployed.** `48584e7 → af158cb`; the pull's own diff carried
`packages/remotion/src/render.ts` (+35) and created `packages/remotion/test/bundle-heal.test.ts`,
which is itself the proof the box had never had them.

The rule, now in `docs/07-worker-box.md` §11: **a succeeding render is not evidence a deploy
landed** — a restart alone produces one, because the old code rebuilds a fresh `/tmp` bundle
that survives until the next midnight-plus-12h. Verify the artifact (`git log -1 --oneline`),
or verify the mechanism (the `ls` above). Never the symptom.

## The code fix, 2026-09-01 (deployed and verified on the box 2026-09-02)

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
