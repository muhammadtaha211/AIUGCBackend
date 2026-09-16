---
type: state
status: current
updated: 2026-09-13
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

## Recent merges

`origin/main` was `fa1a012` when this was written — **fetch and read `origin/main`, never this
line.** Newest first: **#30** `fa1a012` records the 0037 apply and the measured box deploy ·
**#29** `9de62d0` Resend disclosed in privacy §6, reg. 2 deferred by decision
([[0043-the-reg-2-definitions-document-is-deferred-by-decision]]), the budget-park valve now ends
non-render work, the auth-email alert + migration 0037
([[0044-the-auth-email-alert-fires-on-hit-never-on-a-threshold]]) · **#28** `d4c79ef` handover ·
**#26/#27** `b8af879`/`5a52ded` the local/DRY_RUN worker claim guard, migration 0036, content
policy wired at both choke points, the reg. 2 worksheet.

**`feat/render-player` MERGED** — this line said "pushed, not merged" and the tree disagreed:
`ec9849c` is PR #34 and it is on `origin/main`. Every finished render plays in one `RenderPlayer`
— native controls with the browser's ⋮ menu emptied and a real הורדה (an attachment URL the storage
adapter mints) — across both modals and both wizards' released step. The disabled רמיקס/בקרוב it
shipped with is **gone** as of `feat/demo-analysis-credit`: remix is not being built, and a
permanently-disabled button is a promise the product does not keep. Nothing was ever seen in a
browser; the ⋮ and the save-in-place are still founder checks.
[[decisions/0047-finished-renders-play-in-one-component]].

**Pushed, not merged — its migration is already in production: `feat/demo-analysis-credit`.** The steps flat splits
— `a_steps_credits` 5 → 3 for the render, new `a_demo_analysis_credits` 2 for the demo analysis,
charged **once per demo** on the first render of it that is actually paid for. First render of a
demo still totals 5; every later render of the same demo is 3.
[[decisions/0048-the-demo-analysis-is-charged-once-per-demo]] has the mechanism, the accepted edges
and the deploy order. **Migration 0039 is APPLIED (2026-09-13); what is left is the merge.** The
order mattered because `creditCostsSchema` makes the new key required and every quote path — steps,
full, silent and Service B — throws on a row that lacks it; that half is done, and the remaining gap
(new row, old code) only underprices steps at 3 until the merge. Gate green (typecheck 0, lint 0,
76 + 559 + 7 + 369 + 39 tests).

**A worker whose `DATABASE_URL` points at production now refuses to claim** if it is a
`local:*`/`cli:*` worker or if `DRY_RUN` is set (`b39bb2c`, `packages/core/src/jobs/queue.ts`);
`aiugc work --once` exits rather than spinning.
[[local-workers-compete-with-the-box-for-production-jobs]]'s "the only guard is the founder
remembering" line is now historical.

**Both new mechanisms run against nothing, and that is the intended steady state.** `events` holds
**0** rows of every kind — no event kind has ever fired in this project — and **0** jobs have ever
been parked for budget. So the alert sweep reads an empty partial index every 60s and the valve
sweeps an empty set. A session that finds silence here must NOT read it as "the feature is broken";
the first real proof has to be provoked, and the founder's manual test does it with one
`recordAuthEmailFailure` call. Non-succeeded jobs: 3 dead `render_video` (the 2026-08/09 bundle
bug), 2 `lipsync` failed on HeyGen credit.

## External state — not in the repo

Everything in this section is **founder-reported from a dashboard**, not observed from this repo,
unless a line says otherwise.

