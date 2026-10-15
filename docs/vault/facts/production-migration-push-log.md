---
type: fact
status: carried
verified: 2026-10-15
method: "Transcribed 2026-09-29 from CLAUDE.md at 83a9a4b (lines 79 and 138, where this history lived until it moved here) and cross-checked against scripts/verify-migration-ledger.sql §RESULTS (lines 725-1091), the commit messages of bf66041, e4cb08e, f86f1ea, 5bc9b84, 2828fd3 and 5ce8a6d (every SHA in the table was matched by date and subject with git show -s), docs/vault/facts/credit-costs-row.md:36-45 (0043) and docs/vault/defects/daily-caps-were-hand-edited-before-0036.md:5 (0036). Nothing was re-run against the database. The last actual measurement is the 2026-09-21 read-back after the 0048 push: select count(*), min(version), max(version) from supabase_migrations.schema_migrations -> 49 / 0000 / 0048. Re-checked read-only on 2026-09-29: git ls-files 'supabase/migrations/*.sql' -> 49 files, 0000_init.sql to 0048_checkout_intents.sql, contiguous; and grep -c for each project ref in the five env files of the main AIUGC checkout (counts only, no lines printed) -> the new ref in all five, the old ref in none. Measured 2026-10-01 after the 0049 push, read-only (packages/core/.work/readback-0049.ts): select count(*), min(version), max(version) from supabase_migrations.schema_migrations -> 50 / 0000 / 0049; supabase migration list -> 0000-0049 local == remote. Measured 2026-10-02 after the 0050 push, read-only (packages/core/.work/readback-0050.ts): the same query -> 51 / 0000 / 0050; supabase migration list before the push -> 0000-0049 local == remote, 0050 local only. Measured 2026-10-07 after the 0051+0052 push, read-only (packages/core/.work/readback-0051-0052.ts): the same query -> 53 / 0000 / 0052; supabase migration list before the push -> 0000-0050 local == remote, 0051 and 0052 local only, and after it 0000-0052 local == remote; git ls-files 'supabase/migrations/*.sql' -> 53 files. Measured 2026-10-09 after the 0053-0056 push, read-only (packages/core/.work/readback-0053-0056.ts): the same query -> 57 / 0000 / 0056; supabase migration list before the push -> 0000-0052 local == remote, 0053-0056 local only. Measured 2026-10-11 after the 0057-0059 push, read-only (packages/core/.work/readback-0057-0059.ts, run before and after): the same query -> BEFORE 57 / 0000 / 0056, AFTER 60 / 0000 / 0059; supabase migration list before the push -> 0000-0056 local == remote, 0057-0059 local only; the three enum types absent before and present with their values after; social_accounts and scheduled_posts absent before, both relrowsecurity true, 0 policies and 7 indexes after; the events_unnotified_alerts_idx predicate names two kinds before and three after; anon/authenticated hold no SELECT, INSERT, UPDATE or DELETE on either new table (packages/core/.work/grants-census-2026-10-11.ts: those roles hold REFERENCES, TRIGGER and TRUNCATE on all 33 public tables through the public schema's default ACL, and SELECT only on businesses and users for authenticated). Measured 2026-10-11 after the 0060 push, read-only (packages/core/.work/readback-0060.ts, run before and after; push-0060.mjs list/dry/push, logs in packages/core/.work/): BEFORE no ai_label column, scheduled_posts 0 rows, ledger 60 / 0000 / 0059; supabase migration list before the push -> 0000-0059 local == remote, 0060 local only; the dry run would push 0060_scheduled_posts_ai_label.sql alone; AFTER ai_label | boolean | NO | false, scheduled_posts 0 rows, ledger 61 / 0000 / 0060, and migration list 0000-0060 local == remote. The push printed the CLI's 'failed to cache migrations catalog' Docker warning, as the 0053-0056 push did; exit 0. Measured 2026-10-15 for the 0063 push (packages/core/.work/push-0063.mjs list/dry/push; packages/core/.work/blur-a/plans-read.ts before and after, through the schema's plans columns): migration list before -> 0000-0062 local == remote, 0063 local only; the dry run would push 0063_plan_prices_minus_one_shekel.sql alone; BEFORE starter 15000 / pro 30000 / studio 50000 agorot, AFTER 14900 / 29900 / 49900, credits 1000 / 2500 / 5000 unchanged; migration list after -> 0063 local == remote; no pending checkout_intents before the push. The same Docker warning; exit 0."
source: db
---

# Production migration push log

