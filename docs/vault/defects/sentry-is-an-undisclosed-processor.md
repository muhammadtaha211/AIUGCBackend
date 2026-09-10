---
type: defect
status: verified
verified: 2026-09-10
method: "Read at 91e4470. `grep -ni sentry apps/web/src/app/(legal)/privacy/page.tsx` -> zero hits; `grep -ni sentry docs/legal-review.md` -> zero hits. Sentry is wired: apps/worker/src/reporting.ts:57-71 sends `lastError: job.lastError` at :69. jobs.last_error is unsanitised err.message — packages/core/src/jobs/worker.ts:119-120, persisted at jobs/queue.ts:172, :194, :212; providers slice up to 500 chars of raw response body into it (providers/lipsync.ts:140, elevenlabs.ts:53, imagegen.ts:78). docs/02-jobs.md:155-158 carries the warning."
source: code
---

# Sentry receives customer-derived text and is named in no privacy disclosure

## The gap

`/privacy` §6 (`למי המידע מועבר`, `apps/web/src/app/(legal)/privacy/page.tsx:160-227`) lists the
recipients under four sub-headings — infrastructure (Supabase, Vercel, Hetzner), AI (Anthropic,
ElevenLabs, HeyGen, fal.ai), Google sign-in, and the homepage images (picsum.photos).

**Sentry is in none of them.** It appears nowhere on the privacy page and nowhere in
`docs/legal-review.md` — no P-row covers it at all. Both greps return zero.

Meanwhile it is real and wired: `@sentry/node` in `apps/worker`, initialised whenever `SENTRY_DSN`
is set, reporting every terminal job ([[0037-the-worker-reports-to-sentry-the-web-apps-do-not]],
[[worker-sentry-reporting]]).

## What actually leaves the country

`apps/worker/src/reporting.ts:57-71` sends `jobs.last_error` in the Sentry `extra` object — `:69`,
`lastError: job.lastError`. Its own comment at `:45-46` says `lastError` "is the whole point".

`jobs.last_error` is **unsanitised**. It is `err.message` and nothing else —
`packages/core/src/jobs/worker.ts:119-120` — passed straight through to the settle writes at
`jobs/queue.ts:172`, `:194` and `:212` with no slice, redact or filter on the path.

And what lands in `err.message` is up to **500 characters of a third party's raw response body**:

- `packages/core/src/providers/lipsync.ts:140` — `` `heygen ${response.status}: ${body.slice(0, 500)}` ``
- `packages/core/src/providers/elevenlabs.ts:53` — the same shape
- `packages/core/src/providers/imagegen.ts:78` — the same shape

`docs/02-jobs.md:155-158` already warns about exactly this, and states it as a deliberate trade:

> **`last_error` leaves the box.** It is `err.message` only — never a stack, never the job payload —
> but it is not sanitised, so a provider error quoting customer text goes with it.

## The finding

That trade was made about **observability**. It was not made about **disclosure**. A provider error
quoting a customer's script, hook line or questionnaire answer goes to Sentry, which is a processor
the privacy policy does not name and the legal review has never considered.

The reg. 2 draft is the only document in the repo that has noticed —
`docs/legal/database-definitions-document.md:680` lists Sentry with
`**[חסר]** — אינו ברשימת הנמענים` ("missing — not in the recipient list").

Two things follow, and only the second is optional:

1. **§6's recipient list is materially incomplete** while `SENTRY_DSN` is set on the box. That is a
   disclosure question, not a code question.
2. Sanitising `last_error` before it reaches Sentry would shrink the problem, but it is a different
   change with its own cost — the whole value of the field is that it is verbatim.

## Deliberately not fixed here

**Neither the privacy page nor `docs/legal-review.md` was edited** — both are the founder's call.
This note records the gap.

## Related

- [[0037-the-worker-reports-to-sentry-the-web-apps-do-not]] — the decision that put Sentry in.
- [[worker-sentry-reporting]] — what a Sentry event actually carries.
- [[privacy-understates-what-the-edge-check-reads]] — the other §6 problem found the same day.
- [[database-definitions-document-missing]] — the document that flagged it first.
