---
type: state
status: current
updated: 2026-09-11
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

**The product is live end to end.** `tavnit.ai` serves `apps/web` on Vercel; a full Service A wizard
run went from demo upload to a finished MP4 on the Hetzner box. Google sign-in is public, `/privacy`
and `/terms` are shipped, `apps/admin` sits behind HTTP Basic in front of `requireAdmin`. The Service
B engine and its wizard are built and merged; the first real B wizard render was 2026-09-05. Service
B format and engine decisions are all in `decisions/` — start at
[[0017-service-b-single-setting-selfie-talking-head]],
[[0023-hook-is-a-remotion-animation-opener-clips-retired]] and
[[0024-hook-effect-is-a-render-param-the-customer-picks]], and read CLAUDE.md's Service B paragraph
rather than a summary here.

**Email confirmation is ON as of 2026-09-11** — the one live behaviour change a new session is most
likely to trip over. Every new signup now depends on an email being delivered through Resend, and the
real ceiling is 100/day at the provider: [[auth-email-runs-through-resend]].

**The rule that cost two incidents, and the first time it paid.** Verify the deployed **artifact**,
not the symptom: `git log -1` on the box, never "a render worked afterwards" — a restart alone
produces that. `docs/07-worker-box.md` §11 carries the check.
**2026-09-11 it was run on a real deploy and PASSED** (founder-reported, and the strongest external
evidence this file holds): `git log -1` on the box returned `b8af879` — the PR #26 merge — with
`HEAD -> main, origin/main, origin/HEAD` on it, and its two parents are `ab0245e` (the main the
branch was cut from) and `d56f702` (the branch tip). That proves the deployed artifact _is_ the
merged branch, by lineage rather than by symptom. First artifact-confirmed box deploy in this repo's
history. History of the two incidents that bought it:
[[0039-three-deploy-axes-and-the-box-is-the-one-that-forgets]],
[[bundle-fix-reached-the-worker-box]], [[tmp-cron-deletes-live-worker-bundle]].

### Verifying a deploy without the box

There is now a **second** way to confirm the box's code, and it needs no SSH, no founder report and
no write of any kind. It is weaker than `git log -1` — it identifies _behaviour_, not a commit — but
it is available from this machine at any time, which `git log -1` is not.

Pick a query that exists ONLY in the code you just merged, then watch it tick:

```sql
select calls from pg_stat_statements where query like '%<a fragment unique to the new query>%';
```

Sample it, idle past one interval of whatever loop should be running it, sample again. A rising
count is a process that is not you executing code that did not exist before the merge. Pair it with
`pg_stat_user_indexes.idx_scan` for an index the same migration created — if the two move in
lockstep, the planner is using the index too, which a bare `CREATE INDEX` read-back cannot show.

Used 2026-09-11 to confirm the PR #29 deploy. **Caveats, both real:** `pg_stat_statements` is
cumulative since the last reset, so only the DELTA means anything — an absolute count includes every
read-back you ran yourself. And it proves a _behaviour_ shipped, not that the box is at a given SHA;
if you need the SHA, it is still `git log -1` on the box (`docs/07-worker-box.md` §11).

## What changed this session — `launch/resend-parkvalve-alerts`, MERGED as PR #29

