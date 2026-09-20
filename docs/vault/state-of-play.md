---
type: state
status: current
updated: 2026-09-20
source: founder
note: >
  Mutable working state, NOT a fact note. The 14-day staleness rule in CONVENTIONS.md
  does not apply — this file is meant to be edited in place whenever the queue moves.
  Anything here that becomes a durable, verified fact should graduate into
  docs/vault/facts/ or decisions/ and be removed from this file.
---

# State of play

Read this first in a new session. It holds what the repo cannot: external state, decisions made in
conversation, and the ordered queue. **If this file and the repo disagree, the repo wins.**

## Where things stand

**The product is live end to end; billing is built but not wired.** `tavnit.ai` serves `apps/web` on
Vercel; both wizards run; `apps/admin` sits behind HTTP Basic in front of `requireAdmin`. Service A/B
format and engine decisions are all in `decisions/` — start at
[[0020-service-a-is-hook-and-steps-only]], [[0017-service-b-single-setting-selfie-talking-head]],
[[0023-hook-is-a-remotion-animation-opener-clips-retired]],
[[0024-hook-effect-is-a-render-param-the-customer-picks]], and CLAUDE.md rather than a summary here.

**Email confirmation is ON since 2026-09-11** — the live behaviour a new session is most likely to
trip over. Every signup depends on a Resend delivery, ceiling 100/day
([[auth-email-runs-through-resend]]).

**Billing shipped 2026-09-17 and is all merged.** `origin/main` carries the engine (`54c6231`), the
customer-facing half (`7ccb708`) and the legal/public pass (`d215eae`); migrations 0044–0047 applied.
Read the notes, not a summary: 0052–0058 in `decisions/`. `UPDATED` in `(legal)/legal.tsx` is
`17.09.2026` and is load-bearing — both /terms' date and the string checkout writes into
`terms_acceptances.terms_version`. Safe today (0 rows); not safe to forget after the first sale.