**Supabase.** Project `hyaqydcmwbnbaiqqufow`, `eu-central-1` (Frankfurt), Pro, Micro compute.
**Migrations 0000–0039 applied, ledger clean, 40 rows, no gaps, nothing pending** — **0039 was
pushed 2026-09-13** on the founder's explicit instruction for that one push, by the session that
wrote it; `db push` recorded it itself, the sixth time running that no `migration repair` was
needed. The read-back went through `getConfigValue(db, 'credit_costs', creditCostsSchema)` — the
exact call every quote path makes — and returned `a_steps_credits` **3** and
`a_demo_analysis_credits` **2**, both `jsonb_typeof` = `number`, on a row of 10 keys with the other
eight rates untouched (20 checks, PASS; `scripts/verify-migration-ledger.sql` §RESULTS).
**`feat/demo-analysis-credit` is NOT merged yet, and that ordering is deliberate and safe**: the
deployed `creditCostsSchema` is a plain `z.object`, so it strips the key it does not know about and
the only live effect until the merge is that a steps render prices at **3 instead of 5** — an
undercharge window, not an outage. The reverse order is the one that breaks everything.
0036 and 0037
both pushed 2026-09-11 and **0038 on 2026-09-13**, each on the founder's explicit instruction for
that one push; `db push` recorded every one itself, so no `migration repair` was needed (fifth time
running that the prediction held). Proof block: `scripts/verify-migration-ledger.sql` §RESULTS.
**0038 raised `audio_preview_daily_limit` 20 → 50** ([[0047-audio-preview-attempt-cap-moves-to-50]],
reasoned not measured); the live row was read back through the code's own parse as the number 50, and
no restart or deploy was needed because `requestAudio` reads it live on every call.
**The ledger file's own expected counts were measured against production for the first time on
2026-09-13: 27 true, 1 false, 1 NULL of 29 structural rows.** The single false is **0022**, which
asserts platform `gpu_seconds = 7200` — a value 0036 raised to 32000 on 2026-09-11 without anyone
revisiting the row. It has been false on every database since, and the file's header count was one
out for two days before this run caught it. **A false on 0022 alone is expected; every other false is
real.** The predicate was deliberately left alone — 0036's row already asserts all seven caps.
**`events` is EMPTY — 0 rows, every kind, measured 2026-09-11 right after the 0037 apply.** No event
kind has ever fired in this project: not `platform_budget_tripped`, not `qc_release`/`qc_reject`,
not `content_policy_flag`, not `refund_resolved_to_ancestor`. So the alert sweep reads an empty
partial index every 60s, which is the intended steady state and not evidence it is broken.
**`npx -y supabase` is no longer the right recipe** — `supabase` is a root devDependency (2.109.1)
and the pinned local binary is spawned directly. `CLAUDE.md:138` was corrected to say so on
2026-09-13 (old queue item 3, closed), and the 0038 apply used the corrected recipe.
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