Cut from `origin/main` at `d4c79ef` (PR #28), merged back as **PR #29 (`9de62d0`)**. Four commits,
one per task, plus the handover — and one follow-up commit recording the 0037 apply.

| commit    | what                                                                                        |
| --------- | ------------------------------------------------------------------------------------------- |
| `3a3deda` | privacy §6 discloses Resend; `legal-review.md` P11; `UPDATED` -> 11.09.2026                 |
| `692c3dd` | reg. 2 is deferred BY DECISION — vault `0043`, out of the queue, into Open decisions        |
| `ba6a239` | the budget-park valve now ends non-render work; `packages/core/test/park-valve.test.ts`     |
| `5c13ead` | the auth-email alert — migration **0037**, `core/src/alerts.ts`, vault `0044`, 0037 amended |

**Migration 0037 (`events.notified_at` + a partial alert index) IS APPLIED** — pushed to production
2026-09-11 on the founder's explicit instruction for that one push, and `db push` recorded the
version itself, so no `migration repair` (fourth time that prediction has held). Ledger read-back:
**38 rows, 0000–0037, no gaps.** Post-apply read-back went through the drizzle model, not raw SQL —
`apps/cli/node_modules/.bin/tsx packages/core/scripts/verify-events-notified-at.ts` returned PASS.
Proof block: `scripts/verify-migration-ledger.sql` §RESULTS.

**The box is deployed, and for once that is MEASURED rather than founder-reported.** The park valve
and the alert sweep both live in worker code, so neither ran until the box was deployed at the merged
tip; the founder deployed it 2026-09-11 ~18:15 UTC. Confirmed from here, read-only, without touching
the box: the alert sweep's `SELECT` over `events.notified_at` exists ONLY in post-#29 code, and its
`pg_stat_statements.calls` rose **5 -> 7 across 140 idle seconds** (60s sweep interval), with
`events_unnotified_alerts_idx.idx_scan` rising 5 -> 7 in lockstep and `reap_dead_renders.locked_at`
advancing 18:18:35 -> 18:20:37. A process that is not this machine is executing a query that did not
exist before the merge. The exact method is under **Verifying a deploy without the box** above.
The web half (the
disclosure, the route, the classifier) shipped with Vercel on merge.

**What both new mechanisms are actually looking at, measured 2026-09-11 after the deploy.** Both are
running against nothing, and that is the intended steady state, not a fault:

| measured                                    | value                                                                                  |
| ------------------------------------------- | -------------------------------------------------------------------------------------- |
| `events` rows, all kinds                    | **0** — no event kind has ever fired in this project                                   |
| jobs ever parked for budget (`error_class`) | **0** — the park valve has never had anything to end                                   |
| `reap_dead_renders` cadence on the box      | self-rescheduling, **60s**, `locked_by = hetzner:light`                                |
| non-succeeded jobs                          | 3 dead `render_video` (the 2026-08/09 bundle bug), 2 `lipsync` failed on HeyGen credit |

So the alert sweep reads an empty partial index every 60s and the valve sweeps an empty set — both
by design. A future session that finds silence here should NOT read it as "the feature is broken".
The first real proof either one works end to end has to be provoked; the founder's manual test does
it with one `recordAuthEmailFailure` call.

**Two queue items were closed by this branch and are gone from the queue** — the Resend disclosure
and the budget-park exit. The queue is renumbered accordingly.

## What changed this session (2026-09-11)

Branch `overnight/launch-blockers`, six commits, merged to `main` in **two** PRs — #26 (`b8af879`,
the five work commits) and #27 (`5a52ded`, the `2828fd3` docs commit). `origin/main` is `5a52ded`.

| commit    | what                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------- |
| `702742a` | privacy §6 describes what the edge check actually reads; `docs/legal-review.md` P3 rewrite      |
| `b39bb2c` | **the local/DRY_RUN worker claim guard** — `packages/core/src/jobs/queue.ts`                    |
| `3080b73` | migration 0036 (`daily_caps` → runaway detector) + `packages/core/scripts/verify-daily-caps.ts` |
| `c442447` | content policy wired at `createSet` and `createBRender`; vault 0042, 0041 superseded            |
| `d56f702` | `docs/legal/reg2-open-questions.md` — the reg. 2 triage worksheet                               |
| `2828fd3` | records the 0036 apply, and that it was a DATA no-op                                            |

`2b8e6ee` (privacy §6 names Sentry) is **not** in that range — it landed 37 seconds before
`ab0245e`, the commit the branch was cut from. Same night's work, different side of the cut.

**`b39bb2c` closes a mechanism this file used to describe as unguarded.** A worker whose
`DATABASE_URL` points at the production project now **refuses to claim** if it is a `local:*`/`cli:*`
worker or if `DRY_RUN` is set, and says so. `aiugc work --once` exits rather than spinning.
[[local-workers-compete-with-the-box-for-production-jobs]] is the note; its "the only guard is the
founder remembering" line is now historical.

