---
type: defect
status: verified
verified: 2026-09-18
method: "production read of jobs (id, attempts, last_error, created_at, updated_at, locked_at, run_at) and usage_events joined on job_id for job 85d9ec0b; the three level-40 lines of `journalctl -u aiugc-worker` (epoch ms 1789693024360 / 1789693124363 / 1789693256270); then packages/core/src/pipelines/demo-analysis.ts:660-732 and packages/core/src/jobs/queue.ts:225-260 read in the tree at f84e931; then @anthropic-ai/sdk 0.111.0 read in node_modules (helpers/zod.js:41, lib/parser.js:51-64, resources/messages/messages.js:67, client.js:110) to locate the double wrap"
source: db
---

# One bad enum value in one frame discards a whole analysis attempt

`analyze_demo` job `85d9ec0b-4ee0-44d2-9bff-c89e9e55b332`
(demo `3915c8e2-3ae0-486c-a1b5-2937a6a6e8d9`, business `1b237001-c525-47fe-9060-871f9a53df4c`,
2026-09-18) ran **four times** — three transient failures, then success — and took **8m19s** of
customer-visible latency to do ~85 seconds of necessary work.

All times in this note are **UTC**. The database, `journalctl` and the Vercel access log are three
different clocks in two zones; the Vercel log renders IDT (UTC+3) and every figure taken from it
here is already converted.

## The cause

`jobs.last_error`, verbatim:

```
Failed to parse structured output: Error: Failed to parse structured output:
frames.5.actionType: Invalid option: expected one of
"navigate"|"tap"|"type"|"select"|"scroll"|"result"|"idle"
```

One frame in one batch of ten came back with an `actionType` outside the enum.
`batchOutputSchema` is `z.object({ frames: z.array(...) })`
(`demo-analysis.ts:118-133`), so zod rejected the **whole batch object**, the call threw before
returning, and the `Promise.allSettled` rethrow at `demo-analysis.ts:727-732` discarded the entire
attempt.

## The timeline [MEASURED]

Reconciled to within 2 seconds of the 499s the row records between `created_at` and `updated_at`.

| attempt | claimed     | ended                     | ran  | then slept |
| ------- | ----------- | ------------------------- | ---- | ---------- |
| 1       | ~00:55:52   | failed 00:57:04.36        | ~72s | 35s        |
| 2       | ~00:57:39   | failed 00:58:44.36        | ~65s | 65s        |
| 3       | ~00:59:50   | failed 01:00:56.27        | ~66s | 127s       |
| 4       | 01:03:05.36 | **succeeded** 01:04:09.54 | 64s  | —          |

- work **~267s**, backoff sleep **~227s**, claim latency **~6s**.
- The three failure timestamps are the level-40 `journalctl -u aiugc-worker` lines; their epoch-ms
  values decode to exactly the times above.
- Success and the final `usage_events` row are 130ms apart — 01:04:09.40 and 01:04:09.53.
- `attempts` finished at **3**, not 4: `failTransient` increments on failure, not on claim
  (`queue.ts:246-247`, read).

## The checkpoint held — and it is what makes the attribution sound [MEASURED]

`usage_events` for this `job_id`: **five rows clustered 00:56:22–00:57:04** (attempt 1) and **one
row at 01:04:09.40** (attempt 4). Ledger total **6 calls / 98,083 tokens / ₪1.69** — _below_ the
clean-run baseline in [[analyze-demo-cost]] (8–9 calls, 125–159k tokens, ₪2.04–₪2.56), because five
batches were bought once and reused across all four attempts. (Ledger, not bill — see the caveat
below.)

The mechanism, read in the tree: `batchResults[bi]` is restored from `job.state` when the
`resumeKey` matches (`demo-analysis.ts:646-649`), `if (batchResults[bi]) return;` skips a finished
batch (`:691`), and `saveCheckpoint` chains its writes so a smaller snapshot can never land last
(`:651-660`). `recordUsage` runs only **after** the provider call returns (`:669-685`), so a thrown
call leaves no row at all.

