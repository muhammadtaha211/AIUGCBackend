---
type: fact
status: verified
verified: 2026-10-28
method: "Read, no code run and nothing in production touched, at origin/main 0fc8ab0 (2026-10-28): supabase/migrations/0070_autopilot.sql; packages/core/src/pipelines/autopilot.ts, autopilot-setup.ts, copy.ts, sets.ts, social.ts, businesses.ts; packages/core/src/providers/meta-graph.ts; apps/web/src/lib/autopilot.ts, apps/web/src/app/api/autopilot/route.ts, apps/web/src/app/(posting)/autopilot/autopilot-setup.tsx, apps/web/src/app/api/onboarding/complete/route.ts, apps/web/src/app/api/social/posts/[id]/route.ts, apps/web/src/app/home/sidebar.tsx; prompts/hook_lines/v7.md. Every line number is at that commit; a later edit to those files moves them."
source: code
---

# The autopilot as built, against the three things the demand test needs of it

[[0128-the-autopilot-is-the-demand-test-engine]] would run candidate Instagram accounts through the
autopilot ([[0127-the-instagram-autopilot]]). Each of the three needs below was checked against the
code, and **none is built**. The reads are MEASURED by reading; a line marked REASONED is a reading
of those lines, not a run. The sizing of the changes is planning, so it is in state-of-play's queue,
not here: this note names only the place each change would land. What connecting a new account takes
is [[connecting-a-new-instagram-account-while-the-meta-app-is-unapproved-2026-10-28]].

## 1. Its own business per account — NOT built

The business is chosen once per Tavnit login. Every Instagram account on the login renders from it.

- **Storage.** `autopilot_setups` is one row per login (primary key `user_id`) and holds the one
  `business_id` (`0070_autopilot.sql:33–35`). `autopilot_accounts` has no business column
  (`:46–61`).
- **Save.** The body carries one `businessId` (`autopilot-setup.ts:77–79`,
  `apps/web/src/lib/autopilot.ts:35`), which the caller must own (`autopilot-setup.ts:252–256`). An
  account's demos are checked against that business alone (`:282–286`, refused `demo_not_owned` at
  `:310–312`).
- **The night.** Every business read is `setup.businessId`, ten sites in `autopilot.ts`: the
  hook-line pool and its top-up (`:392`, `:410`, `:418`, `:760`, `:963`, `:966`), the ready demos
  (`:735`, `:972`), the admin-owned check (`:1016`) and `createSet` (`:1031`).
- **The page.** One select for the whole page, shown only when he owns more than one business
  (`autopilot-setup.tsx:228–244`). `GET /api/autopilot?businessId=` previews another business's
  demos (`api/autopilot/route.ts:6–11`); the save writes the one pick.
- **So** choosing a candidate's business on the page clears every account's demo picks
  (`autopilot-setup.tsx:139–144`), and a save is then refused `nothing_to_post` for each account
  that is on (`autopilot-setup.ts:355–357`); a request that keeps the old picks is refused
  `demo_not_owned`. Saved with the Tavnit accounts switched off, it moves the whole login to the
  candidate's business. The Tavnit accounts and a candidate cannot share a login as built.

**Also in the way: characters.** A character can be on one account per login
(`autopilot-setup.ts:304–307`, `character_on_two_accounts`). Per 0127 §7 and its 2026-10-25 read,
all six active characters are already on the four accounts (not re-read today), so a candidate on
the same login would have to take one from a page.

**The rest of the chain already supports a second business** (MEASURED). The sidebar's «הוספת עסק»
(`apps/web/src/app/home/sidebar.tsx:280–286`) opens `/home/new-business`, whose completion posts
`allowCreate` and skips the one-business guard (`api/onboarding/complete/route.ts:89–111`), so a
business with its own questionnaire, demo upload, analysis and plan approval is made in the app.
`isAdminOwned` is true for any business whose owner has role admin (`businesses.ts:233–237`), so
the night's render takes no debit and no classifier call for it.

**Works today without code (REASONED): a second admin login per candidate.** It has its own setup
row and business, and the connect is run under it. `getAutopilotAccess` and `getPlatformAccess`
pass any `users.role = 'admin'` (`autopilot.ts:112–119`, `social.ts:186`), and the live-account
unique index is per login (`social_accounts_live_idx`, `0058_social_tables.sql:86–88`), so the same
Facebook profile can connect under two logins. The costs:

- the second login must be promoted to admin by a production write that needs his instruction
  (`ensureUser` returns an existing row and never changes its role, `businesses.ts:128`);