**Uncommitted at the time of writing** — this session's own bookkeeping, all docs/vault:
`docs/08-supabase-project-rebuild.md` (new §8A.2), four vault notes newly written, and cite/claim
corrections across seven existing ones. Nothing in `packages/` or `apps/` is touched.

**Local `main` is 8 commits behind `origin/main`** (`git branch -vv` → `behind 8`). Nothing is
unpushed — `origin/main..main` is empty — but a session that reads local `main` reads `ab0245e`.
Fast-forward it before trusting it.

**The box is one merge behind `origin/main`**: it is at `b8af879`, which does not contain `2828fd3`.
That commit is docs-only, so there is no functional drift — but "the box is at merged main" is no
longer literally true, and the next deploy should say `5a52ded`.

## External state — not in the repo

Everything in this section is **founder-reported from a dashboard**, not observed from this repo,
unless a line says otherwise.

**Supabase.** Project `hyaqydcmwbnbaiqqufow`, `eu-central-1` (Frankfurt), Pro, Micro compute.
**Migrations 0000–0037 applied, ledger clean, 38 rows, no gaps** — 0036 and then 0037 both pushed
2026-09-11, each on the founder's explicit instruction for that one push; `db push` recorded both
itself, so no `migration repair` was needed (third and fourth time running that the prediction
held). Proof block: `scripts/verify-migration-ledger.sql` §RESULTS.
**`events` is EMPTY — 0 rows, every kind, measured 2026-09-11 right after the 0037 apply.** No event
kind has ever fired in this project: not `platform_budget_tripped`, not `qc_release`/`qc_reject`,
not `content_policy_flag`, not `refund_resolved_to_ancestor`. So the alert sweep reads an empty
partial index every 60s, which is the intended steady state and not evidence it is broken.
**`npx -y supabase` is no longer the right recipe** — `supabase` is a root devDependency (2.109.1)
and the pinned local binary was spawned directly. `CLAUDE.md:132` still says no CLI is installed.
Auth: Email provider on, Google enabled, **Confirm email ON since 2026-09-11**, Site URL
`https://tavnit.ai`, `https://tavnit.ai/auth/callback` on the redirect allowlist.
Custom SMTP configured; **Rate Limits raised to 100 emails/hour**. All five Hebrew auth templates
were written in the dashboard and are now reproduced in `docs/08` §8A.2.