**Caveat, and it matters for the money:** "three retries cost zero agorot" is true of the
_ledger_, not of the Anthropic bill. A call that reached the API and then failed zod validation was
billed and recorded **nowhere** — `recordUsage` never ran. So `usage_events` under-reports this
job's real spend, and the per-attempt attribution above is sound precisely _because_ failed calls
are invisible, not because they were free. [REASONED from the call ordering at `:669-685`.]

**The gap is countable, and it is three calls.** [REASONED, tightly constrained by the
measurements:] ~53 states at `a_analysis_batch_size` 10 is **6 batches**. Five were bought and
checkpointed in attempt 1; one threw. A parse failure throws _inside the provider_, before
`salvageBatchFrames`, so it can never trigger the corrective retry — one throwing batch is exactly
one wasted call per attempt. Attempts 1, 2 and 3 therefore each made **one** unrecorded call, and
attempt 4 made the recorded sixth. **9 real API calls, 6 in the ledger.** Folding three calls back
in at this job's own mean (98,083 / 6 ≈ 16.3k tokens, ~28 agorot) puts the true spend near
**₪2.5** — _inside_ the clean-run range in [[analyze-demo-cost]], not below it. The failing batch
was a full one, not the 3-frame remainder: `frames.5` is a zero-based index, so it held at least
six frames.

## The defect, in two halves

### (a) Granularity — one array element discards nine good frames and ~30s of setup

The rejection unit is the batch **object**. One invalid element therefore throws away:

- the nine good frames beside it in that batch;
- the position of five already-paid sibling batches, for that attempt's round;
- and — because the phases before the batch loop carry **no checkpoint guard at all** — the storage
  download (`demo-analysis.ts:564`), two ffmpeg decode passes (`frameHashes` at `:569`,
  the frame extraction feeding `localFrameOf`), `clusterStates` (`:571`) and ~53 thumbnail uploads,
  which re-run in full on every attempt. That is the ~30s each retry spends to get back to the
  position of making one API call.

### (b) Wrong retry class — backoff cannot fix a sampling failure

This is model sampling variance, not a flaky provider. Exponential backoff
(`queue.ts:225-228`: `30_000 * 2^(n-1)` plus up to 10s of jitter, so 30s / 60s / 120s bases) buys
nothing, because **nothing about the input changes between attempts** — same frames, same prompt,
same schema. **~227s of the 499s was spent sleeping on a condition sleeping cannot fix.** Attempt 4
succeeded on a resample, which is the only thing that was ever going to work.

## The machinery for this already exists, one layer too high [REASONED, not measured]

The handler already owns the right response to "the model got a frame wrong":

- `salvageBatchFrames` (`demo-analysis.ts:232-243`) — null for a miss, never a throw;
- one corrective retry naming the failure and re-requesting **that batch only** (`:693-715`);
- the `a_analysis_max_degraded_fraction` gate, default 0.25 (`:745-757`), under the stated policy
  in the code: _"Degrade, don't die: losing a few states out of eighty is nothing; losing the whole
  analysis is expensive."_

A **parse** failure bypasses all of it, because it throws inside the provider
(`providers/anthropic.ts:86-97`) before `salvageBatchFrames` ever sees a response. Routing parse
failures into that existing path is the fix.

**Not shipped.** This note is OPEN; the fix is queue item 1 in [[state-of-play]].

## The double wrap — LOCATED, and it is NOT a retry

`jobs.last_error` carries the prefix **twice**:
`Failed to parse structured output: Error: Failed to parse structured output:`.

**Both layers are in `@anthropic-ai/sdk` 0.111.0, and neither is a retry** (read in the installed
package, `node_modules/.pnpm/@anthropic-ai+sdk@0.111.0_zod@4.4.3/node_modules/@anthropic-ai/sdk`):

1. **Inner** — `zodOutputFormat`'s own `parse` callback throws
   ``AnthropicError(`Failed to parse structured output: ${output.error.message}…`)`` at
   `helpers/zod.js:41`.
