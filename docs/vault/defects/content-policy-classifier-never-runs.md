---
type: defect
status: verified
verified: 2026-09-11
method: "Original finding: grep -rn contentPolicyCheck across packages and apps (one hit, the definition); git log -S contentPolicyCheck --oneline (two commits, Init and the vault commit). Re-read 2026-09-11 at 702742a — still zero callers immediately before the fix, and the line numbers cited in the body had drifted (contentPolicyCheck is copy.ts:662, the Service A QC bypass is renders.ts:491-492). Fix verified by packages/core/test/content-policy-gate.test.ts, 11 tests green."
source: code
---

# The content-policy classifier has never run, and the docs say it does

## FIXED 2026-09-11 — it now runs at both render choke points

> **The banner here previously said ACCEPTED, NOT FIXED (founder decision 2026-09-10,
> [[0041-content-policy-is-accepted-not-fixed]]). That decision is superseded by
> [[0042-content-policy-is-wired-at-both-choke-points]] on the event 0041 itself named as its own
> expiry — the first signup by someone who is not the founder. 0041's reasoning is not wrong and has
> not been rewritten; its premise expired.**
>
> The old banner also flagged that line 70's "the founder plus two accounts" is a stale 2026-08-23
> census against the deleted project — live is six accounts, one admin, all the founder's
> ([[live-account-census-2026-09-10]]). That is still true of the body below.

`contentPolicyCheck` is called from `createSet` (Service A) and `createBRender` (Service B) — the
two functions that create renders, and they are two because `createBRender` does not go through
`createSet`. Both calls sit after every free gate and **before the transaction that debits**, so a
refused render never charges. A flag throws `ContentPolicyError` (422 plus a Hebrew line in
`apps/web/src/lib/api-errors.ts`); a classifier ERROR **fails open**, writing a
`content_policy_check_failed` event and letting the render through. Founder-owned businesses skip
the check, like credits and the per-account cap.

`packages/core/test/content-policy-gate.test.ts` pins it and closes this note's other finding along
the way: **`content_policy_flag` had no test anywhere.**

**Three findings below survive the fix, unchanged:**

- The gate table is still accurate. Neither QC queue stands between customer text and a rendered
  ad, so this check is the only thing there.
- Terms §6's persona-as-testimonial rule still has nothing enforcing it. The classifier prompt does
  not cover that case and was deliberately not edited — 0042 records it as a remaining gap.
- Nothing surfaces either event: `events` has never held a row and there is no admin events feed.

**Two line numbers in the body are stale** and are left as written rather than silently corrected —
`contentPolicyCheck` is `copy.ts:662`, not `:491`, and the Service A QC bypass is
`renders.ts:491-492`, not `:428`. Both were re-read on 2026-09-11.

---

`contentPolicyCheck` (`packages/core/src/pipelines/copy.ts:491`) has **zero callers anywhere in the
repo, including tests.** Repo-wide it has exactly two mentions: its own definition, and the prose at
`docs/04-integrations.md:76-78` which states it

> runs the `content_policy` classifier over the questionnaire + final script **before render** in
> the self-serve flow; a flag blocks the render and writes a `content_policy_flag` event for founder
> review.

None of that happens.

## It was never wired, not unwired later

`git log -S contentPolicyCheck --oneline` returns exactly two commits: `9872108` (2026-07-16,
"Init") and the vault commit that first wrote this claim down. `git log -S content_policy` returns
the same two. Since any caller would itself contain the string, a caller being added or removed
would have moved the count and produced a third commit. **No caller has ever existed.** The function
and the doc paragraph shipped together in the initial commit, and the wiring between them was never
written.

`prompts/content_policy/v1.md` exists and is reachable from nothing else.

## Blast radius: there is no review between customer text and a rendered ad

This is the part that matters. Trace every gate that could catch bad copy:

| gate                         | state                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| `contentPolicyCheck`         | never called                                                                                  |
| Service B QC queue           | `auto_release_b` is `true` — bypassed (CLAUDE.md decision #8, amended)                        |
| Service A QC queue           | bypassed **unconditionally** — `renders.ts:428` is `render.service === "a" \|\| autoReleaseB` |
| `events.content_policy_flag` | 0 rows, because nothing writes it ([[events-table-is-empty]])                                 |

So for Service A — the self-serve steps product — **nothing automated and nobody human sees the
copy between the customer typing it and the MP4 existing.**

There is one partial mitigation, and it is worth naming precisely so nobody over- or under-rates it.
The _generation_ prompts carry soft policy constraints in prose:

- `prompts/hook_lines/v7.md:247` — "Any medical treatment or cure claim"
- `prompts/hook_lines/v7.md:250` — asserting a named company's product is "defective, unsafe,
  illegal or fraudulent"
- `prompts/b_script/v8.md:142` — "testimonials, guarantees, or medical and financial promises"
- `prompts/vo_script/v5.md` — the same shape for voiceover

That is an instruction to the writing model, not a verdict that blocks anything, and it covers only
part of what the classifier checks. Critically it does **not** cover text the customer types
himself: the questionnaire, and the free-text hook line the hook studio lets him edit and burn onto
the video. Generated copy gets a nudge; supplied copy gets nothing.

What the classifier would have caught, per `prompts/content_policy/v1.md:9-15`:

- illegal products or services (drugs, weapons, counterfeits)
- medical or health claims (cures, treatments, weight-loss promises)
- financial promises (guaranteed returns, get-rich schemes, crypto pumping)
- adult content or services
- political campaigning
- scams, misleading claims, or impersonation
- hate speech or harassment

Today the exposure is small: the customer set is the founder plus two accounts, and 13 Service A
renders exist in total. It stops being small the moment self-serve is open to strangers, which is
the stated goal.

## Fix shape

One call, at one choke point. `createSet` (`packages/core/src/pipelines/sets.ts:137`) is the single
function the web entry point funnels through —
`apps/web/src/app/api/businesses/[businessId]/a-sets/steps/route.ts:82` (the orphaned voiced route
that also called it was deleted 2026-08-31) — as well as the CLI. A `contentPolicyCheck` call
placed among its existing hard gates covers every path at once.

Everything else is already built: the function, its prompt, its zod output, its event kind, and the
package-root export at `packages/core/src/index.ts:17`. Only the call site is missing.

Until it is written, `docs/04-integrations.md:76-78` should be corrected — a doc that describes a
safety control that does not exist is worse than no doc.

## Related

- [[events-table-is-empty]] — why the `content_policy_flag` row count is zero
