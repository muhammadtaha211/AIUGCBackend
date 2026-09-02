---
type: falsified
status: verified
verified: 2026-09-02
method: "prod db, packages/core/.work/diag-failed-render.ts over the session pooler: render bb8a3c51 (created 2026-09-02T01:57:36Z) died after 5/5 attempts, error_class transient, last_error 'Tried to serve the Webpack bundle on a HTTP server, but the file /tmp/remotion-webpack-bundle-0iONhy/index.html does not exist'. A /tmp path cannot be produced by 9543cc3, whose single bundle() call passes outDir: <repo>/.work/remotion-bundle (packages/remotion/src/render.ts:191,205)."
source: db + code
supersedes: "[[tmp-cron-deletes-live-worker-bundle]]"
---

# Falsified: "the bundle outDir fix was deployed to the box on 2026-09-01"

## The claim

[[tmp-cron-deletes-live-worker-bundle]] was closed the same day it was written, with:

> Deployed to the box the same night (§11 run, worker restarted); a full wizard render then
> completed end to end.

`docs/07-worker-box.md` §9 was rewritten on the strength of it, and now states as fact that the
bundle "lives at `/home/aiugc/AIUGCBackend/.work/remotion-bundle` — one directory, overwritten in
place, never in `/tmp`".

## What killed it

The next Service A render after that, on 2026-09-02, died the same death — and the path in the
error is still under `/tmp`:

| render      | created (UTC)    | outcome             | bundle dir in last_error |
| ----------- | ---------------- | ------------------- | ------------------------ |
| `92ecd773…` | 2026-08-28 19:51 | dead 5/5            | `/tmp/…-7LrUmX`          |
| `4f324277…` | 2026-09-01 03:54 | dead 5/5            | `/tmp/…-7LrUmX`          |
| `56adb04e…` | 2026-09-01 04:41 | **succeeded**, 0.92 | —                        |
| `bb8a3c51…` | 2026-09-02 01:57 | dead 5/5            | `/tmp/…-0iONhy`          |

Two independent proofs that the process serving `hetzner:heavy` on 2026-09-02 was **not** running
`9543cc3`:

1. **The path.** There is exactly one `bundle()` call in the repo and it passes
   `outDir: BUNDLE_OUT_DIR` (`packages/remotion/src/render.ts:205`). Code with that line cannot
   mkdtemp under `/tmp`.
2. **The heal.** `getBundle()` re-bundles when the memoized directory's `index.html` has vanished
   (`render.ts:194-203`), so attempt 2 of 5 would have succeeded. All five failed identically.

## Why the original evidence looked like proof and was not

The successful render at 2026-09-01 04:41 was read as "the fix works in production". A **restart
alone** produces exactly that result: the old code mkdtemps a _fresh_ `/tmp` bundle on process
start, and every render works until the `@daily` cron deletes it once it is over 12h old. The
success is equally explained by the restart, and the new directory name (`0iONhy`, not the
four-day-old `7LrUmX`) shows a restart is what happened.

The 2026-09-02 failure is the same clock as before: bundle born ~04:41 on 09-01, midnight cron on
09-02 finds it ~19h old, deletes it, the 01:57 render dies.

## When it did become true

2026-09-02, one day later: a real §11 deploy (`48584e7 → af158cb`), and then the check that
should have been run the first time —

```
$ ls -d ~/AIUGCBackend/.work/remotion-bundle; ls -d /tmp/remotion-webpack-bundle-* 2>/dev/null | wc -l
/home/aiugc/AIUGCBackend/.work/remotion-bundle
0
```

Note what that check does and the original did not: it observes the **mechanism** (where the
bundle physically is) rather than the **symptom** (a render working). See
[[tmp-cron-deletes-live-worker-bundle]] for the closing evidence.

## The rule this is the second instance of

A deploy is not verified by the system working afterwards. **Verify the deployed artifact, not the
symptom** — for this one, `ssh aiugc@<box> 'cd ~/AIUGCBackend && git log -1 --oneline'` and
`ls -d ~/AIUGCBackend/.work/remotion-bundle`, either of which would have caught it in seconds.
Compare [[stale-process-seam]]-shaped mistakes elsewhere: a long-lived process keeps serving old
code, and green tests on the desktop say nothing about it.
