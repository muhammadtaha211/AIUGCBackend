---
type: defect
status: verified
verified: 2026-08-27
method: "pnpm --filter @aiugc/remotion render:sample:a on a 4-vCPU Hetzner CPX32; thrown by resolveConcurrency before any frame rendered"
source: code
---

# A fixed RENDER_CONCURRENCY of 6 crashes any box with fewer than 6 cores

`packages/remotion/src/render.ts` hardcoded `RENDER_CONCURRENCY = 6`, its
comment describing it as pinned for the founder's 8-thread desktop. Remotion
refuses any concurrency above the machine's core count:

    Error: Maximum for --concurrency is 4 (number of cores on this system)
      at resolveConcurrency (@remotion/renderer 4.0.499)

It throws inside `renderMedia` before a single frame is rendered, so nothing
partial is produced and nothing is retryable.

`runRender` is shared, so this took out all three entrypoints — `renderServiceA`,
`renderServiceASteps`, `renderServiceB` — plus `frame-delivery.test.ts`, which
renders for real. On a 4-core box, `pnpm --filter @aiugc/remotion test` could
not pass either.

The class is what matters: a constant tuned on the founder's hardware, with the
tuning value hardcoded rather than derived, silently encoding "at least 6 cores"
as a requirement of the whole render path. It survived because every machine
that had run a render until now had eight threads.

Found while working through [[0007-worker-box-instance]]'s §12 acceptance test
on the first non-desktop machine the renderer had ever run on.

## FIXED

Replaced with `Math.min(6, cpus().length)` — reproduces 6 on the 8-thread
desktop and 4 on the box, and cannot exceed Remotion's cap on any machine.
Guarded by an assertion in `packages/remotion/test/render-args.test.ts`.

Timing after the fix: [[box-render-timing]].

Note the original comment's rationale — leave ~2 threads spare to feed the
encoder pipe and offthread compositor — is **not** satisfied at 4 cores, where
the formula leaves zero. The 45s result says it is not hurting there. Unverified
below 8 threads.