**Two deploy checks worth keeping, neither with a vault note — both die with this file.** (1) Verify
the deployed **artifact**, not the symptom: `git log -1` on the box, never "a render worked
afterwards" — `docs/07-worker-box.md` §11, run and passed 2026-09-11 (`b8af879`, matching parents),
the first artifact-confirmed box deploy here
([[0039-three-deploy-axes-and-the-box-is-the-one-that-forgets]]). (2) A weaker check needing no SSH:
pick a query fragment unique to the merged code and watch
`select calls from pg_stat_statements where query like '%<fragment>%'` across one loop interval,
paired with `pg_stat_user_indexes.idx_scan` for an index the same migration created — lockstep
movement also proves the planner uses it (used 2026-09-11 for PR #29). **Caveats:** the counter is
cumulative since reset so only the DELTA means anything, and it proves a behaviour, not a SHA.

## What this session was (2026-09-18) — DIAGNOSIS, no fixes

Nothing was fixed. Everything was measured against production (Supabase SQL, the Vercel access log,
`journalctl` on the box) or read in the tree at `f84e931`. **External state changed: nothing.** No
deploys, no dashboard changes, no provider changes, no migrations.

Three notes created, two updated:

- **[[analysis-parse-failure-discards-the-whole-attempt]]** (new, defect) — one frame's bad
  `actionType` enum discarded a whole `analyze_demo` attempt, three times: 8m19s of latency for ~85s
  of work. Full measured timeline, both halves of the defect, the fix list, two observability holes.
  **FIXED ON BRANCH 2026-09-20** — queue item 1 has the state; the note's head has the FIXED block.
- **[[demo-analysis-latency-is-not-duration-bound]]** (new, fact) — a 90s 1080×1920 demo analyses in
  ~65s of real work, ~53 states, no thinning. Graduated out of this file.
- **[[0059-emoji-in-burned-text-needs-a-second-font]]** (new, decision) — the tofu, the verified
  two-font fix, the ~2.06 MB / 10-request cost, the founder decision still pending.
- **[[analyze-demo-cost]]** and **[[every-upload-spends-2.40]]** (updated) — `85d9ec0b` added and
  "retries re-pay in full" rewritten (two three-attempt jobs came out opposite ways); the ₪4.35 open
  question narrowed; five drifted cites fixed between them.

**The emoji font change is NOT in this container's tree.** The brief said it was sitting uncommitted
in `packages/remotion/src/overlays.tsx`; `git status` here is clean and `overlays.tsx:1` still loads
Heebo alone. Likeliest reading: it lives on the founder's own machine and never reached this remote
clone — **UNVERIFIED**, and a session that expects to find it will not.

**Pruned in the same pass** (one line, not a section — last session's list was deleted on exactly that
reasoning): the 90-second cap's performance half → the fact note above; "What landed (2026-09-17)" →
0052–0058 already carry it, three SHAs kept below; last session's graduation list → `git log
--follow`; queue items 2 and 3 as "unmerged branches" → both merged, what survives is the box deploy
(item 8). **Still with no vault note, dying with this file:** the `pg_stat_statements` deploy check,
the `b8af879` artifact-confirmed deploy, the `admin.tavnit.ai` question.

## Corrections — the cheapest lines in the file

Each cost real time, and each came from asserting rather than checking.

**From 2026-09-18, assistant-side:**

- **"The vision batches probably ran fine; suspect ffmpeg passes, 429 backoff, or heavy-lane
  contention." WRONG on all three.** `locked_at` is 2s after `run_at`, so the lane was idle; there
  was no 429; one zod parse failure caused everything.
- **"Parallelising the vision batches would collapse 8 calls into 2-3 rounds." WRONG** — they
  already run concurrently via `Promise.allSettled`. Caught by reading before proposing.
- **"The 93-second gap before `POST /plan` looks like a missing affordance." WRONG.** Measured:
  analysis ready 01:04:09.53, the client's last poll at 01:04:11.38 saw ready, the sections job
  finished 01:04:16.78 (7s, never the blocker), the founder clicked 01:05:44.27. Nothing was waiting
  on anything. **The one real finding underneath it:** that poll landed 5.4s BEFORE sections was
  written, so it got `sections: null` — harmless today (the picker re-fetches on mount and the ~25s
  plan call keeps the window shut), but a **latent race**, cheaper written down than rediscovered.
- **A lane-census query returned no rows because the window was written in log-local time against a
  UTC column** — same class as the `finished_at` column that did not exist
  ([[local-workers-claimed-nine-production-jobs]]). **Production queries are UTC; the Vercel access
  log renders IDT (UTC+3). Convert before querying, never write a local time into the vault.**

**From 2026-09-20, assistant-side:**

- **The fix brief's (A) — "a lenient provider schema takes the enums out of the grammar" — WRONG in
  its premise.** The enums were never in the grammar: `@anthropic-ai/sdk` 0.111.0 folds `enum` and
  `const` into description prose, so there was nothing for a lenient client schema to loosen.
  Caught by Step 0.1 of the brief, which existed to test exactly that premise
  ([[sdk-folds-enum-and-const-into-description]]).
- **"An enum slot holds a model-chosen token, never screen text" — WRONG under the folded wire.**
  The slot was unconstrained; the review reproduced a screen label landing in it and reaching a
  warn log field. Fixed before commit 1 landed: a received value is quoted only when it has the
  shape of a token, otherwise its length alone.

**From 2026-09-18, founder-side:** the proposal to **cap demos at 30 seconds for speed**. Measurement
says duration was never the driver ([[demo-analysis-latency-is-not-duration-bound]]). A hypothesis
correctly tested and dropped, **not** a mistake — the point is that asking beat shipping.

**Older, still load-bearing — four about stale cites, because that is the recurring one:**

- **This file's own counters go stale and say so confidently** ("44 rows, 0000–0043" after 0047
  applied). **Fetch the artefact — `origin/main`, the ledger, `verify-migration-ledger.sql`
  §RESULTS — never this file, for a count.**
- **A brief is the least current thing in the room; re-grep even the part telling you the truth.**
  Two briefs in a row described merged branches as unmerged (queue item 8), and one handed over
  `auth.ts:78` as the _correct_ cite sixteen hours after it moved to `:132`.
- **Cites drift en masse, a "fix" can be wrong in a new way, and a commit that fixes a cite while
  editing the cited file invalidates its own cite.** Four notes cited `sets.ts:483`; the fix pointed at
  the definition while the described line had moved to `:745`. Three more were found drifted ~175
  lines on 2026-09-18, in notes three weeks old. **Size of an insertion does not predict drift; only a
  grep does — run it AFTER prettier, on your own result, not your parent's.**
- **A vault note may already exist for what you are about to write.** Grep `docs/vault/` first.
- **`grep -c` counts lines, not occurrences.** Reg. 2 gaps: 71 lines, 75 markers, **73 real gaps**.
- **A number without its conditions gets attached to the wrong ones.** The 45s render figure was
  assumed concurrency 2; it was 4. [[render-concurrency-hardcoded-above-core-count]].
- **A mitigation became an outage** — the temp-dir cron deleted the live worker's bundle, four days
  of dead renders ([[tmp-cron-deletes-live-worker-bundle]]). **Never point a janitor at a directory a
  long-lived process serves from.**
- **An acceptance gate passed against code that existed nowhere but that box.** Confirm the tree is
  clean before believing a gate.
- **Two promoted into CLAUDE.md in full, pointers only here:** a credential echoed in session output
  three times (verify by connecting, report the outcome, never the value), and "`npx -y supabase`
  because no CLI is installed" was false all along.
- **"Authorized origin" in Google Console was the wrong field** — _Authorized **domains**_, at publish.
- **"Billing unwired, so account caps are the only bound" was backwards** — the credit balance is the
  bound, and _tighter_ because billing is unwired ([[no-self-serve-credit-grant-path]]).
- **`/start` proves nothing about auth** — redirects unconditionally, discards
  `exchangeCodeForSession`. `/home` is the only real gate.
- `words_per_second` is **2.1** (calibration), not the seed's 2.2 (a guess).

## What landed (2026-09-19) — the landing repositioning, on `landing/two-services`, NOT merged

The public landing and `/about` sold the **retired** Service A — "מסרטון אחד", קריינות, "עם קול
ובלי" — and folded the talking head into one feature card. Both now sell the two services that
exist, under the app's own names, and claim nothing: no results, no organic-reach promise, no credit
or shekel number, no length for the talking head. The reasoning, the vocabulary rules
(כיתובים for hook + demo, כתוביות only for B) and the eight product claims re-read against the code
before shipping: [[0061-landing-positioning-two-services-no-results-claims]].

New: `apps/web/src/lib/landing-media.ts` + `apps/web/public/landing/` — every landing asset is one
typed object plus a file drop, no import and no page edit. Every slot ships empty and draws the
existing AdFrame still wearing its own label; "placeholder" never reaches the screen.

**The whole gate ran green from this machine — 1198 tests, 0 failures, all five suites.** ffmpeg IS
installed here, so the four core `ffmpeg ENOENT` failures under Unfinished measurement are a property
of that container, not of this repo.

**The last surface still selling the retired format is `app/home/pathway-cards.tsx:36`** — the
signed-in card into the A wizard, promising `כתוביות וקריינות` for a format with no audio stream.
Out of this change's scope (a `/home` surface), left for the founder.

## What landed earlier (2026-09-18/19) — the wait-timing fix — MERGED

`claude/analysis-wait-timing-backoff-z16uw9` is in `origin/main` (PR #48, `1849713`); this file said
"NOT merged" and was wrong. Both halves graduated into notes —
[[0059-the-wait-clock-counts-from-the-request-row-not-the-job]] and
[[0060-a-short-retry-backoff-is-not-a-pause]] — so the detail lives there, not here. Two render-wait
defects stay open and unfixed: [[render-wait-elapsed-resets-on-reclaim]] and
[[render-wait-says-nothing-about-a-long-budget-park]].

## Decisions made in conversation — not yet in a note

Each with its date. This is the main thing a new session cannot recover on its own.

1. **Annual billing DECLINED, 2026-09-16**, reaffirming [[0046-billing-ships-as-osek-patur]] §3.
   Monthly only — decided against, not "not built yet".
2. **VAT stays ON TOP at conversion, reaffirmed 2026-09-17.** 0046 §2 stands; "כולל מע״מ" nowhere.
3. **Checkout is a dead end BY DECISION, not omission** — the server answers 503 with a Hebrew line
   until the Sumit adapter exists, the client is written for the wired shape, so wiring is
   server-only. Noted because it reads like an unfinished feature and is not.
4. **`requires_new_card` is DEFERRED to the adapter task, not declined**, 2026-09-17 — gateway tokens
   are not portable, so building the state first would fix its shape to a vendor nobody had
   integrated. Checklist item 10 below.
5. **Product names on the plan cards follow the APP**, 2026-09-17 (`SERVICE_LABELS` in
   `lib/service-b-ui.ts`). Aligned, tests re-pinned.
6. **The demo upload cap is 90 seconds** (was 3 minutes), decided in chat 2026-09-16, built the same
   day: the ingest probe is the only gate (`DEMO_MAX_DURATION_MS`, `pipelines/demos.ts:20`), the limit
   is stated in the picker before a file is chosen, and `ready` demos longer than 90s stay usable
   because nothing re-checks later. **Hebrew is COPY PENDING FOUNDER REVIEW.** Still has no decision
   note. _(The performance half of this question is CLOSED and graduated —
   [[demo-analysis-latency-is-not-duration-bound]].)_
7. **Where `apps/admin` lives — proposed `admin.tavnit.ai`, never decided.** Deployed and publicly
   reachable on its vercel.app URL today. No note; dies with this file.
8. **`debitRender`'s non-positive-cost hole: deliberately not fixed.** The note is in the tree
   ([[debit-render-accepts-non-positive-cost]]); the decision is that it stays a note.
9. **Emoji: which font subset to ship — OPEN, 2026-09-18.** Gates queue item 4;
   [[0059-emoji-in-burned-text-needs-a-second-font]] has both options costed.
10. **Whether transient job retries should report to Sentry — OPEN, 2026-09-18.** Queue item 7.

## The queue

Two axes. **Money** (item 0) and **pipeline** (items 1–7, all from this session's diagnosis), then the
older launch items. Item 0 still outranks everything: nothing in billing earns money until it exists.

**0. The Sumit adapter.** `getBillingGateway()` returns `NotConfiguredGateway` outside `DRY_RUN`, so
production throws on any charge and the web tier maps it to 503. The checklist, as dictated:

1. Create a **SEPARATE test business** at `app.sumit.co.il/companies/newtestcompany`. **LANDMINE:
   connecting a test terminal on the real org disconnects its existing Upay clearing — never touch
   `developers/testterminal` there.** Test quotas ~100 actions / ~400 API calls a month; test docs
   carry business no. 999999998; no Upay, no 3DS in test.
2. Install modules **הכנסות + סליקת אשראי** on the real org.
3. Confirm schemas of `/billing/payments/charge/`, `/billing/payments/beginredirect/` (return-URL
   params, save-card mode) and `/billing/paymentmethods/setforcustomer/` — **single-use token only,
   never a PAN**; terms §8 promises card data is never held by us.
4. **Refund: no endpoint seen.** Check `/creditguy/gateway/transaction/` for a credit type
   referencing the original, and what `/accounting/documents/cancel/` does to the payment; else
   refunds go through the Sumit UI at launch.
5. **Idempotency:** does charge accept an external reference? If not, write the attempt row first,
   reconcile via `/billing/payments/get/` on timeout.
6. **Errors:** HTTP status, or a status field inside a 200 body — never treat 200 as success blindly.
7. **Card auto-update on replaced cards** — API-charged too, or only Sumit-run recurring?
8. **Chargebacks:** poll `/billing/payments/list/` or use triggers (Growth plan) — decide.
9. **3DS is production-only, ₪1 per attempt, first customer-present charge only.** The CVV exemption
   for recurring is automatic on Upay.
10. Add **`requires_new_card`**: the enum value, the one-live-per-user partial index, the renewal
    skip, the `/home/plan` banner.
11. **Rename the renewal charge description** from `AIUGC <name> — monthly renewal` to a תבנית one.
12. **Cap or dedupe `terms_acceptances` per user per version** — checkout inserts on every request.
13. **Refuse the `DryRunGateway` when the database host is production.** `apps/web/.env.local` has
    `DRY_RUN=1` against production, so a local upgrade click grants real credits.
14. **Sumit offers no integration support** — Facebook group, a paid support hour, or an external dev.

**1. The batch-granularity fix — FIXED ON BRANCH `fix/analysis-frame-salvage` (2026-09-20), two
commits, awaiting merge and box deploy.** Commit 1, the net: a parse failure rides the
`salvageBatchFrames` / corrective-retry / `a_analysis_max_degraded_fraction` path instead of
throwing out of the provider — the rejection unit is the frame, usage is recorded before any parse,
the envelope error carries the stop_reason, every rejection in a parallel round is logged, and the
wire is byte-identical to before. Commit 2, the cure: the three frame enums go into the decoding
grammar (`strictOutputFormat`; the pinned wire moved by exactly three nodes), because Step 0 of the
fix found they never were — the SDK folds `enum` into description prose
([[sdk-folds-enum-and-const-into-description]], measured with two authorized calls: the folded wire
returned `"click"` on request, the strict wire returned `"tap"`). **Deploy order matters for the
revert story, not the deploy:** the wire change is the production risk; if it misbehaves on the box,
revert commit 2 alone and keep the net. What shipped, with post-prettier cites: the FIXED block at
the head of [[analysis-parse-failure-discards-the-whole-attempt]]. **The double-wrap question is ANSWERED** —
both prefixes are `@anthropic-ai/sdk` 0.111.0 (`helpers/zod.js:41` inner, `lib/parser.js:63` outer),
the parse runs in a `.then` outside the client's HTTP retry loop (`messages.js:67`), so no internal
retry and one sample per attempt. What remains is the founder's: open the PR, merge, deploy the box
as ONE step gated on nothing running (`select id, type, status from jobs where status = 'running';`
→ empty, then `git pull && pnpm install && sudo systemctl restart aiugc-worker`, then `git log -1`
on the box shows the merge commit — `docs/07-worker-box.md` §11). No migration, no config row, no
prompt version moves.

**2. The wait surfaces — two parts, both now MEASURED rather than reasoned.** Independent of item 1,
cheap, and a lighter model can do it. (a) `analysisWaitView`'s elapsed comes from `now - lockedAt` for
a running job (`queue.ts:365-372`), so it **resets on every re-claim**: a real 8m19s wait displayed
`"פחות מדקה"`. (b) The `"הניתוח מושהה כרגע"` line (`service-a-ui.ts:216`) rendered **exactly twice**,
because `resumeAtMs` only appears when the delay exceeds `JOB_DELAY_VISIBLE_MS` (60s, `queue.ts:302`,
gated at `:361`) — `backoffMs(1)` is 30s+jitter (max 39,999ms, never visible) while `backoffMs(2)` and
`backoffMs(3)` clear it. A 65-second retry sleep reads to the customer as a fault.

**The same call was already made for renders and never propagated.** `renderWaitView` says nothing for
a backoff-parked render — founder call 2026-09-02,
[[0009-retry-backoff-is-invisible-to-the-customer]], whose closing line is explicit: _"Anything that
reintroduces per-attempt commentary to the customer is reopening this decision."_ The analysis surface
(`service-a-ui.ts:212-217`) **and the plan surface** (`:261-267`) both still carry it. This is
extending 0009 to two more surfaces, not new copy.

**3. Checkpoint the ffmpeg / storage / thumbnail phases.** ~30s per retry — the storage download
(`demo-analysis.ts:564`), two ffmpeg decode passes, `clusterStates` and ~53 thumbnail uploads have no
checkpoint guard and re-run in full every attempt, to reach the position of making one API call.
**Deliberately NOT bundled into item 1.**

**4. Emoji** — gated on the founder's chunk-vs-curated-set decision (conversation decision 9), then
**~7–10h** of work, split by the reporting model as: tokenizer and grapheme-cap work **4–6h** (its own
least-confident area — server/client grapheme-boundary parity for U+FE0F and U+200D), the
`findPlanViolations` model-path rule **~1h**, the picker **2–3h**.

> **Two things checked since, both changing its shape.** (a) The estimate flagged "have not checked
> whether `tokenizeWords` and `labelRuns` share code": **they share the splitter, not the matcher.**
> `labelRuns` (`service-a-ui.ts:669-693`) calls core's `splitWords` and matches **exactly**;
> `tokenizeWords` (`plan-format.ts:131-132`) is `splitWords` + `normalizeWord`. One tokenizer, two
> matching layers — grapheme work lands in `splitWords` (`plan-format.ts:106-112`, one regex) and
> both callers inherit it, which should pull the 4–6h down. (b) Pushing the other way: **shipping the
> font makes "emoji cannot be burned" false while three places still assert it** —
> `hook-text.ts:39,74`, `copy.ts:89-96`, and the customer-facing Hebrew at `service-b-ui.ts:262`.
> Not in the estimate at all. Both written up in [[0059-emoji-in-burned-text-needs-a-second-font]].

**5. Why the URL-typing state landed in the collapsed `"צעדים פחות מתאימים"` tier and never made the
plan. UNDIAGNOSED** — the only thing from this session's original scope still fully open. Two live
hypotheses: `screenKind: "system"` (browser chrome is the natural read, and `"system"` is in
`PLAN_SKIP_SCREEN_KINDS`, `plan-format.ts:24-25`), or `legibility: "low"`. **The structural conflict
worth checking either way:** `prompts/plan_demo_steps/v14.md:137-142` §4 "Open with the way in" tells
the model to select the URL state as the **FIRST** step, while `findPlanViolations`' `isSkippedKind`
(`demo-step-plans.ts:53-54`, applied at `:603`) hard-rejects any skip-kind state. _§4 already
pre-empts the legibility objection in so many words ("The home page is often `legibility: "low"` —
take it anyway for this one step"), which weakens hypothesis (b) without killing it._ **[MEASURED]**
the state IS in the timeline: ~53 states under the 80 cap means no thinning occurred, so it was
**demoted, not dropped**.

**6. Move the demo upload to the FIRST wizard step** so the analysis runs behind the remaining steps.
Founder's idea, and correct. **The honest size [MEASURED]:** the wizard opened 00:53:52 and the demo
registered 00:55:10 (UTC) — **~78s** of pre-upload work to overlap, **~45s of it already overlapped**.
Worth more AFTER item 1, when a ~90-second analysis is something 78 seconds can cover. **Needs the
wizard's step order and persistence model documented first — that is unwritten.**

**7. Whether transient retries should report to Sentry. A decision, not a task.** `reportTerminal`
fires only on a permanent failure or `isLastAttempt` (`jobs/worker.ts:134-140`, `:153-160`), per
[[0037-the-worker-reports-to-sentry-the-web-apps-do-not]]. Job `85d9ec0b` never reached
`isLastAttempt` (`max_attempts` 5, three failures), so **the silence is the wiring working**. The
consequence is the question: a job can burn ~8 minutes of customer-visible latency across three
failures and leave no signal in Sentry, in the dashboard, or anywhere a human looks.

**8. Two branches listed here as unmerged ARE MERGED — what remains is the BOX.** `git merge-base
--is-ancestor` against `origin/main`: the label provenance rule is `4a29e92` (2026-09-15,
[[0049-the-label-provenance-rule-is-a-highlight-not-a-gate]], [[label-rule-families-2026-09-15]]) and
`prompts/plan_demo_steps/v14.md` is on `main`; the `רגע` ban rule is `ecf50c5`, merged via PR #32
(`ade760a`, [[0046-the-rega-ban-targets-the-hesitation-tick-not-the-word]],
[[ban-rule-test-collides-with-a-curated-hook]]).

**Not closed, and uncheckable from this container: the box deploy.** A prompt version goes live **per
call** the moment the file lands, while worker code needs a restart — a `git pull` without a restart
is the hazard ([[prompt-versions-on-disk]]). Owed: deploy as ONE step gated on nothing running
(`select id, type, status from jobs where status = 'running';` → empty, then
`git pull && pnpm install && sudo systemctl restart aiugc-worker`, then `git log -1` on the box);
confirm the first live plan stamps `plan_demo_steps@v14` and carries `offScreenWords`; run
`aiugc bank seed-structures --update` against production (the seed file is not the live source —
[[0028-scripts-end-on-a-closer-from-a-curated-bank]]); and the founder's review of 0049's Legal
section (REASONED, not counsel-confirmed — `docs/legal-review.md` T9 carries the line).

**9. Audit the 12 `getStorage()` call sites in `apps/web` for the ownership check** — one line per
site: which route, what it checks, whether a caller can reach it with an id they do not own. The
invariant [[0045-the-web-tier-holds-the-service-role-key]] rests on, and that note says plainly it is
**UNVERIFIED**. **The only queue item that can surface a security defect.** Sites tabulated in 0045.

**10. Three loose ends from billing.** (a) **No seed for `past_due` or `suspended`** — neither state
was ever walked; their copy is unit-tested and nothing else, and a seed script is the cheapest way to
find out whether the banners and disabled buttons are right. (b) **The Drizzle snapshot gap** —
`migrations/meta/` holds snapshots `0000/0001/0002` and nothing after 0005. **A consequence of a
decision, not a bug**: migrations are hand-written portable SQL (35 of 48 files say so), PGlite
replays the files through `PORTABLE_MIGRATIONS`, `drizzle-kit generate` is not in the workflow. Cost:
`drizzle-kit` cannot diff this schema; nothing else reads the journal. Measured 2026-09-17. (c) **The
founder's copy review of `plans-ui.ts`** — still ⚠️ COPY PENDING FOUNDER REVIEW; numbers correct,
wording a first draft.

**11. `generateObject` shares the whole-object rejection unit — a decision, not a fix.** Its three
callers (`plan_demo_steps`, `group_analysis_states`, `copy.ts`/`tts.ts`) still go through
`messages.parse`: a parse failure throws whole-object, records NO usage (the ledger hole commit 1
closed for the vision call), and a `max_tokens` truncation surfaces with no stop_reason at all.
`group_analysis_states`' `.min(1)` / `.int().nonnegative()` are description-only on the wire
([[sdk-folds-enum-and-const-into-description]]). None of them carries an enum, so the casing
exposure does not apply. Whether they move to the raw seam and/or a strict wire is the founder's
call; the brief for the analysis fix deliberately left their wire untouched.

**12. Sweep the stale `apps/web/src/lib/auth.ts` cites.** `5c13ead` pushed everything below `signUp`
down ~54 lines. Verified 2026-09-11: `docs/08` `:383` and `:631`; [[auth-email-runs-through-resend]]
`:5`; [[auth-round-trips-that-miss-the-callback-die-silently]] `:24`; `0005` `:41` and `:48`. **Do not
touch `0006:26`** — correct there.

**13. Ceiling alert + `vat_rate` config — build with the gateway adapter, not before.** Spec in
[[0046-billing-ships-as-osek-patur]] §6.

## External state — not in the repo

Founder-reported from a dashboard unless a line says otherwise. **Nothing in this section changed on
2026-09-18.**

**Supabase.** Project `hyaqydcmwbnbaiqqufow`, `eu-central-1` (Frankfurt), Pro, Micro compute.
**Migrations 0000–0047 applied, ledger clean at 48 rows, no gaps, nothing pending.** Every push since
0036 was on the founder's explicit instruction **for that one push** — not standing permission — and
`db push` recorded each version itself, so `migration repair` has been needed zero times in ten.
History and read-backs live in `scripts/verify-migration-ledger.sql` §RESULTS (38 structural rows, 36
true / 1 false (0022, expected — every other false is real) / 1 NULL (0020)); the guarded- and
destructive-migration read-back rules are in CLAUDE.md. Do not re-narrate either here. Auth: Email on,
Google enabled, **Confirm email ON since 2026-09-11**, Site URL `https://tavnit.ai`,
`https://tavnit.ai/auth/callback` allowlisted. Custom SMTP, 100 emails/hour. Hebrew auth templates in
`docs/08` §8A.2.

**`events` is EMPTY — 0 rows, every kind.** Not `platform_budget_tripped`, not
`qc_release`/`qc_reject`, not `content_policy_flag`. The alert sweep reads an empty partial index
every 60s. **A session that finds silence here must NOT read it as "the feature is broken"** — that is
the intended steady state, and the first real proof has to be provoked. Non-succeeded jobs: 3 dead
`render_video` (the 2026-08/09 bundle bug), 2 `lipsync` failed on HeyGen credit. `subscriptions` is
**0 rows**.

**Resend.** Region **Ireland (EU)**, `tavnit.ai` verified, DKIM `TXT resend._domainkey`, sending via
two CNAMEs (`rsend`, `send`) not an SPF TXT, DMARC `p=none`, receiving off. Free tier 3,000/month
**AND 100/day — the daily figure is the real ceiling** ([[auth-email-runs-through-resend]]). **The
transfer basis is still open** — an Irish sending region says nothing about US access by a US company,
and `/privacy` deliberately claims no basis. Unanswered at `docs/legal/reg2-open-questions.md:131`
(COUNSEL) and `:167` (VENDOR).

**The box.** `aiugc-worker.service`, `Restart=always`, `WORKER_ID=hetzner`. Last confirmed at
`b8af879`; `origin/main` is now `f84e931`, so **the box is behind by at least the billing merges and
the two branches in queue item 8 — UNVERIFIED, nobody has run `git log -1` on it since 2026-09-11.**
Sentry confirmed active **by test** (a job inserted knowing it would fail; the founder got the email),
not by a log line — `error reporting on` also prints for a malformed DSN. `journalctl` sees unit
lifecycle and OOM kills (`usermod -aG systemd-journal aiugc` has been run). `ufw` active, OpenSSH
only, key-only SSH from one desktop. `sudo` needs a password, so an unattended session cannot
`systemctl restart`; `kill -TERM $(systemctl show aiugc-worker -p MainPID --value)` is equivalent.
Deploys: `docs/07-worker-box.md` §11.

**Vercel.** `apps/web` off this monorepo: Root Directory `apps/web`, Next.js preset, no overrides,
region `fra1`, `ANTHROPIC_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` present. Admin project also `fra1`.
`NEXT_PUBLIC_*` must be type Config, not Secret. **The access log renders IDT (UTC+3); the database
does not.**

**Hetzner.** One server `tavnit-worker`, CPX32 (**4 vCPU**, not 8), Nuremberg, Ubuntu 24.04, ~$41/mo +
~$0.72 IPv4. A powered-off server still bills in full — only deletion stops the meter. Two snapshots.
[[0007-worker-box-instance]].

**GitHub.** Fine-grained PAT, **no expiration**, scoped to `AIUGCBackend`, Contents read-only,
plaintext in `~/.git-credentials` on the box. Nothing will remind anyone it exists; revocable only at
GitHub. [[0008-github-pat-over-deploy-key]]. **Google OAuth** published, _In production_, scopes
`openid`/`email`/`profile` — do NOT upload a custom app logo, it triggers brand review even with
non-sensitive scopes.

## Owed founder actions

- **Shoot and drop the landing media** — six slots, all empty today: `demoBefore`/`demoAfter`
  (one recording and the ad built from it), four hook clips, a hook-studio screenshot, a presenter
  clip, an Instagram screenshot. Filenames and the two-step swap are in
  `apps/web/public/landing/README.md`; the page renders correctly without them.
- **Set the presenter's name and Instagram URL** in `apps/web/src/lib/landing-media.ts`.
  `presenterName` is `"עדי"` as a stand-in and `instagramUrl` is `null`, which hides the link. **The
  `#proof` copy is written feminine — if the presenter is male, rewrite it rather than regendering
  it in a session.** [[0061-landing-positioning-two-services-no-results-claims]].
- **Update the address on the עוסק פטור registration** — still כאבול while every public page says
  ברזיל 14, תל אביב. **UNVERIFIED**: he said he is doing it; nobody has seen the file
  ([[0058-the-operator-address-is-a-tel-aviv-street-address]]).
- **Send the reply email to UPay** confirming each site requirement and where it is satisfied. The
  Hebrew draft was handed over with the change that implemented them.
- **Restart the worker box** (queue item 8 and the box entry above). Blast radius is wider than it
  was: the renewal change, the label rule and the `רגע` ban fix are all merged and none is running.
- **Create the Sumit test business** (queue item 0, step 1) — the adapter cannot start without it.
- **Decide the emoji font subset** (conversation decision 9) — queue item 4 is blocked on it.
- Vendor DPA / reg. 3 undertakings (Anthropic, ElevenLabs, HeyGen, fal.ai, Sentry, Resend), the
  ElevenLabs voice licence question, Sentry's data region, the עוסק פטור ceiling on gov.il. Full list:
  the closing section of `docs/legal-review.md`.

## Open decisions

**Housekeeping, unresolved: `decisions/` has two 0046s, two 0047s and two 0049s** — six notes, three
numbers, from concurrent sessions each taking "the next free number". Nothing is lost (slugs are
distinct, every inbound link uses the full filename), but `[[0047]]` is ambiguous. 0050, 0056–0058 and
0059 were taken **above** the highest number rather than filling a gap, because renumbering a
published note breaks the links pointing at it. Renumber or leave it — a founder call.

- **Narrowing the ICP — RAISED AND DEFERRED, 2026-09-19**, as its own decision. The
  physical-product category STAYS: `WhatChooser` still offers `מוצר פיזי` first and the landing still
  addresses it. Recorded so the absence of narrowing reads as deferred, not overlooked.
  [[0061-landing-positioning-two-services-no-results-claims]] §5.
- **Service B ships unreviewed, by decision.** `auto_release_b` is `true` and stays true
  ([[0036-auto-release-b-is-always-on]]). **Not** settled: whether anything else should stand in that
  space at self-serve scale; as of `c442447` the content-policy classifier does
  ([[0042-content-policy-is-wired-at-both-choke-points]]).
- **The reg. 2 מסמך הגדרות מאגר — DEFERRED INDEFINITELY, 2026-09-11**, consequences accepted, a lawyer
  when the founder sees fit. **Not a queue item — do not put it back.**
  [[0043-the-reg-2-definitions-document-is-deferred-by-decision]]. It does not retract `/privacy` §11.
  [[database-definitions-document-missing]] stays open by choice.
- **The `users`/`auth.users` casing gap.** `ensureUser` is guarded; confirm the fix closed the silent
  variant for every writer, not just the CLI.
- **`lipsync_resolution`** is the only `app_config` key still genuinely provisional
  ([[0004-service-b-config-is-provisional]]).

## Unfinished measurement

- **No cold render measured on the box** — one including the ~92 MB Chrome Headless Shell download.
  Matters only if the box is rebuilt from scratch rather than from a snapshot.
- **What Supabase does with a provider rejection** once Resend's 100/day is spent — reasoned from two
  published limits, not observed.
- **This container cannot run the full test gate.** `ffmpeg` missing (5 core suites fail `spawn ffmpeg
ENOENT`) and `remotion.media` 403s for the Chromium Headless Shell (1 remotion test). Environment
  gaps, not repo failures; a session reporting "gate green" from here is reporting 4 of 5 suites.
  It also starts with **no `node_modules`** — `pnpm install --frozen-lockfile` takes ~7s and is worth
  running before anything else, since prettier and every dependency read depends on it.
- **The worst-case analysis is unmeasured.** ~53 states is one 90s demo; a denser one could approach
  the 80-state cap and add a seventh batch.

---

## How to hand over

This file is overwritten in place, never duplicated. `git log --follow` on it is the history. **If
this file and the repo disagree, the repo wins** — treat anything here as a pointer, not a source of
truth.

### Closing a session — paste into the chat that's ending

```
Update docs/vault/state-of-play.md for handover. Rewrite the existing file in place —
don't produce a new version, git history is the versioning.

Cover: what actually changed this session (done / committed / still uncommitted);
decisions made in conversation that never reached the repo, each named, with where it
should eventually live in the vault — the main thing a new session cannot recover on its
own; corrections, anything either of us asserted that turned out wrong, keep them, they're
the cheapest lines in the file; the queue, reordered if this session changed the order,
with reasoning wherever it isn't self-evident; and external state that changed.

Be explicit about verified versus assumed — if something was true when written and you
can't confirm it still holds, mark it rather than repeating it. Prune as you go: delete
anything finished or graduated into a vault note, and tell me which ones graduated so I
can confirm they landed. This file must not grow session over session.

Separately, outside the file: what should I hand to Claude Code before I close this chat,
and is anything still uncommitted or unpushed?
```

### Opening the next session — paste as the first message

```
Read docs/vault/state-of-play.md. It's the handover from my last session — the queue,
external state, and the decisions that never made it into the repo.

I'm working on: [what you're doing]

Search the vault before answering, and tell me if anything in the state file looks out of
date relative to the repo — project knowledge syncs on a delay, so the tree you can see
may be ahead of it.
```
