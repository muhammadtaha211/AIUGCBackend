---
type: defect
status: verified
verified: 2026-08-23
method: "read packages/remotion/src/serve-files.ts:54-72 line by line against RFC 7233; the regex evaluated in isolation with node -e"
source: code
---

# `serve-files.ts` answers a suffix Range request with the wrong bytes — and nothing sends one

**Severity: latent nit.** Recorded because the handover filed it as "mishandles HTTP Range
requests", which implies renders break. They do not.

## The one real bug

```ts
// packages/remotion/src/serve-files.ts:54
const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
// :61-62
const start = match[1] ? Number(match[1]) : 0;
const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
```

Both capture groups are `\d*`, so the suffix form `bytes=-500` — RFC 7233 §2.1, meaning **the last
500 bytes** — matches with group 1 empty and group 2 = `500`. Line 61 then reads that as `start =
0` and line 62 as `end = 500`. The 416 guard at `:63` does not fire (`0 < size`, `500 >= 0`), so
`:67-72` emits `206` with `content-range: bytes 0-500/<size>` and streams **the first 501 bytes** —
the opposite end of the file, presented as a valid partial response.

## Everything else in the parser is correct

Checked each form against RFC 7233 individually:

| request              | behaviour                                        | verdict                             |
| -------------------- | ------------------------------------------------ | ----------------------------------- |
| `bytes=500-`         | `end = size-1` → `206 bytes 500-999/1000`        | correct                             |
| `bytes=1500-`        | `:63` → `416` with `content-range: bytes */1000` | correct (§4.4)                      |
| `bytes=0-99,200-299` | fails the regex → `200` with the whole body      | legal (§3.1 permits ignoring Range) |
| `bytes=-500`         | `206` with the first 501 bytes                   | **wrong**                           |

Two further deviations, both harmless and both unreachable: `bytes=100-50` returns 416 where the RFC
says an invalid spec should be ignored (200), and `bytes=-0` returns a 1-byte 206 where a zero
suffix-length is unsatisfiable (416).

## Why it has never bitten

The only client is the headless Chrome the Remotion renderer drives against a server bound to
`127.0.0.1` on an ephemeral port. Chromium's media stack requests right-unbounded ranges
(`bytes=<pos>-`) and does not emit suffix ranges. Corroborated by outcome rather than by reading
Chromium: `packages/remotion/test/frame-delivery.test.ts` drives a real bundle and a real headless
render through this server, and it is green at HEAD ([[gate-results]]).

Caveat on that: I did not capture live `Range` headers, because doing so would mean running a
render. What is measured is that the render works.

## Blast radius

None. Unreachable from the only client that exists, on a loopback-bound server that lives for the
duration of one render.

## Fix shape

Two lines at `:61-62` — branch on the suffix form before computing start and end:

```ts
const suffix = !match[1] && !!match[2];
const start = suffix ? Math.max(0, size - Number(match[2])) : match[1] ? Number(match[1]) : 0;
const end = suffix ? size - 1 : match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
```

Worth doing only as hygiene in a helper that advertises range support. It fixes nothing that is
broken today.

## Deliberately not fixed

Recorded, not fixed. The handover's framing was the thing worth correcting.