The history behind the migration gate. The operating rules live in `.claude/rules/migrations.md`;
this note holds the dated record they came from. The per-push detail (pre-flight output, read-back
queries, structural-row counts) is in `scripts/verify-migration-ledger.sql` §RESULTS. This note
indexes it rather than re-narrating it.

## The project

- There is **one** Supabase project, `hyaqydcmwbnbaiqqufow`, and it holds real data. All five `.env`
  files point at it: `.env`, `apps/web/.env.local`, `apps/admin/.env.local`, `apps/worker/.env`,
  `apps/cli/.env`. This was verified 2026-09-11 (bf66041), when no reference to the old ref was left
  anywhere outside `docs/`. It was re-checked by count on 2026-09-29: each file names the new ref and
  none names the old. Outside `docs/`, `git grep` still finds the old ref in
  `.claude/rules/migrations.md` (which names it as deleted) and `scripts/verify-migration-ledger.sql:987`.
  Neither is config.
- The old project (`mtpmrqltldfwhziyyzdu`) is deleted. That is founder-reported, and its date is
  recorded nowhere (`docs/legal/reg2-open-questions.md:80` asks for it).
- The env flip was on **2026-08-27**. That date is in the vault notes that cite it, e.g.
  [[pronunciation-map-is-empty-on-the-new-project]]:16 and bf66041's message.
  `docs/08-supabase-project-rebuild.md` §8 is the repoint procedure and does not carry the date. Not
  resolved: `docs/legal/reg2-open-questions.md:80` says the env-flip date is written nowhere in the
  repo.
- **The escape hatch.** From 2026-08-26 (5ce8a6d) until 2026-09-11 (bf66041), CLAUDE.md offered one:
  the new, still-empty project could be deleted and recreated in three minutes (`docs/08` §1). It
  stopped being true at the env flip on 2026-08-27, so CLAUDE.md kept offering it for 15 days after
  that. bf66041 names that as the hazard. At 83a9a4b:79 CLAUDE.md summarised it as "the 'still-empty,
  so delete and recreate it in three minutes' escape hatch this line used to offer died at the env
  flip on 2026-08-27".

## The ledger

**Clean at 0000–0052.** There are 53 files in `supabase/migrations/` and 53 ledger rows, with no
gaps and nothing unapplied. This was measured 2026-10-07, right after the 0051+0052 push (the 0050
push on 2026-10-02 measured 51 / 51). The directory tracks 57 files in all; the other four are `meta/0000-0002_snapshot.json` and `meta/_journal.json`.

Before that:

- **2026-08-26.** The ledger was repaired to 0000–0030 (ad0c8c3;
  `scripts/verify-migration-ledger.sql` is the proof file; [[migration-ledger-stops-at-0007]]). That
  repair ran on the OLD project (verify:987-992). The same day, the NEW project was built from empty
  by `db push`, with all 31 migrations clean and no repair needed (verify:994-1001).

## Applies since the repair

