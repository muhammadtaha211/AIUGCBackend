---
type: fact
status: verified
verified: 2026-09-11
method: "DB half (2026-08-23, NOT re-measured since): select count(*) from events → 0. Code half re-read 2026-09-11 at 2828fd3: grep -rn 'insert(events)' packages/core/src apps → eight sites (was seven), then one call-graph grep per site. Every file:line in this note was re-verified on that date; the row counts were not."
source: db
---

# The `events` table has never held a row — and each of the eight reasons is different

`select count(*) from events` returns **0**. Not zero of some kind: zero rows, total.

**Eight** places insert into it as of 2026-09-11 — the eighth arrived with the content-policy
gate (`c442447`). Every one is an exception path. **The reasons are unrelated to each other** —
there is no single explanation, and in particular `auto_release_b` accounts for at most two of them.

**The row count is carried, not re-measured.** `select count(*) from events` returned 0 on
2026-08-23 and has not been run since; the file:line column below was re-read on 2026-09-11.

| site                                             | kind                          | why it has never fired                                               |
| ------------------------------------------------ | ----------------------------- | -------------------------------------------------------------------- |
| `packages/core/src/budget.ts:41`                 | `platform_budget_tripped`     | the platform cap has never been reached                              |
| `packages/core/src/pipelines/qc.ts:22`           | `qc_release`                  | three independent blockers — see below                               |
| `packages/core/src/pipelines/qc.ts:45`           | `qc_reject`                   | same                                                                 |
| `packages/core/src/pipelines/sets.ts:438`        | `star`                        | zero renders have `starred_at` set                                   |
| `packages/core/src/pipelines/renders.ts:1008`    | `refund_resolved_to_ancestor` | 2 refunds happened, neither resolved to a different render           |
| `packages/core/src/pipelines/copy.ts:706`        | `content_policy_flag`         | ~~its caller does not exist~~ **wired 2026-09-11**, see below        |
| `packages/core/src/pipelines/sets.ts:232`        | `content_policy_check_failed` | new 2026-09-11; the classifier has not errored, see below            |
| `packages/core/src/pipelines/audio-script.ts:94` | `audio_script_pointer_moved`  | **a passing assertion** — zero rows is the wanted outcome, see below |

## The platform cap has never been reached

`budget.ts:41` fires **only** when the platform-wide cap refuses a paid call. Its own comment says a
trip there means something is broken — a runaway loop or a leaked key — not that we are busy. Zero
rows is a positive result: the ceiling has never been hit. Consistent with the rolling window
measured at 192,290 tokens (9.6%) on 2026-08-23 03:38 UTC — but **that percentage is against the old
cap**. The `llm_tokens` platform cap was 2,000,000/24h when this was measured and is **8,000,000**
since migration 0036 (2026-09-11), which by design makes a trip four times less likely still
([[0040-the-hard-ceiling-moves-to-the-providers]], [[daily-caps-were-hand-edited-before-0036]]).
Do not re-derive a utilisation percentage from the 192,290 figure without re-measuring the window.

## The QC rows have three blockers, not one

It is tempting to write this off as "`auto_release_b` is true". That is only part of it:

1. `packages/core/src/pipelines/renders.ts:491-492` reads
   `const released = render.service === "a" || autoReleaseB;` — **Service A bypasses the gate
   unconditionally**, whatever the flag says. 13 of the 28 released renders are Service A and would
   never have entered `qc_pending`.
2. `auto_release_b` is `true`, so Service B releases too. ([[app-config-live-state]])
3. Even with the flag off, `qc_release` needs a human running `aiugc qc approve`
   (`apps/cli/src/index.ts:840-845`). **There is no QC surface in `apps/admin`.** Flipping the flag
   tomorrow would still produce zero `qc_release` rows until the founder ran the CLI by hand.
   `auto_release_b` is settled ON permanently ([[0036-auto-release-b-is-always-on]]), so in practice
   this path is closed by decision, not just unexercised.

## One of the eight was genuinely broken — fixed 2026-09-11

**Original claim, kept verbatim because it was true for the repo's entire history until this date:**

