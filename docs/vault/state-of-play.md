---
type: state
status: current
updated: 2026-09-17
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

**The product is live end to end**, and **billing is now built but not wired.** `tavnit.ai` serves
`apps/web` on Vercel; both wizards run; `apps/admin` sits behind HTTP Basic in front of
`requireAdmin`. Service A/B format and engine decisions are all in `decisions/` — start at
[[0020-service-a-is-hook-and-steps-only]], [[0017-service-b-single-setting-selfie-talking-head]],
[[0023-hook-is-a-remotion-animation-opener-clips-retired]] and
[[0024-hook-effect-is-a-render-param-the-customer-picks]], and read CLAUDE.md rather than a summary
here.

**Email confirmation is ON since 2026-09-11** — the live behaviour a new session is most likely to
trip over. Every signup depends on a Resend delivery, ceiling 100/day:
[[auth-email-runs-through-resend]].

**The deploy rule that cost two incidents.** Verify the deployed **artifact**, not the symptom:
`git log -1` on the box, never "a render worked afterwards". `docs/07-worker-box.md` §11 carries the
check. It was run on a real deploy on 2026-09-11 and **passed** — `git log -1` on the box returned
`b8af879` (the PR #26 merge) with `HEAD -> main, origin/main` on it and its two parents matching
the branch it merged, which proves the artifact by lineage rather than by symptom. First
artifact-confirmed box deploy in this repo's history.
[[0039-three-deploy-axes-and-the-box-is-the-one-that-forgets]].

**A second, weaker deploy check that needs no SSH.** Pick a query fragment that exists only in the
code you just merged, then watch `select calls from pg_stat_statements where query like '%<fragment>%'`
across one interval of whatever loop should run it. A rising count is a process that is not you
executing code that did not exist before. Pair it with `pg_stat_user_indexes.idx_scan` for an index
the same migration created — moving in lockstep also shows the planner using it, which a bare
`CREATE INDEX` read-back cannot. Used 2026-09-11 for PR #29. **Two real caveats:** the counter is
cumulative since the last reset so only the DELTA means anything, and it proves a behaviour
shipped, not a SHA.

## What landed (2026-09-17) — three prompts, all MERGED

**Correction to the brief that wrote this section: A and B are MERGED, not "pushed, unmerged".**
`origin/main` is `96cefc6` (PR #45) with `7ccb708` (B) and `54c6231` (A) beneath it. Fetch and read
`origin/main`, never this line.

**A — `54c6231`, the billing engine.** Migrations **0044–0047 applied to production 2026-09-17** on
the founder's explicit instruction for that one push, with matching before/after read-backs:
Hebrew plan names and the `subscriptions.gateway` default `'sumit'` (0044, guarded, read at both
ends), `subscriptions.scheduled_plan_code` (0045), `terms_acceptances` (0046), and a nullable
`feedback.user_id` with its contact columns (0047). **Ledger is 48 rows, 0000–0047, no gaps, no
repair — tenth time running** (this file said "44 rows, 0000–0043" until now; that was four
migrations stale). `scripts/verify-migration-ledger.sql` is at **38 structural rows, 36 true /
1 false (0022) / 1 NULL (0020)** and its §RESULTS carries the production run. Code:
`packages/core/src/plan-change.ts` (`quotePlanChange`, pure, client-safe subpath), `changePlan` /
`cancelSubscription` / `resumeSubscription` and the scheduled branch of `processDueRenewals` in
`pipelines/billing.ts`, `recordTermsAcceptance`, and five routes under
`apps/web/src/app/api/account/`. [[0052-upgrade-credits-are-period-credits]],
[[0053-downgrades-are-scheduled-not-applied]], [[0054-payment-stack-is-sumit-via-upay]].

**B — `7ccb708`, the customer-facing half.** Public `/pricing` (hour-cached plan view, FAQ),
`/home/plan` with the button matrix and six dialogs, the settings row "המסלול הנוכחי", the credits
pill at the content pane's top-start, תמחור in both headers and the footer, `/start?plan=` riding
the onboarding draft into `/home/plan?plan=`. Every customer string is in
`apps/web/src/lib/plans-ui.ts`; every number comes from `apps/web/src/lib/plans.ts`.
[[0055-plan-cards-may-show-computed-ad-counts]]. Walked in a real browser on a seeded pro
subscription, then the seed deleted by id.

**C — this session, the legal/public pass.** Terms §8 reorganised into four bold-headed sub-blocks
for the acquirer's site requirements **with no section renumbered**; the purchase-step acceptance
checkbox stated in the intro and §8; the operator address moved כאבול → ברזיל 14, תל אביב into one
constant (`OPERATOR_ADDRESS` in `(legal)/legal.tsx`); privacy gained the Sumit/Upay payment block,
the acceptance record and the contact-form fields; new public `/about` and `/contact` with
`POST /api/contact` (public, honeypot, 5-per-IP-per-day cap) writing anonymous `feedback` rows; the
admin inbox shows those rows' name and address; `plans-ui.ts` product names aligned to the app's.
[[0056-the-purchase-step-takes-an-active-terms-checkbox]],
[[0057-the-upay-site-requirements-are-met-by-reorganising-not-re-deciding]],
[[0058-the-operator-address-is-a-tel-aviv-street-address]].

**`UPDATED` in `(legal)/legal.tsx` moved `11.09.2026` → `17.09.2026`, and that is load-bearing.**
It is both the date at the head of /terms and the string checkout writes into
`terms_acceptances.terms_version`. Safe today (`terms_acceptances` had 0 rows); not safe to forget
after the first sale. The constant now carries a comment saying so.

**Two older branches are still the founder's to land** — `labels/highlight-not-gate` and
`fix/rega-ban-rule`, both pushed, neither merged, neither deployed. Queue items 2 and 3.

## What landed (2026-09-18/19) — the wait-timing fix, on `claude/analysis-wait-timing-backoff-z16uw9`, pushed, NOT merged

Customer-facing defects in the Service A wizard's analysis/plan wait cards. No server logic,
no schema, no `packages/core` change, no Hebrew string added or changed. Six commits: the
first pass (`4917043`, `6c86a21`, `6a51d91`), then a founder review that caught three things
it got wrong (`7c93160`, `243c045`, `3550d7d`).

**The elapsed clock reset on every retry re-claim.** `analysisWaitView` and `planWaitView`
read core's `JobProgress.elapsedMs`, which for a RUNNING job is `now - job.lockedAt` —
refreshed at every re-claim. Measured: a real 8-minute wait on a job's third attempt showed
"רץ כבר פחות מדקה". Now the ROUTES difference the domain row's own `created_at`
(`demo_analyses` / `demo_step_plans`) against their own clock and send a duration —
`requestedElapsedMs` on the analysis body, on `StepPlanWire` via `stepPlanResponse`. The first
pass sent an ISO string and subtracted in the view, which runs in the browser: a client clock
behind the server's would have pinned the line at "פחות מדקה". Corrected in `7c93160`, which
also deleted the fallback to `job.elapsedMs` — when the server sends no number, none is shown.
[[0059-the-wait-clock-counts-from-the-request-row-not-the-job]].

**A short retry backoff read as a pause.** Both wait views showed "מושהה" (paused, will resume
automatically) for ANY `resumeAtMs`, which core sets whenever a queued job's `run_at` is more
than 60s out — conflating a 90s transient-retry backoff with an hours-long budget park. The
founder saw it twice in one session. Gated on a new view-only `LONG_PARK_THRESHOLD_MS` (10
minutes); core's `JOB_DELAY_VISIBLE_MS` is untouched by instruction. But gating alone let a
short park fall through to branches that describe a job about to be claimed — "הניתוח יתחיל
בקרוב" for the analysis, "בונים את תוכנית הצעדים…" for the plan, the second an outright lie
about a job building nothing. `243c045` keys both on the JOB the way `renderWaitView` already
did: a rescheduled job returns its standing queued line and stops.
[[0060-a-short-retry-backoff-is-not-a-pause]], which extends
[[0009-retry-backoff-is-invisible-to-the-customer]] to these two surfaces rather than
diverging from it — 0009 ruled on retry backoff and never on budget parks.

**The render wait now carries two recorded defects, both unfixed and both out of this task's
scope**: [[render-wait-elapsed-resets-on-reclaim]] (the same elapsed reset) and
[[render-wait-says-nothing-about-a-long-budget-park]] (0009's single `resumeAtMs` branch
swallows an hours-long park as well as the backoff it was written for — never reviewed,
because `resumeAtMs` does not record why a job was rescheduled).

`pnpm typecheck` and `pnpm lint` exit 0; the five serial suites run, with the four core
`ffmpeg ENOENT` failures being the pre-existing environment gap (see Unfinished measurement
below), not from this change. **Not yet merged** — this session's branch, not landed to `main`.

## Decisions made in conversation — not yet in a note

Each with its date. This is the main thing a new session cannot recover on its own.

1. **Annual billing DECLINED, 2026-09-16**, reaffirming [[0046-billing-ships-as-osek-patur]] §3.
   Monthly only. No annual toggle, no prepaid, not "not built yet" — decided against.
2. **VAT stays ON TOP at conversion, reaffirmed 2026-09-17** after the founder considered absorbing
   it. 0046 §2 stands; "כולל מע״מ" must appear nowhere.
3. **Checkout is a dead end BY DECISION, not by omission** — the server answers 503 with a Hebrew
   line until the Sumit adapter exists, and the client is written for the wired shape so wiring is
   server-only. Recorded inside [[0054-payment-stack-is-sumit-via-upay]] and
   [[0055-plan-cards-may-show-computed-ad-counts]]; noted here because it reads like an unfinished
   feature and is not.
4. **`requires_new_card` is DEFERRED to the adapter task, not declined**, 2026-09-17. A saved card
   that stops working needs a state the machine does not have. It was kept out of A deliberately
   because **gateway tokens are not portable between gateways** — building the state before the
   adapter would fix its shape to a vendor nobody had integrated. Checklist item 10 below.
5. **Product names on the plan cards follow the APP**, 2026-09-17. `plans-ui.ts` was the only place
   in the repo saying "סרטוני דמות AI" or "הוק+דמו"; the app says "סרטון עם דמות AI" and
   "הוק + דמו" (`SERVICE_LABELS` in `lib/service-b-ui.ts`). Aligned, tests re-pinned.
6. **The demo upload cap is 90 seconds** (was 3 minutes), decided in chat 2026-09-16 and built the
   same day: the ingest probe is the only gate, the limit is stated in the picker before a file is
   chosen, and `ready` demos longer than 90s stay usable because nothing re-checks later. Hebrew is
   COPY PENDING FOUNDER REVIEW. **Still has no vault note.**
7. **Where `apps/admin` lives — proposed `admin.tavnit.ai`, never decided.** Deployed and publicly
   reachable on its vercel.app URL today.
8. **`debitRender`'s non-positive-cost hole: deliberately not fixed.** The note is in the tree
   ([[debit-render-accepts-non-positive-cost]]); the decision is that it stays a note.

## The queue

**0. The Sumit adapter.** Everything else in billing is built and merged; this is the only thing
between the product and a real charge. `getBillingGateway()` returns `NotConfiguredGateway` outside
`DRY_RUN`, so production throws on any charge attempt and the web tier maps it to 503. The
checklist, as the founder dictated it:

1. Create a **SEPARATE test business** at `app.sumit.co.il/companies/newtestcompany`. **LANDMINE:
   connecting a test terminal on the real org disconnects its existing Upay clearing — never touch
   `developers/testterminal` there.** Test quotas ~100 actions / ~400 API calls a month; test
   documents carry business no. 999999998; no Upay and no 3DS in test.
2. Install modules **הכנסות + סליקת אשראי** on the real org.
3. Confirm request/response schemas of `/billing/payments/charge/`,
   `/billing/payments/beginredirect/` (return-URL params, save-card mode) and
   `/billing/paymentmethods/setforcustomer/` — **single-use token only, never a PAN**; terms §8
   promises card data is never held by us.
4. **Refund: no endpoint seen.** Check `/creditguy/gateway/transaction/` for a credit type
   referencing the original, and what `/accounting/documents/cancel/` does to the payment; else
   refunds go through the Sumit UI at launch.
5. **Idempotency:** does charge accept an external reference? If not, write the attempt row first
   and reconcile via `/billing/payments/get/` on timeout.
6. **Errors:** HTTP status, or a status field inside a 200 body — the adapter must not treat 200 as
   success blindly.
7. **Card auto-update on replaced cards** — API-charged too, or only Sumit-run recurring?
8. **Chargebacks:** poll `/billing/payments/list/` or use triggers (Growth plan) — decide.
9. **3DS is production-only, ₪1 per attempt, first customer-present charge only.** CVV exemption
   for recurring is automatic on Upay.
10. Add the **`requires_new_card`** status: the enum value, the one-live-per-user partial index, the
    renewal skip, the `/home/plan` banner.
11. **Rename the renewal charge description** from `AIUGC <name> — monthly renewal` to a תבנית
    description.
12. **Cap or dedupe `terms_acceptances` per user per version** — checkout inserts a row on every
    valid request today.
13. **Refuse the `DryRunGateway` when the database host is production.** `apps/web/.env.local` has
    `DRY_RUN=1` against production, so a local upgrade click grants real credits (A's report).
14. **Sumit offers no integration support** — Facebook group, a paid support hour, or an external
    dev.

**1. Two things billing could not exercise, and one gap that is a decision.**

- **No seed for `past_due` or `suspended`.** B could not walk either state; their copy is
  unit-tested and nothing else. A seed script for both is the cheapest way to find out whether the
  banners and the disabled buttons are right.
- **The Drizzle snapshot gap.** `supabase/migrations/meta/` holds **three** snapshots —
  `0000/0001/0002_snapshot.json` — and `_journal.json` maps them to tags `0000_init`,
  `0003_composites_and_images`, `0005_persona_images`. Nothing after 0005 has one, so 0043–0047
  shipped without a snapshot like the 37 before them. **This is a consequence of a decision, not a
  bug**: migrations here are hand-written portable SQL (35 of the 48 files open with "Hand-written.
  Portable SQL"), the PGlite suite replays the files themselves through `PORTABLE_MIGRATIONS`, and
  `drizzle-kit generate` is not in the workflow. The cost is that `drizzle-kit` cannot diff against
  this schema any more; nothing else reads the journal. Measured 2026-09-17. _(The brief that asked
  for this line said the snapshots stop "at 0002 and 0041" — the 0041 half does not match the tree.)_
- **The founder's copy review of `plans-ui.ts`.** The file still opens ⚠️ COPY PENDING FOUNDER
  REVIEW. The numbers are correct and computed; the wording is a first draft.

**2. The label provenance rule is a highlight, not a gate — BUILT and PUSHED on
`labels/highlight-not-gate`, PR not opened, NOT merged, NOT deployed.**
[[0049-the-label-provenance-rule-is-a-highlight-not-a-gate]]; the measurement is
[[label-rule-families-2026-09-15]]. The remaining steps are the founder's: review the decision
note's Legal section (REASONED, not counsel-confirmed) and the branch's own review list; merge;
then deploy the box as ONE step gated on nothing running
(`select id, type, status from jobs where status = 'running';` → empty, then
`git pull && pnpm install && sudo systemctl restart aiugc-worker`, then `git log -1` on the box) —
the hazard is a `git pull` without a restart, because `prompts/plan_demo_steps/v14.md` goes live per
call the moment it lands while old worker code would still fail plans on the rule v14 no longer
warns about. Then confirm the first live plan stamps `plan_demo_steps@v14` and carries
`offScreenWords`. `docs/legal-review.md` T9 already carries the line for counsel.

**3. Correct the `רגע` ban rule — DECIDED and BUILT on `fix/rega-ban-rule` (`ecf50c5`, pushed, PR
not opened).** A live production copy-quality bug: the ban targets the **hesitation tick**, not the
word, and v16's wording has been suppressing legitimate copy on every generation since `f40bc72`.
What remains is the founder's: open the PR, run `aiugc bank seed-structures --update` against
production himself (the seed file is not the live source —
[[0028-scripts-end-on-a-closer-from-a-curated-bank]]), and deploy/restart the box (a prompt version
bump needs a restart — [[prompt-versions-on-disk]]).
[[0046-the-rega-ban-targets-the-hesitation-tick-not-the-word]],
[[ban-rule-test-collides-with-a-curated-hook]].

**4. Audit the 12 `getStorage()` call sites in `apps/web` for the ownership check.** One line per
site: which route, what it checks, and whether a caller can reach it with an id they do not own.
This is the invariant [[0045-the-web-tier-holds-the-service-role-key]] rests on, and that note says
plainly it is **UNVERIFIED**. The only queue item that can surface a security defect. Sites are
tabulated in 0045.

**5. Sweep the stale `apps/web/src/lib/auth.ts` cites.** `5c13ead` pushed everything below `signUp`
down ~54 lines. Verified 2026-09-11: `docs/08` `:383` and `:631`; [[auth-email-runs-through-resend]]
`:5`; [[auth-round-trips-that-miss-the-callback-die-silently]] `:24`; `0005` `:41` and `:48`.
**Do not touch `0006:26`** — it is historically correct there.

**6. Ceiling alert + `vat_rate` config — build with the gateway adapter, not before.** Spec in
[[0046-billing-ships-as-osek-patur]] §6.

Item 0 outranks everything: nothing in billing earns money until it exists. Item 3 is a live
production copy bug and outranks the rest. Item 4 is the only one that can surface a security
defect. There is no open code defect in this queue.

## External state — not in the repo

Founder-reported from a dashboard unless a line says otherwise.

**Supabase.** Project `hyaqydcmwbnbaiqqufow`, `eu-central-1` (Frankfurt), Pro, Micro compute.
**Migrations 0000–0047 applied, ledger clean at 48 rows, no gaps, nothing pending.** Every push
since 0036 was on the founder's explicit instruction **for that one push** — not a standing
permission — and `db push` recorded each version itself, so `migration repair` has been needed zero
times in ten. The per-migration history, every before/after read-back and the production run of the
structural checks live in `scripts/verify-migration-ledger.sql` §RESULTS; do not re-narrate it here.
**Two rules that came out of it and are worth more than the history:** a **guarded** migration must
be read through the code's own parse BOTH before and after (a guard that matches nothing exits 0,
prints the same output and still records its version), and a **destructive** migration is read
before, always, with the row count in the report.
Auth: Email provider on, Google enabled, **Confirm email ON since 2026-09-11**, Site URL
`https://tavnit.ai`, `https://tavnit.ai/auth/callback` allowlisted. Custom SMTP configured, rate
limit 100 emails/hour. The five Hebrew auth templates are reproduced in `docs/08` §8A.2.

**`events` is EMPTY — 0 rows, every kind.** No event kind has ever fired in this project: not
`platform_budget_tripped`, not `qc_release`/`qc_reject`, not `content_policy_flag`. So the alert
sweep reads an empty partial index every 60s and the budget valve sweeps an empty set. **A session
that finds silence here must NOT read it as "the feature is broken"** — that is the intended steady
state, and the first real proof has to be provoked. Non-succeeded jobs: 3 dead `render_video` (the
2026-08/09 bundle bug), 2 `lipsync` failed on HeyGen credit. `subscriptions` is **0 rows**, so no
plan has granted anyone anything yet.

**Resend.** Region **Ireland (EU)**, `tavnit.ai` verified, DKIM `TXT resend._domainkey`, sending via
two CNAMEs (`rsend`, `send`) not an SPF TXT, DMARC `p=none`, receiving off. Free tier 3,000/month
**AND 100/day — the daily figure is the real ceiling**, [[auth-email-runs-through-resend]]. **The
transfer basis is still open**: an Irish sending region says nothing about US access by a US
company, and `/privacy` deliberately claims no basis. Filed unanswered in
`docs/legal/reg2-open-questions.md:131` (COUNSEL) and `:167` (VENDOR).

**The box.** `aiugc-worker.service`, `Restart=always`, `WORKER_ID=hetzner`, at `b8af879`. Sentry
confirmed active **by test** (a job inserted knowing it would fail; the founder got the email), not
by a log line — which matters, because `error reporting on` also prints for a malformed DSN.
`sudo usermod -aG systemd-journal aiugc` has been run, so unit lifecycle and OOM kills are visible
to `journalctl`. `ufw` active, OpenSSH only, key-only SSH from one desktop. `sudo` needs a password,
so an unattended session cannot `systemctl restart`;
`kill -TERM $(systemctl show aiugc-worker -p MainPID --value)` is equivalent. Deploys:
`docs/07-worker-box.md` §11.

**Vercel.** `apps/web` off this monorepo: Root Directory `apps/web`, Next.js preset, no overrides,
region `fra1`, `ANTHROPIC_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` both present. Admin project also
`fra1`. `NEXT_PUBLIC_*` variables must be type Config, not Secret.

**Hetzner.** One server `tavnit-worker`, CPX32 (**4 vCPU**, not 8), Nuremberg, Ubuntu 24.04,
~$41/mo + ~$0.72 IPv4. A powered-off server still bills in full — only deletion stops the meter.
Two snapshots taken. [[0007-worker-box-instance]].

**GitHub.** Fine-grained PAT, **no expiration**, scoped to `AIUGCBackend`, Contents read-only,
plaintext in `~/.git-credentials` on the box. Nothing will remind anyone it exists; revocable only
at GitHub. [[0008-github-pat-over-deploy-key]].

**Google OAuth** published, _In production_, scopes `openid`/`email`/`profile`. Do NOT upload a
custom app logo — it triggers brand review even with non-sensitive scopes.

## Owed founder actions

- **Update the address on the עוסק פטור registration.** It still records כאבול while every public
  page now says ברזיל 14, תל אביב. **UNVERIFIED** — he said he is doing it; nobody has seen the
  file. Recorded as an owed action, not a defect in the pages
  ([[0058-the-operator-address-is-a-tel-aviv-street-address]]).
- **Send the reply email to UPay** confirming each site requirement and where it is satisfied. The
  Hebrew draft was handed over with the change that implemented them.
- **Merge `feat/pricing-and-plans`'s successor branch** (this session's legal/public pass).
- **Restart the worker box after that merge** — A's renewal change ships there
  (`git pull && pnpm install && sudo systemctl restart aiugc-worker`). Blast radius while it waits
  is the `billing_renewals` job alone, and with `subscriptions` at 0 rows that job does nothing
  either way.
- **Create the Sumit test business** (queue item 0, step 1) — nothing in the adapter can start
  without it.
- Vendor DPA / reg. 3 undertakings (Anthropic, ElevenLabs, HeyGen, fal.ai, Sentry, Resend), the
  ElevenLabs voice licence question, Sentry's data region, and the עוסק פטור ceiling on gov.il. The
  full list is the closing section of `docs/legal-review.md`.

## Open decisions

**Housekeeping, unresolved: `docs/vault/decisions/` has two 0046s, two 0047s and two 0049s** — six
notes, three numbers, from concurrent sessions each taking "the next free number" at the same time.
Nothing is lost (the slugs are distinct and every inbound link uses the full filename), but
`[[0047]]` is ambiguous. 0050 and 0056–0058 were all taken **above** the highest number rather than
filling a gap, because renumbering a published note breaks the links already pointing at it.
Renumber or leave it — a founder call.

- **Service B ships unreviewed, by decision.** `auto_release_b` is `true` and stays true
  ([[0036-auto-release-b-is-always-on]]). What is **not** settled is whether anything else should
  stand in that space at self-serve scale; as of `c442447` the content-policy classifier does
  ([[0042-content-policy-is-wired-at-both-choke-points]]).
- **The reg. 2 מסמך הגדרות מאגר — DEFERRED INDEFINITELY, 2026-09-11.** Decided, with the
  consequences accepted, a lawyer to be engaged when the founder sees fit. **Not a queue item — do
  not put it back.** [[0043-the-reg-2-definitions-document-is-deferred-by-decision]]. It does not
  retract `/privacy` §11's compliance claim. [[database-definitions-document-missing]] stays open by
  choice.
- **The `users`/`auth.users` casing gap.** `ensureUser` is guarded; confirm the casing fix closed
  the silent variant for every writer, not just the CLI.
- **`lipsync_resolution`** is the only `app_config` key still genuinely provisional
  ([[0004-service-b-config-is-provisional]]).

## Unfinished measurement

- **No cold render has been measured on the box** — one including the ~92 MB Chrome Headless Shell
  download. Matters only if the box is rebuilt from scratch rather than from a snapshot.
- **What Supabase does with a provider rejection** once Resend's 100/day is spent. Reasoned from two
  published limits, not observed.
- **This container cannot run the full test gate.** `ffmpeg` is not installed (5 core suites fail
  `spawn ffmpeg ENOENT`) and `remotion.media` returns 403 for the Chromium Headless Shell (1
  remotion test). Both are environment gaps, not repo failures — but a session that reports "gate
  green" from here is reporting 4 of 5 suites.

## Corrections worth not repeating

Each cost real time, and each came from asserting rather than checking.

- **This file's own migration counters were four migrations stale**, and said so confidently: "44
  rows, 0000–0043" after 0044–0047 had been applied and recorded, and "32 structural rows" when the
  proof file was at 38. Both were true when written. **Fetch and read the artefact — `origin/main`,
  the ledger, `scripts/verify-migration-ledger.sql` §RESULTS — never this file, for a count.**
- **The brief for this session said A and B were "pushed, unmerged". They were merged** (PRs #44,
  #45, `origin/main` at `96cefc6`). Same class as the entry below it: **the brief is the least
  current thing in the room; re-grep even the part that is telling you the truth.**
- **A brief's own ground truth can be the stale half.** The queue handed `auth.ts:78` to the session
  fixing `docs/08` as the _correct_ cite. It had moved to `:132` sixteen hours earlier. A session
  trusting the brief would have written a fresh stale cite while removing one.
- **A commit that fixes a line cite while editing the cited file invalidates its own cite.**
  `c442447` re-read `contentPolicyCheck` at `copy.ts:662`, then added 30 lines above it — so every
  cite written _inside_ that commit was already wrong. **Take the cite from your own result AFTER
  prettier has run, not from your parent.**
- **Line cites drift silently and en masse**, and a correction can be stale in a way the fix misses.
  Four notes cited `sets.ts:483`; the brief's "fix" pointed at where the function is _defined_,
  while the line those notes describe had moved to `sets.ts:745`. Sweeping to it would have replaced
  a stale cite with a wrong one. **An insertion's size does not predict a cite's drift; only a grep
  does.**
- **A vault note may already exist for the thing you are about to write.** The `bans רגע` flake was
  handed over as "record this" — it had been recorded four days earlier. Grep `docs/vault/` first,
  per CONVENTIONS.
- **`grep -c` counts lines, not occurrences.** The reg. 2 gap count was quoted as 75 for weeks.
  `grep -c` returns 71 (four lines carry two markers), `grep -o | wc -l` returns 75, and two of
  those are the legend and a prose mention. **73 real gaps.**
- **A number reported without its conditions gets attached to the wrong ones.** The 45s render
  figure was assumed to come from concurrency 2; it was 4. Related: `RENDER_CONCURRENCY = 6` was
  tuned on the founder's hardware and silently became a system requirement
  ([[render-concurrency-hardcoded-above-core-count]]).
- **A mitigation became an outage.** The cron written to contain the temp-dir leak deleted the live
  worker's bundle and killed every render for four days
  ([[tmp-cron-deletes-live-worker-bundle]]). **Never point a janitor at a directory a long-lived
  process serves from.**
- **A credential was echoed in session output three times.** CLAUDE.md's rule now covers it: verify
  by connecting, report the outcome, never the value.
- **An acceptance gate passed against code that existed nowhere but that box.** When a gate passes,
  confirm the tree is clean before believing the result.
- **"`npx -y supabase` because no CLI is installed" was false** — `supabase` has been a root
  devDependency (2.109.1) the whole time. Spawn the pinned `.exe` directly; the `.cmd` shim needs
  `shell: true` on Node 20+, which would put the connection string through cmd.exe quoting.
  CLAUDE.md was corrected 2026-09-13.
- **"Add `tavnit.ai` as an authorized origin in Google Console" — wrong field.** _Authorized
  JavaScript origins_ stays empty (server-side code flow); the field that needs it is _Authorized
  **domains**_, at publish.
- **"Billing is unwired, so account caps are the only bound" was backwards** — the credit balance is
  the bound, and it is _tighter_ because billing is unwired
  ([[no-self-serve-credit-grant-path]]).
- **`/start` proves nothing about auth** — it redirects unconditionally and discards
  `exchangeCodeForSession`'s result. `/home` is the only real gate.
- `words_per_second`: old project 2.1 (calibration output), migration seed 2.2 (a guess). **2.1 is
  correct.**
- `scripts/verify-migration-ledger.sql` cannot fully pass on a fresh database — two checks assert
  old-project row IDs. **A false on 0022 alone is expected** (it asserts a `gpu_seconds` value 0036
  raised); every other false is real.

## What graduated out of this file on 2026-09-17

Removed here because a note now carries it, or because it is finished:

- The whole per-migration narrative for 0036–0043 (~60 lines) → `scripts/verify-migration-ledger.sql`
  §RESULTS plus [[0047-audio-preview-attempt-cap-moves-to-50]],
  [[0049-audio-preview-attempt-cap-back-to-20]], [[0050-subscriptions-are-keyed-on-the-account]],
  [[0051-the-credit-unit-and-the-three-credit-only-plans]],
  [[0048-the-demo-analysis-is-charged-once-per-demo]].
- The 0043 balance top-up narrative → the same §RESULTS and
  [[0051-the-credit-unit-and-the-three-credit-only-plans]].
- "0043 does NOT carry the Hebrew plan names, still open" → **closed**, migration 0044 shipped them.
- `feat/demo-analysis-credit` and `feat/render-player` as pending merges → **both merged.**
- Old queue items 3 (the CLAUDE.md apply recipe) and the seven that closed on 2026-09-11 →
  **done**; the recipe lesson survives in Corrections.
- The address decision, the acceptance checkbox and the acquirer's requirement set → 0056–0058.

**Still NOT graduated, and kept here for that reason:** the `pg_stat_statements` deploy check, the
`b8af879` artifact-confirmed deploy, the 90-second demo cap (item 6 above), and the
`admin.tavnit.ai` question. None has a vault note; all four die with this file if it is pruned
without writing one.

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
