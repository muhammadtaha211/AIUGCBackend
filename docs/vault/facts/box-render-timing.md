---
type: fact
status: verified
verified: 2026-08-27
method: "pnpm --filter @aiugc/remotion render:sample:a on the Hetzner box, RENDER_CONCURRENCY hand-edited to 4 (uncommitted); figure is the script's own 'wrote … in Ns' line"
source: code
---

# sample-a renders in 45s on the 4-vCPU box

Hetzner CPX32 (4 shared AMD vCPU, 8 GB, Ubuntu 24.04), quiet — no other work on
the machine. Output: 17s, 1080x1920, the ServiceA sample composition.
`freemem` at render start was 7,072,841,728 bytes; the OffthreadVideo cache pin
was the usual 536,870,912.

Warm run: Chrome Headless Shell and the ffmpeg fixtures were already on disk
from an earlier attempt, so this excludes the one-time ~92 MB download and the
fixture encode.

For contrast, the numbers already in the comment above `RENDER_CONCURRENCY` in
`packages/remotion/src/render.ts` — 87s at 6 tabs, 174s at the default — were
taken 2026-08-23 on the founder's 8-thread desktop while it was **busy**. The
box being faster at fewer tabs is therefore not a clean hardware comparison.
What it does establish: the box is not a bottleneck at this size.

## Not measured

- Concurrency 2 on this box (the run that produced 45s used 4).
- Wall clock for the whole command including the webpack bundle — only the
  script's own render figure was captured.
- A cold run (Chrome download + fixture encode included).
- ServiceASteps or ServiceB on this box.
- Any full customer render. `docs/02-jobs.md` sizes those at 2–6 min against a
  17s fixture, so this figure does **not** extrapolate.
- Any render claimed by the systemd service's heavy lane. Every render on this
  box so far was typed by hand in an SSH session.
