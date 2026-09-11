---
type: defect
status: verified
verified: 2026-09-11
method: "grep -rni resend across the repo at 2828fd3: zero hits in apps/web/src/app/(legal)/privacy/page.tsx and zero in docs/legal-review.md (the only hits are the docs/08 rebuild recipe, which names Resend as one of five candidate SMTP providers and, since this session, records it as the configured one). Privacy §6 read in full at apps/web/src/app/(legal)/privacy/page.tsx:160-237 — it names ten third parties and Resend is not among them. Provider-side facts (account, domain verification, EU region, DNS records, plan limits) are founder-reported from the Resend and Namecheap dashboards, not observable from this repo."
source: code
---

# Resend holds customer email addresses and is named in no privacy disclosure

Custom SMTP went live on 2026-09-11: every Supabase auth email — today that means the signup
confirmation, which is now **required** — is relayed through **Resend**. Resend therefore receives,
at minimum, the customer's **email address** and the confirmation link, for every account created.

It appears in **neither** disclosure:

- `apps/web/src/app/(legal)/privacy/page.tsx` §6 (`:160-237`) names ten third parties — Supabase,
  Vercel, Hetzner, Anthropic, ElevenLabs, HeyGen, fal.ai, Sentry, Google and picsum.photos. Not
  Resend.
- `docs/legal-review.md` has no Resend row.

This is **the same gap that was closed for Sentry hours earlier the same day**
([[sentry-is-an-undisclosed-processor]], fixed 2026-09-11 in `2b8e6ee`) — re-created by adding a
vendor rather than by overlooking an old one. The pattern is the defect: a processor is wired up in a
dashboard, and nothing in the repo's workflow forces the disclosure to move with it.

## Why this one is easier to justify than Sentry, and still not optional

Resend's sending region is **Ireland (EU)** (founder-reported). That puts it alongside Supabase,
Vercel and Hetzner rather than with the US vendors, and privacy §7 (`:239-248`) already frames the
German operators as parties to the European convention. So the transfer _basis_ is the
better-established half.

**But the region is not the whole question, and this is the trap:** Resend is a **US company**. A
sending region in Ireland does not by itself establish whether US access exists. Do not write "EU, so
it is covered by the §7 German clause" into the policy — that would be a new false statement on a
legal page, which is exactly the mistake [[sentry-is-an-undisclosed-processor]] records avoiding when
it refused to file Sentry under `תשתית ואחסון`. **Open question for counsel, not a resolved basis.**

## What a disclosure has to say

- What reaches Resend: the email address, and the content of the auth email (which carries a
  one-time link or code). Not the uploaded video, not the questionnaire, not the password.
- That it is a **precondition of signing up** now — with confirmation ON, an account cannot be
  created if the mail does not go out. That is a stronger dependency than Sentry's.
- Where it sits relative to §7's Israel/EU/US split, once counsel answers the US-access question.

## Not established

- **Retention.** Whether Resend stores the message body or only metadata, and for how long, was not
  read from its dashboard or terms.
- **Whether the reg. 2 מסמך הגדרות מאגר needs a Resend row.** The document was not edited in the
  session that found this; `docs/legal/reg2-open-questions.md` is where that belongs.
- **The privacy page's own `UPDATED` date is stale** — `apps/web/src/app/(legal)/legal.tsx:54` still
  reads `"03.09.2026"` although §6 was edited twice on 2026-09-11 (`2b8e6ee`, `702742a`). Whatever
  edit adds Resend should bump it, and should bump it for those two edits too.

## Related

- [[sentry-is-an-undisclosed-processor]] — the same defect, found and fixed the same day.
- [[auth-email-runs-through-resend]] — the configuration itself, and the 100/day ceiling.
- [[privacy-understates-what-the-edge-check-reads]] — the other §6 defect the reg. 2 draft turned up.
