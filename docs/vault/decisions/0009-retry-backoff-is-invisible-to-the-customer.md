---
type: decision
status: verified
verified: 2026-09-02
method: "founder instruction in chat, 2026-09-02, after watching a production render alternate between the loading state and the pause line for eight minutes before failing"
source: founder
---

# 0009 — A job's retry backoff says nothing to the customer

## The decision

`renderWaitView` no longer surfaces a backoff-parked render job. The
`resumeAtMs` branch used to return
`"העיבוד מושהה כרגע ויתחדש אוטומטית בעוד כמה דקות."` with a frozen bar; it now returns no
sentence at all and the progress bar keeps running (`apps/web/src/lib/service-a-ui.ts`, pinned by
"a backoff-parked render says nothing and keeps the bar running" in
`apps/web/test/service-a-ui.test.ts`).

## Why

The founder ran a render in production on 2026-09-02 and watched the screen alternate between the
loading state and that sentence for eight minutes, then fail. His words: _"i dont like this at
all, why does this even happen? if it does happen just keep showin the loading bar without saying
its stuck."_

Two things were wrong with it, and only one of them was the copy:

1. **It flickers by construction.** A parked job hops `queued` ↔ `running` as the queue reschedules
   it, and `resumeAtMs` only appears when the delay exceeds `JOB_DELAY_VISIBLE_MS` (60s), which the
   exponential backoff crosses and re-crosses between attempts. The sentence therefore blinks on and
   off rather than describing a stable state.
2. **It describes our machinery, not their video.** A backoff retry resumes by itself within
   minutes. From the customer's side nothing has changed: the video is still being made. Telling
   them "paused" converts a self-healing hiccup into something that reads like a fault they should
   act on — and there is nothing they can do.

## What was kept, and why the honesty rule is not weakened

The two signals that carry real information both survive:

- **Nothing is claiming the job at all** (`heartbeat: "stale"`, or no job row with no live worker)
  still shows the amber `stuckLine` and still freezes the bar. That is the state where the customer
  genuinely should stop waiting.
- **The retries actually ran out** still lands the render on `failed` with
  `RENDER_RETRIES_EXHAUSTED_MESSAGE`. That is the honest terminal signal, and on 2026-09-02 it fired
  correctly.

So the rule is narrowed, not abandoned: we report states the customer can act on or should plan
around, and we do not narrate the retry queue. Anything that reintroduces per-attempt commentary to
the customer is reopening this decision.

## What it does not excuse

The pause line was a **symptom** of [[tmp-cron-deletes-live-worker-bundle]] — the render was
retrying because the worker box is running pre-fix code and every attempt hit a deleted webpack
bundle. Removing the sentence removed the noise, not the cause. The founder-facing diagnostic for
that class of failure is `jobs.last_error` (see
[[bundle-fix-reached-the-worker-box]] for the query), not the customer's screen.