> `contentPolicyCheck` (`packages/core/src/pipelines/copy.ts:491`) has **zero callers anywhere in the
> repo, including tests** — repo-wide it has exactly two mentions, its own definition and the prose
> at `docs/04-integrations.md:76-78`, which asserts it "runs the `content_policy` classifier over the
> questionnaire + final script **before render** in the self-serve flow" and that "a flag blocks the
> render". It does not run. That is a defect, not an unexercised path, and it is the one item here
> that belongs in `defects/`.
>
> Scope: **no caller today.** Git history was not searched, so this note does not claim a caller never
> existed.

**Fixed in `c442447` (2026-09-11)** — [[0042-content-policy-is-wired-at-both-choke-points]],
[[content-policy-classifier-never-runs]]. Both render choke points now go through one helper,
`assertContentPolicy` (`packages/core/src/pipelines/sets.ts:195`), called from `createSet`
(`sets.ts:341`) and `createBRender` (`sets.ts:666`). A flag throws `ContentPolicyError`; a classifier
**error** fails open and writes `content_policy_check_failed` (`sets.ts:232`) — which is why this
note now lists eight sites.

**Zero rows is no longer "the caller does not exist".** For `content_policy_flag` it now means no
generated copy has been flagged; for `content_policy_check_failed` it means the classifier has not
errored. Neither has been re-measured against the DB — see the carried-count warning above.

**Three line cites in the original claim above are stale, and the commit that fixed the defect is
what moved them.** `c442447` added 30 lines to `copy.ts` above the function, so `contentPolicyCheck`
is now **`copy.ts:692`** — it was `:491` when this note was written and `:662` at `c442447^`, which
is the value the notes written _inside_ that commit recorded. The prose it names is now
`docs/04-integrations.md:104-118`, not `:76-78`.

## One of the eight is a tripwire, and zero is the pass

`recordAudioScriptPointerMove` **is** called — from
`apps/web/src/app/api/audio/[id]/route.ts:31`, behind an `if (pointerMoved)` guard. The comment
above it (`route.ts:25-29`) is explicit: once the length-fit regeneration is deleted, nothing writes
`audio_renders.script_id` after insert and the branch should never run again — "it is not dead code,
it is the assertion that stays true. If a row ever shows up in `events` for this kind, something
started moving the pointer, and the customer was shown a script they did not write."

**Zero rows here is the assertion passing.** It confirms locked decision #4's removal held.

## Two of the eight write paths have no test either

Four kinds have a test that asserts the row lands: `star`
(`packages/core/test/e2e.test.ts:238-240`), `refund_resolved_to_ancestor`
(`credits-wiring.test.ts:567-569`), `platform_budget_tripped`
(`account-budget.test.ts:130-132`), and the pointer move
(`audio-script-pointer.test.ts:152-154`).

`qc_release` and `qc_reject` have none — `grep -rn "qc_release\|qc_reject" packages/core/test`
returns nothing. So for those two, "the code works and production never entered the state" is not
established: the code is unexercised in both places.

`content_policy_flag` **was** in that list and no longer is: `c442447` added
`packages/core/test/content-policy-gate.test.ts` (11 tests), which is now the only hit for
`grep -rln "content_policy" packages/core/test apps/*/test`. `content_policy_check_failed` is covered
by the same file's fail-open cases.

## Audit coverage, honestly

The trails that matter are elsewhere and populated: `credit_ledger` (16 rows), `usage_events` (459),
`jobs` (with `last_error`), and the status columns on `demos` / `demo_step_plans` / `video_renders`.

But `gateway_events` is **also** 0 — the billing side has no live trail either, because no payment
has ever been taken. If you are assessing audit coverage rather than reading `events` specifically,
count that one too.

## Scope of this claim

"0 rows now, and every write path has an unmet guard now." Whether these tables were ever non-empty
and truncated was not checked; prod rows are known to be hand-edited, and `xmin` ordering was not
consulted.

## What to do when it stops being empty

A first row in `events` is worth reading immediately — by construction, every kind it can hold means
something unusual happened, and two of them (`platform_budget_tripped`, `audio_script_pointer_moved`)
mean something is wrong.
