---
type: decision
status: verified
verified: 2026-08-27
method: "Hetzner Cloud console at server creation; prices as displayed at the time"
source: founder
---

# Worker box: Hetzner CPX32, Nuremberg, Ubuntu 24.04

`docs/07-worker-box.md` defers instance size and region to a vault note. This is
it.

- **Location: Nuremberg.** Unchangeable after creation — Hetzner cannot move a
  server between locations. Falkenstein was equivalent; both are ~5ms to
  `eu-central-1`.
- **Type: CPX32** — 4 shared AMD vCPU, 8 GB, 160 GB NVMe, 20 TB traffic.
  Roughly $41/month, plus ~$0.72/month for the primary IPv4 (billed whether or
  not it is attached to a server).
- **Image: Ubuntu 24.04 LTS**, not the newer 26.04 on offer. §4's `…t64`
  package names and §12's unprivileged-user-namespace fix are both 24.04-specific.
- **x86, not ARM.** CAX was materially cheaper but Remotion's prebuilt Chrome
  Headless Shell and the ffmpeg path are far better trodden on x86. Untested on
  ARM; not worth the debugging surface at this stage.
- **No backups** (+20%/mo on a machine holding nothing that isn't in the repo,
  the `.env`, or Supabase). A one-off snapshot after §12 passes is the cheaper
  equivalent.
- **No Hetzner cloud firewall** — §3's `ufw` runs on the box, and two firewalls
  means two places to look when SSH stops working.

## Options considered

- **CX (cost-optimized).** Cheapest, EU-only, limited availability, weaker
  single-core. Rejected: the heavy lane renders one video at a time, so
  single-core throughput is what the render actually uses.
- **CCX (dedicated vCPU).** The better machine, and where Hetzner's own docs
  point CPU-saturating workloads. Rejected on duty cycle: `docs/02-jobs.md`
  sizes 300 renders/month at ~25 hours of CPU, about 3.5% of the month. Buying
  guaranteed cores for a box that idles 96% of the time is insurance against a
  problem that has not appeared. One rescale away if it does.
- **A smaller CPX to start.** Rejected after the fact — see
  [[render-concurrency-hardcoded-above-core-count]]. A 2-vCPU box could not
  have rendered at all until that constant was fixed.

## Rescaling later

CPU and RAM can be rescaled up or down; growing the disk is one-way and
permanently blocks any downgrade. Always take the "CPU and RAM only" option.
A powered-off server still bills in full — only deletion stops the meter.

## A stale figure this corrects

`docs/02-jobs.md` says "Hetzner CPX41-class, ~€30/mo flat". Hetzner raised cloud
prices on 15 June 2026 (CPX up roughly 2.4–2.75x in Germany/Finland), so that
number now understates by around half. Not yet corrected in that file.