| Migration | Date       | What                                                                                                                                                                                                                                | How                                                                                                                                                                                                                                                          | Commit  |
| --------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| 0031      | 2026-08-26 | seed unseeded config                                                                                                                                                                                                                | `db push`; ledger 32 rows (verify:1086-1091)                                                                                                                                                                                                                 | 23a10cc |
| 0032–0033 | 2026-09-05 | opener clips + their RLS                                                                                                                                                                                                            | founder, in the dashboard, then `supabase migration repair --status applied 0032 0033`                                                                                                                                                                       | e4cb08e |
| 0034      | 2026-09-06 | the HeyGen expressiveness/prompt rows                                                                                                                                                                                               | `db push` on a one-push instruction, per 5bc9b84 and 2828fd3; no §RESULTS entry                                                                                                                                                                              | 6f32250 |
| 0035      | 2026-09-08 | the in-app feedback table                                                                                                                                                                                                           | `db push` (verify:1003-1016)                                                                                                                                                                                                                                 | 5bc9b84 |
| 0036      | 2026-09-11 | the `daily_caps` runaway detector                                                                                                                                                                                                   | `db push`; a DATA no-op, because the caps had already been moved by hand (verify:1064-1084; [[daily-caps-were-hand-edited-before-0036]])                                                                                                                     | 2828fd3 |
| 0037      | 2026-09-11 | `events.notified_at`                                                                                                                                                                                                                | `db push` (verify:1018-1063)                                                                                                                                                                                                                                 | b1f41b4 |
| 0038      | 2026-09-13 | `audio_preview_daily_limit` 20 → 50                                                                                                                                                                                                 | `db push` (verify:955-985)                                                                                                                                                                                                                                   | f86f1ea |
| 0039      | 2026-09-13 | `credit_costs`: `a_steps_credits` 5 → 3, new `a_demo_analysis_credits` 2                                                                                                                                                            | `db push`, ahead of its own code (see below; verify:872-908)                                                                                                                                                                                                 | c1b0d66 |
| 0040      | 2026-09-16 | `audio_preview_daily_limit` back 50 → 20                                                                                                                                                                                            | `db push`, guarded, with a before-read (verify:910-953)                                                                                                                                                                                                      | b6bf6f4 |
| 0041–0042 | 2026-09-16 | subscriptions keyed on the account; RLS re-scoped                                                                                                                                                                                   | `db push`, destructive, with a before-read (verify:814-868)                                                                                                                                                                                                  | 6201bb8 |
| 0043      | 2026-09-17 | the ₪0.15 credit unit and the three plans                                                                                                                                                                                           | `db push` (no §RESULTS entry; [[credit-costs-row]]:36-45, `docs/05-billing.md`:335-340)                                                                                                                                                                      | 1f979d9 |
| 0044–0047 | 2026-09-17 | Hebrew plan names + `subscriptions.gateway` default `'sumit'`; `subscriptions.scheduled_plan_code`; `terms_acceptances`; nullable `feedback.user_id` + contact columns                                                              | `db push` (verify:761-810)                                                                                                                                                                                                                                   | 54c6231 |
| 0048      | 2026-09-21 | `checkout_intents`, the hosted-checkout intent row ([[0062-hosted-checkout-via-sumit-payment-pages]])                                                                                                                               | `db push`; ledger 49 rows (verify:727-759)                                                                                                                                                                                                                   | f4d079e |
| 0049      | 2026-10-01 | `hook_clips.text_color` (white or black), the founder-set hook-line colour ([[0073-hook-text-colour-is-set-per-clip-by-the-founder]])                                                                                               | `db push`; ledger 50 rows (verify:742-771)                                                                                                                                                                                                                   | 8838c4f |
| 0050      | 2026-10-02 | `demo_analysis_footage`, what the analysis knows about the recording itself ([[0077-moments-keep-their-real-start-and-end]], [[0083-no-model-names-the-instants-for-now]])                                                          | `db push`; ledger 51 rows (verify §RESULTS, the 2026-10-02 entry)                                                                                                                                                                                            | f1bffd3 |
| 0051–0052 | 2026-10-07 | Service C: `service_kind` `c` and `script_kind` `text_block`; the `text_block_clips` bank, RLS on with no policy ([[0089-service-c-text-block-exists-admin-only-phase-1]], [[0090-text-block-format-clip-once-with-its-own-sound]]) | `db push` on the founder's conditional approval, conditions checked first; ledger 53 rows (verify §RESULTS, the 2026-10-07 entry)                                                                                                                            | b18389a |
| 0053–0056 | 2026-10-09 | Service C phase 2: `credit_costs.c_text_block_credits` 25; `text_block_clips.persona_id`; `personas.voice_id` nullable; `scripts.shown_at` ([[0099-service-c-phase-2-opens-to-customers]])                                          | `db push` on the founder's one-push approval, before the merge (rule 9); ledger 57 rows (verify §RESULTS, the 2026-10-09 entry)                                                                                                                              | 2d8729a |
| 0057–0059 | 2026-10-11 | Social posting: the three enum types; `social_accounts` + `scheduled_posts`, RLS on with no policy; `events_unnotified_alerts_idx` rebuilt with `post_failed` ([[0101-tavnit-schedules-and-posts-to-instagram-and-tiktok]])         | `db push` on the founder's one-push approval ("push 0057–0059, I approve this one push"), after PR #89 merged; read back before and after; ledger 60 rows                                                                                                    | 6494c30 |
| 0061–0062 | 2026-10-14 | The ₪5 intro offer: `ledger_reason` + `grant_trial`/`expire_trial`; `checkout_intents.kind` + nullable `plan_code`; `intro_trials`; `app_config.intro_offer` off ([[0109-a-five-shekel-intro-offer]])                               | `db push` on the founder's instruction ("go ahead and push migrations and merge the branch"), BEFORE PR #97 merged (the 0039 rule: the code names `kind` in every intent read); read back before and after; ledger 63 rows                                   | 153209b |
| 0060      | 2026-10-11 | Social posting PR 2: `scheduled_posts.ai_label boolean NOT NULL DEFAULT false`, the customer's own AI-label tick ([[0102-social-posting-label-mix-switch-key-2026-10-11]])                                                          | `db push` on the founder's instruction ("OK, apply migration 0060."), BEFORE PR 2 merged (the 0039 rule: the code names the column in every post read); read back before and after; ledger 61 rows                                                           | 6c8a16e |
| 0063      | 2026-10-15 | each plan one shekel less: 15000/30000/50000 → 14900/29900/49900 agorot, guarded on the old price ([[0113-the-intro-card-on-the-plan-page-estimates-and-prices-one-shekel-less]])                                                   | `db push` on the founder's answer in session ("Push 0063 now"), BEFORE its branch merged: the Sumit pages already charged ₪149, and `verifyHostedPayment` refuses an amount that differs from the intent's price; read back before and after; ledger 64 rows | 5f83d62 |

