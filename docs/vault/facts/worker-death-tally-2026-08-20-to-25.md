---
type: fact
status: verified
verified: 2026-08-26
method: "python/grep extraction over C:/Users/USER/.claude/projects/C--Users-USER-Documents-AIUGC/6190e778-*.jsonl and e2ca9854 search hits (the sessions babysitting the worker computed each uptime from pino 'worker started'/'worker crashed' timestamps in the worker terminal); machine attribution: pino hostname field in the crash lines + read-only `select locked_by, count(*), min(locked_at), max(locked_at) from jobs group by locked_by`; stranded-job cross-check: `select … from jobs where last_error like 'lease expired%'` (3 rows) — both via packages/core/.work scratch tsx"
source: code
---

# The pre-fix worker died at least 13 times in six days — all on the dev machine

The vault's defect note counted **two** deaths, because it counted `lease expired` markers in
`jobs.last_error` — deaths that stranded a claimed job. The fuller fingerprint is the worker's own
pino `worker crashed` lines, tallied live by the sessions that kept restarting it. That tally
reached **thirteen failures between 2026-08-20 and 2026-08-25** — and the stranded-job markers are
disjoint from it, not a subset. Both of the defect note's markers predate the tally's start
(deaths of 08-17 and 08-19/20, reclaims logged 08-17 02:05Z and 08-20 01:47Z), and a third marker
found today — `a7d427ab`, the `reap_dead_renders` singleton, locked by `local:light`, reclaimed
2026-08-25 10:57Z — evidences one more death after the tally's last row. **Known deaths overall:
≥16, of which three stranded a claimed job.** The tallied thirteen all hit idle-polling lanes and
left no queue-side trace, which is why the queue evidence undercounted five-plus-fold.

| #   | crashed (UTC)                   | error logged at death                               | uptime (min) |
| --- | ------------------------------- | --------------------------------------------------- | ------------ |
| 1   | 2026-08-21 01:10:44 (PID 11012) | `read ECONNRESET`                                   | 147.4        |
| 2   | 2026-08-21 02:45:02 (PID 26132) | `read ECONNRESET`                                   | 92.7         |
| 3   | 2026-08-21 05:42:12 (PID 26264) | `read ECONNRESET`                                   | 171.5        |
| 4   | 2026-08-21 10:44:09             | `read ECONNRESET`                                   | 59.1         |
| 5   | 2026-08-21 15:43:13             | `write CONNECT_TIMEOUT aws-1-…pooler.supabase.com`  | 179.0        |
| 6   | window 08-21 → 08-22            | **none logged** — external kill, cause undetermined | ~387.5       |
| 7   | 2026-08-22 11:44:43             | `canceling statement due to statement timeout`      | 751.4        |
| 8   | 2026-08-22 20:55:39             | `read ECONNRESET`                                   | 127.9        |
| 9   | 2026-08-22 23:05:55             | `read ECONNRESET`                                   | 129.5        |
| 10  | reported 08-23 17:31            | `getaddrinfo ENOTFOUND aws-1-…pooler.supabase.com`  | 224.8        |
| 11  | between 08-23 and 08-24         | not recovered from surviving transcripts            | ?            |
| 12  | reported 08-24 15:42            | `read ECONNRESET`                                   | 868.7        |
| 13  | reported 08-25 01:01            | `read ECONNRESET`                                   | 170.9        |

Row 11 is inferred only from the babysitting session calling row 12 "the twelfth failure"; its
detail row did not survive. Rows 10/12/13 carry the report time, not the crash time. Row 6's ~387.5
is last-log-minus-start (the session's summary rounded it to "393"); with no `worker crashed` line
it is the one death that did NOT go through the fatal claim/settle path — external termination,
**consistent with OOM, machine sleep, or a manual kill; not established which.**

## All of it was this machine

- Every logged crash line carries pino's `"hostname":"DESKTOP-1ELVETN"` — this Windows dev machine
  (today's local test runs print the same hostname).
- Each death was followed in the same terminal by pnpm's
  `C:\Users\USER\Documents\AIUGC\apps\worker: ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` — the worker was
  `pnpm --filter @aiugc/worker dev` in a local terminal.
- `jobs.locked_by` has only ever held four values: `local:light` (142 claims, since 2026-07-23),
  `local:heavy` (66), `cli:light` (10), `cli:heavy` (4). `WORKER_ID=local` is this machine's env.
  **No server box has ever claimed a job.**

## Not lid-closes, not Ctrl-C — at least not the logged ones

Ctrl-C is excluded for the eleven crashes with recovered crash lines: SIGINT takes the graceful abort path and prints
`worker stopped`, exit 0 — these printed a pino `worker crashed` with an error object and exited 1.
Machine sleep as the _trigger_ (sleep kills the socket, the wake-up poll eats the reset) cannot be
excluded in general, but crashes 1 and 2 landed inside an active development window — git commits
at 00:23Z and 01:25Z bracket crash 1, and a merge commit followed crash 2 by six minutes — so at
least those two hit a machine that was demonstrably awake and in use. For the rest, awake-state is
not establishable from what survives.

Four distinct error strings (`ECONNRESET` ×8, `CONNECT_TIMEOUT`, `statement timeout`, `ENOTFOUND`)
all died through the same unguarded claim/settle path — fixed 2026-08-26, `c46131d`
([[worker-exits-on-a-dropped-connection]]). Post-fix, each of these becomes a warn line and a
retry; the warn-line rate in the worker log now measures the drop frequency directly.

## Re-measure with

```
grep -c "claim failed — retrying" <worker log>   # post-fix drop rate
```

and for the historical tally:

```
python -c "import re
for line in open(r'C:/Users/USER/.claude/projects/C--Users-USER-Documents-AIUGC/6190e778-e48e-4b8a-802a-3756235ccf97.jsonl',encoding='utf-8',errors='replace'):
    for m in re.finditer(r'uptime', line): print(line[max(0,m.start()-260):m.end()+30])"
```
