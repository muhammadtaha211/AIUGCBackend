---
type: decision
status: verified
verified: 2026-09-11
method: "Founder instruction, overnight brief of 2026-09-11, on the ground that the product is being opened to strangers — the EVENT [[0041-content-policy-is-accepted-not-fixed]] named as its own expiry. Code read and wired at 702742a: contentPolicyCheck is packages/core/src/pipelines/copy.ts:662 (the :491 that 0041 and the defect note both cite is stale — that line is now inside pickStructureForBusiness); prompts/content_policy/v1.md takes one variable, {{text}}; the function already writes its own content_policy_flag event (copy.ts:675-680) and already threads businessId into recordUsage via callClaude (copy.ts:24-41). Pinned by packages/core/test/content-policy-gate.test.ts."
source: founder
supersedes: "[[0041-content-policy-is-accepted-not-fixed]]"
---

# 0042 — The content-policy classifier is wired at both render choke points

`contentPolicyCheck` now runs. [[0041-content-policy-is-accepted-not-fixed]] decided the opposite on
2026-09-10 and was right for the world it described; this note replaces it because the event 0041
itself named has arrived.

## What triggered the revisit

0041 rested on [[live-account-census-2026-09-10]] — six accounts, one admin, **all six the founder's
own**, zero third-party signups ever — and said so explicitly:

> That stops being true on an **event**, not a date — the first signup by someone who is not the
> founder. Google sign-in is already published, so it can happen without warning. Revisit this
> decision then, not on a schedule.

The founder is opening the product to strangers. That is the event. Nothing in 0041's reasoning was
wrong; its premise expired exactly the way it said it would.

## What is now wired

One private gate in `packages/core/src/pipelines/sets.ts`, called from the two functions that create
renders — and they are two, not one, because `createBRender` does **not** go through `createSet`:

| path      | entry           | web call site                                                           |
| --------- | --------------- | ----------------------------------------------------------------------- |
| Service A | `createSet`     | `apps/web/src/app/api/businesses/[businessId]/a-sets/steps/route.ts:82` |
| Service B | `createBRender` | `apps/web/src/app/api/businesses/[businessId]/renders/route.ts:100`     |

The CLI reaches the same two functions (`apps/cli/src/index.ts:718`, `:810`), so it is covered by
construction rather than by a second call site.

**Placed after every free gate and before the transaction that debits.** A refused render never
charges; a malformed or unaffordable request never pays for a classifier call.

**What is sent.** `prompts/content_policy/v1.md` takes exactly one variable, `{{text}}`, described in
the prompt as "advertiser-provided content (questionnaire and/or ad script, Hebrew)" — so the input
is one labelled Hebrew blob, not a structure:

- the business questionnaire (`businesses.questionnaire`);
- the FINAL on-screen text — Service B's `hookText`, and Service A's hook lines, read from the
  `scripts` rows the grid names. An edit in the hook studio writes a NEW `scripts` row
  (`copy.ts:715-737`), so those ids carry the text that actually gets burned in;
- the script where one exists — Service A's caption script, Service B's script behind the approved
  audio render.

That set is deliberate: the generation prompts already carry soft policy constraints
(`prompts/hook_lines/v7.md:247`, `:250`) and Anthropic refuses at generation, but **neither covers
text the customer supplies**, which is the whole of the questionnaire and an edited hook line.

## Why this gate is the only one there

- **Service A never touches HeyGen at all** — 0041's own correction, and it is the important half.
  No lip-sync, no provider moderation anywhere in Service A's path.
- Service A bypasses QC unconditionally (`packages/core/src/pipelines/renders.ts:491-492` reads
  `render.service === "a" || autoReleaseB`).
- `auto_release_b` is `true` permanently ([[0036-auto-release-b-is-always-on]]), so Service B
  releases without QC too.

So no human and no provider sees either service's output before the customer does.

## The fail-open choice, stated plainly

A classifier that **errors** — Anthropic down, a timeout, output that will not parse — writes a
`content_policy_check_failed` event and **lets the render through**.

The reasoning: a classifier outage must not take the product down, and the exposure it guards is
low. The cost is real and worth naming: **the gate is exactly as available as Anthropic is**, and a
sufficiently long outage is a window in which nothing is checked. The event row is the only record
that the window happened, and nothing surfaces it — `events` has never held a row
([[events-table-is-empty]]) and there is no admin events feed.

