---
type: decision
status: verified
verified: 2026-09-08
method: "founder in chat, 2026-09-08: 'apps/web/src/lib/onboarding.ts recommendedTone: return friendly for every business type. (Founder decision: the persona's register is the influencer's; tone is an opt-in dial.)'"
source: founder
---

# 0029 — The onboarding tone defaults to `friendly` for every business type

`recommendedTone(businessType)` in `apps/web/src/lib/onboarding.ts` used to guess from the
category: `app` → `direct`, `service` → `professional`, everything else → `friendly`. The
guess fed four call sites in three files — the landing chooser's draft, the onboarding flow (its
payload and the audience step's `tone` prop), and the "recommended" badge on the audience step —
so an app or a service business was steered to a non-friendly tone before it had typed a word.

## The decision

Return `friendly` for every business type. The persona's register is the influencer's — a
person recommending something to a friend — and that is what a UGC ad sounds like regardless
of what is being sold. `direct` and `professional` stay available; they are a dial the
customer turns deliberately, not a default the category picks.

The function keeps its parameter so the four call sites read unchanged; only the body moved.
`apps/web/test/onboarding-payload.test.ts` pins `friendly` for all four types and for `null`.

## Why it matters downstream

`questionnaire.tone` is what `pickClosers` filters on ([[0028-scripts-end-on-a-closer-from-a-curated-bank]])
and what `b_script` blends with the persona's voice — so the default tone decides which closer
pool a first-time customer's script draws from. After the same day's four additions the pools are
friendly 7, direct 9, professional 6 (counted over `tones` in
`packages/core/src/closer-templates.ts`, the two `ALL_TONES` entries included, 2026-09-08) —
`friendly` is not the largest, but it is the only pool that
offers the two-dot closer (`חבל על הזמן..`) and the plural-audience one (`תודו לי אחר כך.`).

## Not changed

Existing `businesses.questionnaire.tone` values are untouched — this is the default for new
drafts, not a backfill. The CLI's `business questionnaire --file` takes raw JSON and never
called `recommendedTone`.