2. **Outer** — `parseOutputFormat` wraps that callback in a try/catch and rethrows
   ``AnthropicError(`Failed to parse structured output: ${error}`)`` at `lib/parser.js:63`.
   `${error}` interpolates the **Error object**, not `.message`, so it stringifies as
   `Error: <message>` — which is exactly the `Error:` sitting between the two prefixes.

**One prefix per layer, two layers, zero extra samples.** `messages.parse` is
`this.create(params, options).then((message) => parseMessage(message, params, …))`
(`resources/messages/messages.js:67`) — the parse runs in a `.then` on an already-resolved request,
**outside** the client's HTTP retry loop (`maxRetries` default 2, `client.js:110`, which covers
transport faults and never a schema failure). So the model was sampled **once per attempt**, not
twice, and the three failures are three independent resamples of the same input.

That settles the question in favour of half (b) rather than against it: nothing about the call
changed across the three retries, and nothing in the stack was going to change it.

- Corroborating, from the tree at `f84e931`: the string `Failed to parse structured output`
  **appears nowhere in this repo** (`git grep`, all tracked files). Our own parse error reads
  `structured output parse failed (stop_reason: …)` (`providers/anthropic.ts:49`, `:96`);
  `generateObjectWithImages` (`:68-110`) makes one `client.messages.parse(...)` call with no retry;
  and `handleAnalyzeDemo`'s outer catch rethrows `err` unchanged (`demo-analysis.ts:865-876`).

**One discrepancy left, UNVERIFIED.** `helpers/zod.js:41` in _this_ build also appends
`\nValidation issues:\n  - <path>: <message>`, and the `last_error` text as transcribed into the
session brief has no `Validation issues:` line. Either the transcription elided it, or the box was
running a different 0.111.x patch. One `select last_error from jobs where id =
'85d9ec0b-4ee0-44d2-9bff-c89e9e55b332';` settles it, and nothing above depends on the answer.

## Two observability holes found by reading — UNSHIPPED, and part of the fix list

1. **The `allSettled` rethrow discards every rejection but one, unlogged.**
   `demo-analysis.ts:727-732` picks the `BudgetError` if one is present, otherwise
   `rejections[0]`, and throws it. Nothing logs the others. **If two batches fail in one round, one
   leaves no trace anywhere** — not in `jobs.last_error`, not in the journal.
2. **The ffmpeg / storage / thumbnail phases have no checkpoint guard**, so every retry repeats
   ~30s of work to reach the position of making one API call. Deliberately kept out of the
   granularity fix (queue item 3 in [[state-of-play]]).

## Why nothing reached Sentry, and why that is correct

`reportTerminal` fires only on a permanent failure (`jobs/worker.ts:134-140`) or when
`isLastAttempt` is true (`:153-160`), per
[[0037-the-worker-reports-to-sentry-the-web-apps-do-not]]. With `max_attempts` defaulting to **5**
(`db/schema.ts:522`) and `isLastAttempt` = `attempts + 1 >= maxAttempts` (`queue.ts:242-243`), this
job's third failure evaluated `3 >= 5` — false. **It never reached `isLastAttempt`, so the silence
is the wiring working.**

The consequence is the open question, not a bug: a job can burn ~8 minutes of customer-visible
latency across three failures and leave **no signal in Sentry, in the dashboard, or anywhere a
human looks**. This job succeeded on execution 4 of a possible 5; had it kept failing, the first
Sentry event would have arrived only after execution 5 — roughly 13 minutes in, using the measured
per-attempt figures above. [REASONED projection from the measured table; not observed.] Whether
transient retries should report at all is a founder decision that has not been made.

## Related

- [[analyze-demo-cost]] — the clean-run baseline this job undercut, now carrying this job's row.
- [[every-upload-spends-2.40]] — its open question about the ₪4.35 run is narrowed by this note.
- [[0009-retry-backoff-is-invisible-to-the-customer]] — what the customer was shown while this ran.
- [[worker-exits-on-a-dropped-connection]] — the _other_ cause of a multi-attempt analysis, and the
  one the ₪4.35 run actually had.
