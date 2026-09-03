---
type: decision
status: verified
verified: 2026-09-03
method: "founder ran on the Hetzner box (user aiugc), 2026-09-03 -- grep -c for the claim-failed and lease-sweep-failed markers over `journalctl -u aiugc-worker -o cat` (exact commands in the body): both zero. Journal window: first entry 2026-08-27T08:06:56+00:00, the box unit's first start, through 2026-09-03, 9,996 worker lines total."
source: founder
---

# 0016 — `apps/worker` stays on the transaction pooler, port 6543

## The decision

`apps/worker/.env`'s `DATABASE_URL` stays on port 6543, Supabase's transaction pooler. This closes
the question `docs/07-worker-box.md` §12 and `docs/08-supabase-project-rebuild.md` §2 both
deferred until the box had a week of production runtime.

## The measurement

Founder-run on the Hetzner box (user `aiugc`), 2026-09-03:

```
journalctl -u aiugc-worker -o cat | grep -c '"claim failed'          # -> 0
journalctl -u aiugc-worker -o cat | grep -c '"lease sweep failed'    # -> 0
```

Zero of either drop marker across the unit's full journal on the box: first entry
`2026-08-27T08:06:56+00:00` (the unit's first start there) through 2026-09-03, 9,996 worker lines
in total — call it a week.

**Reasoned, not measured:** how many poll attempts that window represents. The worker polls every
`pollIntervalMs` (default `2000`, `packages/core/src/jobs/worker.ts`), two lanes running — over
~7 days that is on the order of 600,000 claim attempts. That count was not read off the journal; it
is derived from the poll interval and the wall-clock window, and stated here as an estimate, not a
measurement.

## Contrast with the desktop

The desktop tally ([[worker-death-tally-2026-08-20-to-25]]) found **at least 13 deaths in six
days** under the pre-fix worker, across four distinct error strings including
`getaddrinfo ENOTFOUND aws-1-…pooler.supabase.com` and
`write CONNECT_TIMEOUT aws-1-…pooler.supabase.com` — both against the same pooler class this
decision keeps the box on.

**Reasoned, not measured:** that those desktop deaths trace to the desktop's own network and sleep
behaviour rather than to port 6543 itself. The two environments differ on more than the port — a
Windows laptop that sleeps and roams networks, against a Hetzner box on a fixed connection — and
this decision does not isolate which difference caused which failure. The box's zero-drop week is
real evidence that 6543 is survivable under `c46131d`'s guard; it is not evidence that the
desktop's `ENOTFOUND`/`CONNECT_TIMEOUT` pattern was network-caused rather than pooler-caused. The
original defect note already flagged this same gap for the two stranded-job deaths it analysed —
this decision inherits it rather than closing it.

## What actually settles the question

`c46131d` (`worker-exits-on-a-dropped-connection.md`) made a claim failure non-fatal — log, sleep,
retry — instead of a crash. The zero count above is therefore not "the pooler never drops the
box's connections"; it is "if it does, nothing shows up as a drop line and nothing crashes." That
is the bar the deferred queue item asked to clear, and it clears it.

## Related

[[worker-exits-on-a-dropped-connection]] — the fix this decision measures the outcome of.
[[worker-death-tally-2026-08-20-to-25]] — the desktop baseline contrasted against, above.