- the connect upserts every professional account the profile returns, under whichever login runs
  it (`callback/route.ts:84–95`, `social.ts:392–448`), so that login's `/autopilot` also lists his
  other accounts as cards, switched off (`autopilot-setup.ts:209–228`). Switched on in both logins,
  one account would be planned and posted by both.

**Where a change would land:** a business on the account row (`0070:46–61`), read in place of
`setup.businessId` at the ten sites above, validated in the save (`autopilot-setup.ts:252–256`,
`:282–286`, `:310`) and chosen per card on the page.

## 2. A caption set once per account — NOT built

- **The literal.** The night schedules every autopilot post with `caption: ""`
  (`autopilot.ts:900–901`, its comment "No caption (decision 14)"). `autopilot_accounts` has no field
  that could hold one (`0070:46–61`).
- **The path under it exists.** `schedulePosts` takes a caption up to `CAPTION_MAX_CHARS` = 2200
  (`social.ts:79`, `:703`), stores it on the post (`:756`), and `publish_post` hands it to Meta as
  the container's caption (`social.ts:1471`, `meta-graph.ts:360`).
- **By hand, per post.** The post page edits an autopilot post's caption until it starts to publish
  (`api/social/posts/[id]/route.ts:29`, `updateScheduledPost` at `social.ts:797–799`). At about 22
  posts a day (FOUNDER-REPORTED) that is not a path.
- **Where a change would land:** a caption on the account row, in the save body
  (`apps/web/src/lib/autopilot.ts:32–49`) and the page's version stamp (`autopilot-setup.ts:472–500`),
  read at the one `scheduleSlot` call (`autopilot.ts:892–907`; `accountReady` already reads the
  account row, `:830–844`). It would amend 0127 §14 ("No caption"): see 0128.

## 3. Hook lines as a list he writes — NOT built

- **No path in.** Nothing puts a hook line in the autopilot's pool but the wizard's generator. The
  pool a slot draws from is the `scripts` rows of kind `hook_line`, of the setup's business, whose
  `params.autopilot.gender` is set and that no slot or render has used, by id or by text, oldest
  first (`autopilot.ts:337–375`). The gender tag is written only after a generator batch
  (`autopilot.ts:423–432`).
- **The generator.** `generateHookLines` (`copy.ts:129–222`) reads the business's questionnaire
  (`:141`), takes the speaker's gender (Hebrew first person is gendered, `:136`, `:165–171`), runs
  prompt `hook_lines` (latest `prompts/hook_lines/v7.md`) for a batch of ten (`:81`) and checks it
  for unrenderable characters (`:106–127`, `:190–205`).
- **The audience a generated line names comes from the questionnaire (REASONED).** v7 takes
  `target_audience` as its "primary raw material" (`prompts/hook_lines/v7.md:13–14`) and the
  generator passes the whole questionnaire (`copy.ts:165–171`); nothing in the prompt or the
  autopilot sets an audience of its own. So the wide audience word of 0128 decision 3 is, for
  generated lines, the business's own `target_audience` answer. What the Tavnit business's answer
  says today was not read (production untouched).
- **A written list would fit the pool (REASONED, from `autopilot.ts:337–375` and `:392`).** Tagged
  rows are served oldest first, and the generator is called only while the pool is short
  (`autopilot.ts:392`), so a list is spent before any model call: "alongside" generated lines comes
  with the pool, and a slot with no line is skipped `no_line` (`:777`). "Instead of" generated
  lines needs one switch that skips the top-up. Today only a SQL insert puts a line there, a
  production write that needs his instruction.
- **The guards a list would bring itself.** `createSet` reads a hook line by id and checks neither
  its characters nor its length (`sets.ts:283–292`, `:344–357`). The generated path checks
  characters only (`copy.ts:190–205`), and v7 asks for about 60 characters and at most 8 words
  (`prompts/hook_lines/v7.md:71–73`).
- **The pool is per business and gender**, not per account (`autopilot.ts:343–347`): two accounts
  on one business share it, so a list per account follows from a business per account (§1).
- **Where a change would land:** a function that inserts lines as `scripts` rows with the pool's
  tag, after the character guard; a route and a textarea per gender on the page; optionally the
  "only mine" switch.

## Not checked here

- No signed-in walk of the page and no run: the claims are from the code. The page with a second
  business selected was read, not driven.
- The production setup's current picks (which characters and demos are on which account) were not
  re-read; 0127's 2026-10-25 read stands.
