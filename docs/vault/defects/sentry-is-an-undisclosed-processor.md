---
type: defect
status: verified
verified: 2026-09-11
method: "fix verified: the same two greps that were zero on 2026-09-10 — `grep -ni sentry apps/web/src/app/(legal)/privacy/page.tsx docs/legal-review.md` — now return hits in both. `pnpm lint` (prettier --check .) exits 0 and the web typecheck passes. The original 2026-09-10 measurement is preserved verbatim below, and every file:line in it still resolves."
source: code
---

# Sentry receives customer-derived text and is named in no privacy disclosure

## FIXED 2026-09-11 — the disclosure only; `last_error` is still unsanitised, on purpose

**Fixed.** `/privacy` §6 now carries a `דיווח תקלות` sub-section naming Sentry, what reaches it
(job id, type, attempt count and the error text; on a crash, the technical fault and its location
in our code), that the error text is **not filtered** and may quote the customer's own content, and
that the uploaded video, the finished videos and login details are not sent. `docs/legal-review.md`
gained row **P10** and one owed-list bullet; the reg. 2 draft's transfer-basis cell for Sentry
(`docs/legal/database-definitions-document.md:680`) no longer reads "not in the recipient list".

It went in as its own `SubTitle` rather than a fourth bullet under `תשתית ואחסון`, because §3 and
§8 both say "ספקי התשתית שלנו (סעיף 6)" — filing Sentry there would have made §3 claim it logs IPs
and browser details, and §8 claim it holds backups. Neither is true, and both would have been new
false statements on the page.

**Not fixed, deliberately.** `jobs.last_error` is untouched: still `err.message` verbatim, still
carrying up to 500 characters of a provider's raw response body, still shipped in the Sentry
`extra`. That is the observability trade recorded at `docs/02-jobs.md:155-158` — the field is
worth having precisely because it is verbatim — and changing it is a separate decision with its own
cost. What changed is that the trade is now disclosed instead of silent.

**Two things this note's analysis below did not carry, and the public text had to.** The crash path
(`apps/worker/src/reporting.ts:85-96`) sends `captureException` — an exception type, message and
stack frames — which no "job id, type, error text" enumeration describes. And a provider is not the
only way customer text gets in: `packages/core/src/pipelines/copy.ts:184-186` throws a message
embedding the whole generated hook line, with no third party involved. So the page says the error
message is not filtered, rather than blaming an external provider for it.

**Still open.** No country is claimed for Sentry, so §7 gained one clause putting the error-reporting
service outside Israel on the same necessity-plus-consent footing as the US vendors, and the
region stays the open question in P10 and the owed list. The one DSN in the checkout reads as
Sentry's EU region, but it sits in the root `.env`, which the worker's `dotenv` never loads, and the
box's own env file is not in the repo (`docs/07-worker-box.md:174-185`) — so the repo establishes a
region for the desktop's stored key, not for the project the box reports to. Two markers in the reg.
2 draft were left standing by instruction and are now stale: `:612`'s heading
(`### Sentry — **אינו מגולה במדיניות הפרטיות**`) and the `[חסר]` at `:627`, whose "not in the
recipient list" half is answered.

---

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