0. **The label provenance rule is a highlight, not a gate — BUILT and PUSHED 2026-09-15 on
   `labels/highlight-not-gate` (`f5a5663` the census, `a4c1339` the list widening, `4a29e92` the
   highlight, plus the docs sweep; PR not opened, NOT merged, NOT deployed).** Decided in chat on
   2026-09-15 and recorded in
   [[0049-the-label-provenance-rule-is-a-highlight-not-a-gate]]; the measurement it rests on is
   [[label-rule-families-2026-09-15]] (every recorded retry round was provenance — 25 of 25 strings,
   3 of 3 rows). The remaining steps are the founder's, in this order:
   - **Review the decision note** — in particular its Legal section, which is REASONED ("no new
     exposure relative to the three ungated copy paths") and unconfirmed by counsel — and the
     unattended run's own review list in the branch's `.work/label-rule-progress.md` (gitignored;
     the final summary is at its head). The one item there that was for the founder specifically —
     `בין` among the Task 2 list additions, which admitted `מבין`/`הבין` by prefix-stripping — is
     CLOSED: `בין` came back off `FUNCTION_WORDS` on 2026-09-16, because a verb of understanding is
     a product-capability claim, the class the highlight exists to surface. `דרך` stays.
   - **Merge to `main`.** Vercel deploys `apps/web` on its own; the new field is harmless on either
     side of the box's deploy (an old worker never writes it, an old web ignores it).
   - **Deploy the box as ONE step, gated on nothing running** — the only real hazard is a
     `git pull` without a restart: `prompts/plan_demo_steps/v14.md` goes live per call the moment
     it lands, and the OLD worker code would still fail plans on the provenance rule v14 no longer
     warns about ([[0039-three-deploy-axes-and-the-box-is-the-one-that-forgets]]):
     `select id, type, status, locked_by, locked_at from jobs where status = 'running';` → empty,
     then `git pull && pnpm install && sudo systemctl restart aiugc-worker`, then
     `git log -1 --oneline` on the box shows the merge commit. v14 adds no variable; the restart
     is for the core code. No migration, no config row.
   - **Confirm the first live plan after that** stamps `plan_demo_steps@v14` and carries
     `offScreenWords` on its steps:
     `select prompt_version, steps->0->'offScreenWords' from demo_step_plans order by created_at desc limit 1;`
   - **Hand counsel the T9 line.** `docs/legal-review.md` T9's "Counsel to confirm" column now
     ends: step captions may carry model-written words not taken from the recording, shown to the
     customer as unverified before approval. The open question there is unchanged and unanswered.
1. **Correct the `רגע` ban rule — DECIDED and BUILT 2026-09-11 on `fix/rega-ban-rule` (`ecf50c5`,
   pushed, PR not opened). What remains is the founder's: open the PR, run the prod CLI step, and
   deploy/restart the box.** Kept here until all three are done.
   The ban was never about the word: it targets the **hesitation tick**, the filler insertion that
   in Hebrew surfaces as `רגע` and reads as fake casualness. `רגע` occurring naturally inside a
   sentence is legitimate and always was. So v16's wording (`prompts/b_script/v16.md:134`, "it must
   not appear in a script") **overshot the intent, and has been overshooting in the LIVE prompt on
   every generation since `f40bc72`** — suppressing legitimate copy. This is a production
   copy-quality bug, not a test bug. Founder's instructions:
   - **v17 of `b_script`**: the bullet must distinguish the filler use from the natural use and
     carry **one Hebrew example of each**, or the model over-applies it as it has been. Follow
     [[0033-b-script-may-write-an-allowed-brand-name-in-latin]]'s shape, and write a decision note
     recording that 0033's pattern applied again, with the correction of intent stated plainly:
     v16 overshot, it was never a token ban.
   - **The `vo_script` twin carries the same rule — confirmed 2026-09-11**: `prompts/vo_script/v8.md:168`
     is the identical "**Never `רגע`** as a filler, a restart, or an aside". It gets the same
     correction **in the same commit**; the two prompts must not state different rules. (Worth one
     thought first: `vo_script` serves the Service A voiceover, retired 2026-09-05.)
   - **The test:** do NOT merely scope the assertion to the prompt file. Once `רגע` is legitimate
     copy, counting its occurrences is meaningless in either file. **Delete the count assertion**
     (`packages/core/test/hook-templates.test.ts:125`, and its twin
     `packages/core/test/vo-prompt.test.ts:55`) and replace it with one asserting the **rule text**
     is present — a real signal (the rule went missing) instead of a fake one (the word appeared).
     That also ends the 12.0% flake.
   - **Both curated banks keep the word, both get reordered** — `רגע` at the end of the clause is
     more natural than mid-sentence. `packages/core/src/hook-templates.ts:25` → `תראי את זה רגע`.
     `seed/structures/show-and-react.json:6` → `תראו את זה רגע` (plural preserved; the word stays,
     it is that structure's thesis).
   - **STOP before the prod step.** Per [[0028-scripts-end-on-a-closer-from-a-curated-bank]] the
     seed file is not the live source, so the structure-bank change needs
     `aiugc bank seed-structures --update` against production — **the founder runs that himself**.
     A prompt version bump also needs a worker/web restart before it takes effect
     ([[prompt-versions-on-disk]]).
     [[ban-rule-test-collides-with-a-curated-hook]] is the defect note. It predates the ruling and
     frames this as a choice between two fixes; the founder chose neither and corrected the rule.
2. **Audit the 12 `getStorage()` call sites in `apps/web` for the ownership check.** One line per
   site: which route, what it checks, and whether a caller can reach it with an id they do not own.
   This is the invariant [[0045-the-web-tier-holds-the-service-role-key]] rests on, and that note
   says plainly it is **UNVERIFIED**. A site that fails is a real defect and gets a defect note; if
   **several** fail, that is what reopens the `storage.objects`-policies / worker-signing
   alternatives. The sites are tabulated in 0045.
3. ~~**Correct `CLAUDE.md:138`'s apply recipe.**~~ **DONE 2026-09-13**, in the 0038 commit. The
   "no Supabase CLI is installed — npx fetches it" claim is gone (it was false: `supabase` is a root
   devDependency, `package.json:18`, `^2.109.1`), the line now names the pinned
   `…/bin/supabase.exe` and says why the `.exe` and not the `.cmd` shim (spawning a `.cmd` on
   Node 20+ needs `shell: true`, which would put the connection string through cmd.exe quoting), and
   the pushed-migrations enumeration is current through 0038 with 0037 added. The `db push` "records
   the version itself" claim held a **fifth** time. The 0038 apply used that recipe, which is the
   evidence it is the right one.
4. **Sweep the stale `apps/web/src/lib/auth.ts` cites.** `5c13ead` inserted ~54 lines above
   `signUp` on 2026-09-11 and pushed everything below it down. All verified 2026-09-11:
   `docs/08` `:383` (`auth.ts:42` / `:56` → the calls are `:124` / `:156`) and `:631`
   (`auth.ts:71-74` → `signInWithOAuth` is `:222`);
   [[auth-email-runs-through-resend]] `:5` and
   [[auth-round-trips-that-miss-the-callback-die-silently]] `:24` (both `auth.ts:78` → `:132`);
   `0005` `:41` (`auth.ts:69-85` → `:222`) and `:48` (`auth.ts:78` → the Hebrew OAuth fallback
   is `:229`). **Do not touch `0006:26`** — "the missing `emailRedirectTo` is fixed anyway" is
   historically correct there.
5. **Ceiling alert + `vat_rate` config — build with the gateway adapter, not before; spec in
   [[0046-billing-ships-as-osek-patur]].**

Item 0 is waiting on the founder alone (review, merge, box deploy, counsel). Item 1 is a live production copy-quality bug and outranks everything else. Item 2 is the only one that
can surface a security defect. 3–4 are cite corrections, ordered by how likely a reader is to act
on the wrong thing. There is no open code defect in this queue.

**Seven items left this queue on 2026-09-11, all DONE** (PR from `docs/queue-corrections`): docs/08
§8A.1's `emailRedirectTo` falsehood, the CLAUDE.md test gate, `.env.example`'s service-role clause
(+ [[0045-the-web-tier-holds-the-service-role-key]]), `docs/02-jobs.md`'s render-budget numbers,
`sets.ts`'s stale `copy.ts` cites, the pre-publication OAuth passages, and `CLAUDE.md:79`.

## Open decisions

- **Invoice document type before billing ships** — DECIDED 2026-09-13 —
  [[0046-billing-ships-as-osek-patur]].
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
  symptom, and the fix is the `.exe`, not `shell: true`. Queue item 3.

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
  said otherwise at the time — **and this file's own queue already recorded that docs/08 was wrong
  and named the fix commit.** The assertion was made anyway, by reading past it. That is the
  repo-beats-docs rule failing in exactly the direction it exists to prevent: the correction existed,
  in this file, and lost to the doc. **FIXED 2026-09-11** in `docs/08` — and the fix-side cite in
  this very bullet had itself gone stale by then: see the next entry.
- **A brief's own ground truth can be the stale half.** The queue handed `auth.ts:78` to the
  session fixing docs/08 §8A.1 as the _correct_ cite. It was correct from `5646529` until
  `5c13ead` inserted the Resend classifier above it on 2026-09-11 — sixteen hours before the fix
  ran. The line is `:132`. A session trusting the brief would have written a fresh stale cite while
  removing one. **The brief is the least current thing in the room; re-grep even the part that is
  telling you the truth.**
- **"Two wrong numbers on one line" was three.** `docs/02-jobs.md:168` also said "8-vCPU"; the box
  is a CPX32 with 4. Neither the queue nor the fact note that justified the fix had noticed. **Count
  the errors on the line yourself — an inherited count is a claim, not an inventory.**
- **A correction of a correction was off by one.** The queue said `sets.ts:241` should point at
  `copy.ts:706-711`; the insert is `:706-710` (`:711` is the `return {` after it closes). Third
  time this particular cite has been wrong. Same commit found a _second_ stale cite nobody had
  flagged, `sets.ts:340` → `copy.ts:715-737`, really `:745-767`.
- **A uniform drift estimate is a guess.** The queue said every `docs/08` §8B cite was "~151 low"
  after a 151-line insertion. Measured, the drift was **+160, +161 and +179** depending on position,
  because other edits had landed too — and one cited passage had already been fixed on 2026-09-03.
  **An insertion's size does not predict a cite's drift; only a grep does.**
- **`facts/test-suite-inventory.md:53` says `pnpm test` "fans out to four independent runners".**
  It is five — `apps/worker` gained a `test` script on 2026-08-26, three days after that note's
  `verified:` date. Its `:46-49` ("No vitest config exists anywhere") is stale the same way:
  `apps/web/vitest.config.ts` exists. Not corrected; noted.
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
