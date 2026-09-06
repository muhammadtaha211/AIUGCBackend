---
type: fact
status: verified
verified: 2026-09-06
method: "ssh aiugc@<box> 'cd ~/AIUGCBackend && git rev-parse --abbrev-ref HEAD && git log -1 --oneline && systemctl is-active aiugc-worker' -> main / 4e000e3 / active, against origin/main 6aad2f0 (PR #22). Claimant from prod db: select idempotency_key, locked_by from jobs where idempotency_key like '%4f0d448a%' -> both rows hetzner:heavy. Output judged by downloading video_renders.file_path for 4f0d448a and extracting frames at 0.00/0.30/0.65/0.90/1.10/1.60/3.00s with ffmpeg."
source: db + code
---

# The hook effect was missing from the first wizard render because the box was 14 commits behind

The founder picked `zoom` in the B wizard on 2026-09-06 and the released ad had
no zoom and no burned hook line. Nothing in the branch's code is wrong: the
render ran on a checkout that predates the feature.

## What was measured

| thing                                                      | value                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| `video_renders` 4f0d448a…, `params.hookEffect`             | `"zoom"` — stored correctly by the web app                  |
| `params.hookText` / `hookTextSafeArea`                     | both present, both correct                                  |
| `jobs.locked_by` for `lipsync:` and `render:`              | **`hetzner:heavy`** on both — the box rendered it           |
| box `git rev-parse --abbrev-ref HEAD`                      | `main`                                                      |
| box `git log -1 --oneline`                                 | **`4e000e3`**                                               |
| `origin/main`                                              | `6aad2f0` (PR #22, merging service-b-wizard) — **14 ahead** |
| `git cat-file -e 4e000e3:packages/core/src/hook-effect.ts` | fails — the file does not exist on that commit              |

`4e000e3` has 0 occurrences of `hookAnimationProps` in `pipelines/renders.ts`,
0 of `hookEffect` in `pipelines/sets.ts`, and no `step-effect.tsx` at all.

## Why the frames look exactly like that

On `4e000e3` the composition burns `<HookLine>` only inside the `hasOpener`
branch and `serviceBTimeline` gives `hookTextMs` a value only when `hasOpener`.
So a render carrying `hookText` with no `openerClipId` produces precisely the
observed file — **no line, no move, captions from `captionOffsetMs` (250ms)
onward** — with `params.hookEffect` read by nothing. Frames at t=0.00s and
t=1.60s are at identical scale; a live zoom would differ by 35%.

Under current code the same row yields `hookTextMs 3450` and
`hookZoom {from 1.35, to 1.42, atMs 650, durationMs 450}`.

## The rule this is the third instance of

Vercel deploys itself; the box is `git pull` + restart by hand
(`docs/07-worker-box.md` §11), so **the web app and the worker can run different
code and nothing anywhere says so**. A customer then picks a feature the web
knows about and the worker silently ignores it — no error, no failed job, a
released ad that is merely wrong. Compare
[[bundle-fix-reached-the-worker-box]] (deploy believed done, was not) and
[[stale-process-seam]] (a long-lived process serving old code). The check is
the same one docs/07 §11 already prescribes and that was not run here:

```
ssh aiugc@<box> 'cd ~/AIUGCBackend && git log -1 --oneline && systemctl is-active aiugc-worker'
```

## Related

- [[0024-hook-effect-is-a-render-param-the-customer-picks]]
- [[hook-caption-handoff-swallows-an-unmatched-opening]]
