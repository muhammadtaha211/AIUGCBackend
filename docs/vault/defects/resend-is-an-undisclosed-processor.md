---
type: defect
status: verified
verified: 2026-09-11
method: 'Fix verified against this session''s own result, not against the parent: `grep -n ''שליחת מיילים'' apps/web/src/app/(legal)/privacy/page.tsx` -> :220 AFTER prettier ran, and `grep -n Resend` on the four touched files -> privacy/page.tsx:223, docs/legal-review.md:75 (row P11) and :118 (owed list), docs/legal/reg2-open-questions.md:119 (COUNSEL) and :155 (VENDOR). legal.tsx:54 reads "11.09.2026". ORIGINAL FINDING (2026-09-11, unchanged below): grep -rni resend across the repo at 2828fd3 returned zero hits in privacy/page.tsx and zero in docs/legal-review.md. Provider-side facts (account, domain verification, EU sending region, US incorporation, DNS records, plan limits) stay founder-reported from the Resend and Namecheap dashboards and are NOT observable from this repo.'
source: code
---

# Resend holds customer email addresses and is named in no privacy disclosure

## FIXED 2026-09-11 — the disclosure only; the transfer basis is still counsel's

**Fixed.** `/privacy` §6 now carries a `שליחת מיילים` sub-section —
`apps/web/src/app/(legal)/privacy/page.tsx:220-226` — naming Resend, the two mails the app actually
sends (signup confirmation and password reset, the reachable set `docs/08-supabase-project-rebuild.md`
§8A.2 verified against the tree), that it receives the email address and the body of the message
including the one-time link, **that opening an account now depends on the send**, and that the password,
the uploaded video, the finished videos and the questionnaire are not sent. `docs/legal-review.md`
gained row **P11** (`:75`) and one owed-list bullet (`:118`). `legal.tsx:54` `UPDATED` moved from
`"03.09.2026"` to `"11.09.2026"`, which also closes the stale-date item at `:54-56` below — it covers
`2b8e6ee`, `702742a` and this edit, and it moves the date on `/terms` too, since both pages read the
same constant.

It went in as its own `SubTitle`, on the same reasoning `2b8e6ee` used for Sentry: §3 and §8 both say
"ספקי התשתית שלנו (סעיף 6)", so filing Resend under `תשתית ואחסון` would have made §3 claim it logs
IPs and §8 claim it holds backups.

**Not fixed, deliberately — and this is the half that matters.** §7 was **not touched**, and the page
asserts **no transfer basis** for Resend. It states the sending region as a fact (Ireland) and, in the
same sentence, that Resend is an American company, precisely so a later reader cannot take "Ireland"
for "EU vendor, therefore covered by §7's convention clause". That question is now filed where it
belongs: `docs/legal/reg2-open-questions.md:119` (COUNSEL — which basis, and whether an EU sending
region says anything about US access) and `:155` (VENDOR — the reg. 3 undertaking and the retention of
the message body). Both rows carry `—` in the `line` column and change no count: the reg. 2 document
still has no Resend marker, and adding one is a document edit this pass did not make
(`reg2-open-questions.md:25-30` records that).

Still not established, unchanged from below: Resend's retention of the message body.

---

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
