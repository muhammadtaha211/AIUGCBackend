---
type: falsified
status: superseded
verified: 2026-08-23
method: "packages/core/src/pipelines/demos.ts:109-198 read line by line; git log -S analyze_demo; jobs⋈usage_events per analyze_demo job"
source: code
---

# "Every demo upload spends ₪2.40"

## The claim

Carried in the handover series as the per-upload cost, used to price experiments and to decide
whether an upload was affordable.

## What killed it — three separate corrections

### 1. A rejected upload costs nothing

`handleIngestDemo` (`packages/core/src/pipelines/demos.ts:109-198`) runs in this order:

| line       | step                                                     |
| ---------- | -------------------------------------------------------- |
| `:142`     | status → `probing`                                       |
| `:147`     | `storage.download` (Supabase)                            |
| `:149`     | `probe(localRaw)` — **local ffprobe**                    |
| `:151`     | reject if `info.height <= info.width` → `PermanentError` |
| `:154`     | reject if duration `< 8_000ms` or `> 180_000ms`          |
| `:165-166` | `normalizeVideo` + `thumbnail` — **local ffmpeg**        |
| `:183`     | status → `ready`                                         |
| `:190`     | **`enqueueAnalysis` — the first and only paid call**     |

The rejects at `:151` and `:154` throw before `:190`. Nothing between the job start and the probe
touches a paid API — download, probe, normalize and thumbnail are Supabase storage plus local
ffmpeg. **A horizontal clip or one under 8s tests the reject path for free.**

Those two are the _only_ threshold gates: orientation and duration, plus whatever `probe()` itself
rejects as undecodable. There is no codec gate on this path — `codec_name` is never read, and any
decodable format is transcoded to H.264. The only format restriction is the mp4/mov MIME allowlist
on the upload-url route, which runs before storage and before any job.

**Evidentiary limit.** This is proven from control flow, not from a live counterexample. The single
rejected row (`c1901280`) is dated 2026-08-04, _before_ the enqueue existed, so its zero analyses is
over-determined and does not independently confirm the ordering. No upload has been rejected since
`79a1dbc` landed.

### 2. Ten of the sixteen `ready` demos cost nothing either

`analyze_demo` was not enqueued from ingest until **`79a1dbc`, 2026-08-12** ("feat: extend demo
duration and enqueue analysis"). Production has 16 `ready` demos and **6** analyses; the 6 are
exactly the demos uploaded after that commit. The claim was not even true of every `ready` upload
for most of the project's life.

### 2b. Reaching `ready` is necessary but not sufficient

Even after the enqueue, `analyze_demo` can terminate before its first Anthropic call:

- the per-account `llm_tokens` cap trips (`packages/core/src/pipelines/demo-analysis.ts:368-375`,
  converted to a `PermanentError` with the Hebrew "try again tomorrow" message)
- the business has no questionnaire (`demo-analysis.ts:379-385`)
- `DRY_RUN` is set — a canned timeline is written and the handler returns with zero calls

The accurate precondition is "reaches `ready` **and** the analysis actually starts".

### 3. ₪2.40 is not the number

Measured across all six `analyze_demo` jobs, joining `usage_events` on `job_id`: a clean run
(`attempts = 0`) costs **₪2.04 – ₪2.56**, mean ₪2.28, over 8–9 Claude calls and 125k–159k tokens.
A run that retried three times cost **₪4.35** — 17 usage rows against a per-attempt ceiling of 16
calls, so more than one attempt certainly ran. (_Why_ the retry re-bought batches rather than
resuming from a checkpoint is not established here; the count is measured, the mechanism is not.)
See [[analyze-demo-cost]].

₪2.40 sits inside the clean range, so it was never wildly wrong — it was a point estimate presented
without its spread, which is 25% wide, and without the 2.1× retry tail.

## The corrected statement

> A demo upload that reaches `ready` **and whose analysis actually starts**, since `79a1dbc`
> (2026-08-12), costs ~₪2.30 (range ₪2.04–₪2.56) and 125k–159k platform tokens; a retried analysis
> costs up to ₪4.35. An upload rejected at probe costs nothing, and neither does one whose analysis
> stops at the account cap or a missing questionnaire. Zero customer credits either way.

## What replaced it

[[analyze-demo-cost]] and [[demo-corpus]].

## Lesson

Four errors hid inside one confident sentence: a missing precondition (`ready`), a second missing
precondition (the analysis has to start), a missing date (`since 79a1dbc`), and a point estimate
standing in for a range. "Every X costs Y" is the shape to distrust — check what X excludes before
checking whether Y is right.

Note also the size of each correction. The probe gate explains **1** zero-cost upload; the missing
enqueue explains **10**. A correction that cited only the probe would have been right and still
missed 91% of the gap.
