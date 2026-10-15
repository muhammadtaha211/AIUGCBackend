---
type: decision
status: verified
verified: 2026-10-01
method: "Founder decisions in chat, 2026-10-01, recorded from that day's task prompt, which states them as decided and not open for relitigation; the reasons and the one piece of hearsay below are his. Grounding read at origin/main d57b60a, code only — no production query, no classifier call, no grant, no account change: the ledger writers and the signup trigger re-read for [[no-self-serve-credit-grant-path]] (re-verified the same day, still holds); apps/admin/src/app/api/admin/grants/route.ts:7-26 and apps/admin/src/lib/admin.ts:74-78 (the grant route and its schema); packages/core/src/pipelines/credits.ts:108-121 (grantCredits) and :162-176 (expirePeriodRemainder); apps/web/src/lib/wizard-gate.ts:27-32 and its two callers; docs/05-billing.md:447-449 (the rates) and :527-534 (no free tier, the dormant watermark); prompts/content_policy/v1.md; apps/web/src/app/(legal)/terms/page.tsx:169-172 and :190-191; apps/web/src/app/(legal)/privacy/page.tsx:177-181; a grep of apps, packages and supabase for utm_/referrer/signup-source/analytics code (none outside two tests of the Sumit return URL)."
source: founder
---

# 0068 — Prices stand, there is no self-serve free tier, trials are granted by hand, and the first stranger gets none

> **2026-10-15** ([[0113-the-intro-card-on-the-plan-page-estimates-and-prices-one-shekel-less]]): the prices moved one shekel down, ₪149 / ₪299 / ₪499.

Four decisions, taken together on 2026-10-01, the day the first person who is not the founder
signed up. Every claim carries one tag: **FOUNDER-REPORTED** (his statement or his reasoning, not
checkable here), **MEASURED** (read in the tree at `d57b60a`, or measured with git), **REASONED**
(arithmetic or inference from what is cited), **CARRIED** (from an older note, not re-measured).

## 1. Pricing stays as it is

Three plans, differing by credit volume only, with a ₪150 floor: `starter` ₪150 / 1000 credits,
`pro` ₪300 / 2500, `studio` ₪500 / 5000 — [[0051-the-credit-unit-and-the-three-credit-only-plans]].
**CARRIED** from 0051 (a production read of 2026-09-16); re-read in the tree at
`supabase/migrations/0043_pricing_credit_unit.sql:181-190`, not re-queried.

**The alternative weighed was changing the prices before any stranger has seen them.** Kept, for
two reasons, both **FOUNDER-REPORTED**:

- **There is no signal yet.** No stranger has reached the price and walked away.
- **Lowering a price is easier than raising it.**

**Revisit on 0051's existing trigger**: sixty days after the first real paying customer. That clock
**has not started** — **REASONED**: the one subscription on record is the founder's own ₪150 test
purchase, which is excluded from every revenue figure ([[first-real-purchase-2026-09-21]]).

## 2. No self-serve free or watermarked tier; the watermark layer stays dormant

**The options:** a free or watermarked tier that any signup gets on their own, or none. **Chosen:
none, for now.** The reasons, **FOUNDER-REPORTED**:

- **Every trial spends real provider money.**
- **The daily caps, not the credit balance, would become the only bound on stranger spend.**
  **MEASURED**, what that would give up: today a never-paid account's balance is 0, and no present
  code path raises it without a real payment or a founder action
  ([[no-self-serve-credit-grant-path]], re-verified 2026-10-01), so the balance is what refuses a
  stranger's render. The per-account daily caps are the backstop behind it
  ([[per-account-cap-blind-spot]], [[0040-the-hard-ceiling-moves-to-the-providers]]).
- **It is a feature that would have to be removed later.**

**Considered and not decisive.** The founder reported (hearsay, **not verified**) that a competing
product's founder dropped his free tier at about $4k MRR and saw MRR rise. It did not decide this,
because that story is about converting an existing pool of free users, and Tavnit has none.

**What "dormant" means in the tree — MEASURED:** the Remotion `Watermark` overlay
(`packages/remotion/src/overlays.tsx:95`), `video_renders.watermarked` (default `false`,
`packages/core/src/db/schema.ts:485`) and `businesses.sample_used_at` exist, and no customer path
sets them. `docs/05-billing.md:527-534` ("No subscription, no free tier") already says so. This
decision keeps that section true; it changes no code.

## 3. Trials are granted by hand, one person at a time

**Only after the founder has looked at the business**, and only through the grant that already
exists. **MEASURED:** `POST /api/admin/grants` (`apps/admin/src/app/api/admin/grants/route.ts:7-26`,
behind `requireAdmin`) calls `grantCredits` (`packages/core/src/pipelines/credits.ts:108-121`),
which appends one `grant_manual` row. The body takes a user id, a positive integer and a required
note of 1–500 characters (`apps/admin/src/lib/admin.ts:74-78`).

**Reasons, FOUNDER-REPORTED:** it costs only what he chooses; there is nothing to remove later; and
it produces the data the free-tier question needs — **do trial users pay?** **Reopen §2 when that
data exists.**

**Default size: ~200 credits, enough to try each service once. REASONED** from the rates in
`docs/05-billing.md:447-449`: a first hook+demo ad off a new recording is **45** (`25` steps +
`20` analysis) and a 30-second talking-head ad is **150** (`30 × 5`); 45 + 150 = 195. A 15-second
talking-head ad is the 75 floor. At the base tier's ₪0.15 a credit
([[0051-the-credit-unit-and-the-three-credit-only-plans]]), 200 credits is ₪30 of list price;
what it costs in provider money depends on what the person renders, and is not estimated here.