CLAUDE.md (83a9a4b:138) listed 0034–0040, 0043, 0044–0047 and 0048 as pushed "each by a session on
the founder's explicit instruction — those instructions were for that one push each, not a standing
permission". It said "All of them were pushed with the connection string read from `.env` inside a
script rather than typed onto a command line (the credential rule above), after a read-only
`migration list` + `db push --dry-run` pre-flight", and that "`db push` records the version itself,
so none needed `migration repair` — ten times running". The sources do not all agree with that
summary. These disagreements are recorded here and not resolved:

- **0032/0033** were not pushed. The founder applied them by hand and repaired the ledger (e4cb08e).
- **0036, who ran it.** [[daily-caps-were-hand-edited-before-0036]]:5 calls it "Founder-run", with an
  `npx -y supabase migration list` pre-flight. verify:1064-1066 and 2828fd3 describe a `db push` on
  the founder's explicit instruction for that one push, with the connection string read inside a
  script.
- **How the practice is recorded.** The in-script connection string is first recorded at 0035
  (5bc9b84), and 2828fd3 says 0034 and 0035 followed the same procedure. The pinned `.exe` and the
  output-scrubbing wrapper are first recorded at 0037 (verify:1041-1052). 0034 has no §RESULTS
  entry.
- **The count.** CLAUDE.md said "ten times running". verify:732 calls the 0048 push "the ELEVENTH time
  in a row". The file's own REPAIR note (verify:715) still says "SIX times running now", and
  `state-of-play.md` says "zero times in ten".
- **"0031–0040 have been pushed since"** was CLAUDE.md's header for a list that goes on to 0048.

## Lessons the pushes taught (now rules in `.claude/rules/migrations.md`)

- **0040 added a step the other six did not need: a BEFORE-read.** Its `UPDATE` is guarded on the
  old value, and a guard that matches nothing exits 0, prints the same output and still records its
  version. The ledger would then say applied while the value had not moved. Any guarded migration
  therefore needs the row read through the code's own parse both before and after, not just after
  (verify:922-934; [[app-config-live-state]]:63-66). verify:914 counts 0040 as the seventh
  self-recorded push.
- **0041+0042 needed a before-read for a different reason: an irreversible `DROP COLUMN`.** The
  question there is not "did the guard match" but "what is in the column". `subscriptions` measured
  0 rows before `business_id` was dropped. That was the first count of that table ever taken on
  this project.
- **A column an RLS policy reads cannot be dropped until the policy is.** 0041 drops
  `subscriptions_select_own` itself, so the portable file still applies everywhere, and 0042
  recreates it on `user_id` (0011/0012's shape).
- **0039 had to go FIRST, ahead of its own code.** `creditCostsSchema` makes its new key required,
  so a build carrying the schema key against a row without it throws on every quote path rather
  than mis-pricing. 0045 needed the same order (verify:803-808).

## The CLI recipe, corrected

CLAUDE.md said "no Supabase CLI is installed — npx fetches it" until **2026-09-13** (f86f1ea). That
was false: `supabase` is a root devDependency (`package.json`: `^2.109.1`, locked at 2.109.1), and
`npx -y supabase` fetched a second copy every time. CLAUDE.md's Commands block kept an
`npx -y supabase db push --db-url <session-pooler url>` line until 2026-09-29, when the founder had it
removed. Its end-of-task protocol also said "If a supabase migration needs to be applied, apply it
yourself", and the founder replaced that the same day: never apply at end of task, and report the
waiting migration with its dry-run output.

Not resolved: two files still prescribe `npx -y supabase`, against the rule file's "never use
`npx -y supabase`". They are `docs/08-supabase-project-rebuild.md:72` (`npx -y supabase db push
--db-url $NEW`) and the REPAIR recipe at `scripts/verify-migration-ledger.sql:718-719`.

## Related

- [[migration-ledger-stops-at-0007]] — the pre-repair defect
- [[supabase-link-state-removed]] — why every command passes `--db-url` explicitly
- [[0018-rls-cannot-ride-in-a-portable-migration]] — the portable vs Supabase-only split behind the
  0041/0042 order