A **flag** is the other branch and it blocks: `ContentPolicyError`, typed like
`InsufficientCreditsError` so the web layer maps it on `instanceof` rather than a substring, plus
the `content_policy_flag` event `contentPolicyCheck` already wrote itself.

## What is still NOT covered

- **Terms §6 — presenting a persona as a real customer or testimonial.**
  `apps/web/src/app/(legal)/terms/page.tsx:161-162` forbids it. The classifier prompt does **not**
  cover it: its nearest bullet is "Scams, misleading claims, or impersonation"
  (`prompts/content_policy/v1.md:14`), which is about the advertiser's own content, not about the
  platform presenting a generated persona as a real person. The prompt was deliberately left
  unedited, so 0041's "written rule with no mechanism behind it" survives this change intact.
- **Service A's step labels.** The burned Hebrew labels live in `demo_step_plans`, not in a
  `scripts` row, and are not sent. They are derived from the customer's own screen recording, which
  is 0041's argument for why they matter less — but they are customer-editable burned text and this
  gate does not see them.
  **2026-09-15:** still not sent to the classifier. The per-word provenance gate that used to fail a
  plan whose label carried a word not on the screen is gone
  ([[0049-the-label-provenance-rule-is-a-highlight-not-a-gate]]); the highlight it left behind —
  the off-screen words marked in the editor for the customer to confirm — is now the only control on
  label text. Recorded as a remaining gap; the classifier input was deliberately not extended.
- **The classifier call is not itself capped.** Nothing in `pipelines/copy.ts` calls `assertBudget`
  (`docs/04-integrations.md:98-103` says so), and this gate adds one more uncapped paid Claude call
  on the confirm path. It is one call per confirm, not a loop, so it adds no runaway surface — but
  it is not free and it is not metered against the per-account LLM cap before it spends.
- **Nothing surfaces either event.** Both `content_policy_flag` and `content_policy_check_failed`
  land in a table no surface reads.

## Cost and latency

One `claude-sonnet-4-6` call on the confirm path, with the questionnaire and a short amount of copy
as input — the same shape as the other `callClaude` sites in `copy.ts`. **Estimated** added latency
at confirm: on the order of one Claude round trip, a second or two; **not measured**, because
measuring it costs a live call and this run spends nothing at a provider. Usage is recorded through
the same `recordUsage` path as every other copy call, with `businessId` threaded — so it is visible
to the per-account cap and does not land in the blind spot
([[per-account-cap-blind-spot]]).

## Correction 2026-09-11 — this note's own line cites shifted when it landed

The `method` field above was written from a read at `702742a`, the tip _before_ the wiring commit.
`c442447` then added 30 lines to `copy.ts` above the function, so every `copy.ts` cite recorded in
this note was 30 lines stale the moment it was committed. Re-read at `2828fd3`:

| `method` says     | actually                                                 |
| ----------------- | -------------------------------------------------------- |
| `copy.ts:662`     | **`copy.ts:692`** (`contentPolicyCheck`)                 |
| `copy.ts:675-680` | **`copy.ts:706-711`** (the `content_policy_flag` insert) |
| `copy.ts:24-41`   | unverified — not re-read                                 |

`renders.ts:491-492` (the Service A QC bypass, cited in the gate table) **is** still correct.
The in-code comment at `packages/core/src/pipelines/sets.ts:241` carries the same stale
`copy.ts:675-680` and was deliberately not edited in this docs-only pass — it is queued.

The general rule, worth more than the three numbers: **a commit that records a line cite for a file
it is also editing must take the cite from its own result, not from its parent.** The same mistake
is recorded from the other side in [[content-policy-classifier-never-runs]].

## Related

- [[0041-content-policy-is-accepted-not-fixed]] — superseded by this note; its reasoning is correct
  for the world it described and is left verbatim.
- [[content-policy-classifier-never-runs]] — the defect this closes.
- [[live-account-census-2026-09-10]] — the census 0041 rested on, and the event that expired it.
- [[0036-auto-release-b-is-always-on]] — why no QC gate stands behind this one.
- [[per-account-cap-blind-spot]] — why `businessId` had to be threaded.