**`grant_manual` credits never expire. MEASURED** from the code: the only writer that takes
unspent credits away, `expirePeriodRemainder` (`credits.ts:162-176`), expires
`balance − manualOutstanding` and so never touches a manual grant, and no other writer removes
one — the renewal keeps it too ([[0052-upgrade-credits-are-period-credits]]). Two consequences,
**REASONED:**

- An unspent trial stays spendable for as long as the account exists, including after the person
  subscribes. The admin route cannot take it back: it accepts positive integers only
  (`admin.ts:76`, re-checked in `grantCredits`, `credits.ts:112-114`).
- `grant_manual` has no unique index, so a grant submitted twice is two grants
  ([[0051-the-credit-unit-and-the-three-credit-only-plans]] says the same of top-ups).

**OPEN, the founder's call: how a trial user is told about the grant.** The constraint is
`/privacy`, which promises no marketing email (`apps/web/src/app/(legal)/privacy/page.tsx:177-181`).
It names the only mail that is sent: authentication messages, the payment receipt Sumit sends, a
reply to a message the person wrote, and notice of a material change to the policy or the terms.
Marketing mail needs explicit prior consent. **REASONED:** a "you have credits" email is none of
those four unless it answers something the person sent.

## 4. The first third-party signup gets no trial

**FOUNDER-REPORTED:** on 2026-10-01 the first person who is not the founder signed up. Its
questionnaire indicated an **adult-model persona presented as a real person**. That is the whole
description this repo carries of it — a non-fit signup, adult-persona intent. No name, email, user
id or questionnaire text is written anywhere in the repo.

**Why no trial:** it is outside the product and inside the content policy's refused categories.
**MEASURED** (the text, read): `/terms` §6 forbids presenting an AI persona as a real customer, a
real testimonial or a specific person (`apps/web/src/app/(legal)/terms/page.tsx:169-172`), and §7
refuses impersonation and sexual content (`:190-191`). The classifier prompt,
`prompts/content_policy/v1.md`, lists "Adult content or services" and "Scams, misleading claims,
or impersonation".

**Whether the classifier would flag this questionnaire is REASONED, not tested.** No classifier
call was made, by instruction. It could not have seen the text either: the classifier runs only
inside `createSet` and `createBRender`, after the affordability check
([[0042-content-policy-is-wired-at-both-choke-points]]), and a zero-credit account is refused
there before any classifier call ([[content-policy-classifier-was-uncapped]] measured
`classifierCalls: 0` for one).

**The account is left as it is.** No grant, no role change, no deletion. **MEASURED:** a zero
balance keeps it out of both wizards: `wizardGate` (`apps/web/src/lib/wizard-gate.ts:27-32`)
allows a non-admin business only when the balance is above 0, and `/home/a/new` and `/home/b/new`
render `NoCreditsCard` otherwise (`apps/web/src/app/home/a/new/page.tsx:45`,
`apps/web/src/app/home/b/new/page.tsx:43`). **That gate is page-level.** Its own comment calls it
"spam control, not enforcement": the API routes behind the wizards do not read the balance. What
they would spend on Claude calls is bounded by the per-account caps
([[authz-12-synchronous-copy-routes-uncapped]]). A render is still refused at confirm with a 402.

**The attribution is his, not measured.** He attributes the signup to the Instagram videos, because
he has run no other promotion (**FOUNDER-REPORTED**). **MEASURED:** the repo has no signup-source
tracking: no analytics package, no UTM or referrer capture, and no source column. The only `utm_`
strings under `apps/`, `packages/` and `supabase/` are two tests of the Sumit return URL.

**This is the event [[0041-content-policy-is-accepted-not-fixed]] named as its own expiry.**
[[live-account-census-2026-09-10]]'s "zero third-party signups" is stale from today, and marked so.

## Related

- [[no-self-serve-credit-grant-path]] — the "no" in §2 rests on it; re-verified 2026-10-01.
- [[0051-the-credit-unit-and-the-three-credit-only-plans]] — the prices, the rates and the revisit
  trigger.
- [[0042-content-policy-is-wired-at-both-choke-points]] — where the classifier runs, and where it
  does not.
- [[live-account-census-2026-09-10]] — the census this event ends.

_(Pointer 2026-10-11, PostHog: §4's "no analytics package, no UTM or referrer capture" is stale
from `feat/posthog-web`. `apps/web` now counts visits with the referring site and the `utm_*`
parameters, and joins a visitor to the account they create; there is still no source column in
the database. [[0103-posthog-in-apps-web-eu-cloud-free-plan]],
[[0104-what-posthog-records-and-what-never-leaves]].)_

_(Pointer 2026-10-11: the posting feature changes no price — the founder's decision 12 of
2026-10-10 names "any price change" as not now, so §1 stands with its sixty-day trigger.
[[0101-tavnit-schedules-and-posts-to-instagram-and-tiktok]].)_

_(Pointer 2026-10-14, the ₪5 intro offer: an account that has never paid may now buy, once, 150
credits for every service for ₪5, expiring 30 days after the payment and never turning into a
charge by itself. §2 stands — it is a paid offer behind a card and a real payment, not a free or
watermarked tier — and so does §1: no plan, price or rate moved. §3's hand trials stay the
founder's tool; a hand-trial recipient may still buy the offer, and its expiry never takes their
grant. §2's "a never-paid account's balance is 0 … without a real payment" now has a ₪5 payment
among those payments, and the docs/05 lines §2 cites have moved (the section is now "No free tier —
a subscription, or the ₪5 intro offer"). [[0109-a-five-shekel-intro-offer]].)_
