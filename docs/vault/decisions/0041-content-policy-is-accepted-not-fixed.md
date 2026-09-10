---
type: decision
status: superseded
superseded_by: "[[0042-content-policy-is-wired-at-both-choke-points]]"
verified: 2026-09-10
method: "Founder decision in chat, 2026-09-10, accepting the risk recorded in [[content-policy-classifier-never-runs]] rather than closing it. Grounding read at 91e4470: the live Service A steps format is silent and its captions come from demo_step_plans labels + the questionnaire ([[0020-service-a-is-hook-and-steps-only]]); contentPolicyCheck (packages/core/src/pipelines/copy.ts:491) still has zero callers. Terms section 6 read at apps/web/src/app/(legal)/terms/page.tsx."
source: founder
---

# 0041 — Content policy is accepted, not fixed

> **SUPERSEDED 2026-09-11 by [[0042-content-policy-is-wired-at-both-choke-points]].** The classifier
> is now wired at `createSet` and `createBRender`. **Nothing below has been rewritten and nothing
> below is wrong** — this decision was correct for the world it described, and it named the event
> that would end it: the first signup by someone who is not the founder. That event arrived. Read
> what follows for the reasoning, not for the current state of the code.

`contentPolicyCheck` has never been called and will not be wired now. This is a decision to accept
the exposure, not a plan to close it. [[content-policy-classifier-never-runs]] stays exactly as it
is — it is the accurate description of what does not run.

## The reasoning, which is the part worth keeping

**Service A's live format leaves a classifier almost nothing to catch.** The steps format is
**silent** — no voiceover, no script ([[0020-service-a-is-hook-and-steps-only]]) — and its burned
labels come from the customer's own screen recording plus their own questionnaire answers. The copy
is essentially the customer's own words about their own product. A classifier standing between a
person and their own sentences about their own business is close to a no-op.

**On the paths where copy IS generated, there are two upstream backstops, and neither is ours:**

- **Anthropic refuses at generation.** Every copy path in this repo goes through
  `claude-sonnet-4-6`; a request to write something the model will not write does not come back.
- **HeyGen moderates at render.** A Service B clip that HeyGen will not make does not get made.

Relying on someone else's gate is a real trade-off, not a free one — but at this scale it is the
trade the founder is making knowingly.

## The correction that came with the decision

**"If HeyGen accepts it then I do too" does NOT cover Service A.** Service A never touches HeyGen at
all — no lip-sync, no avatar, no provider moderation anywhere in its path. The HeyGen backstop
covers Service B and only Service B. Whoever reaches for that one-liner later needs to know it
applies to half the product.

So the two services are covered differently, and it is worth being blunt about it: Service B has a
provider moderating the render; Service A has Anthropic refusing on the generated half and **nothing
at all** on the customer-supplied half — the questionnaire, and the free-text hook line the hook
studio lets the founder edit and burn onto the video.

## What is accepted rather than solved

**Terms section 6 prohibits presenting personas as real customers or testimonials. Nothing enforces
it but the founder noticing.** There is no check at generation, none at render, and none at release
— `auto_release_b` is `true` permanently ([[0036-auto-release-b-is-always-on]]), so no human sees a
Service B ad before the customer does.

That is a written rule with no mechanism behind it, and it is being accepted as such.

## What would change this

The census this rests on ([[live-account-census-2026-09-10]]): six accounts, one admin, **all six
the founder's own**, and zero third-party signups ever. The exposure argument is "the only person
who can put bad copy in is the person who would be liable for it".

That stops being true on an **event**, not a date — the first signup by someone who is not the
founder. Google sign-in is already published, so it can happen without warning. Revisit this
decision then, not on a schedule.

## Related

- [[content-policy-classifier-never-runs]] — what does not run, and where the one call site would
  go. Unchanged by this decision.
- [[live-account-census-2026-09-10]] — the census this rests on, and why it expires on an event.
- [[0036-auto-release-b-is-always-on]] — the other gate that does not stand there.
- [[0020-service-a-is-hook-and-steps-only]] — why the live A format is silent.