**Resend — a new vendor and a new processor.** Account created, `tavnit.ai` verified, propagation
complete. Region **Ireland (EU)**. DNS at Namecheap: DKIM `TXT resend._domainkey`; sending via two
**CNAME**s (`rsend`, `send`) — _not_ a TXT SPF record; DMARC `TXT _dmarc` = `v=DMARC1; p=none;`.
Receiving off (no MX). Free tier **3,000/month AND 100/day**.
**The 100/day is the real ceiling, not the 100/hour** — see [[auth-email-runs-through-resend]].
It was disclosed nowhere until `3a3deda` (merged in PR #29):
[[resend-is-an-undisclosed-processor]] carries the dated FIXED block. **The transfer basis is still
open** — an Irish sending region says nothing about US access by a US company, and the page
deliberately claims no basis. That question is filed unanswered in
`docs/legal/reg2-open-questions.md:131` (COUNSEL) and `:167` (VENDOR).

**The box.** `aiugc-worker.service`, `Restart=always`, `WORKER_ID=hetzner`. At `b8af879` after the
2026-09-11 deploy (`git pull && pnpm install && sudo systemctl restart aiugc-worker`).
**`sudo usermod -aG systemd-journal aiugc` HAS been run** (2026-09-10) — systemd unit lifecycle
lines, restarts and OOM kills are now visible to `journalctl` as that user. Old queue item 8 closed.
**Sentry is confirmed active by test, not by a log line**: a job was inserted knowing it would fail
and the founder received the email. That satisfies this repo's own warning that
`error reporting on` also prints for a malformed DSN. Old queue item 7 closed.
`ufw` active, OpenSSH only, key-only SSH from one Windows desktop with no second key pair. `sudo`
needs a password, so an unattended session cannot `systemctl restart`; `kill -TERM $(systemctl show
aiugc-worker -p MainPID --value)` is equivalent. Deploys: `docs/07-worker-box.md` §11.

**Vercel.** `apps/web` off this monorepo: Root Directory `apps/web`, Next.js preset, no overrides,
region `fra1`, `ANTHROPIC_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` both present. Admin project is
also `fra1`. `NEXT_PUBLIC_*` variables must be type Config, not Secret.

**Hetzner.** One server `tavnit-worker`, CPX32, Nuremberg, Ubuntu 24.04, ~$41/mo + ~$0.72 IPv4.
A powered-off server still bills in full — only deletion stops the meter.
[[0007-worker-box-instance]]. Two snapshots taken (2026-09-10).

**GitHub.** Fine-grained PAT, **no expiration**, scoped to `AIUGCBackend`, Contents read-only,
plaintext in `~/.git-credentials` on the box. Nothing will remind anyone it exists; revocable only at
GitHub. [[0008-github-pat-over-deploy-key]].

**Google OAuth** is published, status _In production_, scopes `openid`/`email`/`profile`. Do NOT
upload a custom app logo — it triggers brand review even with non-sensitive scopes.

## Decisions made in conversation — not yet in the repo

1. **Where `apps/admin` lives — proposed `admin.tavnit.ai`, never decided.** Admin is deployed and
   publicly reachable on its vercel.app URL today. Should land in `decisions/` when settled.
2. **`debitRender`'s non-positive-cost hole: deliberately not fixed.** The note is in the tree
   ([[debit-render-accepts-non-positive-cost]]); the decision is that it stays a note.
3. **The orphaned a-sets routes were deleted, not guarded** (`497fc24`). Reasoning worth keeping:
   the base route predated the BalanceProvider design and returned no post-debit balance, so a
   future voiced flow rewrites it regardless — a stale draft, not a reusable asset.
4. **Resend's transfer basis is an open question, not a resolved one.** EU sending region ≠ no US
   access; Resend is a US company. Do not write "EU, therefore covered by §7's German clause" onto
   a legal page. Belongs to counsel, tracked in `docs/legal/reg2-open-questions.md`.

## The queue

1. **Correct `docs/08` §8A.1.** `:429-438` asserts `signUp` has **no** `emailRedirectTo` and the
   table row `:443` says a one-line change is needed. Both false — `auth.ts:78` has passed it since
   `02f58bb`. Cheap, and it has now caused a real error once (see Corrections). §8A.2 cross-references
   the falsehood rather than rewriting it, so the correction is one reviewed edit.
2. **Fix the `bans רגע` flaky test.** 12.0% per run of its file, by construction. Worth doing before
   it reddens a gate at a bad moment and someone "fixes" it by weakening the ban — which is the wrong
   fix twice over, because the real question is whether a curated hook may contain a word the prompt
   bans. [[ban-rule-test-collides-with-a-curated-hook]].
3. **Record the real test gate command in CLAUDE.md.** `:110` says `pnpm test  # core tests`; it is
   `pnpm -r test`, fans out to five packages, and OOMs this machine. Every prompt written for this
   repo uses "tests green" as its stop condition, so as written the stop condition is unrunnable.
   [[pnpm-r-test-ooms-this-machine]] has the five serial commands.
4. **`.env.example:9`** — "never the service role key" is confirmed stale against how web actually
   runs (the key IS in Vercel's web env; the wizard signs storage URLs server-side). Deliberately not
   edited: what it should say instead is the founder's call, and the honest options differ — drop the
   clause, or keep it and move the signing off the web tier.
5. **Correct `docs/02-jobs.md`.** Two wrong numbers on one line — and **the line has moved**: it is
   `:168`, not the `:111` this queue said for weeks. "Hetzner CPX41-class, ~€30/mo flat" predates the
   June 2026 price rise and understates by roughly half; "~2–6 min wall time per video" is 2–5× too
   slow against three measured renders ([[service-a-render-wall-clock-on-the-box]]).
6. **Correct the stale in-code cite at `packages/core/src/pipelines/sets.ts:241`** — it points at
   `copy.ts:675-680` for the `content_policy_flag` insert, which is `:706-711`. Left alone because
   this session was docs-only. Trivial, but see Corrections for why this class keeps recurring.
7. **Docs-only cleanup: the pre-publication OAuth passages.** Found 2026-09-03, still open. None is
   load-bearing; all of it misleads. `docs/08` §8B `:495`, `:501`, `:514`, `:547`, `:608`, `:672`;
   `0006` `:34`, `:52`, `:54`; `0005` `:14`, `:30`. **Every one of those line numbers predates this
   session's §8A.2 insertion, which added 151 lines at `:472` — so all the `docs/08` cites above are
   now ~151 low. Re-grep, do not trust them.**
8. **Correct `CLAUDE.md:130`'s apply recipe.** It says "no Supabase CLI is installed — npx fetches
   it", which is **false**: `supabase` is a root devDependency (2.109.1) and the pinned binary lives
   at `node_modules/.pnpm/@supabase+cli-windows-x64@2.109.1/…/bin/supabase.exe`. The 0037 apply on
   2026-09-11 spawned that `.exe` directly rather than `npx -y supabase` — deliberately, because
   spawning the `.cmd` shim on Windows needs `shell: true`, which would put the connection string
   through cmd.exe quoting. Same line also still says `db push` "records the version itself", which
   held for a fourth time and is correct.
9. **Correct `CLAUDE.md:79`.** It says the old project `mtpmrqltldfwhziyyzdu` "is what every `.env`
   still points at" — **false since 2026-08-27**; all five env files point at
   `hyaqydcmwbnbaiqqufow`, and the old project is deleted. Same line's "ledger clean at 0000–0030"
   is stale at 0000–0037. `CLAUDE.md:130` is **not** current either — see item 8.

Items 1–3 first because each is cheap and each is a trap for the _next_ session rather than a
feature. 4–9 are corrections ordered by how likely a reader is to act on the wrong thing. There
is no open code defect in this queue any more.

**Three items left this queue on 2026-09-11, and they left in two different ways.** The Resend
disclosure and the budget-park exit were **DONE** (PR #29). Reg. 2 was **DEFERRED** — not done,
not dropped, decided: [[0043-the-reg-2-definitions-document-is-deferred-by-decision]]. See Open
decisions below.

## Open decisions

- **Invoice document type before billing ships.** The billing plan issues חשבונית מס; the operator is
  עוסק פטור and cannot — [[invoicing-plan-cannot-issue-for-an-osek-patur]]. Either ship billing as
  עוסק פטור (קבלה / חשבונית עסקה) or convert first. No money moves today, so nothing is currently
  wrong; it is a configuration decision the gateway work must not skip.
- **The reg. 2 מסמך הגדרות מאגר — DEFERRED INDEFINITELY by founder decision, 2026-09-11.** Not
  pending, not owed-and-unstarted: decided, with the consequences accepted explicitly, and a lawyer
  to be engaged when the founder sees fit. This is no longer a queue item — do not put it back, and
  do not open it as unfinished work. [[0043-the-reg-2-definitions-document-is-deferred-by-decision]]
  is the decision and carries what stands behind it:
  `docs/legal/database-definitions-document.md` (990 lines, Hebrew, drafted, served by no route — 981
  until 0043 put a STATUS blockquote at its head, which is why the older notes say 981),
  **73 real gaps** bucketed FOUNDER 34 / COUNSEL 23 / VENDOR 16 in
  `docs/legal/reg2-open-questions.md`, of which 39 need a person who is not the founder. What the
  decision does NOT do: retract `/privacy` §11's live compliance claim, or say the duty does not
  apply. [[database-definitions-document-missing]] stays open by choice.
- **The `users`/`auth.users` casing gap.** `ensureUser` is guarded; confirm the casing fix closed the
  silent variant for every writer, not just the CLI.
- **Service B ships unreviewed, by decision.** `auto_release_b` is `true` and stays true
  ([[0036-auto-release-b-is-always-on]]), so every Service B render skips `qc_pending`. The flag is
  settled; what is **not** settled is whether anything else should stand in that space at self-serve
  scale. As of `c442447` one thing now does — the content-policy classifier
  ([[0042-content-policy-is-wired-at-both-choke-points]]) — which is a change from the world
  [[content-policy-classifier-never-runs]] described. A founder eyeball pass on one render is not
  evidence, and it happens after release.
- **`lipsync_resolution`** is the only `app_config` key still genuinely provisional
  ([[0004-service-b-config-is-provisional]], `status: superseded` on the open-endedness only).

## Unfinished measurement

- **No cold render has been measured on the box** — one including the ~92 MB Chrome Headless Shell
  download. Matters only if the box is rebuilt from scratch rather than from a snapshot.
- **What Supabase does with a provider rejection** once Resend's 100/day is spent. The described
  failure mode is reasoned from two published limits, not observed.

## Corrections worth not repeating

- **"`npx -y supabase` because no CLI is installed" was false, and the Windows shim makes it worse.**
  `supabase` has been a root devDependency the whole time (2.109.1). The 0037 apply spawned the
  pinned `.exe` directly: spawning the `.cmd` shim needs `shell: true` on Node 20+, and a shell
  would put the connection string through cmd.exe quoting, where a special character in the password
  is either a leak or a break. `spawn` on a bare `.cmd` without a shell fails `EINVAL` — that is the
  symptom, and the fix is the `.exe`, not `shell: true`. Queue item 8.

- **This file's own "What changed this session" section was stale before it was read.** It records
  `origin/main` as `5a52ded` and lists its own handover commit as uncommitted; by the time the next
  session fetched, `origin/main` was `d4c79ef` — PR #28, which merged exactly that commit. Nothing
  was wrong when written. **Fetch and read `origin/main`, never this file, for where main is.**
- **The reg. 2 STATUS block moved this file's own cites, inside the commit that wrote them.** The
  12-line block added at `reg2-open-questions.md:10` pushed the two Resend rows `3a3deda` had just
  cited at `:119`/`:155` down to `:131`/`:167`, and the 9-line block at the head of
  `database-definitions-document.md` turned `wc -l` 981 into 990. Both were caught and corrected in
  `692c3dd` — the same class as `c442447`, one commit later, in the opposite file. **Take the cite
  from your own result AFTER prettier has run, not before.**
- **`grep -c` on the reg. 2 markers, again.** Reconfirmed 2026-09-11 against the current tree:
  **73 gaps / 75 raw hits / 71 matching lines.** Adding worksheet rows that carry `—` in the `line`
  column changes none of them, because the counts count MARKERS, not questions.

Recorded because each cost real time, and each came from asserting rather than checking.

- **`emailRedirectTo` was already done, and was asserted missing twice in one session.**
  `auth.ts:78` has passed it since `02f58bb`. The source of the error was `docs/08` §8A.1, which
  still says otherwise — **and this file's own item 12 already recorded that docs/08 was wrong and
  named the fix commit.** The assertion was made anyway, by reading past it. That is the
  repo-beats-docs rule failing in exactly the direction it exists to prevent: the correction existed,
  in this file, and lost to the doc. Now queue item 2.
- **A commit that fixes a line cite while editing the cited file invalidates its own cite.**
  `c442447` re-read `contentPolicyCheck` at its parent (`copy.ts:662`), then added 30 lines above it
  — so the moment it landed the function was at `:692`, and every cite written _inside_ that commit
  was already wrong: the defect note's correction block, `0042`'s `method` field, and the in-code
  comment at `sets.ts:241`. **Take the cite from your own result, not from your parent.**
- **Line cites drift silently and en masse.** Swept 2026-09-11: `renders.ts:427-428` → `:491-492`;
  `copy.ts:491` → `:692`; `docs/04-integrations.md:76-78` → `:104-118`; `sets.ts:302` → `:438`;
  `renders.ts:770` → `:1008`; `copy.ts:505` → `:706`; `cli/src/index.ts:670-675` → `:840-845`;
  `docs/02-jobs.md:111` → `:168`. **And a cite can be stale in a way the correction misses**: four
  notes cite `sets.ts:483` for `chargeable = !(await isAdminOwned(...))`. The brief that flagged them
  said the fix was `businesses.ts:232-236` — that is where `isAdminOwned` is _defined_, but the line
  those notes describe now lives at `sets.ts:745`. Sweeping to `businesses.ts` would have replaced a
  stale cite with a wrong one.
- **`grep -c` counts lines, not occurrences.** The reg. 2 gap count was quoted as 75 for weeks.
  `grep -c` returns **71** (four lines carry two markers); `grep -o … | wc -l` returns **75**; and
  two of those 75 are the legend defining the marker and a prose mention of it. **73 real gaps.**
- **A vault note may already exist for the thing you are about to write.** The `bans רגע` flake was
  handed over as "record this so it is not blamed on the overnight commits" — it had already been
  recorded on 2026-09-08 in `bcfe8b9`. Grep `docs/vault/` before writing, per CONVENTIONS.
- **A number reported without its conditions gets attached to the wrong ones.** The 45s render
  figure was assumed to come from concurrency 2; it was 4.
- **A mitigation became an outage.** The §9 cron written to contain the temp-dir leak deleted the
  live worker's bundle and killed every render for four days
  ([[tmp-cron-deletes-live-worker-bundle]]). Never point a janitor at a directory a long-lived
  process serves from.
- **A constant tuned on the founder's hardware silently became a system requirement.**
  `RENDER_CONCURRENCY = 6` — [[render-concurrency-hardcoded-above-core-count]].
- **An acceptance gate passed against code that existed nowhere but that box.** When a gate passes,
  confirm the tree is clean before believing the result.
- **A credential was echoed in session output three times.** CLAUDE.md's rule now covers it: verify
  by connecting, report the outcome, never the value.
- **"Add `tavnit.ai` as an authorized origin in Google Console" — wrong field.** _Authorized
  JavaScript origins_ stays **empty** (server-side code flow); the field that needs `tavnit.ai` is
  _Authorized **domains**_, at publish.
- **`/start` proves nothing about auth** — it redirects unconditionally and discards
  `exchangeCodeForSession`'s result. `/home` is the only real gate.
- **"Billing is unwired, so account caps are the only bound" was backwards** — the credit balance is
  the bound, and it is _tighter_ because billing is unwired. [[no-self-serve-credit-grant-path]].
- `words_per_second`: old project 2.1 (calibration output), migration seed 2.2 (a guess). 2.1 is
  correct.
- `scripts/verify-migration-ledger.sql` cannot fully pass on a fresh database — two checks assert
  old-project row IDs.

---

## How to hand over

This file is overwritten in place, never duplicated. `git log --follow` on it is the
history. **If this file and the repo disagree, the repo wins** — treat anything here as
a pointer, not a source of truth.

### Closing a session — paste into the chat that's ending

```
Update docs/vault/state-of-play.md for handover. Rewrite the existing file in place —
don't produce a new version, git history is the versioning.

Cover:
- What actually changed this session: what's done, what's committed, what's still sitting
  in the working tree uncommitted.
- Decisions made in conversation that never reached the repo. This is the main thing a
  new session cannot recover on its own — name each one, and say where it should
  eventually live in the vault.
- Corrections: anything either of us asserted that turned out to be wrong. Keep these.
  They're the cheapest lines in the file and they stop the same mistake twice.
- The queue, reordered if this session changed the order, with reasoning wherever the
  order isn't self-evident.
- External state that changed — dashboards, providers, billing, anything not in git.

Be explicit about what is verified versus assumed. If something in the current file was
true when written and you can't confirm it still holds, mark it rather than repeating it.

Prune as you go. Delete anything now finished, and anything that has graduated into a
proper vault note — tell me which ones graduated so I can confirm they landed. This file
must not grow session over session.

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
