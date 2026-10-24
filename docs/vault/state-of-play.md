---
type: state
status: current
updated: 2026-10-24
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

**The product is live end to end, and billing is WIRED and has taken a real payment (2026-09-21).**
`tavnit.ai` serves `apps/web` on Vercel; both wizards run; `apps/admin` sits behind HTTP Basic in
front of `requireAdmin`. Service A/B format and engine decisions are all in `decisions/` — start at
[[0020-service-a-is-hook-and-steps-only]], [[0017-service-b-single-setting-selfie-talking-head]],
[[0023-hook-is-a-remotion-animation-opener-clips-retired]],
[[0024-hook-effect-is-a-render-param-the-customer-picks]], and CLAUDE.md (Service B's detail is in
`.claude/rules/service-b.md` since 2026-09-29) rather than a summary here.

**Email confirmation is ON since 2026-09-11** — the live behaviour a new session is most likely to
trip over. Every signup depends on a Resend delivery, ceiling 100/day
([[auth-email-runs-through-resend]]).

**The first signup by someone other than the founder: 2026-10-01. FOUNDER-REPORTED**, except the
two lines marked MEASURED. It was a non-fit, with adult-persona intent, and **no credits were
granted**. The account is left as it is. MEASURED (code, `apps/web/src/lib/wizard-gate.ts`): a
zero balance keeps an account out of both wizards. He attributes the signup to the Instagram videos
because he has run no other promotion. MEASURED (grep): **the repo has no signup-source tracking**,
so the attribution is his, not measured. This is the event 0041/0042 named, so
[[live-account-census-2026-09-10]] is marked stale; no new census has been run. Nothing
identifying about the signup is written anywhere in the repo, by instruction. The same day's
decisions — prices unchanged, no self-serve free tier, trials granted by hand at ~200 credits — are
[[0068-prices-stand-no-free-tier-trials-by-hand]].

**The Instagram autopilot: BUILT 2026-10-24 on `feat/instagram-autopilot`; migration 0070 waiting
for the push; the box step after the merge is his.** [[0127-the-instagram-autopilot]] records his
decisions 3–19 and his calls at approval. After a one-time setup at `/autopilot`, every night at
03:00 Israel the box plans each connected Instagram account's day:

- one 1×1 הוק + דמו render per post, one render at a time, scheduled through today's
  `schedulePosts` → `publish_post` at his times;
- each account's own characters, a least-used hook clip, demo and sound, a hook line never used
  before, no caption, no AI label;
- a refused sound swaps inside `publish_post`, for autopilot posts only;
- a failed render retries and then tries another version;
- a lapsed connection, no usable sound, a character with no clips, a refused file, or a day with
  nothing posted pauses that account and emails him once;
- the night checks in to Sentry.

Admin-only behind `app_config.autopilot` (no row = admins), so he needs no SQL. MEASURED: the night
end to end on 2026-10-25 (the clock-change day) with fakes for Meta, Claude, the renderer and Resend,
in packages/core/test/autopilot-night.test.ts. Details under "What landed (2026-10-24, later)";
what is his under "Owed founder actions".

**The demos page in the phone menu: BUILT 2026-10-24 on `feat/phone-menu-demos`; no migration,
no box step; merged by the session on his instruction ("merge the branches when you're done
yourself").** [[0126-the-demos-page-is-in-the-phone-menu]]. FOUNDER-REPORTED (2026-10-24): checking
the demo names on his phone, he found no way to reach `/home/demos`. The account menu (below `md`
the whole nav; it opens from the avatar, not the logo) gains "סרטוני המוצר" → `/home/demos`, and so
does the desktop popover that shares it. Pinned by `apps/web/test/profile-menu.test.ts`; seen at
375 px in a harness (`packages/core/.work/shots-0126/`, gitignored), not on his phone.

**Demo names: BUILT 2026-10-24 on `feat/demo-names`, MERGED as PR #116 (`4383fd4`, MEASURED by
`git log` 2026-10-24); 0069 PUSHED 2026-10-24 before the merge, both on his instruction ("apply any
migrations you need for this to take affect, push and merge").** Read back after the push,
read-only: `demos.name` text and nullable, 0 of 23 demos named, ledger 70 rows to 0069.
[[0125-demos-get-an-optional-name-never-read-by-a-model]]. A customer can name a recording as it
uploads, in A and in B, and rename or clear it on `/home/demos`. The name shows in every picker and
list, an unnamed demo looks as before, and no model reads it. Details under "What landed
(2026-10-24)"; the strings wait for his approval under "Owed founder actions".

**"גרסה נוספת" on finished hook + demo and גוש טקסט videos: BUILT 2026-10-22 on
`feat/next-version-action`, MERGED as PR #115 (`fc9c1d4`, MEASURED by `git log` 2026-10-23; this
line said "NOT MERGED"); no migration, no box step.**
[[0124-the-next-version-is-taught-at-the-finished-video]]. A third button on every surface a
finished A (steps) or C video plays. A opens the wizard's character step with the recording
already held, under a line naming the next render's price (25 today) and the volume pitch. C
opens the text step with the same character and clip. Nothing on B. One PostHog event,
`next_version_started`. Details under "What landed (2026-10-22, later)"; the strings wait for his
approval under "Owed founder actions".

**Service B demo cutaways and no sway: BUILT 2026-10-20 on `feat/b-demo-cutaways`; 0068 PUSHED
the same day on his instruction ("when you're done go ahead and apply the migrations and merge
yourself").** [[0121-service-b-demo-cutaways-and-no-sway]]. A customer can tick "לשלב קטעים מסרטון
המוצר" on the audio card and cut away to 4–6 s stretches of their own analysed demo; off, the ad is
today's minus the sway, which is gone from every B render. **MERGED as PR #112 (`c5c85e6`,
2026-10-20); the box runs it** (MEASURED 2026-10-21, read-only: his render `cbd62014` was run by
`hetzner:heavy` and its output cuts at the slot edges — a pre-merge box would have ignored them).
Details under "What landed (2026-10-20, last)".

**Service B cutaways, revised: BUILT 2026-10-21 on `feat/b-cutaway-relayout`, MERGED the same day
as PR #113 on his instruction ("open the PR and merge yourself"); no migration, no box step.** [[0122-service-b-clips-before-the-effect-first-cut-at-the-product-mention]]. The clips
step now comes right after the audio card and before the effect; the draft never cuts before the
phrase where the script first names the product; the customer moves, adds and removes clips freely
(a long run is noted, never blocked); a longer hook text moves the clip it reaches; one letter and
one colour per clip; big cards; the picker's drag selects nothing. Walked on his own Pixel 6a and a
desktop Chrome. Details under "What landed (2026-10-21)"; what is still his under "Owed founder actions".

**TTS moves to Eleven v4, as plain text: MERGED as PR #111 (`cc46f64`, MEASURED by `git log`
2026-10-20; this paragraph said the merge was his and pending).** The box runs it: he ran the B flow
on the box with v4 the same day (FOUNDER-REPORTED). [[0119-tts-is-eleven-v4-plain-text]]; the paid
checks pass ([[eleven-v4-paid-check-2026-10-20]]); the details are under "What landed (2026-10-20,
later)".

**The ₪5 intro offer: MERGED 2026-10-14 as PR #97 (`d41eae6`); migrations 0061/0062 PUSHED the
same day, before the merge. LIVE since: MEASURED 2026-10-15, `https://tavnit.ai/pricing` shows the
offer to a signed-out visitor and `app_config.intro_offer` reads enabled, so `SUMIT_INTRO_PAGE` is
set on Vercel and the switch is on (who set them, and when, is not recorded here). The box runs it: the founder restarted it 2026-10-14, and its first `expire_trials`
succeeded at 19:50 UTC.** An account that has never paid buys, once, 150 credits for every service for ₪5 on its own
Sumit page, valid 30 days, never a charge by itself; "continue" charges the card saved at that
payment for an ordinary first month. Behind `app_config.intro_offer` (seeded off) and
`SUMIT_INTRO_PAGE` (unset everywhere but the founder's head). Decision
[[0109-a-five-shekel-intro-offer]] (his eight decisions of 2026-10-13/14, the credits raised 145 →
150 at plan review, his two plan-mode answers: a lost continue answer is settled automatically, the
walkthrough runs off production); `docs/05-billing.md` §"The ₪5 intro offer" says what exists.
Owed-list steps 7 and 8 (the Vercel env and the switch) are therefore done; the rest of that list
stands. Since 2026-10-15 `/pricing` shows it as a card ([[0112-pricing-names-three-services-and-shows-the-intro-card]]), and `/home/plan` shows the same card to an account that may buy it, in the brand gradient (lime to emerald) ([[0113-the-intro-card-on-the-plan-page-estimates-and-prices-one-shekel-less]]). **The
merge alone does change three public things:** terms §8 gains the offer's bullet, `UPDATED` becomes
14.10.2026 (the version every later purchase records, and the date `/privacy` shows), and the
refused/unconfirmed checkout lines say "הרכישה" instead of "המסלול". Counsel's E12(a) — whether
the bullet is a material change under §14 — is not answered; merging before it ships the bullet
first.

**PostHog on `apps/web`: MERGED 2026-10-11 as PR #92 (`81c3b30`, MEASURED by `git log`; this file
said "NOT merged" until 2026-10-15). Recording in production is confirmed (FOUNDER-REPORTED, below).
Since 2026-10-15 every page records and only the sensitive is hidden: MERGED that day as PR #99
(`40a1e29`)** ([[0110-posthog-records-every-page-hides-only-the-sensitive]], the section "What landed
(2026-10-15)" below). Visit counts on every page, session recordings, named funnel steps and browser
errors go to PostHog's EU cloud.

- **FOUNDER-REPORTED (2026-10-15):** a customer sign-in in a normal browser produced no recording;
  the same in an incognito window did. The cause, as planning read it from `docs/10-analytics.md`:
  that browser carries `aiugc.analytics.off` from his admin sign-in on 2026-10-11. That is the first
  production recording confirmed. Nothing else about the PostHog dashboard has changed since
  2026-10-11.

- **Decisions:** [[0103-posthog-in-apps-web-eu-cloud-free-plan]] (the service, the boundary, errors
  beside 0037, what is not built) and [[0104-what-posthog-records-and-what-never-leaves]] (counts,
  recordings, identity, hiding, the notice). The wiring, the named steps, the env and the dashboard
  settings: `docs/10-analytics.md`.
- **What the founder reported on 2026-10-11 (FOUNDER-REPORTED, not repo-verified):** he created a
  PostHog account; its dashboard address is `eu.posthog.com/project/302007/…`. Nothing else about the
  account was reported. **Which settings he turned on is asked at the end of the task and recorded
  here when he answers.**
- **Planning defaults (PLANNING DEFAULT, unstruck):** `/login`, `/forgot-password` and
  `/reset-password` are recorded and carry the notice; no proxy through our domain; where recording
  runs is decided in the repo; console output captured only if checked (checked: nothing logs; left
  off anyway).
- **MEASURED:** 81 tests in `apps/web/test/analytics.test.ts`; the hiding check against a local
  ingest stand-in, run before and after the review's fixes ([[posthog-hiding-check-2026-10-11]]):
  none of seventeen marker values left the browser, public pages sent no recording, an admin
  session sent PostHog nothing at all.
- **An adversarial review of the diff (2026-10-11, five reviewers, one refuter each) confirmed 20
  findings (16 distinct; 5 more were refuted), all fixed or documented before the PR.** The sharpest: a PostHog dashboard URL trigger
  would have put the raw address (tokens included) into the recording as `matchedUrl`; an admin's
  first seconds on `/home` after a password sign-in could have left before the account check
  answered; a PostHog identity outlived a session ended without `signOut()`. The rest are in the
  PR description.
- **One switch is not the repo's (MEASURED in the SDK's source):** the SDK records nothing unless
  the project's session replay is ON in PostHog's dashboard. PostHog's dashboard can also turn
  network capture on regardless of local settings; it is dropped in code.
- **Legal:** `/privacy` §3, §5, §6, §7, §8, §9 edited and `UPDATED` moved 17.09.2026 → 11.10.2026
  (legal-review P13, P14; three reg-2 worksheet rows). This breaks the legal-pages hold of
  [[0099-service-c-phase-2-opens-to-customers]] §9 on the prompt's explicit instruction; a dated
  pointer there says so. `/pricing` and the terms text are untouched. Found while there, not fixed
  (not this task's): `/privacy` §9 already lacked `aiugc.social_oauth` (social posting).
- **Stale from this:** 0068's and this file's "no analytics package, no UTM or referrer capture"
  (dated pointer on 0068; there is still no source column in the database); `docs/00-overview.md`'s
  PostHog line (pointer added); 0037 gained a pointer.

**Unattended feature runs in a cloud session: SET UP 2026-10-08 on `tooling/unattended-cloud-runs`,
MERGED as PR #84 (`1b709ff` on `origin/main`, MEASURED by `git log` 2026-10-09). The first run went
2026-10-09: the inventory first-load retry, on `claude/inventory-first-load-retry-kv24q9`, PR #85,
not merged.** One spec goes in, and a pushed branch, a PR and a report
come out, with two stops of his: the plan, and the merge with everything after it.

- **Decisions:**
  - [[0096-unattended-runs-happen-in-a-cloud-session]]: the run. It starts in Plan mode, and the spec
    is saved after approval.
  - [[0097-push-to-main-refused-by-a-git-hook-the-rest-instruction-only]]: what is refused.
  - [[0098-paid-claude-calls-pre-approved-up-to-the-specs-cap]]: paid checks.
- **Enforced:** a push to main from any Claude session is refused by a git pre-push hook, installed at
  session start by `.claude/hooks/session-start.mjs`.
  - Locally it is in `.git/hooks` and refuses only when `CLAUDECODE` is set. Installed in his checkout
    2026-10-08.
  - In the cloud it refuses always, and covers every clone through the global `core.hooksPath`.
  - Settings are frozen in a cloud session.
- **Unreachable in the cloud:** `db push`, `migration repair` and ssh, because no credential is
  there.
- **Instruction only, each a stop:** merging, `--no-verify`, and printing the key.
- **The planned PreToolUse guard was not built.** The session's step that wrote it was stopped by
  Anthropic's safety classifier, and he ruled it out (0097 says why).
- **What changed in the repo:**
  - `.claude/settings.json` (SessionStart and ConfigChange only);
  - `.claude/hooks/`;
  - `.claude/agents/spec-reviewer.md` (new);
  - test-runner can use Bash;
  - `docs/unattended/` (protocol, spec template, runbook);
  - `packages/core/test/unattended-guard.test.ts`;
  - a CLAUDE.md pointer (§4).
  - No product code, prompt, migration, schema or dependency changed.
- **The first run (2026-10-09)** fixed [[the-inventory-first-load-failure-has-no-retry-button]]
  through both stops. Its spec, log and first-run checklist are in
  `docs/unattended/runs/2026-10-09-inventory-first-load-retry/`. Two findings from it:
  - **The protocol's branch naming does not hold in the cloud.** The session started on a branch
    the harness assigned, `claude/inventory-first-load-retry-kv24q9`, sitting on `origin/main`'s
    head, and the harness says not to push to another without permission. He ruled at plan
    approval to use it. `docs/unattended/protocol.md` still says `<type>/<slug>`; the run did not
    change it.
  - **The gate is 6 of 7 in that environment** (Unfinished measurement).
- **Still to do:** that branch's owed steps (Owed founder actions), and first-run items 5, 11 and
  12, which are his.

**Every Claude call moves to `claude-sonnet-5-5`, thinking off: BUILT 2026-10-08 on
`feat/sonnet-5-5` (`495384c`), MERGED as PR #82 (`7f7489f` on `origin/main`, 2026-10-08 06:05
+0300, MEASURED by `git log`). The five paid checks PASS, ₪3.85 of a ₪10 cap
([[sonnet-5-5-paid-check-2026-10-08]]). The box restart is still owed.**

- **Decisions:**
  - [[0093-every-claude-call-runs-on-sonnet-5-5]] (the founder's, 2026-10-07: everything at once);
  - [[0094-claude-usage-costed-at-sonnet-5-5-price]] (one `llmCostAgorot` in `pricing.ts`, $2 /
    $10; [[llm-cost-formula-is-copied-four-times]] FIXED);
  - [[0095-thinking-stays-off-for-the-sonnet-5-5-switch]] (the founder's, 2026-10-08:
    `between_tools` on both wrappers, because 5.5 rejects `disabled` and turns adaptive thinking
    on when the field is omitted; a failed analysis check would have blocked the box).
- **What changed in code:**
  - the constant and the thinking setting in `providers/anthropic.ts`;
  - the four cost-formula copies removed;
  - `anthropic-request.test.ts` and `pricing.test.ts` pin the model, the thinking setting and the
    rate.
  - Nothing else changed: no prompt, cap, schema, migration or env.
  - The gate was all green on the tree: lint, typecheck, and remotion 97, core 988, worker 7,
    web 572, admin 65 (1,729).
- **The checks, against 4.6:**
  - **Classifier:** the same verdicts on a pass and a flag text.
  - **Copy for Tavnit:** passes. The one B script addressed the viewer as a woman, where the
    prompt reads the address from `target_audience`.
  - **גוש טקסט:** 40 texts, 69 agorot against 94. The course at male stored the word `skipped`
    as a text. Judged blind against v2 on 4.6 by one method, for him to confirm: 6 Hebrew
    mistakes against 21, 4 invented figures against 6, no copied or restating closing line
    against 7.
  - **Planner:** 5 of 5 ready, nothing repaired, 7 calls against 10, ₪1.51 against ₪2.82.
  - **T5 analysis, run locally:** `ready` on attempt 0, 8 calls, ₪1.38. The box took ₪2.20–2.72
    on 4.6.
  - **First-call tokens on identical planner input run 1.15–1.24× 4.6's (the tokenizer).** Token
    caps bind that much sooner per action. They were not changed.
- **Going live (owed, under "Owed founder actions"):** merge, with no env change; then the box
  pull and restart. Until the restart the box keeps calling 4.6, which still works.
  `usage_events` has no model column, so record both moments here when they happen.

**Example clips on the home cards, a higher home heading, גוש טקסט on the landing: BUILT
2026-10-10 on `feat/home-previews-landing-c`, from `origin/main` `ecbb9eb` (phase 2 merged as PR
#86). Gate all green at `e7f33e9` and again at `9ad5944` after his S4–S6 (lint, typecheck,
remotion 97, core 1038, worker 7, web 606, admin 71). MERGED in two PRs: #87 (`24b89aa`, merged
by him 2026-10-10 12:04 at `416e2fe`, the first build with full 9:16 clips), then #88 (his S4–S6:
the reshaped tiles, the footer and root description, review nits), merged on his instruction the
same day. No migration, no box step.**

- **Decision:** [[0100-home-cards-show-example-clips-landing-sells-three]]. It records his five
  decisions from the 2026-10-10 planning chat, the planning defaults (none struck), and three rulings
  from this session:
  - **S1** readable clips over the page fitting his window (options 1–4 shown as screenshots);
  - **S2** `a` ships unedited after the session flagged personal-looking tab titles in it;
  - **S3** the measuring session ran on tavnit.support;
  - **S4–S6**, his reply to the report: the copy approved, the footer and root description to name
    the third service, and the tiles reshaped after a competitor's screenshot (clip cropped to about
    1:1, name and link line under it).
- **What exists:**
  - each `/home` card is its example clip with the name and link line under it, laid out on a
    competitor's tiles he pointed at (S6): the clip cropped to 540×624, about 1:1 (`public/previews/`,
    no audio). The card shows a still at rest and plays the clip only while hovered, silent and
    looping with no controls. On touch the clip plays while the card is on screen. The description
    stays for screen readers.
  - the heading sits 15 px under the top bar at his window (it was 38).
  - the landing strip has three cards, and a `#text-block` section after `#presenter` plays
    `public/landing/text-block.mp4` (720p) lazily, like the other clips.
  - the shared footer's tagline and the root description name the third service (S5, his ask; the
    footer also shows on the held pages, whose own content is unchanged).
- **MEASURED, the cost:**
  - his window is 717×621, which is the phone layout (under 768 px wide). `/home` overflows there by
    121 px after the change (412 before, 243 with the first build's full 9:16 clips), 137 with a long
    strip;
  - a desktop-width window fits from 714 px tall, 730 with a long strip (it was 719).
- **FOUNDER-REPORTED, not repo-verified (2026-10-10):** on his screen `/home` needs a scroll to show
  the recent strip in full.
- **Approved by him 2026-10-10 (S4):** the new Hebrew strings (the landing's third card and the
  `#text-block` section).

**Service C phase 2, the customer wizard: BUILT 2026-10-09 on `feat/service-c-phase-2`.
Migrations 0053–0056 PUSHED TO PRODUCTION 2026-10-09 on his one-push approval, before the merge,
and read back (ledger 57 rows, 0000–0056; `verify-credit-costs.ts` PASS with the eleventh key;
verify §RESULTS, the 2026-10-09 entry). Gate all green (lint, typecheck, remotion 97, core 1038,
worker 7, web 604, admin 71). The merge was his instruction the same day (see Owed founder
actions for what is left).**

- **Decision:** [[0099-service-c-phase-2-opens-to-customers]] — his rulings 1–11 of 2026-10-07/08
  and four more from this task's planning chat (2026-10-09):
  - **R1** `personas.voice_id` is optional (0055), and B's picker also needs a voice;
  - **R2** batch served one at a time, replacing one call per text;
  - **R3** both batches on `text_block` v3 (v2 plus two hunks, `{{skeletons}}`);
  - **R4** one paid check, ₪0.5 cap.
- **What exists:**
  - `/home/c/new` (character → clip → studio → render), the third dashboard card and a sidebar
    entry;
  - `serveNextTextBlock` (stock = unseen, unedited, same gender, current questionnaire stamp,
    fitting, not a placeholder; LRU by `max(scripts.shown_at)` per skeleton across visits);
  - `createTextBlockRender` with the quote, `assertAffordable`, the content-policy gate and
    `debitRender` (the third debit site; the refund path needed no change);
  - `c_text_block_credits` 25 (0053), `text_block_clips.persona_id` (0054), `scripts.shown_at`
    (0056);
  - the routes `GET /api/text-block-clips`, `POST …/text-blocks/next`, `GET …/text-blocks/renders/quote`,
    `POST …/text-blocks/renders`, and a `text_block` branch in `POST /api/scripts/[id]/text`;
  - admin: a clip's character is required at register, reassignable on the card, flagged when
    missing; the gender follows the character (register, reassign, `updatePersona`); the render
    route refuses a customer business; persona create takes no voice.
- **The R4 paid check (MEASURED):** one call, 13 agorot, 20 s; nine skeletons requested without
  `discovery`; nine texts served in bank order from stock with no second call; texts in
  `packages/core/.work/text-block/v3-check.md` (gitignored).
- **Not built, REASONED in 0099:** the SELECT policy on `text_block_clips` (no browser reader).
- **Owed, in order:** see "Owed founder actions" — push 0053–0056 and read back, the box on ≥ #80,
  merge, then assign the existing clips to characters (the moment customers can first pay).

**Service C, גוש טקסט, phase 1 + 1b (admin-only): BUILT 2026-10-07, MERGED as PR #80 (`59a2ff1`
on `origin/main`, MEASURED by `git log`, 2026-10-07); migrations 0051 + 0052 PUSHED TO PRODUCTION
2026-10-07 and read back (ledger 0000–0052, 53 rows). Whether the box has pulled it is not
recorded in the repo. `text_block` v2: BUILT 2026-10-07 on `feat/text-block-v2`, MERGED as PR #81
(`691c9bf` on `origin/main`, MEASURED by `git log`, 2026-10-08).**
The decisions are [[0089-service-c-text-block-exists-admin-only-phase-1]] (exists, built before
the hand-test reports, two phases with a stop, 25 credits recorded for phase 2 only, landing /
pricing / legal untouched), [[0090-text-block-format-clip-once-with-its-own-sound]] (the format
and the planning defaults: cap 400, since v2 asked of the model with 450 as the hard cap, clip 3–60 s, the look's numbers),
[[0091-text-block-texts-ten-skeletons-truth-rules-free-edit]] (the ten skeletons, what the
generator may write, the free edit) and
[[0092-service-b-revamp-tests-overlay-and-resync-routes-are-dead]] (Appendix C: the seven
Service B tests and his rulings; what happens to Service B itself was OPEN, ruled 2026-10-20 by
[[0120-service-b-look-propped-phone-and-opt-in-demo-cutaways]]).

- **What exists (MEASURED in the tree):** `text_block_clips` (0052) and the `c` / `text_block`
  enum values (0051); `prompts/text_block/v1.md` (frozen) and `v2.md` with the ten skeletons and the founder's
  examples verbatim; `generateTextBlocks` (one text per fitting skeleton, in the clip's speaker
  gender, burn check + one re-request, skipped skeletons returned unstored, DRY_RUN = the ten
  examples); `createTextBlockRender` (admin-owned businesses only, the burn check, the
  content-policy gate wired, `service: "c"`, the text pinned on params); the `render_video`
  handler's `c` branch and a release line that puts C beside A, never in `qc_pending`; the
  `ServiceC` composition (the clip once, **unmuted**, Heebo 600, `fitParagraphFontSize`,
  54 → 40 px at line height 1.2, a 3 px edge, `DEFAULT_TEXT_BLOCK_RECT` 180,400,720,1040 — tuned
  2026-10-07 against his screenshots, 0090 amended); admin `/text-blocks`
  (register with gender / area / colour, the preview in the burned look, card actions) and
  `/text-blocks/new` (business → clip → generate → edit → render → download, self-refreshing while
  a render runs) behind six `requireAdmin` routes; `normalize_text_block_clip` (shares the hook
  bank's check; audio kept); the web library label `c: "גוש טקסט"`. Service A and B behaviour
  unchanged; shared code that moved under them: the one `loadFont` call now fetches a second
  Heebo weight on every render (a failed fetch is the same transient retry as before),
  `normalizeHookClip`'s body is now `normalizeStoredClip`, `assertContentPolicy` is exported,
  the admin hook editor takes optional children and exports `readVideoMetadata`.
- **Tests added (MEASURED, all green on the branch):** core 5 files (validator, prompt pins,
  generation, render end to end under DRY_RUN with `auto_release_b` forced false, migrations
  0051/0052); remotion 3 (the unmuted mount and the ink, the paragraph fitter, the encode
  arguments); admin 2 (lib bounds and schemas; every new route 403s with no session and with a
  customer session, the core functions never called); web 1 (both `/api/hooks` forms and the A
  persona catalog never return a text block clip). `apps/admin/vitest.config.ts` was added for
  the `@/` alias, and `apps/admin/next.config.ts` gained the `prompts/**` tracing include the
  generate route needs on Vercel.
- **FOUNDER-REPORTED context from the planning chat, none repo-verified:** the launch clip is
  10 s, made by hand on Seedance 2.5 (Atlas, reference-to-video, generated audio, no voice): a
  woman in a blue hoodie struggles to cut a watermelon with a blunt knife; not posted yet. The 12
  reference posts come from a third-party collection; their view counts are that site's.
  Marketing so far: about 8 videos per account, 100–200 views on average; the first 7 advertised
  Service B with no engagement; video 8, a Service A demo, got 3 saves and 2 likes from strangers
  and no signups. ICP, his guess: solo founders who built software and want to market it on a
  small budget. Service B today "comes out ok but not amazing"; he can tell it is AI by the
  repeated motion and is embarrassed to use it for Tavnit. Replicate flagged his persona image as
  sensitive on Seedance; Atlas accepted it.
- **Phase 1b, 2026-10-07 (his rulings of 2026-10-07/08; 0089–0091 amended):**
  - **The copy.** `text_block` v1 was edited in place. His examples are the exemplars, with
    `shoutout_hack` replaced by his new text. The rules were reworded until all ten obey them, with
    "never an ad" as the governing test. The cap is 400, his ruling. The long dashes are refused in
    generated text only; an edit may carry them.
  - **The fixture run.** It made real calls for Tavnit, a Haifa plumber and an Excel course, at
    the female speaker his clip has, plus the course once with a male clip: 40 texts, no skeleton
    skipped, no retry, 64 agorot. Every text is in `packages/core/.work/text-block/fixture-texts.md`
    (gitignored). Read by eye, not fixed: 3 texts address the viewer in the singular, 1 uses a
    feminine plural for the audience, closing lines are copied whole from the examples (all four
    `founder_ask` end `נו, כן או לא?`), and 2 small invented general figures.
  - **His clip and twelve screenshots** sit in `.work/text-block/`, gitignored. The clip was
    normalised the bank's way (24 → 30 fps, sound kept within 0.2 dB) and rendered with the
    shortest and the longest Tavnit text: `.work/text-block/renders/tavnit-shortest.mp4`,
    `tavnit-longest.mp4`. The crops and side-by-sides are in `.work/text-block/crops/`. The look
    was retuned to weight 600, a 3 px edge, line height 1.2 and a narrower centred default area.
  - **The push.** 0051 + 0052 were pushed on his conditional approval after all four conditions
    were checked (push log; verify §RESULTS 2026-10-07).
- **FOUNDER-REPORTED, 2026-10-07, not repo-verified:**
  - Tavnit's questionnaire was fixed to describe video ads, and its batch was regenerated. He
    reviewed all ten texts; the v2 rulings below came from that review.
  - His first Service C post, the same day, reached about 200 views within a few hours. His
    posts usually take a day to get there. Its average watch time was 6 s on the 10 s clip. This
    is one post.
- **`text_block` v2, 2026-10-07 (his rulings from that review; 0090 and 0091 amended):**
  - **The prompt.** `prompts/text_block/v2.md` is a new file; v1 stays byte for byte, pinned by its
    SHA-256. v2 carries a closing reaction line on `reframe`, `shoutout_hack`, `envy_portrait`
    and `cautionary_confession`, and `instead`'s order (opener alone, good outcome then bad, a
    human reaction, the aside only after it). It adds the familiar tool in `reframe`,
    `envy_portrait`'s payoff, a third person's gender read from the audience, and a signature
    phrase per skeleton with nothing else lifted. Five examples changed and two second examples
    were added, all on his approval. The Truth block changed on one point: a type's exaggerated
    win.
  - **The cap.** The render refuses past 450; the prompt still asks for 400 at most. A
    450-character text in three paragraphs fits the default area at 44–48 px
    ([[text-block-450-chars-fit-the-default-area]]).
  - **Where it runs.** Generation, the edit check and render creation all run in `apps/admin`
    on Vercel, so v2 and the 450 cap take effect with the admin deploy that follows the merge. The
    box does not read either.
  - **The v2 fixture run**, on his ₪3 OK: the same four batches as v1, 40 texts, 94 agorot over
    five calls (one retry). The texts are in `packages/core/.work/text-block/fixture-texts-v2.md`
    and the findings in `fixture-findings-v2.md`, both gitignored.
    - **What improved over v1.** There is no singular address and no feminine plural, and every
      `instead` follows his order. `זה לא נשמע מרגש, אבל זה ההבדל בין` and the small hours are
      gone.
    - **What still breaks** (0091, amended):
      - every `founder_ask` still ends `נו, כן או לא?`, and every `instead` aside is the
        example's;
      - three `cautionary_confession` texts close on the example's `אל תשאלו`;
      - five texts invent a figure;
      - both course batches wrote `discovery` with no `wow`, as v1's run did.
- **Waiting on the founder, in order:**
  1. Read the v2 texts and the findings.
  2. ~~Merge `feat/text-block-v2`~~ MERGED as PR #81 (`691c9bf`).
  3. Rule on what a `text_block` v3 should do about the lifted lines, the invented figures and
     `discovery` without a `wow`. On 5.5 (2026-10-08) the course at female still wrote a
     `discovery` with no wow, and the course at male stored the word `skipped` as its `discovery`
     text, which the batch check passes ([[sonnet-5-5-paid-check-2026-10-08]]). The thinking test
     put a placeholder (`skip`, `skipped`, `discovery`) in `texts` in 7 of 8 course batches; he
     left it for v3 (2026-10-08, [[text-block-thinking-low-test-2026-10-08]]).
  4. Rule on the one planning default 0090 still names: clips 3–60 s.
- **Phase 2 is NOT started.** What it needs is in 0089 §3.

**Every step is a 2 s clip placed from the footage instants: BUILT 2026-10-02 on
`feat/steps-fixed-2s-clips`, PUSHED 2026-10-02 AS PR #79, MERGED (`2a503a4` on `origin/main`,
MEASURED by `git log`, 2026-10-07). The paid check of `plan_demo_steps@v16` ran the same day
on the founder's OK: 10 of 10 plans ready, nothing repaired, ₪4.89
([[v16-paid-check-2026-10-02]]).**

- **What the founder decided (2026-10-02):** D1–D8 of that day's task prompt and four rulings in
  the session. D1–D3 are [[0076-every-step-is-a-fixed-2s-window-inside-its-screen]] restated;
  the rest are [[0084-clips-are-placed-from-the-footage-instants]],
  [[0085-a-draft-may-show-two-pages-and-says-so]],
  [[0086-captions-are-3-4-words-and-a-long-one-is-kept]],
  [[0087-two-steps-never-share-footage]] and [[0088-stored-plans-are-untouched-until-edited]].
  0002, 0070, 0072, 0074, 0077, 0079, 0081 and 0083 carry dated pointers.
  - **FOUNDER-REPORTED:** he accepted D5 (a generated draft may include a step with a flash of
    the next screen) on 2026-10-02, and amended it the same day to "the customer **can** watch
    each step", with the amber line on risky steps.
  - **Deferred by him to a separate task:** showing failed-read moments in the inventory, and
    the quarter gate.
- **What changed in the product** (once deployed): every step is exactly 2 s (60 frames); a plan
  is 5–10 steps; every inventory moment plays its own 2 s clip, which may start up to 1.8 s
  before the moment; a generated plan is asked to prefer calm clips; two steps can never share
  footage; a step whose clip probably shows two pages carries an amber line; the editor's preview
  stops on the clip's last frame. The band, the 4 s cap and the 1.6 s gap are gone.
- **MEASURED on the five takes, free** ([[clip-placement-replay-2026-10-02]]): every moment has a
  2 s clip that holds it; 102 of 536 pickable moments are calm and no calm clip crosses a real
  change, by the key or by frames; 35 of the 434 others hold a keyed change (37 by frames); every
  analysis, T4 included, offers 9 to 27 clips usable together; the two-pages line is on 70 clips
  and on 31 of those 35.
- **MEASURED on production, read-only:** the first footage row exists and its 61 instants match
  this machine's within one frame ([[box-and-local-instants-agree-2026-10-02]]). 19 ready plans
  (11 approved, 8 drafts, all on the founder's accounts) keep their old lengths until edited.
- **No migration.** A step's clip start is one new optional field in the plan row's `steps`
  jsonb.
- **The gate:** all seven green on the uncommitted tree, 2026-10-02: lint and typecheck clean; remotion 84, core 928, worker 7, web 569, admin 42 tests (1,630). Re-run in full on `2fc4fe7` before the push, on the founder's instruction: the same counts, all green. The commits after `2fc4fe7` change only this file, one defect note and the repo map.
- **An independent review of the diff ran before the commit.** Fixed from it: a moment from
  before the way-in step can no longer open a generated plan; a two-step plan with a long caption,
  on a recording that offers no more, is stored instead of failed
  ([[0086-captions-are-3-4-words-and-a-long-one-is-kept]] — settled in the build, not his
  ruling); the inventory request now fails, with its retry, when the instants cannot be read,
  rather than previewing clips the save would not store; an inventory tile is judged on the clips
  a save keeps. Recorded and not fixed, both older than this build:
  [[the-canned-dry-run-caption-can-fail-its-own-validation]],
  [[a-failed-preview-play-can-stop-another-clip]].
- **MEASURED, paid, 2026-10-02** ([[v16-paid-check-2026-10-02]]): one live run on each of the
  five fixtures and five real takes. All ten ended ready on the first or second call; no repair,
  no shared footage in a stored plan, no caption over 4 words. On the five takes 7 of the model's
  24 picks were calm and 3 crossed a real change, each carrying the amber line. The fixtures' live
  pins were re-taken from it.
- **Not measured:** run-to-run spread under v16 (one run each); the backfill on the box; the plan
  job end to end on the box; the wizard walked end to end by a person.
- **Deploy order when he says go:** merge (Vercel redeploys the web); straight after, the box
  `git pull` and restart together; then the backfill on the box, report first
  (`docs/07-worker-box.md` §15). He declined a split PR: "I will not approve or render between
  the merge and the box restart." Until the restart the old worker renders a new step from its
  moment, not its clip's start, and generates old-length plans.
- **Still true after it:** [[the-recording-end-is-the-raw-uploads-length]]; the 8 old drafts and a
  copy of an old approved plan can be approved untouched and render at their old lengths; a
  recording of 8–10 s cannot offer five steps; the detector has been run on five phone-filmed
  takes of two web apps.
- **Kept off the repo:** the replay, the test-data export and the paid-check script are in
  `packages/core/.work/screens/` (gitignored).

**A new analysis keeps every moment, its span and the footage's instants: BUILT 2026-10-02
(PR #78), MIGRATION 0050 PUSHED AND READ BACK THE SAME DAY, THE BOX ON IT (founder-reported; the
first row read back the same day).** Its instants are now read to place clips (the block above);
the moments' spans are read by nothing.

- **What the founder decided (2026-10-02):** D1–D6 of that day's task prompt, four rulings, and
  then "build the model-free half, no model for now":
  [[0077-moments-keep-their-real-start-and-end]],
  [[0078-screen-changes-come-from-the-footage-first]], [[0079-when-unsure-it-is-a-change]],
  [[0080-a-moment-is-never-dropped-for-a-failed-read]],
  [[0081-existing-demos-keep-working-no-paid-re-analysis]],
  [[0082-the-label-call-is-a-paid-call-tested-first]] and
  [[0083-no-model-names-the-instants-for-now]]. 0070 carries a dated pointer.
- **What a new analysis now writes** (once the box has the code): one
  server-only `demo_analysis_footage` row with `fps`, `file_sha`, `moments` (every kept moment
  with `startMs`, `endMs` and `read`, failed reads included) and `instants` (every instant the
  picture changes, from the footage alone). `demo_analyses.timeline` is unchanged.
- **An instant is not a screen change.** The detector has its own instant within 0.4 s of 56 of
  57 real changes and repeats exactly, and fires 6–7 times for every real one
  ([[footage-screen-changes-2026-10-02]]). The vision call tested to name them did not pass and
  is not adopted ([[label-call-test-2026-10-02]], ₪14.20 of the ₪30 cap spent, the rest unspent
  on his instruction). Its code was removed from the tree; it is in commit `5b49335`.
- **MEASURED for his next ruling:** under the rule he proposed — a generated plan may only use a
  moment with 2 s free of instants — 170 of the 536 moments a plan may pick qualify, 67 of 127
  real-screen instances hold one, 13 of the 15 analyses have enough for a plan, and on the newest
  take three of his nine segments hold none ([[instant-free-windows-2026-10-02]]). A window that
  ends exactly at an instant can show up to 4 frames of the next screen; a 0.2 s margin removed
  that on these recordings and leaves 106 moments and 11 of 15 analyses.
- **Deploy, in the order he gave (2026-10-02):** the branch pushed and PR #78 opened; 0050 pushed
  by the session on his instruction and read back (8 columns, RLS on, no policy, 0 rows, ledger
  51 rows 0000–0050); PR #78 merged on his instruction. **Owed: he pulls and restarts the box.**
  Until then analyses run the old code and write no footage row.
- **Kept off the repo:** scripts, frames, labels and the spend ledger are in
  `packages/core/.work/screens/` (gitignored). The frames show private browser tabs.

**Every step becomes a fixed 2 s window inside its screen: DECIDED 2026-10-01, BUILT 2026-10-02
— see the first block above; "inside its screen" was replaced by placement from the instants**
([[0075-more-moments-over-fewer]], [[0076-every-step-is-a-fixed-2s-window-inside-its-screen]]).
The bullets below are the state on 2026-10-01, kept for the measurement they point at.

- **What the founder decided:**
  - more moments over fewer;
  - every step a fixed 2 s;
  - 5–10 steps, with the 15–21 s band retired;
  - every inventory moment plays a 2 s window inside its screen, slid earlier near the screen's
    end, with extra windows only where a long screen has too few moments.
- **The code keeps running 0070 and 0072** until a later task builds this. 0002, 0070 and 0072
  carry dated pointers.
- **Open, his call:** screens shorter than 2 s, caption length at 2 s, and what counts as "its
  screen".
- **The measurement taken for those**, on branch `docs/screen-span-measurement` (docs only, no
  product code, production read-only, no paid call):
  - [[screen-spans-from-the-footage-2026-10-01]]
  - [[the-84s-recording-against-the-founder-timeline-2026-10-01]]
  - [[demo-recordings-by-file-and-take-2026-10-01]]
  - [[repeat-analyses-of-one-file-2026-10-01]]
  - [[founder-timeline-of-the-84s-recording]]

  The headlines:
  - **MEASURED:** the 15 ready analyses are 7 raw files; REASONED from frame similarity, 5 takes.
  - **Analysis screens (MEASURED + REASONED):** 168, of which 45 are really under 2 s; 28 of those
    45 are pieces of a longer real screen (REASONED). 46 pool moments have no clean 2 s window
    inside their analysis screen. None lacks one inside a founder segment or a wizard page.
  - **Real screens (REASONED):** 64, of which 11 are under 2 s, 7 of those blank or loading pages.
  - **Windows by eye (REASONED):** no judged (slid) window inside an analysis screen crossed a
    real screen change. 10 unslid ones do, where the analysis missed the change. Wizard-page
    windows crossed in 23 of 44 (one analysis judged per file).
  - **Missed changes (MEASURED + REASONED):** `isNewScreen` misses 9 real changes across 8 of the
    15 analyses. Under the shipped 0072 rule, 18 pool moments there get a clip that runs into the
    next screen ([[a-missed-screen-change-lets-a-step-run-into-the-next-screen]], NOT fixed).
  - **The founder's timeline (REASONED):** his eight boundaries are all 0.5–2.3 s early, and his
    1:00 is an in-place swap, not a navigation.
  - **The spans are not stored anywhere (MEASURED).** REASONED: cluster spans should be free by
    re-running the clustering on the box and checking each job's `resumeKey`.

- **Kept off the repo:** footage, frames, strips and the per-moment table stay in
  `packages/core/.work/screen-span/` (gitignored). The frames show private browser tabs.

**Steps end on a real screen change** — branch `feat/steps-end-on-screen-change`, **MERGED** as PR
#74 (`a212491` on `origin/main`, MEASURED by `git log`, 2026-10-01); deployed and the box pulled and
restarted (founder-reported, 2026-10-01) ([[0070-a-step-ends-on-a-real-screen-change]],
[[0071-the-3s-step-floor-was-an-undecided-default]], [[0072-step-cap-no-padding-cut-early]]).

- **The first two live v15 plans both failed** (MEASURED, read-only, 2026-10-01), on the founder's
  own 84 s walkthrough of tavnit.ai. That raw file was uploaded five times that day. `207c6421`'s
  analysis was rejected; `dfa291b6`, `28161296`, `24e348bf` and `6a997717` are ready, with
  identical state timestamps (MEASURED by storage eTag,
  [[demo-recordings-by-file-and-take-2026-10-01]]). The failures are on `28161296` and `24e348bf`.
  - **`bd0913b4`** (demo `28161296`, analysis `4219e82e`, 65 states), created 12:41:56 UTC: `failed`
    / `validator` after all 3 calls (`usage_events`: 31 + 32 + 32 = 95 agorot). Round 1 picked
    state 9 on a 1.2 s clip; round 2 kept it; round 3 swapped it for a 4.0 s state and landed at
    21.6 s, 0.6 s over.
  - **`fix/steps-plan-ladder` is MERGED** as PR #75 (`a21da11` on `origin/main`, MEASURED by
    `git log`): the read-time message offers "drop this step" when no 3-word caption fits, and the
    band messages give each step's run. **FOUNDER-REPORTED:** the box showed `a21da11` by
    `git log -1` and was restarted before the second failure.
  - **`ce687d4a`** (demo `24e348bf`, analysis `6658999c`), created 15:17:58 UTC: `failed` /
    `validator` again, on the new wording. The model moved one caption from state 12 to state 11
    and back, both 200 ms clips, and never dropped it
    ([[pr-75-retry-advice-gets-the-model-to-drop-the-step]]).
  - **FOUNDER-REPORTED:** Vercel logged a 404 on `GET /api/demos/[id]/plan` at 12:39:13 and at
    15:16:30 UTC. Each precedes its plan row (12:41:56 and 15:17:58, MEASURED). MEASURED in the
    code: that route answers 404 while the demo has no plan row. REASONED from the two: these are
    the wizard polling before the plan was requested, not a fault. The route's other 404, a demo
    that is missing or not the caller's, is not ruled out by anything measured here.
- **The answer: `fix/steps-plan-repair`, MERGED** as PR #76 (`826399e` on `origin/main`, MEASURED
  by `git log`, 2026-10-01; [[0074-unpickable-moments-and-the-last-round-repair]]).
  **FOUNDER-REPORTED:** he tested it.
  - **MEASURED, the box runs it.** The first plan after the merge, `d3864d05` (demo `6a997717`,
    the fifth upload of the 84 s recording), was created 19:23:58 UTC. Its job `439f7ebc` was
    claimed by `hetzner:light`. Its row reads `ready`, `plan_demo_steps@v15+pickable+access-pin`.
    The first call had one read-time violation and the second was clean, so it was not repaired.
    It holds 5 steps, 17.6 s, not approved.
  - **FOUNDER-REPORTED:** a moment he added by hand from the inventory ran 0.4 s.
  - **MEASURED:** no stored plan row holds a step under 1 s. Replaying every possible hand-add on
    `d3864d05` through the shipped `assembleSteps`, exactly one moment runs 0.4 s: state 39,
    cut by the next step 0.4 s later. 16 others would run 0.2 s
    ([[the-84s-recording-against-the-founder-timeline-2026-10-01]]).
  - The model is sent only states whose own clip can carry a caption (1.6 s), plus the pin. A pick
    of a hidden state is stripped.
  - When the third call still violates, code drops the steps whose caption cannot be read, trims
    a total over 21 s by the shortest step that is enough, and stores the plan as a ready draft:
    not held to the 15 s floor or the 5-step minimum, never under 3 steps.
  - Every model plan's `prompt_version` now carries `+pickable`; a repaired one adds `+repaired`.
  - MEASURED with a mocked model on the two real timelines: `bd0913b4`'s last round is stored at
    19.6 s, 5 steps; a `6658999c` last round carrying state 12 is stored without it.
    **What the model does with the smaller timeline is barely measured:** one live plan has run
    since, `d3864d05` (below), with one violation on its first call and a clean second call.
  - Code only, no prompt change, no migration. **The box is the only axis:** `git pull` and a
    worker restart.
  - MEASURED: 51 of the 151 screens in the 14 ready analyses offer the model no moment, 24 of
    them on screen for 1.6 s or longer ([[screens-with-no-pickable-moment-2026-10-01]]). The cut
    rule is untouched; that count is evidence for a later call.
  - MEASURED in the tree: a customer cannot regenerate from a ready draft. The wizard has no such
    control; `aiugc demo plan` does it from the CLI.
  - **Found while exporting test data:** the analyses of this recording carry other browser tabs'
    titles and address-bar history rows in `visibleText` (the tab strip and the omnibox were in
    frame). Those rows are in production as analysed and went to the plan model with the rest of
    the timeline. Nothing of them is in the repo: the two test-data files hold placeholder tokens
    in place of every word. A regex scan for emails and phone numbers finds none of it.

- **The rule.** A step's clip runs from the picked state to its screen's end (2 of 3 analysis
  signals, cut one sample after the last state on the screen), at most 4 s, never past the next
  selected step or the recording's end. There is no floor; CLAUDE.md #1 is amended.
- **The evidence.** MEASURED: 24 of 95 stored plan steps ran past a screen change, and 12 released
  renders carry a jump ([[stored-plans-under-the-screen-rule-2026-10-01]],
  [[screen-change-signal-2026-10-01]]).
- **To take effect** it needed the merge, Vercel, and a box pull + worker restart **together**: prompt
  `plan_demo_steps@v15` reads `clipMs`, which only the new code sends. Done (see above).
- **Waiting on the founder:**
  - a paid `aiugc plan regress` to see v15's live behaviour. The live data points so far are the
    two failures above and one clean `+pickable` plan, `d3864d05`. Every fixture's live pin now includes states the model is no longer shown
    ([[timeline-fixtures]]), so that run reads as drift to review, not as green or red;
  - any backfill of the 17 stored plans. They keep their old durations until edited.
- **For the founder to watch:** the local A/B renders of plan ca8d5b72 are in
  `packages/core/.work/steps-screen/renders/` (gitignored, his machine only).

**The demo-analysis refilm gate counts `unreadable` only since 2026-10-01** — branch
`fix/legibility-gate-unreadable-only`. MEASURED 2026-10-01: its commit 0778c5a is an ancestor of
`origin/main` 67448de (PR #72, merged). **The box runs it** (MEASURED 2026-10-01, see the paragraph
below).
**The hook line's colour is set per clip by the founder since 2026-10-01** — branch
`feat/hook-text-color`, **migration 0049 APPLIED to production 2026-10-01, branch PUSHED, NOT
merged, NOT on the box** — the push and the apply each on the founder's explicit go for that one
operation ("apply 0049, then publish the branch … I'll do the merge"); he does the merge
([[0073-hook-text-colour-is-set-per-clip-by-the-founder]]). MEASURED after the push, read-only:
`text_color` text NOT NULL default `'white'`, `hook_clips_text_color_check` present, all 30 clips
`white`, ledger 50 rows 0000–0049. Every bank clip carries
`hook_clips.text_color`, `white` (the default for every existing clip, the CLI and an admin
register without a choice) or `black`. The founder sets it on admin `/hooks`, per card or in the
upload form, and "שכפול לדמות" copies it. A Service A steps render reads it off the clip row and
burns the hook line black on a light outline (`TEXT_OUTLINE`'s layers in `255,255,255`). Labels,
B's hook text, captions, the watermark and the retired paths are unchanged. The two previews follow
it: the admin safe-area editor and the wizard's hook studio. **Deploy order, no step skipped:**
(1) ~~`db push` 0049 BEFORE MERGE~~ DONE 2026-10-01 — every build of this branch names
`text_color` in its hook-clip selects, so it had to exist before any of them deployed; main never
names it. (2) Merge (the founder), so Vercel deploys web + admin. (3) Box pull + restart (0039,
`docs/07-worker-box.md` §11) — until then a black clip still burns white. (4) Only then set any
clip black. MEASURED (local
render, real bank clip `1b4a1a71`, 95-frame hook): two runs of the unchanged pipeline decode
identically on frames 0–87, then drift run to run from frame 88 (still inside the hook) with min
PSNR 41 dB. The white render on the new code decodes identically to the second of those runs on
all 197 frames (`framemd5`). The frame grabs are under `packages/core/.work/hook-text-color/`
(gitignored). ~~**Merge-order note:** …~~ Moot: both branches are merged (PR #73 `ab51a1b`, then
PR #74 `a212491`, MEASURED by `git log`, 2026-10-01).

**The demo-analysis refilm gate counts `unreadable` only since 2026-10-01** — branch
`fix/legibility-gate-unreadable-only`, **MERGED** as PR #72 (`67448de` on `origin/main`, MEASURED by
`git log`, 2026-10-01). Box state not re-verified here
([[0069-the-refilm-gate-counts-unreadable-only]]). `low` stops counting. The 0.75 cap on low +
unreadable is deleted, and the unreadable threshold stays at 0.25. MEASURED: neither key has a live
`app_config` row today, so no migration. **FOUNDER-REPORTED:** `analyze_demo` job `174c1063-bd8c-42a9-b858-122ae1109ab3`
(demo `207c6421…`, analysis `e4be3bce…`) ran 2026-10-01 00:59–01:00 UTC on `hetzner:heavy`,
`succeeded`, and its analysis was rejected with the refilm message. He judged the recording readable
throughout, and reported 10 `high` / 10 `low` / 0 `unreadable` in the first 20 states, every `high`
being the Chrome address bar. **MEASURED (read-only, same day):** all 65 states are 10 `high` / 55
`low` / 0 `unreadable`, so 0.846 tripped the 0.75 cap. The first 20 are 9 / 11, not 10 / 10. All 55
`low` frames carry transcribed Hebrew. The address-bar claim is not verified. **The fix does
nothing until it is merged AND the box is pulled and restarted** (0039, `docs/07-worker-box.md`
§11). The founder re-uploads only after that; `e4be3bce` itself stays rejected, neither re-run nor
re-gated. **MEASURED 2026-10-01, the box runs the fix:**

- the same raw file was re-uploaded as `dfa291b6`;
- its analysis `4113d37d`, job `c2273990` on `hetzner:heavy`, came back `ready` at 02:51 UTC;
- it is 9 `high` / 56 `low` / 0 `unreadable`, 0.862 `low`, which the old 0.75 cap would have
  rejected;
- three more re-uploads are ready too ([[demo-recordings-by-file-and-take-2026-10-01]]);
- `67448de` is an ancestor of the `+pickable` code the box ran at 19:23 UTC.

**Billing shipped 2026-09-17 and is all merged.** `origin/main` carries the engine (`54c6231`), the
customer-facing half (`7ccb708`) and the legal/public pass (`d215eae`); migrations 0044–0047 applied.
Read the notes, not a summary: 0052–0058 in `decisions/`. `UPDATED` in `(legal)/legal.tsx` is
`11.10.2026` on `origin/main` (`14.10.2026` on `feat/intro-offer`, for the intro offer's §8 bullet)
and is load-bearing — both /terms' date and the string checkout writes into
`terms_acceptances.terms_version`. **The first sale has happened** — one row now carries
`17.09.2026` ([[first-real-purchase-2026-09-21]]), so changing `UPDATED` from here on changes what
later buyers accept, not what nobody accepted.

**The Sumit adapter and hosted checkout are MERGED and LIVE since 2026-09-21** — PR #52,
`4100cc7`, and the box reports the same commit. [[0062-hosted-checkout-via-sumit-payment-pages]] is
the decision; migration 0048 (`checkout_intents`) is applied (ledger 0000–0048, **49 rows,
measured**). It was walked through first against the founder's TEST business — page → Sumit →
return → active subscription, one renewal charged through `SumitGateway` with a real חשבון/קבלה,
the walkthrough rows deleted afterwards — and then **used for real**: one ₪150 התחלה purchase on the
REAL org, which activated only after the return leg was repaired
([[first-real-purchase-2026-09-21]]). Facts: [[sumit-real-org-configuration]],
[[env-values-differ-between-the-box-and-vercel]], [[sumit-payment-page-saves-the-card]],
[[sumit-payments-list-honours-utc-offsets]], [[sumit-test-org-configuration]].

**The go-live cost three env mistakes and one customer-visible failure.** The third told a paying
customer "התשלום לא הושלם. אפשר לנסות שוב." while Sumit held his ₪150
([[sumit-return-failure-invited-a-second-payment]]). The fix **`fix/sumit-return-unconfirmed`
(`7ec6005`) merged 2026-09-22 as PR #53 (`0cca4fa`)**. MEASURED 2026-10-01: it is an ancestor of
`origin/main` `d57b60a`. Serving on Vercel production is **FOUNDER-REPORTED** (2026-10-01) and
cannot be checked from the repo. A failure to verify now lands on `?checkout=unconfirmed` ("being
confirmed, do not pay again") and is recorded in `gateway_events`. The customer who pays and never
returns is still uncovered (queue item 14).

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

**What exists is in `docs/repo-map.md`, generated since 2026-09-30**
([[0067-what-exists-is-a-generated-repo-map]]; `tooling/repo-map`, merged as PR #71, `d57b60a`). `pnpm
repo-map` derives it from the code. Every task reruns it after its last commit and commits it alone
as `chore: repo-map` (CLAUDE.md §3). At its first run, six independent section checks and a
docs-wide cross-check found nothing in the code that the map misses. What docs/ describes that does
NOT exist (found, none fixed):

- **Stale, written as live.** `phases/8e-render-step.md:90` says
  `POST /api/businesses/[businessId]/a-sets/preview` and `POST …/a-sets` are "still deployed". Both
  were deleted in `497fc24` (2026-09-01). `decisions/0027-…:55` names `aiugc script b`, which never
  existed; the command is `copy b-script`.
- **Written as gone, and gone.** The tables `persona_clips` (dropped in 0005) and `demo_segments`
  (dropped in 0023); the 2026-07-16 onboarding spec's `/dashboard` and `/api/auth/*`; the probe
  routes `/zz-probe`, `/zz-preview-error` and `/api/probe`; and `pending_changes`, the table 0053
  rejected.
- **Env names the map cannot show.** Neither `.env.example` declares `SUMIT_COMPANY_ID`,
  `SUMIT_API_KEY` or `SUMIT_CHECKOUT_PAGES` (read at `packages/core/src/config.ts:16-19`), nor
  `LOG_LEVEL` (`packages/core/src/logger.ts:6`).

## Security audit — paused for launch

**Done: phases 0–4.** Fixes merged: AUTHZ-12 (PR #59, commit `21b7557`); INP-01 (commit `511fefc`);
Next.js 15.5.20 → 15.5.26 (commit `bfa65ae`); INP-08 (`65114f8`, merged 2026-09-25 as PR #63,
`93ba67e`, MEASURED 2026-10-01 as an ancestor of `origin/main` `d57b60a`). The INP-08 fix puts
`-protocol_whitelist` on every ffmpeg/ffprobe input and a container allow-list on the demo ingest
path. **It is worker code, and no box read since 2026-09-21 (`4100cc7`, which predates it) says the
box runs it.** Founder-reported: Resend is on a paid plan — **corrected by him 2026-10-12: the
free plan** (100 a day, 3,000 a month; [[0107-social-posting-pr3-tick-landing-line-failure-email]]); an
Anthropic hard monthly spend limit is set. Measured 2026-09-24: box firewall and key-only SSH.

**Deferred, each with its trigger — no file paths, line numbers, parameters or mechanics here; audit
detail lives only in `.work/security/` (gitignored, the founder's main checkout).**

- AUTH-01 admin two-factor — trigger: first weeks after launch.
- AUTH-03 CAPTCHA on signup / sign-in / recover — trigger: before any paid ads or signup campaign.
- AUTH-06 plus the two Supabase auth settings — trigger: a 10-minute founder test, first weeks.
- INP-09/INP-10 plus box-check.md — server hardening (non-sudo service user, systemd limits, the
  GitHub credential on the box) — trigger: first month.
- INP-07, AUTHZ-06/07, phase 5 — upload/abuse limits — trigger: first sign of abuse or queue
  backlog, or before scaling.
- INP-02/03/14 — content-filter hardening — trigger: first month.
- AUTH-02/04/05, CSRF, the grants migration (SB-5/SB-6), SB-4 bucket limit, PostgREST-off, the
  English Reset Password email — trigger: a later fix batch.
- AUTHZ-13 — billing edge case — trigger: phase 5.
- Phase 6 (secrets, headers, dependency cleanup incl. the 11 remaining highs, vitest 2 → 3, drizzle
  0.36 → 0.45) plus the register consolidation — trigger: first month.
- Every remaining LOW in the 01–04 registers — trigger: with phase 6.

**Standing rules until the audit resumes:**

- drizzle-orm below 0.45.2: never pass a request-, customer- or model-derived value to
  `sql.identifier`, `sql.raw`, `.as` or alias (CLEARED 2026-09-25: every current call is a literal).
- Never run `vitest --ui` or Browser Mode on a Windows machine (vitest below 3.2.6).
- INP-02 must make a failed parse record usage (state-of-play item 11) BEFORE it makes the
  classifier fail closed; otherwise it reopens INP-01.
- Audit details live only in `.work/security/` (gitignored, the founder's main checkout).

MEASURED (the INP-08 session, 2026-09-25, packages/core + apps/worker, this machine's ffmpeg 8.1.2-full_build-www.gyan.dev,
Windows): INP-08's fix and its four new tests. Founder-reported: the Resend plan and the Anthropic
spend limit, both above. REASONED: INP-08's behaviour on the box's Linux ffmpeg — not yet smoke-tested
there (see the vault defect note). MEASURED 2026-09-24, carried from the prior session: the box
firewall and key-only SSH ([[worker-box-network-perimeter-2026-09-24]]).

## What this session was (2026-09-18) — DIAGNOSIS, no fixes

Nothing was fixed. Everything was measured against production (Supabase SQL, the Vercel access log,
`journalctl` on the box) or read in the tree at `f84e931`. **External state changed: nothing.** No
deploys, no dashboard changes, no provider changes, no migrations.

Three notes created, two updated:

- **[[analysis-parse-failure-discards-the-whole-attempt]]** (new, defect) — one frame's bad
  `actionType` enum discarded a whole `analyze_demo` attempt, three times: 8m19s of latency for ~85s
  of work. Full measured timeline, both halves of the defect, the fix list, two observability holes.
  **MERGED as PR #51 (`27ee842`)** — queue item 1 has the state; the note's head has the FIXED block.
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
  Two briefs in a row described merged branches as unmerged (queue item 8), and one handed over a
  superseded `emailRedirectTo` cite as the _correct_ one sixteen hours after it moved to
  `auth.ts:132`.
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
- **Two promoted out of this file, pointers only here:** a credential echoed in session output —
  flagged twice, both 2026-08-26, both rotated; no third flagged incident is recorded, though
  unflagged echoes predate the "three times" this line said ([[credential-echo-incidents]]) — verify by connecting, report the outcome, never the value
  (CLAUDE.md), and
  "`npx -y supabase` because no CLI is installed" was false all along (`.claude/rules/migrations.md`
  and [[production-migration-push-log]] since 2026-09-29).
- **"Authorized origin" in Google Console was the wrong field** — _Authorized **domains**_, at publish.
- **"Billing unwired, so account caps are the only bound" was backwards** — the credit balance is the
  bound, and _tighter_ because billing is unwired ([[no-self-serve-credit-grant-path]]).
- **`/start` proves nothing about auth** — redirects unconditionally, discards
  `exchangeCodeForSession`. `/home` is the only real gate.
- `words_per_second` is **2.1** (calibration), not the seed's 2.2 (a guess).
- **Two branches were described here as unmerged for days after they merged** — `fix/analysis-frame-salvage`
  (PR #51) and `landing/two-services` (PR #49), both corrected 2026-09-21 from
  `git merge-base --is-ancestor`. That is now four times this file has said "NOT merged" about merged
  code. **Check a branch's state with git before writing it down, every time.**
- **Two lines of this file disagreed on the migration ledger** (0000–0047/48 rows vs 0000–0048/49).
  The database settled it: 49 rows, last `0048`. A count that appears twice will drift; keep one.

**From 2026-09-24, external:**

- **This file's own "key-only SSH from one desktop" line was unqualified.** `sshd -T` before that
  date read `passwordauthentication yes`, so password login for `aiugc` was open to the internet the
  whole time; 0 logged failed attempts in 30 days is luck observed after the fact, not evidence the
  setting was closed. [[worker-box-network-perimeter-2026-09-24]].

**From 2026-10-01, assistant-side:**

- **This file said "NOT merged" about merged code a fifth and a sixth time.** The founder reported
  on 2026-10-01 that every fix branch is merged, `fix/sumit-return-unconfirmed` included, and git
  confirms it. `fix/sumit-return-unconfirmed` merged 2026-09-22 (PR #53) and was called unmerged here for nine
  days after that, while it was also the gate on announcing prices. `fix/inp-08-ffmpeg-inputs`
  merged 2026-09-25 (PR #63) and was called "pending merge" here for five days. Both were caught
  by `git merge-base --is-ancestor` against `origin/main` `d57b60a`. The same pass checked all 43
  remote branches besides `main`: every one is an ancestor of `origin/main`, none unmerged.

## What landed (2026-10-24, later) — the Instagram autopilot, `feat/instagram-autopilot`

[[0127-the-instagram-autopilot]] has the decisions; docs/09 §The autopilot has the mechanics. In short:

- **Storage:** 0070, three server-only tables. The slot table's unique indexes are the rules: one
  row per account, day and slot; no clip twice a day on one account; no render, post or hook line on
  two slots.
- **The night:** `autopilot_tick`, a singleton every 60 s.
  - It plans each account's day after 03:00 Israel, for an account on before that 03:00.
  - One 1×1 render at a time, each scheduled when released.
  - A slot is skipped 2 h after its time, and a pause is written once.
  - The night marker is written every night once planning finishes. The worker checks it in to
    Sentry (`autopilot-night`).
  - It never throws: every setup, account and slot has its own try.
- **Shared code it touches,** with manual posting unchanged and pinned by the existing suites:
  - `publish_post`'s optional `nextSound` hook;
  - the failure email's `not exists` for autopilot posts;
  - the calendar's `autopilot` field;
  - `emailsSentToday` counting `autopilot_email`;
  - SoundPicker's optional `pickOnly`, its default markup pinned byte-identical.
- **MEASURED by test:**
  - the night across 2026-10-25 in his shape, 15 posts, each with its own render, the account's
    own characters, a sound, no caption, no label, at his Israel times;
  - a crash at three points resumes with one render and one post per slot;
  - each pause cause emails once, and a skipped slot emails nothing;
  - rotation is fair across three days, and no hook line repeats by id or text;
  - Israel time is pinned across both clock changes.
- **Found while building, fixed:** a third attempt needs a fresh hook line, and the pool held only
  the night's need. It now tops up within the night's valve.
- **The diff review (four lenses, a skeptic per finding; 33 of 38 confirmed, all fixed before the
  PR).** The majors:
  - a resume after a refused-file or lapsed-connection pause was undone a minute later by the same
    failed post, with a second email. Failures now count only on slots made since the account was
    last switched on;
  - the page's resume threw away its unsaved edits;
  - the videos-a-day select showed a clamped count and saved the old one.

  Among the minors:
  - a late plan no longer books passed times;
  - a pause's cancel is retried every tick;
  - the planning transaction re-checks the account;
  - the save merges sounds under the row lock;
  - the pause email's key covers every folded account;
  - a sound swap checkpoints first and keeps its count through a recreate;
  - the calendar's mark is behind the access check;
  - a character with no clips cannot be switched on;
  - the night renders only for an admin-owned business.

- **The second review (of those fixes; 9 of 13 confirmed, all fixed before the PR).** The majors:
  - a hand switch-off whose cancel hit a dropped connection answered success, and the post still went
    out. Every tick now re-cancels a paused or switched-off account's waiting posts, and the save
    answers an error;
  - a resume kept a retired character the page no longer shows, so the account was paused again every
    night. The resume now drops it and refuses what the night would pause again at once.

  Among the minors:
  - the page's resume saves the page first;
  - a save's answer outranks a business pick still loading.

  Every claimed fix now has a test that fails without it (13 core mutants and 1 web mutant, all
  caught). The page-only fixes were checked in a fetch-mock harness, each against its undone fix.

- **The third review (of that commit; 3 of 5 confirmed, all fixed before the PR):**
  - a save switching off several accounts now cancels all of them before answering one failure;
  - a resume re-reads its row under a lock, so a save from another tab that lands meanwhile wins;
  - a card the night paused no longer blocks saving the others (its resume does the checks).

  Three more mutants, all caught.

- **A last pass (2 of 3 confirmed, both two-tab windows of a fraction of a second, closed):** the
  save decides which cards it run-checks from the rows it holds locked; the resume re-checks
  everything it checked under the same two locks, in the save's order (the setup row, then the
  account row). Two more mutants, both caught. The save's half has no test: it needs two
  connections, and the tests run on one.

- **Owed when it opens to customers:** `/privacy` §5 names the emails a customer gets; the
  autopilot's two are admin-only today, so it is unchanged (`legal-pages.test.ts` says so).
- **Not done:** no signed-in walk; the setup and the calendar were seen in a harness
  (`packages/core/.work/shots-0127/`, gitignored). No live Meta post by the autopilot yet.

## What landed (2026-10-24) — demo names, `feat/demo-names`

[[0125-demos-get-an-optional-name-never-read-by-a-model]] records his four calls and the two that
came with his approval of the plan (403 for another account's demo; B saves at ready). In short:

- `demos.name` (0069): nullable text, capped at 40 characters in code. `PATCH /api/demos/[id]`
  takes `name` and `description`, each optional. A rename leaves `updated_at`, the raw file's
  retention clock, alone.
- The field is the first one on the A and B upload, ingest and ready cards. The name shows in
  every picker row, the duplicate card, `/home/demos` (with rename and clear) and the plan
  editor's header. An unnamed demo looks as before.
- MEASURED by test: the plan prompt, the stored plan, the VO prompt and its params are identical
  with and without a name, and a label word found only in the name stays flagged off-screen. Both
  cases fail when the name is leaked into the plan's description input (checked, reverted).
- MEASURED in the harness: a `<bdi>` flipped a name that starts in Latin, so the name sits on its
  own RTL line, the same base as the field. A Latin-only name is set LTR on the two truncating
  lines, so the ellipsis takes its end.
- The diff review confirmed four defects in the first build, all fixed before the commit. B lost a
  name typed before the customer left the step, and could save a stale value; its save now lives
  in `BWizard`. The library save rewrote the field. A Latin-only name truncated at its beginning.
- Found while building, left alone: the comments at `0013_demo_description_hook_personas.sql:3-4`,
  `schema.ts` (`demos.description`) and `pipelines/demos.ts` (`setDemoDescription`) still call the
  description "soft grounding for the VO script", the retired path; it feeds the step plan.
  `setDemoDescription` bumps `updated_at`, and A's continue always sends the note, so reusing a
  demo in A restarts its raw file's 30-day clock. Vault 0061's line cites for the description are
  stale. The ledger proof's header had missed 0066–0068; corrected with the 0069 row.
- **Not done:** no signed-in walk. The wizards' save call sites (A's continue, `BWizard`'s
  effect) are read in the code only; the repo has no component tests.

## What landed (2026-10-22, later) — "גרסה נוספת" at the finished video, `feat/next-version-action`, MERGED as PR #115 (`fc9c1d4`, MEASURED by `git log` 2026-10-23; this heading said "NOT MERGED")

[[0124-the-next-version-is-taught-at-the-finished-video]] records his eight calls and how each is
built. In short:

- `GET /api/renders/[id]` sends `nextVersion` for released A (steps) and C renders only. Every
  `RenderPlayer` mount passes it on: the home strip's and the library's modals, and the A and C
  finish steps. B's finish step does not.
- **The recording IS carried, with no A wizard change**: the button goes to
  `/home/a/new?demo=<id>`, and the wizard's own `?demo=` restore lands on the character step when
  no step is given. MEASURED in headless Chrome against the real `AWizard` (harness, fetch mock):
  a soft navigation from another page and the full load the finish step uses both landed on step
  1 with the recording in the strip.
- C's entry is the only wizard change: `?persona=&clip=` read by the page, resolved by the wizard
  from the catalog and that character's gallery, onto the text step; the address goes back to bare.
- The number is `quoteStepsASet` → `quoteTotal(…, 1)`, sent only when it is a discount
  (chargeable, analysis already paid). The test moves `a_steps_credits` and the number follows.
- MEASURED 2026-10-22, read-only: `credit_costs` is 25 / 20 / 25 (steps / analysis / C), so the
  first-render breakdown reads `45 קרדיטים: 25 לסרטון + 20 על ניתוח ההקלטה. כל מודעה נוספת מאותה
הקלטה תעלה 25.` and the new line says 25. Neither posting switch row exists (admins only), so
  a customer sees הורדה | גרסה נוספת.
- **FOUNDER-REPORTED (2026-10-22), not repo-verified:** the Instagram account he markets Tavnit
  with gets few views and barely any customer conversions, which is why it is not used as an
  in-app example and `instagramUrl` stays null. The "a few videos are enough" misconception is what
  he hears from people, not something measured in the product.
- **Not done:** no signed-in walk. The account he owns as a customer has no finished A video, and
  making one spends credits on the live box. The screenshots came from a throwaway harness,
  deleted before the commit.

## What landed (2026-10-22) — new A and B example clips on the landing and the home cards, `feat/new-example-videos`, MERGED as PR #114 on his instruction ("go ahead and merge")

[[0123-new-a-and-b-example-clips-a-ships-unblurred]] records his calls. Every copy of the A
example is now his new recording (`Desktop\demos\newnewserviceA.mp4`) and the ad made from it
(`madefromserviceaDemo.mp4`): the landing's `demoBefore` and `demoAfter`, the home card's
`hook-demo`, and the demo step's pair, uploaded under new keys `samples/a-steps/recording-v3.mp4`
and `ad-v3.mp4` (no overwrite, no delete; read back byte-identical) that the two constants in
`apps/web/src/lib/service-a.ts` now name. B's `presenterSample` and home card come from
`Desktop\AIassets\bServiceExample.mp4`. All of it ships unblurred, on his instruction ("thats on
purpose, dont blur anything"). His first A clip, `AIassets\serviceAExample.mp4`, was replaced the
same session before the merge, when he asked for the before/after to match. Merged at his
instruction ("merge when you're done"), after an earlier "wait for my permission before you merge".

- **Checked:** every burned line inside the home card's crop; the dev server serves all ten files
  byte-identical; headless Chrome plays all five landing slots and both home-card clips, and plays
  the uploaded recording; both new storage objects serve `200 video/mp4` through a signed URL with
  the uploaded bytes. The demo step itself was not opened signed in (its code is unchanged).

## What landed (2026-10-21) — Service B cutaways revised: clips before the effect, first cut at the product mention, free edits, `feat/b-cutaway-relayout`, MERGED as PR #113

[[0122-service-b-clips-before-the-effect-first-cut-at-the-product-mention]] amends 0121; his
rulings, the planning defaults and my flagged interpretations are recorded there.

**FOUNDER-REPORTED (2026-10-21):** the cutaways branch is merged; the step works and he likes it; on
his test the draft put a clip at ~4 s during the intro, before the product came up. MEASURED since
(read-only): that render is `cbd62014`, its first clip at VO 2.8 s, the name spoken at VO 11.4 s.

**Box status (MEASURED 2026-10-21, read-only):** the newest `render_video` job (`c3c24b41`, render
`cbd62014`, 02:22 UTC) was run by `hetzner:heavy`; ffmpeg's scene detector over its output finds
hard cuts at 8.30, 11.63 and 16.07 s — 3 of its 4 slot edges at VO + 250 (the first falls inside the
focus effect's blur). A box without 0121 ignores `params.cutaways`, so the box was on main at or
after `c5c85e6`. Nothing is owed on the box for 0121, and **this branch changes no worker code**.

**Built.**

- **Core.** `cutaway-structure.ts`:
  - `productMention`: `product_name`, else the business name, else 40% — no model call;
  - `hookLeaveVoMs`;
  - the mention floor and the 8-clip bound in `cutawayLayout` (`firstCutMinMs` and
    `cutawayLayoutError` deleted);
  - `fitCutawayAt`, `cutawayEditError`, `cutawayWindowStarts`/`snapCutawayStart` (moved from the
    web) and `clearHookText`;
  - a client-safe subpath.
- **Plan row** (`pipelines/cutaways.ts`):
  - slot `id`s in the jsonb;
  - the key's hook text is the script's own;
  - edited rows never redrafted;
  - 0121 rows found under any line, their picks carried;
  - version-guarded writes;
  - PATCH takes the whole list;
  - enqueue moves what the final hook text reaches and copies nothing with no clip left.
  - No migration.
- **Web.** The new order, the letter-and-colour clips, big cards, the phrase list, the notes, the
  409 recovery, the drag fix, and the effect step's collision line.

**Checks.**

- The full gate (see the report).
- An adversarial review: confirmed findings fixed in `0116a16`.
- **The draft on his 17 real audios** ([[cutaway-mention-positions-2026-10-21]]):
  - 14 lay out, all strict; no cut before the mention; heads after it ≤ 5.0 s; ending on the
    character.
  - The mention is matched by name on 9 (40–57% on the 7 v17 scripts).
  - 8 fall back to 40%; on 6 of those the name is spoken in Hebrew letters 1.9–9.8 s later.
  - 3 have no room: the 6.3 s audio and two scripts that name it at 77–78%.
- **The local render** ([[cutaway-local-render-check-2026-10-21]]) on `ab7e3837` + `3915c8e2`:
  - the first cut on the name's phrase (7.23 s);
  - cuts on chunk boundaries;
  - audio sample-identical to the head-only render;
  - no sway.
- **The walk.** His own Pixel 6a (Chrome 155) with real touches over adb, and a desktop Chrome 155
  window, both on local `pnpm dev` (DRY_RUN web, production DB) through a minted session.
  - All of 0122's done-criteria seen on both.
  - The real-phone pass found a crash the tests and an emulator could not
    ([[scrollintoview-returns-a-promise-in-chrome-155]], fixed in `d71027f`).
  - A tap that fired before the demo list loaded opened the phone's photo picker. It was closed
    with nothing selected (no demo row created, read back), and the tap tool now refuses the upload
    control.
  - Screenshots: `packages/core/.work/cutaways/walk-shots-0122/` (gitignored).
  - **No render was created.**
  - Rows the walk left in production: 3 scripts, 3 audio renders (their `synth_tts` ran on the box),
    3 `cutaway_plans` rows. Ordinary wizard leftovers, not deleted.

**Spend.** 15 agorot of ElevenLabs (three TTS of the canned script on the box, 443 characters); ₪0
else. The local render, the draft and the edits: ₪0.

**Found and not fixed (reported):**

- `productMention` does not catch a Latin `product_name` spoken in Hebrew letters (6 of his older
  audios); a transliteration tier would be a new rule — his call.
- Matching does not pass the name through the pronunciation map (empty in production when last
  measured, 2026-09-08): latent.
- The audio card's continue button reads "המשך ליצירת הסרטון" even when the clips or the effect
  come next (pre-existing).
- Rolling the web back after customers add clips would break those plans: the old schema requires
  `draftDemoStartMs` on every slot.

## What landed (2026-10-20, last) — Service B demo cutaways and no sway, `feat/b-demo-cutaways`

[[0121-service-b-demo-cutaways-and-no-sway]] builds 0120 §2 and §4; the task prompt and his
amendments are recorded there.

**Built.**

- **Core.** `cutaway-structure.ts` holds the "alternate" structure as data. The draft, the edit and
  the enqueue copy are in `pipelines/cutaways.ts`. Migration 0068 adds `cutaway_plans`.
  `createBRender` takes `cutawayPlanId` and resolves it before any paid call. `buildServiceBProps`
  downloads the demo and clamps against the probed video stream.
- **Remotion.** A cutaway layer outside the static overscan, on `voBoundaryFrame`. `handheld`,
  `SWAY`, `cameraSeed` and the dead `brollPaths`/`brollSrcs` are removed.
- **Web.**
  - The opt-in checkbox on B's ready-audio card, and the "demo" step after the effect step.
  - The demo picker is A's `StepDemo` in a narrow "b" variant.
  - The slot strip, and the window picker (touch drag, ‹ › nudges, the slider keys).
  - POST and PATCH `/api/businesses/[businessId]/cutaway-plans`, and `cutawayPlanId` on the render
    body.
  - The wizard is keyed by business.
- **0066/0067.** This branch carries the two own-voice migration files production already had, so
  main can push migrations again (his option (a′)).

**Checks.**

- The full gate (see the report).
- An adversarial review of the diff: 10 confirmed findings (7 distinct), all fixed in `6a7eff4`; 5
  refuted.
- The local render of his stored take `ab7e3837` with his demo `3915c8e2`
  ([[cutaway-local-render-check-2026-10-20]]):
  - first cut at 4.33 s, after the hook text (2.21 s);
  - cutaways 5.37 s and 4.10 s, heads 1.53 s and 1.20 s, ending on the head;
  - cuts exactly on caption-chunk boundaries;
  - audio sample-identical to the head-only render (the demo muted);
  - every head frame identical to the head-only render;
  - no sway (best shift (0,0); the control finds a planted 8×6 px move).
- The matcher test ([[cutaway-matcher-hit-rate-2026-10-20]]): 63.3% against demo order 43.3%, 79.5%
  agreement, under the bar fixed before the run. **The draft ships as demo order.**
- The real walk, on local `pnpm dev` (DRY_RUN web, production DB), signed in to his account through a
  minted session, in headless Chrome at 1280×900, 375×812 with touch, and 717×621. Screenshots are in
  `packages/core/.work/cutaways/walk-shots/` (gitignored).
  - The option shows off, then ticked; the rail grows from 6 steps to 7.
  - Effect "none"; his newest demo `84889b25` picked.
  - One slot drafted (VO 3.52–9.04 s): demo order gave state 23 at 21.4 s.
  - In the phone picker, a touch drag (21.4 → 32.6 s), a nudge (→ 34.2 s) and the save moved it to
    state 34.
  - The render step read "…עם קטע אחד מסרטון המוצר…". It stopped there: **no render was created**.
  - Rows the walk left in production: 1 script, 1 audio render (its `synth_tts` ran on the box), 1
    `cutaway_plans` row. Ordinary wizard leftovers, not deleted (no SQL writes without his
    instruction).

**Spend.** Matcher test 256 agorot. The walk's one TTS on the box: a few agorot (~250 characters of
the canned DRY_RUN script). Local renders, HeyGen and the draft: ₪0. **Total ≈ ₪2.6 of the ₪25.**

**FOUNDER-REPORTED, not repo-verified (2026-10-20):**

- `app_config.lipsync_expressiveness` reads `low` in production: his read against the vault's
  `medium`. MEASURED since: `"low"` ([[app-config-live-state]]).
- He ran the B flow on the box with the new propped-phone image registered as a persona's live
  selfie, and v4: "much better, still a bit uncanny; a seasoned eye can tell after about five
  seconds".
- The HeyGen motion prompt was changed again on 2026-10-20 and is now good. MEASURED since: the row
  changed between two reads that day ([[app-config-live-state]]).
- Expressiveness `low` is confirmed.
- Own voice is parked (`feat/b-own-voice`, done and unmerged; he changed his mind about the addition).

**Found and not fixed (reported):**

- 3 of his 15 distinct real audios lay out only with a cut on a word start inside a caption line.
  CLAUDE.md's wording says "caption-line boundaries". The alternative is no cutaways for those
  audios: his call (Open decisions).
- `ALIGN_MAX_PX`'s comment in `pipelines/renders.ts` still reasons about the sway. The retired
  opener path only, left as it is.
- docs/04's lines on the hook handoff "not yet in `serviceBTimeline`" are stale; it has been there
  since 0024.
- The defect note for 0066/0067 lives on `feat/b-own-voice` only. Its fix (the files on main) lands
  with this branch.
- `observedWordsPerSecond` still groups the two voiceless own-voice `audio_renders` rows under a null
  voice. The own-voice branch's filter is not here.

## What landed (2026-10-20, later) — TTS on Eleven v4, plain text, `feat/tts-eleven-v4`, MERGED as PR #111 (`cc46f64`, MEASURED by `git log` 2026-10-20; this heading said the merge was his)

**Decided (FOUNDER-REPORTED, planning chat 2026-10-20):**

- [[0119-tts-is-eleven-v4-plain-text]]:
  - `eleven_v4`, not Turbo (his ear, on elevenlabs.io);
  - plain text, with no audio tags and no enhancement call;
  - stability 1.0 and similarity 1.0;
  - voice ids stay his in admin.
- [[0120-service-b-look-propped-phone-and-opt-in-demo-cutaways]], **DECIDED** (the sway and the
  cutaways BUILT later the same day, [[0121-service-b-demo-cutaways-and-no-sway]]; the look and the
  numbered settings not built):
  - the single talking head stays, on a propped-phone workspace image per character;
  - the handheld sway goes off for every B render;
  - "selfie" is retired for numbered settings;
  - opt-in demo cutaways (never the default);
  - not doing: Hyperframes, generated B-roll, short non-software uploads.

  0092's "Open, not ruled" is ruled (dated pointer there).

**What changed in code (`packages/core` only):**

- `ELEVENLABS_MODEL = "eleven_v4"` and
  `ELEVENLABS_VOICE_SETTINGS = {stability: 1, similarity_boost: 1}` sit beside the call;
  `synthesize` lost its `stability` argument.
- `handleSynthTts` reads neither `tts_enhance` nor `tts_stability`. It removes any `[...]` span after
  the pronunciation map, so `rendered_text` is exactly what was sent. A script left empty by that
  fails its preview with a plain `PermanentError`.
- **`duration_ms` is clamped to the audio file** (his ruling, same day, 0119 §5): the shorter of
  the alignment end and `measureDurationMs`. DRY_RUN keeps the alignment end.
- Removed: `enhanceWithAudioTags`, `sameWordSequence`, the DRY_RUN `[excited]` prefix and
  `captions.ts`' `stripTagWords`. Two stale `copy.ts` comments were fixed.
- `tts-enhance.test.ts` became `tts-plain-text.test.ts`, with 11 tests:
  - the exact request body;
  - the alignment in ms;
  - no tag reaches the provider, from a script or from a map entry;
  - DRY_RUN sends plain text byte for byte;
  - a tag-only script fails plainly;
  - a leftover `tts_enhance = true` adds nothing;
  - the clamp, on a real one-second mp3, both ways.
- **Checked (MEASURED, 2026-10-20):**
  - **The gate:** all green on the tree before the review's fixes — lint and typecheck clean,
    2,279 tests (remotion 97, core 1,237, worker 7, web 867, admin 71). Re-run after the review's
    fixes, before the clamp: all green again, 2,280 (core 1,238). Re-run with the clamp: all
    green, 2,282 (core 1,240).
  - **An adversarial review of the diff** (four lenses, a skeptic per finding): 13 findings, 8
    survived and 5 were refuted. Fixed from it:
    - the tag-only script;
    - 0119's caption sentence, overstated: a tag glued to a word or to punctuation now captions
      differently;
    - the defect note's credit rule, which missed whole-number subtotals;
    - the HeyGen-row wording;
    - an over-claimed "no silence" pointer;
    - an untested claim tagged MEASURED;
    - **the owed order:** the 80 ms ruling now comes before the merge. He made it the same day,
      and the clamp is built.
  - **The clamp diff was reviewed separately** (two lenses, a skeptic per finding): no code
    defect. Five record fixes were applied:
    - the three readers of the last-word ordering;
    - 0119 §5's claim about the quote;
    - two stale lines on what `duration_ms` stores;
    - this gate line.
- No migration, no `app_config` write, no credit or price change, no web, admin, remotion or worker
  code, no prompt file.

**MEASURED, paid, 2026-10-20** ([[eleven-v4-paid-check-2026-10-20]]):

- TTS `with-timestamps` accepts `eleven_v4`: 200, with the alignment. The chunker is unchanged:
  11 × 3, and 16 × 3 + 2.
- **The preview:** `audio_renders` `997a5ec7` on Tavnit (script `af00027b`, voice שירה), run through
  `handleSynthTts`. It is `ready`, not approved, and **his to listen to**.
- 2.10 words/s pooled, against the live 2.1.
- v4 is 1.2–2.2 LU quieter than v3 on the same script and voice: −21.65 and −23.05 LUFS, where own
  voice targets −20.
- v4's alignment runs **80 ms past the file** on both calls
  ([[eleven-v4-alignment-ends-80ms-past-its-audio]]). REASONED: left alone, it could add one credit
  to about two B quotes in five. **FIXED on his ruling**: the clamp stores 18,240 and 21,040, the
  decoded lengths (free replay). The preview row `997a5ec7`, written before the fix, keeps 21,120.
  Its quote is the same 106 credits.
- Price: $0.08 per 1k for v4 and v3 alike on the live page, and `character-cost` 17 = 17 on one line.
- Spend: 541 characters, ≈ 16 agorot of the ₪10 cap.

**FOUNDER-REPORTED, not repo-verified (2026-10-20):**

- v4 was tested on elevenlabs.io by ear, with the settings above and no enhancement.
- `app_config.lipsync_resolution` reads 1080p in production (his read).
- `app_config.lipsync_motion_prompt` was changed in production; the value is not recorded yet.
  [[app-config-live-state]] still shows the 2026-09-07 value.
- HeyGen's "more expressive" switch was off in his UI tests.
- What he judged was HeyGen's own output, not a Tavnit render.
- The example videos `a` and `b` are stale against the new look and the UI change; they are his to
  redo.

**Going live:** listen to the preview, merge, then the box pull and restart ("Owed founder
actions"). The 80 ms ruling is made and built.
`synth_tts` runs only on the box, so until the restart previews still speak v3 (plain, since
`tts_enhance` is `false`).

**Found and not fixed (reported):**

- The root `README.md` still says "ElevenLabs V3". It is outside this task's scope and already stale
  on openers and QC.
- `prompts/vo_script/v9.md` line 340 says emotion is "added automatically at a later stage". That is
  the retired format, and prompt files are out of scope.
- `prompts/tts_enhance/v1–v4` and `hook-templates.test.ts`' render test for them are dead.
- `TTS_COST_AGOROT_PER_1K_CHARS` prices $0.10 where the live rate is $0.08 (his call).
- The ElevenLabs key cannot read the account's character counter (401).
- docs/04 says previews are capped per business per day; the code caps them per owner account. This
  was already so before this task.
- **`feat/b-own-voice` edits the same `tts.ts` and `elevenlabs.ts`.** Expect conflicts at the
  `synthesize(...)` call, the `../captions` import and the provider's header, whichever merges second.

## What landed (2026-10-20) — the `hook_text` extractor gets one corrective call, `fix/hook-text-corrective-retry`, MERGED as PR #110 (`033a420`, MEASURED by `git log` 2026-10-20; this heading said "not merged")

**The failure (FOUNDER-REPORTED, from the Vercel log):** Service B's script step failed twice in a
row with `hook_text is 44 characters — the cap is 40`, then 41 — `assertHookText` thrown from
`deriveHookTextWithVersion`, i.e. the generation path's extractor fallback
([[0030-hook-text-falls-back-to-the-extractor-never-trims]]) had ALSO missed the 40-character cap.
**MEASURED (read-only, `packages/core/.work/hook-text-char-cap-forensics.ts`, gitignored,
2026-10-20):** four generations in a row with no script row on the founder's business between
01:56 and 02:00 UTC — each a ~7.1k-token `b_script` call followed by a ~1k `hook_text` call — and,
on a customer's business, three ~1k-token calls with no row the same night (00:04, 00:22, 01:19
UTC), each seconds after a successful one: the edit save (`POST /api/scripts/[id]/text`), the path
0030 said had nothing left to fall back to. Over 60 days, 86 `b_script` rows: on v17 (n=20) the
hook text is p50 29 / p90 39 / max 39 characters, none re-derived — but the rows are survivors, so
the misses are invisible there.

**What exists (on the branch):** `deriveHookTextWithVersion` makes exactly ONE corrective call when
the extractor's line misses a cap — the same rendered prompt with the rejected line and the exact
`hookTextError` problem appended in code (`correctivePrompt`'s shape; `callClaude` gained
`{maxTokens?, appendix?}` in place of its positional `maxTokens`), asking for a shorter verbatim
prefix. A second miss throws as before; nothing is trimmed anywhere; the worst case is three paid
calls per generation (b_script, extractor, corrective) and two per edit save. One place covers the
generation fallback, the edit save and `aiugc script edit`. Tests: four cases in
`packages/core/test/hook-text.test.ts` (19 pass). Docs: `docs/04-integrations.md`. Vault 0030's "a
second failure throws, as before" and its "Not fixed here" section describe the pre-fix code and are
NOT amended — an amendment is his to ask for.

**Checked (MEASURED, 2026-10-20):** the test gate all green on the final head — 2,286 tests (core
1244, web 867, remotion 97, admin 71, worker 7), lint and typecheck clean; an adversarial review of
the diff (four lenses, three refuters per finding) confirmed no defect; five of its refuted items
were taken anyway as hardenings (the appendix asks for as many words as the overshoot needs, not
"at least one"; `assertBudget` again before the corrective call; the rejected line quoted with
`JSON.stringify`; the two route comments' call counts; three test pins). **Not run:** nothing live —
no paid call was made; the first real corrective call will show in the Vercel log as
`hook_text rejected — one corrective call`.

**The cap is not physical (MEASURED, code, 2026-10-20):** `HookLine` in
`packages/remotion/src/ServiceA.tsx` shrinks the line to fit the 1009×179 safe area (`fitFontSize`,
base 92 → floor 40; two lines fit at ≤74px), so a 44-character line would have rendered, smaller or
wrapped. 0030 calls 40 "the physical limit — what fits on one centred burned row"; the row is the
design intent, the renderer does not enforce it. Raising the cap is his decision, not taken here.

## What landed (2026-10-17) — social posting PR 4.1: the TikTok delivery email and the door, `feat/tiktok-delivery-email`, MERGED as PR #108 (`2817133`, MEASURED by `git log` 2026-10-20; this heading said "OPEN")

[[0116-tiktok-delivery-email-and-the-door]] (his five decisions, the planning defaults he approved);
the plan and prompt in `docs/claude/`; mechanics in docs/09 §The delivery email, §TikTok, checklist
t8. No migration, no env change.

**What exists (MEASURED, on the branch):**

- **The close-out of PR 4 first, as its own commit** — the live run of the night of 2026-10-16/17
  ([[tiktok-inbox-live-run-2026-10-17]]), the PR 4 TikTok strings FINAL (approved by his merge), and
  "a sandbox post cannot be public" moved to `falsified/`
  ([[the-sandbox-cannot-post-publicly-2026-10-16]]).
- **The trim.** Every string in `packages/core/src/config.ts` goes through one `envString`; a test
  walks the schema's keys so a new one cannot skip it.
- **The delivery email.** `pipelines/social-delivery-email.ts`, a worker sweep beside the failure
  email: one email per Tavnit account per sweep for TikTok videos still `delivered`, 2 minutes
  settled, never twice per post, the TikTok switch asked at send time, the failure email's 20-a-day
  ceiling counted over both kinds. The failure email's gate, day count and Resend error ladder are
  shared exports now (its 24 tests unchanged and green). Log kind `post_delivery_email`.
- **One inbox path in four places** (`TIKTOK_INBOX_PATH`, `social-copy.ts`): the TikTok card's lead,
  the schedule note, the post page's delivered line, the email. The TikTok-only time step says what
  the time is for.

**Checked (MEASURED, 2026-10-17):** the test gate all green on the head — 2,263 tests (core 1242, web 846, remotion 97, admin 71, worker 7), lint and typecheck clean; an adversarial review of the diff (four lenses, a skeptic per finding) — one real defect, reported twice (Resend's 409 on a reused key logged the whole grown batch as told), fixed and mutation-checked; screenshots from a throwaway harness page with made-up data, deleted after.

**Not run:** nothing live. The box does not run it until his pull and restart; no email has been sent.

**Named next steps, not built (his §2):** a reminder when a video is still unfinished after a day;
per-user email preferences; Instagram's deauthorize callback.

**The legal pass, same PR ([[0117-legal-pages-lifted-for-connected-accounts-address-emails]]):** `/privacy` gains §13 on connected Instagram and TikTok accounts and the matching sentences in §3–§9 and §12 (the failure and TikTok-delivery emails, Resend for all of them, the two OAuth cookies by name); `/terms` §4 gains a connected-accounts subsection; the operator address becomes the registration's P.O. box (one constant, four surfaces; supersedes [[0058-the-operator-address-is-a-tel-aviv-street-address]]); the date is 17.10.2026. Every claim was checked against the code (114 supported, 26 corrections applied), and `apps/web/test/legal-pages.test.ts` ties the names and numbers to the code. The gate is green on the final head — 2,284 tests (core 1242, web 867, remotion 97, admin 71, worker 7), lint and typecheck clean — and the claim map is [[privacy-connected-accounts-claims-and-their-code-2026-10-17]]. Merged on his instruction in chat, so he reads it after, not before. **Open, his:** whether the name line (מוחמד טאהא) must match the Meta record's order (טאהא מוחמד); the Meta Data Deletion Request URL entered in the Meta app; whether the terms subsection is a material change under terms §14; the acquirer and the P.O. box. His look at t7 (does «צפייה בפוסט» open the player).

## What landed (2026-10-16) — social posting PR 4: TikTok inbox posting, `feat/tiktok-inbox-posting`, MERGED as PR #107 (`f11ff04`, 2026-10-17); 0064/0065 PUSHED 2026-10-17; run live in the sandbox the same night

[[0115-tiktok-inbox-posting-pr4]] (his seven decisions, his five approval changes, the planning
defaults he approved); facts [[tiktok-api-attaches-no-sound-2026-10-16]] and
[[custom-domain-serves-storage-2026-10-16]]; dated pointers on 0101, 0102, 0107, 0108 and 0063. The
prompt and the approved plan are in the repo (`docs/claude/prompts/`, `docs/claude/plans/`, both
2026-10-16). Mechanics: docs/09 §TikTok, §Runbook: the TikTok app, §Live-test checklist PR 4.

**What exists (MEASURED, on the branch):** migrations **0064** (`scheduled_post_status` +
`delivered`, alone) and **0065** (`social_accounts.access_token_expires_at`,
`scheduled_posts.delivered_at`) — pinned in `migrations.test.ts`, **pushed 2026-10-17** before the
merge (the 0060 rule) on his instruction in session, read back before and after: `delivered` after
`publishing`, both columns `timestamp with time zone` nullable, row counts unchanged, ledger 66 /
0000 / 0065 ([[production-migration-push-log]]). `providers/tiktok.ts`
(Login Kit web, flat OAuth errors, the PULL inbox init, status, the webhook signature, a DRY_RUN
stub); the TikTok section of `pipelines/social.ts` (connect upsert, tokens refreshed under a row
lock, the inbox delivery through `auth.tavnit.ai`, the webhook's events, the daily half);
`app_config.tiktok_posting` beside `social_posting` (now Instagram's) with every read filtered by
platform; the failure email's cause per platform; the routes `/api/social/tiktok/{start,callback,webhook}`;
the TikTok card, the schedule flow without caption/sound/tick for TikTok, the tile's tags per platform
with each platform's official mark (`apps/web/public/brand/`, files unaltered), the calendar's
`delivered` chip. Env names `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` (both, on Vercel **and** the
box). Probe (read-only, 2026-10-16): a signed render URL through `auth.tavnit.ai` → 200 `video/mp4`,
no redirect.

**What the founder reported (FOUNDER-REPORTED, 2026-10-14…16):** the Meta business portfolio, the
Meta business verification filed, the TikTok developer app with its production draft and one
sandbox, the tavnit.ai domain verified at TikTok by DNS — all in "External state" below.

**Checked (MEASURED, 2026-10-16):** the test gate all green on `6c33a2f` — 2,234 tests (core 1216,
web 843, remotion 97, admin 71, worker 7), lint and typecheck clean; an adversarial review of the
diff (four lenses, a skeptic per lens) — 15 findings survived, all fixed in `6c33a2f`, none high;
screenshots from a throwaway harness page behind a fetch mock (no production row), deleted after;
`db push --dry-run` would push exactly 0064 and 0065 (ledger 0000–0063 applied).

**Run live (2026-10-17, FOUNDER-REPORTED t1–t6 passed; the rows MEASURED —
[[tiktok-inbox-live-run-2026-10-17]]):** the first post was refused by TikTok with
`url_ownership_unverified` (the sandbox keeps its own URL-properties list and needed its own domain
verification) and its failure email went; the next two reached the inbox — a **silent הוק + דמו was
accepted**, so approval §5's stop did not fire — and the גוש טקסט one was posted from TikTok's editor,
**public**, with a post id and the player link (so the repo's "a sandbox post cannot be public" was
wrong: [[the-sandbox-cannot-post-publicly-2026-10-16]], falsified; whether the link opens is his look,
t7). The rows show no Service B post and no `connection_expired` post or email, so t3 as worded and
the waiting-post half of t5 left no trace. One draft (the הוק + דמו, 23:25 UTC on the 16th) is still
unfinished in his TikTok — the case PR 4.1's delivery email is for. The sandbox pair is on Vercel
Production and on the box; the box runs the PR 4 build with the failure email on.

## What landed (2026-10-15, last) — `/home/plan`'s cards in one row of four, `feat/plan-row-of-four`

[[0114-plan-page-cards-in-one-row-of-four]]; dated pointer on 0113 §1. Merged at his instruction in
chat. With the intro card, `/home/plan`'s four cards are one row from `lg`, each drawn a size down
(padding, price, rate, estimate, buttons), and no longer two by two. Measured at 1024–1920 px: one
row, prices on one line, nothing overflowing. `/pricing`, and `/home/plan` without the card, are
unchanged.

## What landed (2026-10-15, later still) — the intro card on `/home/plan`, "בערך" estimates, each plan ₪1 less, `feat/plan-intro-card-prices`, MERGED as PR #105 (`41bdc37`); 0063 PUSHED

[[0113-the-intro-card-on-the-plan-page-estimates-and-prices-one-shekel-less]] records his five
requests and the push. Dated pointers on 0112 §4–§5, 0109, 0055, 0051 and 0068;
[[production-migration-push-log]] has the 0063 row. Merged at his instruction in chat.

- **Prices ₪149 / ₪299 / ₪499 (migration 0063, PUSHED 2026-10-15 on his answer in session,
  before the merge).** He had already set the Sumit pages to them. `plans.price_agorot` is what
  the checkout's amount check, renewals, the trial's continue and upgrades all read, so until 0063
  a ₪149 starter payment would have been refused as `amount_mismatch`. Nobody was hit: no plan
  purchase and no pending intent before the push (MEASURED). Read back 14900 / 29900 / 49900, with
  credits unchanged.
- **`/home/plan`:** the offer box is gone. The same intro card sits first in the plans row (two by
  two), for an account that may buy it.
- **Both pages:**
  - the card is the brand gradient (lime to emerald), with an ink `ללקוחות חדשים בלבד` pill on
    top and no line under the title;
  - every estimate says "בערך" and counts hook+demo at the render price (40 / 100 / 200);
  - the `/pricing` cache key is bumped, so the new prices show on deploy, not up to an hour later.

## What landed (2026-10-15, after the blur) — `/pricing`: three services, no footnote, the ₪5 card, `feat/pricing-intro-card`, MERGED as PR #104 (`bef4721`)

[[0112-pricing-names-three-services-and-shows-the-intro-card]] records his six decisions (the
countdown and the gradient set aside), the planning defaults (unstruck) and the claim's arithmetic.
Dated pointers on [[0055-plan-cards-may-show-computed-ad-counts]],
[[0099-service-c-phase-2-opens-to-customers]] §9, [[0089-service-c-text-block-exists-admin-only-phase-1]] §5
and [[0109-a-five-shekel-intro-offer]] (the "one line" default struck). Merged at his instruction
in chat, like the blur.

- **Every plan card** (`/pricing` and `/home/plan`): the estimate names all three services (the
  third count through `quoteServiceC`). The credit key under it and the VAT footnote are gone, the
  footnote from the checkout, continue and intro summaries too. Terms §8 is untouched.
- **The ₪5 offer is a lime card**, `חבילת התנסות`, first in the row. It shows to a stranger while
  the offer is live, and to a signed-in account only while it may buy. Its button goes to `/start`
  for a stranger and to `/home/plan/intro` for an account. The old line under the cards (no link,
  shown to every signed-in account too) is gone.
- **The offer is LIVE in production** (MEASURED today: the live page shows it), so the card shows
  on tavnit.ai as soon as this deploys.
- **Copy:** every new string is COPY PENDING FOUNDER REVIEW except his title.

## What landed (2026-10-15, later) — the A example footage's browser text blurred, `fix/blur-a-example-footage`, MERGED as PR #103 (`c08697f`)

[[0111-the-a-example-footage-has-its-browser-text-blurred]] records his four decisions, the
three planning defaults (unstruck) and his session OK on the regions. Dated pointers on
[[0100-home-cards-show-example-clips-landing-sells-three]] §3 and S2 (reversed) and on
[[8d-demo-step-rework]]'s sample-pair bullet. Merged at his instruction in chat ("for this one
time, when you're done with each branch, go ahead and merge").

- **Every copy showed the URL step's browser text** (tab title, bookmarks bar, the address bar's
  history list): the home card's `hook-demo.mp4`, the landing's `demo-before.mp4` (and its poster)
  and `demo-after.mp4`, and the wizard's storage pair. Each was re-encoded from its source, every
  one of which re-encodes byte-for-byte to the old copy; the text is blurred at the source's
  resolution, and the typed `tavnit.ai` and the burned step labels stay sharp.
- **Storage:** new keys, `samples/a-steps/recording-v2.mp4` and `ad-v2.mp4`, uploaded with his OK
  and read back byte-identical; the two constants in `apps/web/src/lib/service-a.ts` name them. The
  old objects stay (owed list).
- **Checked:** per-frame edge sharpness inside the blurred areas (24–76 → ≤ 4), probe parity,
  frames outside the windows mostly bit-identical and otherwise as faithful to the source as
  before, and playback in headless Chrome at localhost:3000.
- **Found, not fixed:** `packages/core/.work/upload-a-samples.ts` (gitignored, local) still writes
  the old keys with upsert; the blur scripts sit beside it in `packages/core/.work/blur-a/`.

## What landed (2026-10-15) — PostHog records every page, hides only the sensitive, `feat/posthog-record-every-page`, MERGED as PR #99 (`40a1e29`)

**FOUNDER-REPORTED:** merged at his instruction in chat ("merge everything", 2026-10-15), together
with PRs #100 and #101 below. No planning default was struck, so the three in 0110 §2 stand.

[[0110-posthog-records-every-page-hides-only-the-sensitive]] records his six decisions of
2026-10-15 and the three planning defaults (unstruck until PR review). Dated pointers on
[[0104-what-posthog-records-and-what-never-leaves]] §1 and §3 and on
[[posthog-hiding-check-2026-10-11]]. The measurement is [[posthog-hiding-check-2026-10-15]].

- **Every page records**, the landing and `/pricing` included; nothing stops the recorder between a
  public page and an app page. **A customer's sign-in leaves no gap:** the batches recorded between
  the cookie and the gate's answer are held and then sent, and the gate is asked at once. **An
  admin's sign-in still sends nothing** from the cookie on, and marks the device. The same holds
  when an admin's session is written over a live customer's, which the gate now catches by
  comparing the cookie's value. All MEASURED in tests (106 in `apps/web/test/analytics.test.ts`)
  and in the browser, on the final tree.
- **An adversarial review of the diff** (five lenses, each finding re-checked by a refuter)
  confirmed 21 findings and refuted 3; all were fixed or documented before the PR. The sharpest:
  - an email typed into an ordinary field leaked keystroke by keystroke until the address was
    complete; it is now hidden from its `@` on, and `/privacy` says what came before is recorded;
  - the gate noticed a session cookie appearing or vanishing but not changing hands;
  - `:is()` in the block selector would have voided it on older browsers;
  - the `/home` expired-account notice and the post page's link named the Instagram account.
- **Hidden:** passwords, codes and tokens; password, email and phone fields; email addresses
  anywhere; the account email; a connected Instagram account's name, username and picture; the
  contact and feedback forms whole; the deletion code; media that would not play in a replay.
  **Shown:** everything else, business content included.
- **Media:** every signed link apps/web mints lives 3600 s (`SIGNED_URL_TTL_SECONDS`), so every
  customer video and image stays a blank box. Only Tavnit's own public media shows: the persona
  images and the site's examples. No lifetime was changed. Lengthening alone would not make customer
  media play, because the token rides in the query, which the hidden list strips (0110 §3).
- **The notice** is in every public page's footer, and every instance is now 11 px at 45% ink
  (3.0:1), from 12 px at 50%.
- **Legal:** `/privacy` §3's recording sentences and §6's last sentence rewritten. `UPDATED` moved
  14.10.2026 → 15.10.2026: both pages show it, new `terms_acceptances` rows record it, nothing
  compares or forces re-acceptance, and no email is sent. Legal-review P13 and P14, the owed list,
  and reg-2 worksheet rows 136 and 137 each gained a dated line.
- **Found, not fixed (not this task's):**
  - `docs/03-storage.md` says the `{download}` option has one caller (it has three), and its fal.ai
    line is half stale.
  - `GET /api/renders/[id]` signs a `thumbUrl` nothing reads.
  - The stale picsum sentence and the two unreadable lines it also listed were fixed the same day,
    by PRs #101 and #100.

## What landed (2026-10-14) — the ₪5 intro offer, `feat/intro-offer`, MERGED as PR #97 (`d41eae6`); 0061/0062 PUSHED

[[0109-a-five-shekel-intro-offer]]; dated pointers on 0068, 0051 and 0062; the two new paths added
to [[no-self-serve-credit-grant-path]]; `docs/05-billing.md` (a new section, the unconfirmed query,
the env paragraph, "No free tier"), `docs/01-schema.md`, `docs/02-jobs.md`, `docs/10-analytics.md`;
terms §8's bullet, `UPDATED` 14.10.2026, `docs/legal-review.md` E12.

**What exists (MEASURED, on the branch):**

- **Migrations (not pushed):** 0061 (`ledger_reason` + `grant_trial`, `expire_trial`, alone) and 0062
  (`checkout_intents.kind` + nullable `plan_code` with the pairing CHECK; `intro_trials`, user id as
  the key; `app_config.intro_offer = {"enabled": false}`). Both must be pushed **before** the merge:
  `schema.ts` names `checkout_intents.kind` in every bare select.
- **Core:** `pipelines/intro.ts` (the offer constant, the switch, eligibility, activation, the
  day-30 sweep `expire_trials`, `continueFromTrial`, `settleContinueAttempts` behind the delayed
  `reconcile_continue` job); `checkout.ts` (`createIntroIntent`, `verifyHostedPayment`, the kind
  branch, a hosted plan purchase converts an open trial, `createCheckoutIntent` refuses while a
  continue is pending); `credits.ts` (the trial's ledger writers). One lock order: intent → users →
  intro_trials → subscriptions.
- **Web:** `POST /api/account/intro`, `POST /api/account/intro/continue`, `/home/plan/intro`,
  `/home/plan/continue`, the plan page's offer box, trial line, continue cards and pending notice,
  the intro landings, `NoCreditsCard`'s line, the settings trial line, one `/pricing` line. Every
  new line COPY PENDING FOUNDER REVIEW in `lib/plans-ui.ts`.
- **Tests:** `packages/core/test/intro.test.ts` (33, PGlite — the founder's done-when list plus the
  races and edges the plan review found), `migrations.test.ts` (0061, 0062),
  `apps/web/test/intro-routes.test.ts` and the moved `plans-ui` / `analytics` / `account-routes` /
  `sumit-return-route` suites.

**The test-org walkthrough, 2026-10-14 (MEASURED, off production, PARTIAL):** the ₪5 page renders
under testbusiness at ₪5 ("תבנית - היכרות"); our intent id comes back as the payment's
ExternalIdentifier on the new catalogue; a decline stays on the page; `completeCheckout` on it
refuses `payment_invalid` and writes nothing. **The test terminal declined every card that day**
(code 004) — two published MasterCards on the ₪5 page, and on the ₪150 starter page the very card
it approved on 2026-09-21 — so the approved ₪5, the second attempt after a real trial, the continue
on the saved card and the receipt lines are still owed. Driver: `packages/core/.work/intro-walk.ts`
(gitignored; persistent PGlite in the session scratchpad; refuses unless `listquotas` reads the test
org's Operations quota of 100). Observed in passing: three declines left `Operations` usage at 0 and
`Mails` at 3 — unlike 2026-09-21, when each attempt moved Operations by 1 (not written to a fact
note). The founder's page text reads "מסלול היכרותת" (doubled ת).

**Then, on the founder's instruction the same day ("go ahead and push migrations and merge the
branch"):** 0061 + 0062 pushed (pre-flight `migration list` + dry-run; read back before and after
through `packages/core/.work/readback-0061-0062.ts`; `scripts/verify-migration-ledger.sql` against
production 52 rows, 49 true — the not-true are 0020 NULL, 0022 false and the data row 0028, all
expected), then PR #97 merged as `d41eae6` with its three Vercel previews green. **FOUNDER-REPORTED:**
he received two "payment failed" emails — Sumit's notices for the walkthrough's declined test-org
attempts (the test org's `Mails` usage read 3), no money moved. No call against the real Sumit org,
no paid call.

**The box, 2026-10-14 (FOUNDER-REPORTED, then MEASURED):** he pulled and restarted it ("restarted
the box"). Read-only against production at 21:07 UTC (`packages/core/.work/box-check-0109.ts`):
`expire_trials:2026-10-14` created 19:50:03 UTC, claimed by `hetzner:light`, `succeeded` with no
error — a job only the new code enqueues and handles, so the box runs the merge; the reaper singleton
had ticked a minute before the read; no `reconcile_continue` row; the switch `{"enabled": false}`,
0 trials, 0 intro intents. `git log -1` on the box was not read (no SSH from here): the job is the
weaker no-SSH check of [[0039-three-deploy-axes-and-the-box-is-the-one-that-forgets]]. He then
OK'd the merge of these records (PR #98, "go ahead and merge 98").

## What landed (2026-10-15, later) — readable badge and warnings, `fix/readable-badge-and-warnings`, MERGED as PR #100 (`385c1e8`)

Four lines in the app
were dark-theme colours left on light surfaces. The PostHog task's recon found the first two; they
are fixed here in the app's own house style. Contrast was computed from Tailwind 4.3.3's values and
re-measured from the browser's computed colours on a throwaway page (deleted):

- the `/home/demos` "מוכן" badge, from `bg-accent/15 text-accent` (1.17:1) to `bg-accent/25
text-ink` (17.7:1), the "active" plan pill's style;
- the A hook studio's small-text warning, from `text-amber-300/90` (1.40:1) to `text-amber-700`
  (5.03:1 on white, 4.70 on paper), the style of the other inline warnings;
- the same warning in the B effect step, from `text-amber-600` (3.19:1) to `text-amber-700`;
- B's audio step "script changed" notice, from `bg-amber-500/10 text-amber-200` (1.15:1) to
  `bg-amber-50 text-amber-900` (8.7:1), the app's other alert boxes. It normally never shows.

**Left as they are, dead code:** `components/a-wizard/step-script.tsx` (imported nowhere) and B
`step-audio`'s `measuredEnding` line (`b-wizard.tsx` never passes `demoDurationMs`) still carry
`text-amber-300/90`. They can never render.

## What landed (2026-10-13, later) — social posting: four UI fixes after PR 3, `fix/social-posting-ui`, MERGED as PR #96 (`9e7000b`)

[[0108-social-posting-four-ui-fixes-after-pr3]] (his five decisions of 2026-10-13, with a dated
pointer on 0101); docs/09's screens table carries the new behaviour. **UI only, `apps/web` only**:
no core function, no job, no limit, no email, no connect, no migration, no dependency.

**What exists (MEASURED, on the branch):**

- **The tag:** "פורסם" (green, the calendar's posted colour) once a post of the video went out and
  none waits; "מתוזמן" (grey) while any waits; none for failed or cancelled posts alone. The list
  route's `postTag`, from one grouped query in the web app (`postCountsByRender`); absent for a
  hidden account, as before.
- **The button:** `WHITE_BUTTON_CLASS` — white, `hover:bg-neutral-200`, ink text — on all five
  player mounts. The cause was the `secondary` variant's `light:` hover, a 4 % ink tint that is black
  over the modals' `bg-black/80`.
- **The pickers:** each field one button; a month with the out-of-range days disabled and a 24-hour
  list in 5-minute steps; keyboard throughout; the field reads "יום ד׳, 14.10". Shared with the post
  page's edit form, which changed with it.
- **The sounds:** a row whose link is an `instagram.com` page reads "האזנה באינסטגרם" and opens it in
  a new tab; file rows unchanged.
- **Tests:** `apps/web/test/social-schedule.test.ts`, 32 — the four tag cases through the route, a
  hidden account with a posted and a waiting post seeing no tag, the tile's two colours, the 288
  24-hour options, the range enforced in the month's markup, the two kinds of sound row.
- **Screenshots** (harness with a mocked fetch, sample data; desktop and 375 px, headless Chrome over
  CDP): `packages/core/.work/0108-shots/` (gitignored), with `report.json` — the computed colours,
  the keyboard paths, the new tab.

**What the tree answered (MEASURED; the prompt's §3):**

- **A new-tab row** = a row whose `previewUrl` is Meta's `on_platform_audio_preview_link`: core
  folds `on_platform_audio_preview_link ?? download_url` into one link and PR 3's picker opened it
  when `<audio>.play()` refused. Planning's inference holds, with one edge: a row carrying both
  fields would also have gone to Instagram (not known to happen; no live call).
- **The tiles** could not tell a posted video (`pendingPostsByRender` counts waiting posts only); a
  web-local query does it, no core change, no migration.
- **"מתוזמן"** already followed the rule (scheduled or publishing).
- **The fields** were the browser's own date and time inputs.
- **The 5-minute step** fits: `publish_post` runs at the chosen minute (2 s lane poll), then Meta's
  container is polled every 60 s.
- **AM/PM elsewhere:** none — the calendar, the done line, the post page and the failure email all
  format `he-IL` with `hour12: false`.

**What the founder reported on 2026-10-13 (FOUNDER-REPORTED, not repo-verified):**

- PR 3 is merged and works live for him.
- In the trending original sounds, about the first ten opened an `instagram.com/reels/audio/…` page
  in a new tab and the rest played inside Tavnit. Songs always played inside.

**Not run:** nothing live — no post, no deploy, no production query. The pickers and rows were
checked on a harness, not in a signed-in walk.

## What landed (2026-10-15, later still) — `/privacy` drops the picsum sentence, `docs/privacy-drop-picsum`, MERGED as PR #101 (`817ca2e`)

`/privacy` §6 said the landing loads
temporary images from `picsum.photos`; MEASURED by reading the code and in the browser, none does.
`hookStudioShot` always renders its mock, `instagramShot` hides while its `src` is null, and every
other slot has our own file. A full scroll of the landing made 12 media elements and no
third-party request.

- **Removed:** the subtitle "תמונות בדף הבית" and its three sentences.
- **Also removed:** the dead fallback in `AdFrame` that could still have drawn a picsum still, and
  the `seed` prop it left unused, so the removal stays true. `apps/web/test/landing-media.test.ts`
  pins that the landing's media is our own files.
- **Legal docs:** legal-review row P15 added; reg-2 worksheet row 168 marked moot.
  `docs/legal/database-definitions-document.md` still names picsum, because that draft is frozen
  (decision 0043).
- **FOUNDER-REPORTED (2026-10-15):** `UPDATED` is not moved here; PR #99 moves it to 15.10.2026.
  #99 merged first, so the page shows 15.10.2026.

## What landed (2026-10-13) — social posting PR 3: schedule, sound picker, calendar, live posts, the failure email, `feat/social-posting-schedule`, MERGED as PR #95 (`acb245f`)

FOUNDER-REPORTED 2026-10-13: merged, and works live for him. Which of the live checks below
("Owed founder actions") he ran was not reported.

[[0107-social-posting-pr3-tick-landing-line-failure-email]] (his five decisions of 2026-10-12, with
dated pointers on 0101, 0102 and 0061); the mechanics are docs/09 §The schedule flow and the
calendar and §The failure email. Built from the approved plan of 2026-10-10 (§8, Appendix A), found
in the session's plans folder (`~/.claude/plans/steady-moseying-castle.md`) after he asked.

**What exists (MEASURED, on the branch):**

- **The failure email (0107 §3):** a 60-second sweep on the worker beside the alert sweep
  (`sweepFailureEmails`), core's `pipelines/social-failure-email.ts`, one Resend wrapper
  (`providers/resend.ts`, plain `fetch`, 10 s timeout). A cause is (Tavnit account, failure kind):
  one email per cause per 24 h, folded failures never emailed, sent once the newest failure is 2
  minutes old, only failures under 24 h old, at most **20 a UTC day**. Log = `events` rows of kind
  `post_failure_email`; **no migration**. Off with no `RESEND_API_KEY`, under `DRY_RUN`, and on a
  `local`/`cli` worker against production. Never touches a post or the notice.
- **The screens:** "תזמון פרסום" beside הורדה on the five player mounts; the grey "מתוזמן" tag;
  `/schedule/[renderId]` (accounts → when → caption, sound, AI tick → done; `?from=` for a failed
  post); the sound picker over `GET /api/social/instagram/sounds` (core `searchInstagramSounds`, the
  User token); `/calendar` and `/calendar/[postId]`; the `/home` notice; "לוח פרסומים" in the
  sidebar and the account menu. All behind the switch; a hidden account sees no trace.
- **One change to the plan's paths (latitude, his §5):** the schedule page and the calendar are
  `/schedule/…` and `/calendar…`, not under `/home`, in an `app/(posting)` group whose layout gates
  before any Suspense boundary — under `/home`, `loading.tsx` makes `notFound()` stream a 200 (PR 2's
  reason for `/connect/instagram`). Same frame (`HomeLayout`); `socialReturnPath` accepts the two.
- **§2.1–2.2:** the AI tick is small, muted, unticked, last on the caption step, with one muted hint
  line (DRAFT); the landing's `#proof` line now reads «החשבון מסומן כדמות AI, ואנחנו ממליצים לכל מי
  שמפרסם עם תבנית לסמן גם את הסרטונים שלו כתוכן AI.» (DRAFT).
- **Strings:** `apps/web/src/lib/social-posting-ui.ts` (Appendix A, the new ones DRAFT) and core's
  `social-copy.ts` (the failure lines, the email) — all for his approval at PR review.
- **Screenshots** (harness with a mocked fetch, sample data; desktop and 375 px):
  `.work/social-pr3/` (gitignored).
- **The adversarial review (2026-10-13):** six reviewers, one skeptic per finding — 31 confirmed
  (many one defect seen from several sides), 4 refuted, all fixed in `d2708d9` but two. The worst:
  the email linked to `/home/calendar`, which does not exist. Also fixed: the email's words
  (פרסום, לוח הפרסומים, plurals, no reschedule for a missing file), a stable idempotency key (the
  oldest due post), 401/403 as the account's fault (no row, an hour's pause), the body read inside
  the timeout; `/home`, the layout and the renders routes no longer fail on a failed switch read;
  the modals' button laid out from the open; the post page's stale state after a 409; the calendar's
  spill-over days and Back month. **Not fixed, his call:** a signed-out reader of the email gets the
  404 his no-trace rule gives (the email says the calendar opens after signing in); **known limit**
  (true of `/connect/instagram` since PR 2): the 404's raw HTML names the route tree. **Not fixed,
  minor:** "עכשיו" sends the browser's clock — one more than 60 s slow is refused as past, with the
  line saying so.
- **The gate (2026-10-13, at the review fixes):** `pnpm lint` clean; typecheck clean, all six
  packages; remotion 97 (9 files), core 1130 (80), worker 7 (1), web 742 (31), admin 71 (5).
  The first web run failed `auth-user.test.ts`'s session-read allowlist for the four `(posting)`
  files — they are on it now, with the pre-screen's reason.

**Read on the providers' own pages (MEASURED, 2026-10-12):**

- **Resend:** the free plan is "limited to 100 emails per day" and 3,000 a month; the day "is a UTC
  calendar day"; `daily_quota_exceeded` and `rate_limit_exceeded` are 429; a `sending_access` key
  "Can only send emails" and can be held to one domain; `Idempotency-Key` lasts 24 hours. Whether
  SMTP sends count toward the same day: not stated (REASONED yes, one team).
- **Meta** (each line re-fetched by a refuter; quotes and URLs in docs/09): a stream-less Reel is
  neither allowed nor refused in the docs; the audio search is documented against "A valid User
  access token" only; PPA blocks publishing with no documented error code and no way to detect it
  in advance; Meta requires disclosure of photorealistic AI video, and `is_ai_generated` is "an
  optional parameter to provide a self-disclosure".
- **Retention (production, a SELECT-only probe):** `retention_days.released_renders` = **90**, so the
  horizon is the earlier of 30 days and 88 days after release. `social_posting` has no row (admins
  only); 0 scheduled posts; 4 connected accounts, 1 disconnected.

**What the founder reported on 2026-10-12 (FOUNDER-REPORTED, not repo-verified):**

- Resend is on the **free** plan — this corrects the security-audit section's "paid plan" line. He
  will watch usage and upgrade if needed.
- He will create a second Resend key, for sending only, for the worker.
- He can now add Instagram accounts with no issue.

**Not run:** nothing live — no post, no email, no env change, no deploy, no migration. Every PR 3
check against Meta and Resend ran against fakes.

## What landed (2026-10-12, later) — the live run, the ruling, the Page-first pre-screen, `feat/instagram-connect-page-steps`, MERGED as PR #94 (`e21bc78`)

[[instagram-connect-live-run-2026-10-12]] (the run: database MEASURED read-only, the window
FOUNDER-REPORTED) and [[0106-instagram-connect-stays-on-todays-flow-with-a-page-first]] (his
ruling), with a dated pointer on 0105.

- **#93 merged** (`fc8a03d`). Production first showed only the branch's Preview deploy; the
  Production deploy of the merge followed (FOUNDER-REPORTED: "it's there now and says production").
- **Switch off (15:15 UTC):** today's flow behaved as before by design; the round trip came back
  connected (Shira refreshed), not on the old failure line.
- **Switch on (15:27–~16:10):** Omri connected through Meta's one-window setup on the second try,
  with a Page Meta created — by a **code in the query** (MEASURED: only the callback's server-side
  exchange writes a row). Yael and the tavnit.ai account failed inside Meta's window with
  Facebook's generic "Sorry, something went wrong" (REASONED: both are in his Accounts Center, Omri
  is not; the one public report shows console error 1850019 and no Meta answer).
- **Switch off again, a Page linked by hand:** Yael connected at once, with confirm alone — no
  Edit settings.
- Disconnect (u): Shira's row kept, both tokens null. Three live accounts, each once.
- **His ruling (0106):** customers stay on today's flow, the Page linked first; the switch stays
  off and its code stays; PR 3 is unblocked.
- **This branch:** the today's-mode pre-screen rewritten from the run (DRAFT strings), the records.

## What landed (2026-10-12) — Instagram connect: Meta's one-window setup behind a switch, `feat/instagram-onboarding-connect`, MERGED as PR #93 (`fc8a03d`)

[[0105-instagram-stays-on-facebook-login-one-window-setup-behind-a-switch]] (his five decisions of
2026-10-12, dated pointers on 0101 and 0102); the mechanics are docs/09 §The connect mode and
runbook J. **PR 3 waits for his live result on this** (decision 5).

**What the founder reported on 2026-10-12 (FOUNDER-REPORTED, not repo-verified):**

- PR 2 is merged (git agrees: PR #91, `92f256b`), and he connected one account, Shira, on tavnit.ai
  as admin; it appeared with its picture and name. Disconnect and the return address (docs/09
  checklist g, h) are not tested.
- הוספת חשבון: Facebook showed "Continue as…? You've previously linked Tavnit", with "Edit settings"
  and "Continue", no Page list. "Continue" returned Shira only — because Omri has no Page (his
  ruling at Stop 1; his previous settings were already "all current and future").
- "Edit settings" led through Pages, Businesses and Instagram accounts, each preset to "all current
  and future", then a review screen, then "connected". Tavnit then showed «החיבור לאינסטגרם לא
  הושלם. נסו שוב.» Shira stayed connected. He may have been in Facebook's window more than ten
  minutes.
- Signing into Instagram as another account in the same browser changed nothing.
- Omri, his second account, has no Facebook Page; it became a Business account that day through
  Instagram's own flow.
- Facebook's review screen tells the user that Tavnit can "manage everything in the portfolio".
- Fastlane connects Instagram through Ayrshare on Instagram's own login, with no Page.
- `META_LOGIN_CONFIG_ID` is not set in Vercel Production; the related variables there are
  `META_APP_ID`, `META_APP_SECRET` and `SOCIAL_TOKEN_KEY`.

**What exists (MEASURED, on the branch):** `app_config.instagram_connect` (`"onboarding"` = Meta's
one-window setup with a code return; absent or unparseable = today's request, byte for byte; read
only behind `social_posting`'s gate); the state cookie carries its issue time — 30 minutes for the
window, kept a day by the browser; six callback outcomes, each its own Hebrew line (DRAFT) and its
own log reason; every callback redirect carries its own fragment; the pre-screen's lines follow the
mode, and in today's mode הוספת חשבון opens with the Page requirement, then Edit settings (his
amendment). Tests: `social-connect.test.ts` 25, `social-accounts.test.ts` 7, passing. No migration,
no env change, nothing live.

**MEASURED on Meta's pages (2026-10-12, refuter-checked):** the one-window setup is documented only
with `response_type=token` (the fragment), and as a 2022 beta; whether it honours a code is
UNVERIFIED — his live run (docs/09 checklist q). A Facebook code lives 10 minutes from its creation.

**The red error's cause:** REASONED — the 10-minute cookie — until his Vercel log lines are read
(owed below).

## What landed (2026-10-11) — social posting, PR 2 of 4: connecting accounts, `feat/social-posting-connect`, MERGED as PR #91 (`92f256b`)

[[0102-social-posting-label-mix-switch-key-2026-10-11]] (his five changes to PR 1, recorded with a
dated pointer on 0101); the mechanics and the Meta runbook are `docs/09-social-posting.md`.

**What exists (MEASURED, on the branch):**

- **0102 in core:** `scheduled_posts.ai_label` (migration **0060** — **APPLIED to production
  2026-10-11** on his instruction "OK, apply migration 0060.", before PR 2 merged as the 0039 rule
  asks; read back before and after: no column → `ai_label | boolean | NO | false`, 0 post rows,
  ledger 61 rows, 0000–0060 ([[production-migration-push-log]])); the AI
  label is the post's own tick, unticked by default on every service, `is_ai_generated` sent only
  when ticked; `SOUND_VOLUMES` per service — a 100/0, b 15/100, c 100/40 (sound/video), a retired
  full-format A render on b's; the switch's third setting
  `{"access":"named","userIds":[…]}`, and a row that does not parse hides instead of throwing.
- **The web:** חיבורים in `/home/settings` (only for an allowed account; one Instagram card, no
  TikTok card); the pre-screen at **`/connect/instagram`** — outside `/home` because a `notFound()`
  under `/home`'s `loading.tsx` boundaries streams a 200 (found by the PR's review); the Facebook
  round trip (`/api/social/instagram/start|callback`: a session-bound state cookie, `config_id` or
  the scope list, `auth_type=rerequest` for הוספת חשבון, every Instagram account from one approval,
  the return address honoured, never an open redirect); disconnect; Meta's deletion callback and
  `/social/deletion/[code]`. Every social route answers a hidden or signed-out account with 404.
- **Core fixes from the PR's adversarial review (25 agents, 9 of 20 findings survived):** Meta's
  deletion now erases rows already disconnected in Tavnit (it skipped them — PR 1 code, live with
  this PR); disconnect, manual cancel, Meta's deletion and the confirm's count share one
  "cancellable" predicate (a post waiting out Instagram's quota with no container is cancelled too);
  the confirmation code is 32 hex digits (Meta documents an alphanumeric code); display names are
  bidi-isolated.
- **Tests:** the full gate green on the branch after the review fixes (2026-10-11): `pnpm lint`
  clean; typecheck, all six packages; remotion 97, core 1099 (78 files), worker 7, web 627 (29
  files, `social-connect.test.ts` 20 of them), admin 71. Remotion, worker and admin are the
  test-runner's counts from before the fixes, which touched none of them.
- **Screenshots** (harness, sample data; desktop and 375 px): `.work/social-pr2/` (gitignored).
- **`SOCIAL_TOKEN_KEY` generated 2026-10-11** into `C:\Users\USER\aiugc-keys\SOCIAL_TOKEN_KEY.txt`
  (outside the repo, never printed), fingerprint **047bda40** (first 8 hex of its SHA-256). Not yet
  placed anywhere — his three placements are under "Owed founder actions".
- **Records:** [[job-settle-writes-have-no-ownership-check]] (defect, not fixed); docs/02's heavy-lane
  list now names `analyze_demo`; [[data-api-surface-is-two-tables]]'s "only RLS stands between anon
  and the data" corrected (two layers on the current project; grants re-measured).

**Meta's gates, read on Meta's pages 2026-10-11 (detail and paths in docs/09's runbook):**
MEASURED — Business-type apps have no modes and Standard Access serves role users only, so his
"published" app still connects only his own accounts; "Ready for testing" = testable, not approved;
Advanced Access needs App Review **and** Business Verification; Tavnit is a Tech Provider and five of
its seven permissions need access verification after Business Verification; the dialog is Facebook
Login for Business, `config_id` preferred and `scope` still accepted; Graph API v26.0 is the latest.
UNVERIFIED — whether an עוסק פטור qualifies (no Meta page mentions sole traders or Israel; his
Security Center says Start or Ineligible); whether an app published without a verified business
stays published; whether `http://localhost` is accepted as a redirect URI (Enforce HTTPS argues
against it); **whether `auth_type=rerequest` shows Facebook's Page list again** (Meta documents it
only for declined permissions; the documented Page change is the user's Business Integrations
setting) — a live check, with two fallbacks named in the runbook.

**What the founder reported on 2026-10-11 (FOUNDER-REPORTED, not repo-verified):**

- He merged PR 1 and told the session to apply 0057–0059 (done, read back).
- He published the Meta app after filling in the privacy-policy link, the terms link, an address
  and an email; Meta answered "Your app was successfully published".
- The app's Permissions and features page shows "Ready for testing" on `business_management`,
  `instagram_basic`, `instagram_content_publish`, `instagram_manage_messages`,
  `pages_read_engagement`, `pages_show_list` and `public_profile`.
- No business portfolio is connected to the app; he could not find a business-verification section.
- He deleted the Explorer test Reel right after it posted; whether it was publicly visible, and
  which service the video was, are both unknown.
- No TikTok developer app exists.

**Planning defaults of the PR 2 prompt (PLANNING DEFAULT, unstruck):** live checks use the box on
`origin/main`, never a task branch; `instagram_manage_messages` is unused and the runbook tells him to
remove it before review (docs/09 §C).

**Read, not edited (his instruction):** 0061 §3's landing line, live at `apps/web/src/app/page.tsx:640`
— "החשבון מסומן כדמות AI, כמו שאנחנו מבקשים מכל מי שמפרסם עם תבנית". Its first half (Tavnit's own
account is marked) stands; its second half ("as we ask of everyone who publishes with Tavnit") is in
tension with 0102 §1, where the label is the customer's choice and unticked by default.

## What landed (2026-10-11) — social posting, PR 1 of 3: the core, `feat/social-posting-core`, MERGED as PR #89

[[0101-tavnit-schedules-and-posts-to-instagram-and-tiktok]]; the mechanics are
`docs/09-social-posting.md`. The founder approved the plan on 2026-10-11 with none of its open
questions answered, so every recommendation stands as a PLANNING DEFAULT (listed in 0101).

**What exists (MEASURED; merged as PR #89 on 2026-10-11):** migrations 0057–0059 (three enum types;
`social_accounts` and `scheduled_posts`, server-only; the alert index rebuilt with `post_failed`) —
**APPLIED to production 2026-10-11** on the founder's one-push approval, read back before and after
(ledger 60 rows, 0000–0059; [[production-migration-push-log]]); `secret-box.ts` (AES-256-GCM under `SOCIAL_TOKEN_KEY`); `providers/meta-graph.ts`
with its DRY_RUN stub; `pipelines/social.ts` (the switch `app_config.social_posting`, connections,
scheduling with its guards, the `publish_post` job, the daily `check_social_tokens`, Meta's deletion
path); six test files. **No web surface and no TikTok.** Nothing a customer can reach changed.

**What the founder reported on 2026-10-10 (FOUNDER-REPORTED, not repo-verified):**

- A Meta developer app named Tavnit exists: use case "Manage messaging & content on Instagram", API
  setup with Facebook login, the required content permissions added, no business portfolio
  connected.
- In the Graph API Explorer (v26.0) with `instagram_basic`, `instagram_content_publish`,
  `pages_show_list`, `pages_read_engagement`, `me/accounts` came back empty until he added
  `business_management` (MEASURED afterwards in the Graph API changelog v17.0: that permission is
  required for Pages linked to a Meta business).
- `ig_audio` with `audio_type=original_sound` and no query returned about 25 trending sounds and a
  paging cursor; fields seen: `audio_id`, `title`, `duration_in_ms`, `ig_username`, and either
  `download_url` or `on_platform_audio_preview_link`.
- `audio_type=music` returned only little-known library artists; a known artist's song he uses and a
  current Israeli hit returned nothing.
- He published one Reel to his own account: `media` with `media_type=REELS`, a caption,
  `audio_configuration` (sound 100, video 0) and a Tavnit render's own signed download link as
  `video_url`, then `media_publish`. It went live with the caption, the sound from its first second.
  **Which service's render is not recorded, so a stream-less הוק + דמו file is untested.**
- His other Instagram accounts would not link to the same Facebook Page.
- A competitor, Fastlane, tells users that direct scheduled TikTok posts get throttled — unverified,
  never to appear in Tavnit's copy.
- No TikTok developer app exists.

**Planning defaults kept at approval (PLANNING DEFAULT):** the eleven from his prompt and the
plan's own — the AI label on הוק + דמו and דמות AI only, the `35/100` bed under a video's own
sound, hourly deferral on a spent Instagram quota, no silent AAC track for A renders, a 30-day
horizon bounded by retention, `share_to_feed=true`, a per-account calendar, in-app failure notice
only, the browser's zone, cancelled posts hidden, no permission revoke on disconnect, the User token
kept for the sound picker. All in 0101. _(2026-10-11: the AI label, the bed and the switch moved —
[[0102-social-posting-label-mix-switch-key-2026-10-11]].)_

**The queue for this feature:** PR 2 `feat/social-posting-connect` (BUILT 2026-10-11, the entry
above); PR 3 `feat/social-posting-schedule` (the player button and
`scheduleHref`, the tag, the schedule flow, the sound picker, the calendar, the `/home` notice,
strings, screenshots — the live checks run on it); PR 4 TikTok, once a sandbox app exists. The
Hebrew strings are drafted in the plan's Appendix A and await his approval before merge.

## What landed (2026-09-19) — the landing repositioning, `landing/two-services`, MERGED as PR #49 (`495ac43`)

The public landing and `/about` sold the **retired** Service A — "מסרטון אחד", קריינות, "עם קול
ובלי" — and folded the talking head into one feature card. Both now sell the two services that
exist, under the app's own names, and claim nothing: no results, no organic-reach promise, no credit
or shekel number, no length for the talking head. The reasoning, the vocabulary rules
(כיתובים for hook + demo, כתוביות only for B) and the eight product claims re-read against the code
before shipping: [[0061-landing-positioning-two-services-no-results-claims]].

New: `apps/web/src/lib/landing-media.ts` + `apps/web/public/landing/` — every landing asset is one
typed object plus a file drop, no import and no page edit. Every slot ships empty and draws the
existing AdFrame still wearing its own label; "placeholder" never reaches the screen. One
exception since `13432fc`: `instagramShot` hides its `#proof` column instead of drawing a still —
an empty phone frame beside copy about an Instagram account read as a broken image. Setting its
`src` brings the frame and the two-column layout back; there is no flag.

**The whole gate ran green from this machine — 1198 tests, 0 failures, all five suites.** ffmpeg IS
installed here, so the four core `ffmpeg ENOENT` failures under Unfinished measurement are a property
of that container, not of this repo.

**No surface still sells the retired format** — closed 2026-09-23 on branch
`tweaks/landing-home-contact-demo`. This file used to name `app/home/pathway-cards.tsx:36` as the
last one; that was true of the file and wrong about the count. A repo-wide sweep of `apps/web` for
`קריינות`/`קריינ`/`voiceover` found **two** live claims, not one, and `0ade931` fixed both: the
signed-in card into the A wizard (now `…חיתוך לסרטון המוצר שלכם וכיתוב על כל צעד.`) and
`app/home/demos/page.tsx:40`, which told customers the demo description helps `הקריינות` — it
feeds the burned step labels and the hook lines (`demo-step-plans.ts:1149`, `copy.ts:322`), so it
now says `הכיתובים`. The other 40 hits are accurate Service B copy, service-wide legal statements
that are true because Service B exists, source comments, or copy belonging to the retired voiced
format, which is unreachable from the web app. Two are negations that must survive any future
sweep: `service-a-ui.ts:1167` (`בלי קריינות`, pinned by `service-a-ui.test.ts:889`) and
`terms/page.tsx:69` (`ללא קריינות וללא פסקול`). No legal page was edited, so `terms_version` did
not move.

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
   server-only. Noted because it reads like an unfinished feature and is not. **Superseded
   2026-09-21** by [[0062-hosted-checkout-via-sumit-payment-pages]] on `feat/sumit-checkout`: the
   503 now means only "no `SUMIT_CHECKOUT_PAGES` in this environment". **Closed 2026-09-21**: the
   pages are set on Vercel and checkout redirects to Sumit. The 503 was seen once more that day,
   on all three tiers at once, because the value had been saved with its quotes
   ([[env-values-differ-between-the-box-and-vercel]]).
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
11. **Testing the API charge is DEFERRED until real sales fund the Upay balance — 2026-09-21.**
    The only way to exercise `/billing/payments/charge/` on the live terminal is a day-0 upgrade
    (₪150), and it could not be refunded afterwards: a Sumit refund needs a Upay balance larger
    than the refund, and a new terminal has none. Reason given: cost. So renewals and upgrades
    remain **unproven against the real terminal** ([[first-real-purchase-2026-09-21]]).
12. **The first real purchase stays UNREFUNDED for now — 2026-09-21.** Founder's call. It is a
    TEST subscription on his own card and must be excluded from revenue; the accountant has to be
    told the ₪150 receipt is a self-purchase. Refunding later is optional and only becomes possible
    once the Upay balance exceeds ₪150.
13. **Three CLAUDE.md contradictions resolved by ruling, 2026-09-29** (the slim-CLAUDE.md brief; kept
    here on the founder’s instruction). (a) End of task NEVER applies a migration: say in Next step
    that one is waiting and include the `db push --dry-run` output. This replaces "apply it
    yourself". (b) The `npx -y supabase db push` line leaves CLAUDE.md's Commands; the recipe is
    `.claude/rules/migrations.md`. (c) Vault notes are written only at the moments CLAUDE.md's vault
    section lists; end of task still updates this file. **Follow-up rulings, 2026-09-29** (same
    branch; they close the knock-on questions (a) raised):
    1. The migration gate covers anything that writes to the database or the migration ledger.
       `migration list` and `db push --dry-run` are read-only pre-flight and need no permission. For
       a pending migration, the manual test is the read-back query the founder runs after he
       authorizes the push, with the expected result. `migration repair` writes the ledger, so it
       takes the same explicit instruction as a push; a hand-applied migration found mid-task is
       reported, not repaired. All in `.claude/rules/migrations.md` rules 1, 2, 5 and 10.
    2. Where the vault holds the decision, CLAUDE.md follows it, in the notes' wording: Payments
       (0046, 0054, 0062), the Service B QC clause and locked #8's "permanently" (0036), falsified
       notes (CONVENTIONS.md), the credential count ([[credential-echo-incidents]]), the four hook
       effects (`hook-effect.ts`).
    3. CLAUDE.md governs how to work and the locked decisions; the vault governs what is true and
       what was decided. Both files' openings now say so.
    4. The test gate is `pnpm lint`, `pnpm typecheck` (run one package at a time with `--no-bail` — the implementer’s precaution, not part of the ruling) and the five
       vitest runs; `test-runner` runs all seven.
    5. "Reachable only from the CLI" became "no customer-facing path";
       [[retired-formats-keep-two-live-web-routes]] records the two live routes, which stay.
       Rulings 6 and 7 (branch per task, handovers retired), and the 2026-09-30 ruling that the coding
       principles live inline in CLAUDE.md instead of the `/karpathy-guidelines` skill, are
       [[0066-branch-per-task-and-no-handovers]].

Recorded as recommendations the founder did not object to, 2026-09-21 — not decisions he stated:
קטלוג ללא מע"מ stays unticked on the real org (deliberately unlike the test org, because a no-VAT
catalogue flags its customers VAT-exempt for future charges); Sumit's own terms stay unattached
(acceptance lives in our checkout, 0056); the return URL is set per catalogue only; wallets stay off
until someone measures whether a wallet payment leaves a chargeable saved card.
[[sumit-real-org-configuration]].

## The queue

**The Instagram autopilot — BUILT 2026-10-24** ([[0127-the-instagram-autopilot]]); what is left is
the owed list's first bullet: the box step, his setup and the first night. C joins it later (0127
"Where C slots in", in docs/09). Demo names
([[0125-demos-get-an-optional-name-never-read-by-a-model]]) went first because the autopilot picks
demos by what they show.

**The ₪5 intro offer — MERGED 2026-10-14 as PR #97, 0061/0062 pushed, LIVE (MEASURED 2026-10-15)** ([[0109-a-five-shekel-intro-offer]]);
what is still owed (from the real ₪5 purchase on) is the owed list's "The ₪5 intro offer" bullet,
steps 9 onward.

Two axes. **Money** (item 0) and **pipeline** (items 1–7, all from the 2026-09-18 diagnosis), then
the older launch items. Item 0 no longer outranks everything the way it did — billing exists and has
taken a real payment — but what is left of it is still the part that decides whether the next
payment is kept.

**Social posting — PR 1 (core) MERGED as #89; PR 2 (connect) MERGED as #91; the one-window setup
MERGED as #93 (`fc8a03d`), run live and RULED OFF 2026-10-12**
([[0101-tavnit-schedules-and-posts-to-instagram-and-tiktok]],
[[0102-social-posting-label-mix-switch-key-2026-10-11]],
[[0105-instagram-stays-on-facebook-login-one-window-setup-behind-a-switch]],
[[0106-instagram-connect-stays-on-todays-flow-with-a-page-first]],
[[instagram-connect-live-run-2026-10-12]]; the "What landed" entries above). 0060 is applied
(2026-10-11). The Page-first pre-screen MERGED as #94. **PR 3 MERGED as #95** (`acb245f`; the
button, the tag, the flow, the sound picker, the calendar, the notice, the failure email —
[[0107-social-posting-pr3-tick-landing-line-failure-email]]), live and working for him
(FOUNDER-REPORTED 2026-10-13). **Four UI fixes MERGED as #96** (`9e7000b`,
[[0108-social-posting-four-ui-fixes-after-pr3]]; this line said "BUILT … next: his review and merge"
until 2026-10-16). PR 3's live checks in 0107's order are still unreported (docs/09 §Live-test
checklist, PR 3). **PR 4 — TikTok inbox posting — MERGED as #107** (`f11ff04`, 2026-10-17;
[[0115-tiktok-inbox-posting-pr4]], the "What landed" entry above); 0064/0065 PUSHED 2026-10-17; run
live in the sandbox that night, t1–t6 passed by his report
([[tiktok-inbox-live-run-2026-10-17]]). **PR 4.1 — the delivery email and the door — BUILT
2026-10-17** on `feat/tiktok-delivery-email` ([[0116-tiktok-delivery-email-and-the-door]]; its
"What landed" entry above), awaiting his merge (PR #108). Next: his look at t7 (does «צפייה בפוסט» open the
player), the recorded review demo and "Submit for review" (yours), then the production pair after the
audit. The env names and the live-test steps are under "Owed
founder actions".

**Service C phase 2 — BUILT 2026-10-09** on `feat/service-c-phase-2`
([[0099-service-c-phase-2-opens-to-customers]]); its push, merge and go-live are under "Owed
founder actions". The legal pages stay as they are (his ruling 10). The landing's part of that hold
was lifted 2026-10-10 and the landing sells גוש טקסט since PR #87 (merged 2026-10-10)
([[0100-home-cards-show-example-clips-landing-sells-three]]); `/pricing`'s part was lifted 2026-10-15:
each plan card's estimate names גוש טקסט as a third count
([[0112-pricing-names-three-services-and-shows-the-intro-card]]).

**Low-effort thinking on גוש טקסט: TESTED and RULED OUT 2026-10-08 on
`feat/text-block-thinking-low`, ₪1.65 of a ₪5 cap
([[text-block-thinking-low-test-2026-10-08]]). Every call still sends `between_tools`, as 0095 set
it.**

- **The ruling, in his words:** "No on low, and no medium-effort test for now." And: "Leave the
  discovery placeholder for v3." He gave no reason in chat.
- **The code is back to `origin/main`:** `ca2f816` reverts `cd7fbf0`, the test-only
  `thinking: "low"` on `generateObject` and `generateTextBlocks`.
- **What the test measured:**
  - **The model did not think at `low`:** 0 thinking tokens on 8 of 8 calls, and no thinking
    block. So the sides differed by the effort level alone.
  - **Time and cost:** the same on both sides, 72–76 s and 54–57 agorot for each run of four
    batches. No cut-off and no retry.
  - **Judged blind:** the sides split. `low` had fewer Hebrew mistakes (7 against 11) and fewer
    invented figures (1 against 6). It had more copied closing lines (10 against 3; 6 against 2
    verbatim) and more truth breaks (2 against 1).
- **Not queued:** a medium-effort test.
- **Left for `text_block` v3:** the `discovery` placeholder. For the course, which has no `wow`, 7
  of 8 batches across the four runs put `skip`, `skipped` or `discovery` in `texts`.
  `textBlockBatchProblem` passes it and `generateTextBlocks` stores it as a `text_block` row. At
  least three of the seven also listed `discovery` in `skipped`; off-r1's skip list was not
  recorded.

**0. The Sumit adapter.** MERGED and LIVE 2026-09-21 — PR #52, `4100cc7` —
[[0062-hosted-checkout-via-sumit-payment-pages]]. `getBillingGateway()` returns `SumitGateway`
because `SUMIT_COMPANY_ID` + `SUMIT_API_KEY` are set on Vercel and on the box without `DRY_RUN`, and
one real ₪150 purchase has gone through it ([[first-real-purchase-2026-09-21]]). What is left is
below. The checklist, as dictated, with what the build and the go-live closed:

1. ~~Create a **SEPARATE test business**~~ — DONE, exists and measured
   ([[sumit-test-org-configuration]]). **LANDMINE stands: connecting a test terminal on the real
   org disconnects its existing Upay clearing — never touch `developers/testterminal` there.** Test
   quotas: Operations 100/month (6 used after the walkthrough), Mails 1000; test docs carry
   business no. 999999998; no Upay, no 3DS in test.
2. ~~Install modules **הכנסות + סליקת אשראי** on the real org~~ — **סליקת אשראי is PROVEN**: the
   live Upay terminal took a customer-present ₪150 payment and Sumit issued the document
   ([[first-real-purchase-2026-09-21]]). **הכנסות and what the receipt actually shows stay
   UNVERIFIED** — the founder has not said.
3. ~~Confirm schemas~~ — DONE from the public OpenAPI spec and measured
   ([[sumit-payment-page-saves-the-card]]). `beginredirect` is NOT used: the founder's fixed-price
   payment pages are the hosted first charge; `setforcustomer` takes Sumit's own token + expiry,
   never a PAN.
4. **Refund: no endpoint seen.** Check `/creditguy/gateway/transaction/` for a credit type
   referencing the original, and what `/accounting/documents/cancel/` does to the payment; else
   refunds go through the Sumit UI at launch. STILL OPEN — refunds are by hand in Sumit's UI.
   **And a refund is not always possible at all**: per Sumit's help articles (5799412, 10792135,
   read 2026-09-21, not measured by us) a refund needs a **Upay balance larger than the refund**,
   the charge must have gone through Sumit, and a same-day full refund usually becomes a
   cancellation. A new terminal therefore cannot refund its first customers — which is why the
   recovery that matters is **replaying the return URL**, not refunding
   ([[sumit-real-org-configuration]]).
5. ~~Idempotency~~ — ANSWERED: charge accepts NO external reference. `checkout_intents` is the
   attempt row for the hosted leg; renewals reconcile through `/billing/payments/list/` (narrow
   window, API charges only) and end `unconfirmed` → dunning otherwise (0062 states the residual).
6. ~~Errors~~ — ANSWERED: always HTTP 200 with `Status` 0/1/2 in the body; a decline is Status 0
   with `ValidPayment false`. The client never treats 200 as success blindly.
7. **Card auto-update on replaced cards** — API-charged too, or only Sumit-run recurring? OPEN.
8. **Chargebacks:** poll `/billing/payments/list/` or use triggers (Growth plan) — decide. OPEN.
9. **3DS is production-only, ₪1 per attempt, first customer-present charge only.** The CVV exemption
   for recurring is automatic on Upay. **STILL OPEN after the real purchase** — one customer-present
   charge ran on the live terminal on 2026-09-21 and the founder has not said whether 3DS appeared
   ([[first-real-purchase-2026-09-21]]); the CVV exemption is untested because no API charge has
   run against Upay at all (0.15).
10. Add **`requires_new_card`**: the enum value, the one-live-per-user partial index, the renewal
    skip, the `/home/plan` banner. OPEN — a suspended subscription reactivates from the checkout page.
11. ~~Rename the renewal charge description~~ — DONE: `תבנית — מסלול <name>, חידוש חודשי` and
    `תבנית — מסלול <name>, שדרוג`, seen on the test org's receipt 40002.
12. ~~Cap or dedupe `terms_acceptances`~~ — DONE: one row per intent; a second click within 30 min
    reuses the pending intent and writes none.
13. ~~Refuse the `DryRunGateway` when the database host is production~~ — DONE, throws naming
    `apps/web/.env.local`.
14. **Sumit offers no integration support** — Facebook group, a paid support hour, or an external dev.
    OPEN (nothing needed it this time; the public spec answered everything).
15. **`/billing/payments/charge/` has never run against the real terminal — OPEN, and it is the
    biggest unproven thing in billing.** Every renewal and every prorated upgrade takes that path.
    The hosted first charge proves the page, the saved card and the return leg; it proves nothing
    about a customer-not-present charge, the CVV exemption, or the reconcile ladder that 0.5
    describes. Testing it costs a ₪150 day-0 upgrade that cannot be refunded yet, so it is deferred
    by decision (conversation decision 11). **The first real renewal is the test**, and it will
    happen unattended — watch for `recurring_charge_failed`. Related and still open: 0.7 (card
    auto-update) and 0.8 (chargebacks), both of which also only bite on the API path.

**1. The batch-granularity fix — MERGED 2026-09-20 as PR #51 (`27ee842`), two commits, and LIVE on
the box since the 2026-09-21 deploy** (`4100cc7` contains it). Commit 1, the net: a parse failure rides the
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
retry and one sample per attempt. Both halves are now done: merged as PR #51, and the box reports `4100cc7`
on `git log -1` after the 2026-09-21 deploy, which contains it. No migration, no config row, no
prompt version moved. **What was never done is watching it work** — no analysis has been observed
salvaging a frame in production since the deploy.

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
**demoted, not dropped**. **The customer half is CLOSED (2026-09-28) by
[[0064-the-inventory-is-one-tier]]:** the collapsed tier no longer exists, so that state now sits
on a page like every readable moment and can be added by hand. Why the PLAN never took it stays
UNDIAGNOSED — 0064 deliberately left the plan pass alone.

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

**CLOSED 2026-09-21 — the box was deployed and restarted for the Sumit env.** The founder reports
`git log -1` on the box = `4100cc7` and `HEAD = origin/main`, the unit active, the journal's
`worker started` line carrying `workerId: hetzner` and `dryRun: false`, and three `SUMIT_` variables
in the running process's environment. That commit contains the renewal change, the label rule and
the `רגע` ban fix, all verified here as ancestors of `4100cc7`, so **those three are live**. Keep
the rule that produced this: a prompt version goes live **per call** the moment the file lands,
while worker code needs a restart — a `git pull` without a restart is the hazard
([[prompt-versions-on-disk]]). Deploy as ONE step gated on nothing running
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
callers (`plan_demo_steps`, `group_analysis_states`, `copy.ts`; `tts.ts`'s call left with the
retired `tts_enhance` pass, 2026-10-20, [[0119-tts-is-eleven-v4-plain-text]]) still go through
`messages.parse`: a parse failure throws whole-object, records NO usage (the ledger hole commit 1
closed for the vision call), and a `max_tokens` truncation surfaces with no stop_reason at all.
`group_analysis_states`' `.min(1)` / `.int().nonnegative()` are description-only on the wire
([[sdk-folds-enum-and-const-into-description]]). None of them carries an enum, so the casing
exposure does not apply. Whether they move to the raw seam and/or a strict wire is the founder's
call; the brief for the analysis fix deliberately left their wire untouched.

**12. Sweep the stale `apps/web/src/lib/auth.ts` cites.** `5c13ead` pushed everything below `signUp`
down ~54 lines. LEFT: `docs/08` `:383`, `:631`; `0005` `:41`. Done on `fix/site-url-landing`:
`docs/08` `:763` (was `:760`), both in [[auth-round-trips-that-miss-the-callback-die-silently]],
[[auth-email-runs-through-resend]] `:5`, `0005` `:48`. **Do not touch `0006:26`** — correct there.

**13. Ceiling alert + `vat_rate` config — build with the gateway adapter, not before.** Spec in
[[0046-billing-ships-as-osek-patur]] §6.

**14. "Paid, never returned" — a customer who pays and closes the tab before Sumit redirects leaves
NOTHING on our side.** Numbered last because it is new, not because it is least important; it is the
one hole the 2026-09-21 fix does not cover. The return leg is the only writer: no redirect, no
`completeCheckout`, no `checkout_charge`, and (since `fix/sumit-return-unconfirmed`) not even a
`checkout_unconfirmed` row — the intent just stays `pending` while Sumit holds the money.
**No sweep exists**: `listPayments` has exactly one caller, the post-lost-answer reconcile inside
`SumitGateway.chargeRecurring`, and none of the **13** job types in the registry
(`packages/core/src/handlers.ts` `buildHandlers()`) reconciles Sumit's payments against our intents
— the only billing one is `billing_renewals`. Measured 2026-09-21.

- **The manual net, available today:** Sumit's purchase history shows our `externalidentifier` on
  every page payment, and every purchase there should correspond to a `completed` intent. Anything
  in Sumit with no completed intent is a customer who paid for nothing.
- **A sweep is feasible**: `/billing/payments/list/` returns `ExternalIdentifier` for page payments
  (measured 2026-09-21 on the test org, [[sumit-payment-page-saves-the-card]]), so a job can match
  Sumit's list against `checkout_intents` by our own id — which is exactly what the API charge
  cannot do (0.15, and 0062's unconfirmed-charge rule).
- **It is probably the same job** as the sweep over unresolved `checkout_unconfirmed` rows that
  `fix/sumit-return-unconfirmed` leaves for later: both ask "did this payment ever activate?", both
  answer it from the payment id, and both would run on the box with the box's own credentials —
  independent of Vercel's, which is the pair that failed on go-live day.

**15. The Site-URL wrong-account landing — CLOSED 2026-09-22.** Both halves merged (PR #54
`352484e`, PR #56 `57e599d`), and **the trigger is measured**: a third occurrence, in the founder's
Supabase + Vercel log exports, started on `www.tavnit.ai` — a second serving origin holding the PKCE
verifier in its own jar. Fixed in Vercel: `www` 308s to the apex, measured, and a fifth allow-list
entry was rejected. [[the-site-url-landing-signs-you-into-the-wrong-account]]. Not a queue item, in
that note's "Still open": whether `/login` should redirect a signed-in user.

**16. GoTrue calls are unbounded in time, everywhere — one decision, not three.** `@supabase/auth-js`
2.110.6 sets no `AbortController`, `signal` or timeout anywhere in `dist/main/lib/fetch.js`, so a
Supabase Auth that HANGS rather than errors stalls whatever is awaiting it until the platform kills
the function. Three callers, all equally exposed: `exchangeCodeForSession` on the callback's happy
path, the middleware's `getUser()` on **every matched request**, and the `signOut` the clear added.
The lever is the same for all three and it is not the callback — it is a custom `fetch` with a
deadline on the clients built in `lib/supabase/{client,server}.ts` and `middleware.ts`. Deliberately
NOT done bespoke in the callback, where it would have bounded the least important of the three and
made the other two look handled. Deferred, founder's call.

**17. The worker runs as `aiugc`, which has password-protected sudo — a dedicated non-sudo service
user is the target, not built.** Sized for a later phase of the ongoing box/Supabase security audit
(`.work/security/`, session-local, not in this repo). [[worker-box-network-perimeter-2026-09-24]].

**18. Tighten the live Supabase grants.** Column-scoped `SELECT` —
`businesses(id,name,questionnaire,created_at)` and `users(id,role)` — to `authenticated`, in place of
today's live table-wide grant; plus `REVOKE TRUNCATE, REFERENCES, TRIGGER` in `public` **only**
(never touch `storage`'s grants — Supabase manages that schema itself). No migration written yet.
[[supabase-live-snapshot-2026-09-24]], `docs/08-supabase-project-rebuild.md` §6A.

## External state — not in the repo

Founder-reported from a dashboard unless a line says otherwise. **This section changed on
2026-09-21**: the Sumit variables now exist in two places, the box was deployed, and the first
subscription row was written.

**FOUNDER-REPORTED 2026-10-23, not repo-verified (the demo-names prompt).**

- **Hook bank.** One Service A character was removed because its look came out too close to the
  real person whose photo inspired it. Six Service A characters remain: five with four hook clips
  and one with six, 26 clips by his count. The last MEASURED count was 30 clips on 2026-10-01; not
  re-measured.
- **Service C.** Three characters, one clip each. The last MEASURED count was two characters,
  2026-10-10 (the Service C phase 2 owed item).
- **Instagram.** Four accounts are connected: Shira, Omri, Yael and Tavnit's official page. This
  updates [[instagram-connect-live-run-2026-10-12]], where tavnit.ai failed to connect inside Meta's
  window. Each character page posts only its own character's clips.
- **Demos. FOUNDER-REPORTED 2026-10-24:** he named two Tavnit demos, "Service A" (`17c112d9`) and
  "Service B" (`32e93f95`), and has no C demo yet. This supersedes his 2026-10-23 "three, one per
  service" and settles that conflict. Neither named demo is one of the three ids in
  [[cutaway-matcher-hit-rate-2026-10-20]] (`dfa291b6`, `3915c8e2`, `84889b25`); `32e93f95` is a
  different take (T4) from the matcher's B wizard `3915c8e2` (T2). MEASURED read-only the same day:
  both are ready with an approved plan.
- **Instagram characters. FOUNDER-REPORTED 2026-10-24, at the autopilot's approval:** the page names
  are not the character names. shir_acreates posts טליה, omri.creates posts עומרי, yael_creates
  posts שירה, and tavnit.ai gets the three without a page: נטלי, נהוראי, גלעד. MEASURED read-only:
  active hook clips שירה 6, עומרי 5, טליה 4, נטלי 4, נהוראי 4, גלעד 4.

**Meta (FOUNDER-REPORTED, 2026-10-14…16, from the PR 4 prompt).** Business portfolio "Tavnit" (ID
1147255727975713); legal name טאהא מוחמד, address ת"ד 929, כאבול 2496300, website tavnit.ai.
Business verification filed 2026-10-14 on the אישור עוסק פטור, confirmed by an email code to
muhammad@tavnit.ai (a Namecheap forward to his Gmail); status "In review". App 1728633468194967
declared Tech Provider; the portfolio is connected under Review → Verification; access verification
is locked until business verification completes. Still owed on Meta: the Website platform on Basic
(unverified whether added), the reviewer account, the recording, App Review, and the privacy page's
address and connected-accounts text.

**TikTok (FOUNDER-REPORTED, 2026-10-16).** Developer app "Tavnit": a production draft saved
2026-10-16 with a placeholder demo video, **not submitted**. Domain property tavnit.ai verified by
DNS TXT at Namecheap. Platform Web https://tavnit.ai; Terms /terms; Privacy /privacy. Products: Login
Kit (Web, redirect https://tavnit.ai/api/social/tiktok/callback), Content Posting API with Upload on
and Direct Post off, Webhooks (callback https://tavnit.ai/api/social/tiktok/webhook). Scopes
user.info.basic, video.upload. One sandbox cloned from the draft, with one target user. **Since the
live run (2026-10-17, FOUNDER-REPORTED):** the sandbox has its own client key and secret, both placed
on Vercel Production and on the box; it keeps its own URL-properties list and needed its own domain
verification (the first live post failed with `url_ownership_unverified` until then); t1–t6 passed.
Still not submitted for review.

**tavnit.ai DNS (FOUNDER-REPORTED, 2026-10-16)** is at Namecheap; mail forwarding
muhammad@tavnit.ai → his Gmail; Resend's records untouched.

**Supabase.** Project `hyaqydcmwbnbaiqqufow`, `eu-central-1` (Frankfurt), Pro, Micro compute.
**Migrations 0000–0069 applied, ledger clean at 70 rows, nothing pending** — MEASURED
2026-10-24 right after the founder-authorized 0069 push (demo names, PR #116, pushed before its
merge), read-only against `supabase_migrations.schema_migrations` (count 70, first `0000`, last
`0069`; `migration list` 0000–0069 local == remote) ([[production-migration-push-log]]). _(This
line said 0000–0065 / 66 rows, MEASURED 2026-10-17, until 2026-10-24 and missed the 0066–0068
pushes of 2026-10-20.)_ _(This line said 0000–0062 / 63 rows until 2026-10-17 and
missed the 0063 push of 2026-10-15.)_ _(This line said
0000–0059 / 60 rows until today and missed the 0060 push of 2026-10-11.)_ _(The earlier text of this paragraph recorded the 0049 push of
2026-10-01 and a 49-files-against-50-rows interval that has long since closed.)_ The earlier 49-row line corrected a stale "0000–0047 / 48 rows" here;
**CLAUDE.md still says 0000–0047 and is now the stale copy.** (Not resolved: CLAUDE.md in the tree
that sentence was written in, ec0a324, already said 0000–0048, since f4d079e that morning. Since
2026-09-29 CLAUDE.md holds no ledger count; the other copy is [[production-migration-push-log]].)
Every push since
0036 was on the founder's explicit instruction **for that one push** — not standing permission — and
`db push` recorded each version itself, so `migration repair` has been needed zero times in ten.
History and read-backs live in `scripts/verify-migration-ledger.sql` §RESULTS (38 structural rows, 36
true / 1 false (0022, expected — every other false is real) / 1 NULL (0020)); the guarded- and
destructive-migration read-back rules are in `.claude/rules/migrations.md` (moved out of CLAUDE.md
2026-09-29). Do not re-narrate either here. Auth: Email on,
Google enabled, **Confirm email ON since 2026-09-11**, Site URL `https://tavnit.ai`; **Redirect URLs
read 2026-09-22 — four and only four: `/auth/callback` + `/auth/recovery` on `https://tavnit.ai` and
on `http://localhost:3000`, no `*.vercel.app`, no `www`** — every other origin falls back to the Site
URL. Custom SMTP, 100 emails/hour. Hebrew auth templates in `docs/08` §8A.2. **RLS/grants/auth-settings
re-verified read-only 2026-09-24** — everything matched the 2026-09-23 audit read except one thing
`docs/08` §6A now says correctly: the `authenticated` grant is table-wide, not column-scoped.
[[supabase-live-snapshot-2026-09-24]]. **Custom Domain add-on activated 2026-09-26: `auth.tavnit.ai`**
is now the Auth custom domain (founder-reported; $10/month, billed hourly, not covered by the
platform spend cap — Supabase's documentation). Namecheap `CNAME auth -> hyaqydcmwbnbaiqqufow.supabase.co.`
**must stay** — deleting it breaks Google sign-in, because Auth now sends Google back to
`auth.tavnit.ai` for the callback. [[0063-auth-custom-domain]].

**`events` is EMPTY — 0 rows, every kind.** Not `platform_budget_tripped`, not
`qc_release`/`qc_reject`, not `content_policy_flag`. The alert sweep reads an empty partial index
every 60s. **A session that finds silence here must NOT read it as "the feature is broken"** — that is
the intended steady state, and the first real proof has to be provoked. Non-succeeded jobs: 3 dead
`render_video` (the 2026-08/09 bundle bug), 2 `lipsync` failed on HeyGen credit.

**`subscriptions` is 1 row as of 2026-09-21, and it is a TEST** — the founder's own ₪150 התחלה,
`active`, `cancel_at_period_end = true`, period to 2026-10-21, with a `grant_period` of 1000 credits
beside it. **Exclude it from every revenue figure.** Measured, with the rest of the read-back, at
[[first-real-purchase-2026-09-21]]. Also measured the same day: `checkout_intents` holds 3 rows (one
`completed`, two `pending` for pro and studio that were never paid), and `gateway_events` holds
exactly one row, the `checkout_charge`. No `checkout_refused` row has ever been written.

**Resend.** Region **Ireland (EU)**, `tavnit.ai` verified, DKIM `TXT resend._domainkey`, sending via
two CNAMEs (`rsend`, `send`) not an SPF TXT, DMARC `p=none`, receiving off. Free tier 3,000/month
**AND 100/day — the daily figure is the real ceiling** ([[auth-email-runs-through-resend]]). **The
transfer basis is still open** — an Irish sending region says nothing about US access by a US company,
and `/privacy` deliberately claims no basis. Unanswered at `docs/legal/reg2-open-questions.md:131`
(COUNSEL) and `:167` (VENDOR).

**The box.** `aiugc-worker.service`, `Restart=always`, `WORKER_ID=hetzner`. **Deployed and
restarted 2026-09-21: `git log -1` on the box = `4100cc7`, `HEAD = origin/main`, unit active,
`worker started` with `workerId: hetzner` and `dryRun: false`** (founder-reported from the box
itself, which is the artifact check §11 asks for). `apps/worker/.env` now also carries
`SUMIT_COMPANY_ID`, `SUMIT_API_KEY` and `SUMIT_CHECKOUT_PAGES` for the **real** org — three
`SUMIT_` variables confirmed in the running process's environment. The pages value was first pasted
across two lines and the worker started anyway with a broken map
([[env-values-differ-between-the-box-and-vercel]]); the checks that catch it are
`docs/07-worker-box.md` §13.
Sentry confirmed active **by test** (a job inserted knowing it would fail; the founder got the email),
not by a log line — `error reporting on` also prints for a malformed DSN. `journalctl` sees unit
lifecycle and OOM kills (`usermod -aG systemd-journal aiugc` has been run). `ufw` active, OpenSSH
only; **key-only SSH became true only on 2026-09-24** — password authentication was open to the
internet in `sshd_config` from day one until then (0 failed attempts logged in 30 days, but the
setting, not observed luck, was the exposure), and a Hetzner Cloud Firewall now also gates the host.
[[worker-box-network-perimeter-2026-09-24]]. `sudo` needs a password, so an unattended session cannot
`systemctl restart`; `kill -TERM $(systemctl show aiugc-worker -p MainPID --value)` is equivalent.
Deploys: `docs/07-worker-box.md` §11.

**Vercel.** `apps/web` off this monorepo: Root Directory `apps/web`, Next.js preset, no overrides,
region `fra1`, `ANTHROPIC_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` present. **Since 2026-09-21 also
`SUMIT_COMPANY_ID`, `SUMIT_API_KEY` and `SUMIT_CHECKOUT_PAGES` on the Production environment**, for
the REAL org. Two of the three were first saved in a shape Vercel stores verbatim and the code
cannot read — quotes around the JSON, then a malformed credential — which is what cost go-live day;
**bare values only, and a change reaches only deployments created after it, so redeploy**
([[env-values-differ-between-the-box-and-vercel]]). Admin project also `fra1`.
`NEXT_PUBLIC_*` must be type Config, not Secret. **The access log renders IDT (UTC+3); the database
does not.**

**Hetzner.** One server `tavnit-worker`, CPX32 (**4 vCPU**, not 8), Nuremberg, Ubuntu 24.04, ~$41/mo +
~$0.72 IPv4. A powered-off server still bills in full — only deletion stops the meter. Two snapshots.
[[0007-worker-box-instance]].

**GitHub.** Fine-grained PAT, **no expiration**, scoped to `AIUGCBackend`, Contents read-only,
plaintext in `~/.git-credentials` on the box. Nothing will remind anyone it exists; revocable only at
GitHub. [[0008-github-pat-over-deploy-key]]. **Google OAuth** published, _In production_, scopes
`openid`/`email`/`profile` — do NOT upload a custom app logo, it triggers brand review even with
non-sensitive scopes (still correct while brand verification is deferred — see
[[0063-auth-custom-domain]] for what reversing that would take). **Authorized redirect URIs, since
the 2026-09-26 custom domain (founder-reported):**
`https://hyaqydcmwbnbaiqqufow.supabase.co/auth/v1/callback` and
`https://auth.tavnit.ai/auth/v1/callback`, both kept. **The account chooser now reads "tavnit.ai"**
— founder-tested after activation, no longer the raw project ref. [[0063-auth-custom-domain]].

**Claude Code cloud environment `tavnit-unattended` (FOUNDER-REPORTED 2026-10-08).**

- **As he set it up:** Trusted network access, no setup script, and one environment variable,
  `PAID_CHECK_ANTHROPIC_KEY`.
- **The key's limit:** a $20/month spend limit, in his words "on the scoped anthropic api key for
  cloud sessions".
- **What he still has to change:** add the setup script, and switch the network to Custom with
  `remotion.media` added (Owed founder actions).
- **What the first run saw (MEASURED 2026-10-09):** ffmpeg 6.1.1 present, and Chrome Headless Shell
  downloading in full from `remotion.media`. Both fit the two changes having been made; he has not
  said so. Headless Chrome then failed `fonts.gstatic.com` on a certificate error (Unfinished
  measurement).
- **The rule:** never add a credential to it.

[[0096-unattended-runs-happen-in-a-cloud-session]],
[[0097-push-to-main-refused-by-a-git-hook-the-rest-instruction-only]].

## Owed founder actions

- **The Instagram autopilot (2026-10-24, `feat/instagram-autopilot`,
  [[0127-the-instagram-autopilot]]).** In order:
  1. 0070 pushed and read back (the session, on his instruction "apply migrations if you need to");
     then the merge (the same instruction). Vercel deploys web.
  2. The box: `git pull && pnpm install` and a worker restart, gated on no running job (docs/07
     §11). The tick is ensured at boot. His step.
  3. Optional, before he switches anything on: add hook clips where a page needs more.
  4. `/autopilot` (or the link at the top of `/calendar`):
     - add 3 or more sounds;
     - on each card, pick its characters, videos a day, the demos and the times;
     - switch it on and save.

     It starts with the next 03:00 Israel. Creating the setup is his, never the session's.

  5. The next morning: the calendar shows the day's posts marked "אוטו".
  6. Sentry → Crons: `autopilot-night` exists after the first night. Confirm a missed check-in
     emails him (his ask at approval).
  7. Approve the new Hebrew at PR review: `apps/web/src/lib/autopilot-ui.ts` and the autopilot block
     of `packages/core/src/social-copy.ts`, all DRAFT.

- **Demo names (2026-10-24, `feat/demo-names`,
  [[0125-demos-get-an-optional-name-never-read-by-a-model]]).** The box needs nothing. In order:
  1. ~~Push 0069 before the merge~~ **DONE 2026-10-24** on his instruction, read back before and
     after (verify §RESULTS, the 0069 entry).
  2. ~~The merge of PR #116~~ **DONE** (`4383fd4`).
  3. ~~Approve the strings~~ **APPROVED 2026-10-24** (FOUNDER-REPORTED; 0125 carries the dated line).
  4. ~~Name his Tavnit recordings~~ **DONE**: two, "Service A" and "Service B" (External state).
  5. On his phone: upload a demo in A with a name and see it in the picker and on `/home/demos`;
     rename it; clear it.

- **"גרסה נוספת" (2026-10-22, `feat/next-version-action`,
  [[0124-the-next-version-is-taught-at-the-finished-video]]).** No migration, no box step. In order:
  1. Approve the strings: `NEXT_VERSION_BUTTON` and `nextVersionLine` in
     `apps/web/src/lib/quote-ui.ts`. COPY PENDING FOUNDER REVIEW.
  2. ~~The merge~~ **DONE**: PR #115 (`fc9c1d4`), MEASURED by `git log` 2026-10-23.
  3. On his phone, as a customer: open a finished A video from `/home`, tap גרסה נוספת, and check
     that the character step has the recording in the strip; the same for a C video, which should
     land on the text step.

- **Service B cutaways revised (2026-10-21, `feat/b-cutaway-relayout`,
  [[0122-service-b-clips-before-the-effect-first-cut-at-the-product-mention]]).** No migration, no
  worker change. In order:
  1. Approve the Hebrew strings (the report lists every one): `CUTAWAY_COPY` in
     `apps/web/src/lib/service-b-ui.ts` and the `CutawayPlanError` lines in
     `apps/web/src/lib/api-errors.ts`. COPY PENDING FOUNDER REVIEW. This replaces 0121's string
     approval below.
  2. ~~The merge~~ **DONE 2026-10-21**: PR #113, merged by the session on his instruction ("open the PR and
     merge yourself"). Vercel deploys it; the box needs nothing.
  3. A render of his own with the option on: the draft's first clip on the phrase that names the
     product; move, add or remove one; render.
  4. Not rollback-safe once customers add clips (the old schema cannot read their slots).

- **Service B demo cutaways (2026-10-20, `feat/b-demo-cutaways`, [[0121-service-b-demo-cutaways-and-no-sway]]).**
  0068 is pushed (read back: `cutaway_plans` present, RLS on, 0 policies, ledger 69 rows to 0068).
  MERGED as PR #112 (`c5c85e6`); the box runs it (MEASURED 2026-10-21, above). In order:
  1. Approve the new Hebrew strings: `CUTAWAY_COPY` in `apps/web/src/lib/service-b-ui.ts`, the
     `CutawayPlanError` lines in `apps/web/src/lib/api-errors.ts`, and `bShapeSummary`'s cutaway
     clause in `apps/web/src/lib/quote-ui.ts`. COPY PENDING FOUNDER REVIEW. (Folded into 0122's
     approval above.)
  2. ~~The merge~~ **DONE** (PR #112, `c5c85e6`).
  3. ~~**The box, straight after.**~~ **DONE** (MEASURED 2026-10-21: his render `cbd62014` was
     rendered with its cutaways by `hetzner:heavy`). Until it restarts, it renders a cutaway render
     WITHOUT its cutaways, at full HeyGen price.
     - Gate: `select id, type, status, locked_by, locked_at from jobs where status = 'running';`
       must return no rows.
     - Then `cd ~/AIUGCBackend && git pull && pnpm install && sudo systemctl restart aiugc-worker`.
       No env change; the migration is already in.
  4. ~~The end-to-end render on the box~~ **DONE** (FOUNDER-REPORTED 2026-10-21: he rendered with
     cutaways and likes it; render `cbd62014`). Watch
     for a head-only ad with no sway, and a `cutaway_render_degraded` event if a window was clamped.
  5. ~~A tap-through of the window picker on his real phone~~ **DONE 2026-10-21** by 0122's walk on
     his Pixel 6a (real touches over adb).

- **TTS on Eleven v4 (2026-10-20, `feat/tts-eleven-v4`, [[0119-tts-is-eleven-v4-plain-text]]).** In
  order, each its own OK:
  1. Listen to the preview, `audio_renders` `997a5ec7`, at
     `packages/core/.work/eleven-v4/preview-997a5ec7-v4.mp3` on his machine. Its v3 twin, the same
     script, is `stored/014e98dc.mp3`.
  2. ~~Rule on the 80 ms `duration_ms` overshoot before the merge~~ **DONE 2026-10-20**: he chose the
     clamp, and it is built on the branch (0119 §5,
     [[eleven-v4-alignment-ends-80ms-past-its-audio]]). Still his, not blocking: the 30-agorot TTS
     estimate (the live rate is $0.08 per 1k).
  3. Merge PR #111 on GitHub. The session's merge was refused by its permission check. Vercel
     redeploys, but nothing that speaks changes there.
  4. **The box, straight after.** Gate:
     `select id, type, status, locked_by, locked_at from jobs where status = 'running';` must
     return no rows. Then
     `cd ~/AIUGCBackend && git pull && pnpm install && sudo systemctl restart aiugc-worker`.
     `git log -1 --oneline` must show the merge, and `systemctl is-active aiugc-worker` must print
     `active`. No env change, no migration.
  5. The first preview after it: its `synth_tts` job's `locked_by` reads `hetzner:light` (no local
     worker running), and it sounds like v4.

- **Social posting — PR 4.1, the delivery email (2026-10-17, `feat/tiktok-delivery-email`).** In order,
  each its own OK: 1. the DRAFT strings at PR review — the four inbox places and the time-step
  sentence (`social-copy.ts`, `social-ui.ts`, `social-posting-ui.ts`) and the email's subject and
  body (`deliveryEmail`); 2. the merge (Vercel deploys the copy); 3. **the box:** `cd ~/AIUGCBackend
&& git pull && pnpm install && sudo systemctl restart aiugc-worker` — the sweep runs there; no
  env change, no migration; 4. docs/09 t8 — one TikTok video scheduled a few minutes ahead gives one
  email with the path and a working link, two at once give one (an unfinished video from before the
  deploy, delivered in the last 24 h, rides in the first email); 5. t7 — «צפייה בפוסט» on the
  sandbox's public post; 6. ~~owed while the legal pages are held~~ DONE in the same PR ([[0117-legal-pages-lifted-for-connected-accounts-address-emails]]): `/privacy` names every email and Resend for all of them; read the new text on tavnit.ai/privacy and /terms and change any sentence you do not want.

- **Social posting — PR 4, TikTok (2026-10-16, `feat/tiktok-inbox-posting`, MERGED as PR #107,
  2026-10-17; items 1–8 below are done by his report and the rows — the merge, the pair on Vercel and
  the box, the box restart, the Resend key (a TikTok failure email went from the box), the switch
  (he is admin), the sandbox checks t1–t6 — kept for the record; 9–11 are still his).** In order,
  each its own OK: 1. ~~the DRAFT strings at PR review~~ approved by his merge (marked FINAL in the
  code 2026-10-17; the three inbox lines PR 4.1 rewrites are DRAFT again) — `apps/web/src/lib/social-ui.ts` (the TikTok
  card and its outcome lines), `apps/web/src/lib/social-posting-ui.ts` (the inbox note, the done
  lines, the no-account lines, the pending-cap refusal, the delivered and deferred labels),
  `packages/core/src/social-copy.ts` (TikTok's `quota_exhausted` lines) — final wording of the
  inbox lines after the live run shows where the video lands (his approval §1); 2. ~~the push of
  **0064 and 0065** BEFORE the merge, with their read-backs~~ DONE 2026-10-17 on his instruction
  ([[production-migration-push-log]]); 3. the merge (Vercel deploys); 4. the **sandbox** pair as
  `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` on Vercel Production (redeploy) and in the box's
  `apps/worker/.env` (docs/09 §Runbook: the TikTok app — the no-print proof), then the box pull and
  restart; 5. confirm in TikTok's console: the sandbox's webhook field holds
  `https://tavnit.ai/api/social/tiktok/webhook`, the sandbox shows the tavnit.ai URL property, and
  whether the sandbox has its own key and secret; 6. `RESEND_API_KEY` on the box (still not
  reported) before check (t5); 7. the switch: you are admin, so no SQL is needed for you; name another
  account with docs/09 §The switches; 8. the sandbox live checks (docs/09 checklist PR 4, t1–t6); 9. the review demo recorded in the sandbox (docs/09 §Runbook, the step list); "Submit for review"
  is yours; 10. after the audit: the production pair (docs/09 §Runbook: sandbox → production), then
  `tiktok_posting` to `everyone`; 11. ~~owed while the legal pages are held~~ DONE 2026-10-17 (0117, in PR #108): `/privacy` on TikTok — what Tavnit receives (open_id, display name, avatar, the tokens), why, how to
  disconnect or remove Tavnit in TikTok, and deletion; `/privacy` §9 should also name the cookie
  `aiugc.tiktok_oauth` beside `aiugc.social_oauth`.

- **Delete the old A example pair from storage, when nothing serves it** (0111 §4). Once the
  `-v2` constants are live on Vercel and an hour has passed (the signed links' lifetime), the old
  `assets/samples/a-steps/recording.mp4` and `ad.mp4` are referenced by nothing; they still hold
  the unblurred text. The one delete, his call, not run:
  `supabase.storage.from("assets").remove(["samples/a-steps/recording.mp4", "samples/a-steps/ad.mp4"])`
  (service-role client), or Storage → `assets` → `samples/a-steps` in the dashboard. Since
  2026-10-22 (0123) the `-v2` pair is unreferenced too once the `-v3` constants are live; it holds
  only blurred text, so deleting it is housekeeping.
- **The ₪5 intro offer (2026-10-14, `feat/intro-offer`).** Each its own OK, in order:
  1. ~~the test-org ₪5 page~~ DONE 2026-10-14 (`…/138f5dl/14m9m60/14m9m61/payment/`, redirect to
     localhost);
  2. **finish the test walkthrough on a day the test terminal approves a card** (it declined all
     on 2026-10-14): the approved ₪5 → trial active, the second attempt refused, the continue
     charging the saved card, the two receipts' lines — `packages/core/.work/intro-walk.ts`;
  3. the real-org ₪5 page: fixed price ₪5, its own catalogue, **"קטלוג ללא מע"מ" OFF**, Bit off,
     redirect to the production return route;
  4. ~~OK the 0061/0062 push~~ DONE 2026-10-14 on his instruction ("go ahead and push migrations
     and merge the branch"): read back before and after, ledger 63 rows 0000–0062;
  5. ~~merge~~ DONE 2026-10-14, PR #97 → `d41eae6` (it published the §8 bullet and `UPDATED`
     14.10.2026 with E12(a) still open);
  6. ~~the box (pull, install, restart)~~ DONE 2026-10-14 by the founder; `expire_trials:2026-10-14`
     succeeded on `hetzner:light` at 19:50 UTC (read-only, MEASURED);
  7. ~~on Vercel, `SUMIT_INTRO_PAGE`~~ DONE by 2026-10-15 (MEASURED: the live `/pricing` shows the
     offer); still owed from this step: read the web
     project's function time limit (Fluid on or off) — a continue's worst case is ~95 s, a kill is
     safe (the settle resolves it) but the customer then waits ten minutes;
  8. ~~the switch~~ DONE by 2026-10-15 (MEASURED: `app_config.intro_offer` reads enabled);
  9. **the real ₪5 purchase** — from a NEW customer-role account (new email, new business name: Sumit
     matches returning customers by those, and tavnit.support already holds a subscription, so it is
     refused by design), in a browser profile that has never signed in as admin; a self-purchase,
     kept out of revenue figures;
  10. **the real-terminal continue** — the first real saved-card charge;
  11. the cost read-back after the trial is used: `aiugc costs --business <id> --from <date>` and
      the account's `usage_events`;
  12. **AUTH-03 (CAPTCHA on signup) before any campaign that promotes the offer**;
  13. counsel: legal-review E12 (the §14 material-change question, the cancellation carve-out, the
      30-day expiry of paid credits);
  14. the copy: every line marked COPY PENDING in `lib/plans-ui.ts`, the terms bullet, the receipt
      line `תבנית — מסלול <name>, חודש ראשון`.

- **PostHog every page (2026-10-15, merged as PR #99).** Each its own OK: 1. after the deploy,
  watch one production replay of the landing and of a wizard and confirm the business content shows
  and the email does not; 2. decide separately whether to lengthen any signed-link lifetime,
  knowing that the token rule keeps customer media boxed regardless (0110 §3); 3. counsel: the §14
  email question now covers recording every page and showing business content (legal-review P13,
  P14). Your normal browser carries `aiugc.analytics.off` from your admin sign-in: it will never
  record there, by design.
- **PostHog (2026-10-11, `feat/posthog-web`, merged as PR #92).** Each its own OK, in order: 1. at PR review, the
  Hebrew (the notice line, two wordings offered, and every `/privacy` sentence) and the planning
  defaults to strike; 2. in PostHog's dashboard (yours alone): session replay ON (nothing records
  without it), network capture OFF, console log capture OFF, "Discard client IP data" ON, and
  authorized domains limited to `tavnit.ai` if offered; sign the DPA (self-serve on every plan,
  per PostHog's docs) — legal-review P13; 3. tell the session which settings you turned on, to be
  recorded above as FOUNDER-REPORTED; 4. merge; 5. on Vercel, `NEXT_PUBLIC_POSTHOG_KEY` on the web
  project, Production (and Preview if you want the preview check to send), then a redeploy — the key
  is inlined at build time; 6. the preview check: type a known phrase into `/start`, open a wizard
  with a known business name, then find the session in PostHog and confirm neither appears and the
  interface copy does; 7. counsel (legal-review P13, P14): the transfer basis, the notice-only
  question for visitors with no account, and whether this is a §14 material change needing an email
  to existing accounts.
- **Instagram connect (2026-10-12, `feat/instagram-connect-page-steps`).** Each its own OK: 1. the
  DRAFT Hebrew strings in `apps/web/src/lib/social-ui.ts` (the five outcome lines merged in #93,
  and this branch's Page-first pre-screen) at PR review, then merge; 2. the Vercel runtime log lines
  for `GET /api/social/instagram/callback` at his 2026-10-12 morning Edit-settings attempt — the
  message text and the **names** of the query parameters, never their values — to confirm the red
  error's cause (still REASONED); 3. what's left of docs/09's checks: (u) the disconnect confirm's
  count (tokens null MEASURED), (v) a return address; the one-window checks (q)–(s) are DONE
  ([[instagram-connect-live-run-2026-10-12]]); 4. ~~his ruling~~ DONE 2026-10-12 (0106).

- **Social posting — four UI fixes (2026-10-13, `fix/social-posting-ui`).** 1. the review and the
  merge (no new string beyond his two; no env, no migration, no box restart); 2. the checks on
  tavnit.ai in the task report, after Vercel deploys.

- **Social posting — PR 3 (2026-10-13, `feat/social-posting-schedule`, MERGED as #95).** Items 1
  and 2 are DONE (the merge); 3–6 are not reported. Each its own OK: 1. the
  strings at PR review — `apps/web/src/lib/social-posting-ui.ts` (Appendix A; DRAFT marks the new
  ones, among them the AI tick and its hint, the גוש טקסט mix line, the refusals), core's
  `social-copy.ts` (the email's subject and body, DRAFT) and the landing's `#proof` line (DRAFT); 2. the merge (Vercel deploys Production itself); 3. the box on `origin/main` after the merge (pull,
  install, restart); 4. a **sending-only** Resend key restricted to `tavnit.ai`, placed as
  `RESEND_API_KEY` in the box's `apps/worker/.env` only (docs/09 §Env names: the steps and the
  no-print proof) — before check (o), not before the others; 5. the live checks in 0107's order
  (docs/09 checklist PR 3: (k) a הוק + דמו with a trending sound now, logged-out look; (l) two
  accounts a few minutes ahead; (l2) a גוש טקסט post for the levels; (n) change then cancel; (v)
  the way back to the video; (u) a disconnect's count; (w) the Page token on `ig_audio`, report
  only — it needs `META_APP_SECRET`, which only Vercel and the box hold, so it did not run from this
  machine; (o) the forced failure last, the notice and the email); 6. owed while the legal pages are
  held, not edited: `/privacy`'s sentence on which emails Tavnit sends (it names Resend for the two
  auth emails only) and the text on connected accounts.

- **Social posting — PR 2 (2026-10-11, `feat/social-posting-connect`).** Each its own OK: 1. the
  PR 2 strings (Appendix A's connect lines plus the DRAFT singular forms in
  `apps/web/src/lib/social-ui.ts`) at PR review; 2. ~~the ONE `db push` of **0060**~~ DONE 2026-10-11
  on his instruction, read back before and after ([[production-migration-push-log]]); 3. placing `SOCIAL_TOKEN_KEY` (fingerprint 047bda40) on Vercel
  Production, the box and `apps/web/.env.local`, and `META_APP_ID` / `META_APP_SECRET` (and
  `META_LOGIN_CONFIG_ID` if the dashboard gives one) per docs/09 §Env names; 4. in the Meta app
  (yours alone), docs/09 runbook A–C: the configuration id, the redirect URI(s) with Check URI, the
  deletion URL, removing `instagram_manage_messages`; 5. the live connect (docs/09 checklist a–i:
  connect, add another, disconnect, a return address) — connect and add another RUN 2026-10-12
  (FOUNDER-REPORTED, the one-window entry above), disconnect and the return address moved to
  checklist (u), (v); 6. later, for review: a portfolio, Business
  Verification, access verification, a non-admin reviewer account named in the switch (runbook E–I); 7. ~~the privacy text on connected accounts and deletion~~ written 2026-10-17 ([[0117-legal-pages-lifted-for-connected-accounts-address-emails]]); entering the Data Deletion Request URL in the Meta app (docs/09 runbook B) is still yours, and the page's sentence on it is conditional until you do.

- **Social posting (2026-10-11, `feat/social-posting-core` and the PRs after it).** In order, each
  its own OK (his §4): 1. the Hebrew strings of the plan's Appendix A — approve or change before PR 3
  merges; 2. ~~the ONE `db push` of 0057–0059 to production~~ DONE 2026-10-11 on his approval
  ("push 0057–0059, I approve this one push"), after PR #89 merged; read back before and after
  ([[production-migration-push-log]]); 3. the env names — `META_APP_ID`,
  `META_APP_SECRET`, `SOCIAL_TOKEN_KEY` (and `META_LOGIN_CONFIG_ID` only if the dashboard gives
  Facebook Login a configuration) into `apps/web/.env.local` and Vercel Production;
  `META_APP_SECRET`, `SOCIAL_TOKEN_KEY` into the box's `apps/worker/.env`; 4. in the Meta app
  (yours alone): the localhost and production redirect URIs, the Privacy URL, the User Data
  Deletion URL, the icon, the roles; 5. Facebook Pages for your other two Instagram accounts; 6. ~~the live-test checklist once PR 3 exists (box on the branch, `DRY_RUN=0` locally)~~
  superseded 2026-10-12: the box on `origin/main` after the merge, on tavnit.ai (0102 planning
  default), in 0107's order — the PR 3 entry above; 7. Meta's App Review and Business Verification after the web PRs are
  live, then the app to Live and `social_posting` to `everyone`; 8. ~~the TikTok developer app and
  sandbox, when you want PR 4~~ DONE 2026-10-16 (FOUNDER-REPORTED; External state) — PR 4 is the entry above.

- **Service C phase 2 (2026-10-09, `feat/service-c-phase-2`).** In order:
  1. ~~The ONE push of 0053–0056~~ DONE 2026-10-09 on his approval ("push 0053–0056, I approve
     this one push"), before the merge.
  2. ~~The read-back~~ DONE 2026-10-09: `readback-0053-0056.ts` and `verify-credit-costs.ts` both
     clean (verify §RESULTS, the 2026-10-09 entry).
  3. The box on `origin/main` (≥ #80, which carries the `c` render handler; this also lands the
     owed #82 restart): pull + install + restart once no job is running. Phase 2 adds no worker code.
  4. The merge: his instruction of 2026-10-09 ("then merge"), with the Hebrew strings of the
     report taken as approved. Vercel deploys web and admin.
  5. Admin `/text-blocks`: assign each existing clip to a character. For a character used only
     here, create it with no voice and upload a **preview** image. Until then no customer sees C.
     _(MEASURED 2026-10-10, read-only: production has 2 active `text_block_clips`, both with a
     character, and `GET /api/personas?withTextBlocks=1` as a customer lists 2 characters. So the
     picker is not empty; whether he counts this step done is his to say.)_
  6. Smoke test as a customer with credits: `/home/c/new` end to end, 25 credits debited.

- **Home example clips + גוש טקסט on the landing (2026-10-10, `feat/home-previews-landing-c`).**
  In order:
  1. ~~Approve the Hebrew strings~~ DONE 2026-10-10 (S4), with the footer and root description
     added (S5).
  2. The signed-in walk on your own account and window: look at the reshaped tiles (S6), hover each
     card, then click one; check `main.scrollHeight - main.clientHeight` on `/home` (121 expected at
     717×621 with one render, about 137 with your long strip).
  3. ~~Open the PR and merge~~ DONE 2026-10-10: #87 by him, #88 on his instruction. Vercel deploys
     web; no migration, no box step.

- **Unattended cloud runs (2026-10-08, `tooling/unattended-cloud-runs`).** In order:
  1. ~~Merge the PR~~ MERGED as PR #84 (`1b709ff`, by `git log` 2026-10-09). It changes no product code, so Vercel's redeploy changes nothing customers see.
  2. In claude.ai/code, edit `tavnit-unattended`:
     - paste the setup script from `docs/unattended/runbook.md` (ffmpeg and headless Chrome's
       libraries);
     - set Network access to Custom with `remotion.media` added and the default list ticked;
     - keep `PAID_CHECK_ANTHROPIC_KEY` as the only variable.
  3. Once: run `$env:CLAUDECODE` in the desktop app's Terminal panel. It says whether a push typed
     there by Claude is covered by the pre-push hook. Record the answer here.
  4. ~~The first trial run~~ RAN 2026-10-09 (below). The checklist is in its `log.md`; items 5, 11
     and 12 are his to report.

- **The first unattended run's branch, `claude/inventory-first-load-retry-kv24q9`, PR #85
  (2026-10-09).** In order:
  1. Run the Remotion suite locally:
     `pnpm --filter @aiugc/remotion exec vitest run --fileParallelism=false`. **The PR must not be
     merged before it passes** (his ruling, 2026-10-09). The cloud run could not run it green
     (Unfinished measurement).
  2. The List 2 checks in a browser. Block the inventory request in DevTools: the steps screen
     shows the error line with «נסו שוב». Unblock and click: the list loads. Then the same at
     375 px. The panel shows only on a ready, unapproved plan.
  3. Merge. Vercel deploys web; no migration, no box step.

- **The switch to `claude-sonnet-5-5` (2026-10-08, `feat/sonnet-5-5`).** In order:
  1. ~~Merge the PR~~ MERGED as PR #82 (`7f7489f`, 2026-10-08 06:05 +0300). Vercel redeploys web
     and admin: hook lines, the B script, hook text, the classifier and גוש טקסט run on 5.5 from
     that deploy.
  2. No env change: the model is a constant.
  3. The box: when `select id, type, status from jobs where status = 'running';` is empty, run
     `cd ~/AIUGCBackend && git pull && pnpm install && sudo systemctl restart aiugc-worker`. Then
     check that `git log -1 --oneline` is the merge and `systemctl is-active aiugc-worker` says
     active. Record the date here. The analysis check passed, so 0095's gate is open. The pull also
     ships PRs #79–#81 if the box has not taken them: the footage backfill and "no approving or
     rendering between merge and restart" below still apply.
  4. Optional: the Console's rate limits for Sonnet 5.5, which has its own pool.

- **Service C phase 1 (2026-10-07).** Done the same day on his rulings:
  - the push of 0051 + 0052;
  - the fixture run, 64 agorot, whose texts are in `packages/core/.work/text-block/fixture-texts.md`;
  - the clip and the screenshots, attached and rendered;
  - the cap, 400.

  Still owed, in order:
  1. Read the texts and the two renders in `packages/core/.work/text-block/renders/`.
  2. ~~Merge `feat/service-c-text-block`~~ MERGED as PR #80 (`59a2ff1`).
  3. Pull and restart the box together, once no job is running.
  4. Rule on the prompt findings in [[0091-text-block-texts-ten-skeletons-truth-rules-free-edit]]
     (amended) and on clips 3–60 s in [[0090-text-block-format-clip-once-with-its-own-sound]].

- **~~Say whether the paid check of `plan_demo_steps@v16` may run~~ DONE 2026-10-02:** he said
  yes; it ran and passed ([[v16-paid-check-2026-10-02]]).
- **~~Merge PR #79 (`feat/steps-fixed-2s-clips`)~~ MERGED (`2a503a4` on `origin/main`, by
  `git log` 2026-10-07).** Still owed after it: **box `git pull` AND restart together**, and do not approve or render a
  Service A plan in between.
- **~~Say whether the inventory list should get a retry button on a failed first load~~ ANSWERED
  2026-10-09:** yes, by the first unattended run's spec. FIXED on
  `claude/inventory-first-load-retry-kv24q9`, not merged
  ([[the-inventory-first-load-failure-has-no-retry-button]]). He also said to leave both copy
  points alone: the error line's «…רעננו את העמוד ונסו שוב.» above the new in-place retry, and
  step-plan's «נסה שוב» (singular) beside the other retries' «נסו שוב».
- ~~**Run the footage backfill on the box, report first**~~ **NOT NEEDED — MEASURED 2026-10-20:**
  every ready analysis in production has its `demo_analysis_footage` row: the founder's 16 and the
  4 of customer-owned businesses (read-only join of `demo_analyses` ready ⟕ `demo_analysis_footage`).
  Who wrote the rows for the older analyses is not recorded here.
- **~~Put the worker box on the merge of PR #78~~ DONE 2026-10-02** (founder-reported; the first
  footage row was read back the same day). **Still owed from it:** the `waitedMs` of that analysis,
  which is only in the box log ("analysis: footage instants").

- **Rotate the credentials found burned on 2026-09-29** ([[credential-echo-incidents]]). By key
  name only: the `DATABASE_URL` password, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`,
  `ELEVENLABS_API_KEY`, `FAL_KEY` and `HEYGEN_API_KEY` each appear in 2–3 local session
  transcripts; the founder’s app-account password was printed by a research subagent that day.
  CLAUDE.md says each has to be rotated; the order and timing are the founder’s. A rotated key
  changes wherever it is set (the `.env` files, Vercel, the worker box).
- **Put the worker box on the 0064 commit — `git pull` AND restart** (2026-09-28,
  [[0064-the-inventory-is-one-tier]]). The v2 grouping prompt is read per call, so a pull alone
  makes the box send v2's text over the OLD quality pool; the pool change and the `screenKind`
  field need the restart. The web half ships with Vercel. **Regrouping existing analyses under v2
  is NOT done and is the founder's call** — each is a paid call that overwrites a computed-once
  column; until then their other readable moments are placed by nearest neighbour.
- **~~Merge `fix/legibility-gate-unreadable-only`~~ MERGED as PR #72 (`67448de`); put the box on
  it — `git pull`, `pnpm install`, restart, `git log -1`** (2026-10-01,
  [[0069-the-refilm-gate-counts-unreadable-only]], `docs/07-worker-box.md` §11). The gate runs only in the worker, so the Vercel deploy alone changes
  nothing. Gate the restart on no `running` jobs. Then re-upload the demo that `e4be3bce` rejected.
  (MEASURED 2026-10-01: the merge is done — PR #72. **The box half is done too**: the re-upload
  `4113d37d` passed the new gate at 02:51 UTC, at 0.862 `low`. See "The demo-analysis refilm
  gate" above.)
- **~~Review and merge `fix/steps-plan-ladder`~~ MERGED as PR #75 (`a21da11`); on the box
  (founder-reported).** It did not stop the failure: the next live plan failed on the new wording.
- **~~Review `fix/steps-plan-repair`, then say go for the push and the PR~~ MERGED as PR #76
  (`826399e`), tested by the founder (founder-reported), on the box** (2026-10-01,
  [[0074-unpickable-moments-and-the-last-round-repair]]).
  - MEASURED: the first plan after it, `d3864d05` on the new upload `6a997717`, carries `+pickable`
    and two calls of `retry_violations`.
  - The retry this item asked for ran on the new upload, not on `24e348bf` or `28161296`.
- **~~Review, merge and deploy `feat/steps-end-on-screen-change`~~ MERGED as PR #74, deployed and on
  the box** (2026-10-01, [[0072-step-cap-no-padding-cut-early]]; the deploy and the box restart are
  founder-reported).
  - **Still to decide, two paid or data steps:**
    - a live `aiugc plan regress` (CARRIED estimate ~₪0.50 per fixture, the six-word file's own figure; five files) to see v15's
      behaviour;
    - whether to re-save or backfill the stored plans whose released renders jump: ca8d5b72,
      3799ef3b, bc429f16, ba616a37, f26f1fd1, e47f3ffb. Untouched, they render exactly as approved.
- **Take the Sumit checkout live — DONE 2026-09-21 except step 8.** Kept with a status per step,
  because the order is the useful part and because a rebuild would follow it again:
  1. ~~Merge and deploy~~ **DONE** — PR #52, `4100cc7`, on Vercel and on the box.
  2. ~~One fixed-price product and payment page per plan in the REAL org, return URL
     `https://tavnit.ai/api/billing/sumit/return`, card SAVED, "לקוח נפרד לכל רכישה" OFF~~ —
     **DONE for התחלה, proven by the purchase**; מתקדם and פרימיום are founder-reported only and
     have never been paid through ([[sumit-real-org-configuration]]).
  3. **Bit off** — the catalogue screen showed no Bit option at all, consistent with the module not
     being installed. Not the same as confirming it is off at the clearing level: OPEN.
  4. **Delete any recurring products** in the real org — renewal scheduling is ours; a Sumit-run
     recurring charge would double-bill. UNVERIFIED, nobody has confirmed there are none.
  5. ~~Set `SUMIT_COMPANY_ID`, `SUMIT_API_KEY` and `SUMIT_CHECKOUT_PAGES` on Vercel and in
     `apps/worker/.env`~~ — **DONE**, after three false starts on the value FORMAT
     ([[env-values-differ-between-the-box-and-vercel]]). Never in a chat, never in a commit.
  6. ~~Restart the worker box~~ — **DONE**, `git log -1` = `4100cc7`.
  7. ~~Make ONE real purchase on the cheapest plan~~ — **DONE**, ₪150 התחלה, and it exposed the
     defect this day is named for ([[first-real-purchase-2026-09-21]],
     [[sumit-return-failure-invited-a-second-payment]]). **Not refunded** — by decision, and a new
     terminal has no Upay balance to refund from anyway (queue item 0.4).
  8. **Announce prices — STILL OPEN.** Its named gate, `fix/sumit-return-unconfirmed` merged and
     live on the web, is **met**. The merge is MEASURED (PR #53, an ancestor of `origin/main`
     `d57b60a`), and serving on Vercel production is FOUNDER-REPORTED 2026-10-01. Nothing else here
     moves: steps 3 and 4 above are still open, and **do not touch `developers/testterminal` on the
     real org.** The prices themselves stand
     ([[0068-prices-stand-no-free-tier-trials-by-hand]]).
- **Drop the last two landing stills** — `hookStudioShot` (step 3, a hook-studio screenshot) and
  `instagramShot` (`#proof`). Every clip slot was filled 2026-09-25 — `demoBefore`/`demoAfter`,
  the four hook clips, the presenter — from the founder's own files, web-encoded into
  `apps/web/public/landing/` (174 MB of sources → 11 MB). The same demo pair now also fills the
  A-wizard demo step's example (`assets/samples/a-steps/`, which was empty on this project) — the
  recording there as its own 720p encode, since the landing's 540p one smears on-screen text. Step 4
  is one frame of the finished ad now, not four tiles, and `demoAfter` carries its own burned hook
  line — the reverse of the rule [[0061-landing-positioning-two-services-no-results-claims]]
  recorded. Clips fetch only when scrolled near (`components/landing/landing-video.tsx`), and the
  web middleware no longer runs on `.mp4`. Filenames, the swap and the encode recipe:
  `apps/web/public/landing/README.md`.
- **Set the presenter's Instagram URL** in `apps/web/src/lib/landing-media.ts` — `instagramUrl` is
  `null`, which hides the link. The name is set: `presenterName` is `"נועה"` (founder, 2026-09-25),
  and the `#proof` copy is written feminine, which fits her.
  [[0061-landing-positioning-two-services-no-results-claims]].
- ~~**Update the address on the עוסק פטור registration**~~ — superseded 2026-10-17 ([[0117-legal-pages-lifted-for-connected-accounts-address-emails]]): the pages now print the address he says is on the registration (ת"ד 929, כאבול 2496300), so nothing is owed on the registration by that count (UNVERIFIED: nobody has seen the file). Open instead: whether a P.O. box meets the acquirer's reachable-operator requirement ([[0057-the-upay-site-requirements-are-met-by-reorganising-not-re-deciding]]), and that receipts print the same address.
- **Send the reply email to UPay** confirming each site requirement and where it is satisfied. The
  Hebrew draft was handed over with the change that implemented them.
- ~~**Restart the worker box**~~ — done 2026-09-21 with the Sumit env; the box reports `4100cc7`,
  which contains the renewal change, the label rule and the `רגע` ban fix (ancestry verified here).
  All three are live.
- ~~**Create the Sumit test business**~~ — done; the adapter was built and walked through on it
  2026-09-21 ([[sumit-test-org-configuration]]).
- **Owed from the 2026-09-21 go-live** — eight, none of which this repo can answer:
  1. **Compare the return URL on מתקדם and פרימיום to התחלה's.** Only התחלה has ever been paid
     through; a wrong or empty return URL on the other two is invisible until someone buys.
  2. **Confirm the catalogue settings on all three** — no quantity control and no add-product arrow
     on the rendered pages, single-item limit on, wallets off, קטלוג ללא מע"מ off.
  3. **Confirm the Bit module is not installed and that no recurring products exist** in the real
     org. Both are inferred, neither observed.
  4. **Set the notification inbox** on the global payment-page settings — it was empty.
  5. **Ask Sumit what `Obligo 57,000` measures.** It is in `listquotas` and in no help article.
  6. **Say whether 3DS appeared** during the ₪150 purchase, and what the receipt shows.
  7. **Tell the accountant the ₪150 receipt is a self-purchase.** Refunding is optional and only
     possible once the Upay balance exceeds ₪150.
  8. **Watch the first real renewal and the first real upgrade.** Both take
     `/billing/payments/charge/`, which has never run against the live terminal (queue item 0.15);
     the renewal failure mode to watch for is `recurring_charge_failed`.
- **Decide the emoji font subset** (conversation decision 9) — queue item 4 is blocked on it.
- Vendor DPA / reg. 3 undertakings (Anthropic, ElevenLabs, HeyGen, fal.ai, Sentry, Resend), the
  ElevenLabs voice licence question, Sentry's data region, the עוסק פטור ceiling on gov.il. Full list:
  the closing section of `docs/legal-review.md`.

## Open decisions

**Demo cutaways: a cut on a word start, or no cutaways (2026-10-20, his call).** 3 of his 15
distinct real B audios have a 2.5–2.8 s caption line exactly where a cut has to land, so no
chunk-start layout exists. The build cuts on a word start inside the line for those, keeping the
first cut on his chunk rule ([[0121-service-b-demo-cutaways-and-no-sway]]). The alternative is no
cutaways for those ads. CLAUDE.md's approved line says "caption-line boundaries". Settling it
changes one tier list in `cutaway-structure.ts`.

**Demo cutaways: the draft by words (open, not urgent).** The matcher scored 63% against demo order's
43% on his demos, under the bar ([[cutaway-matcher-hit-rate-2026-10-20]]). The code is at `aff4abd`
if scripts that name screens (or a v2 prompt) make it worth a second test.

**Service C's two planning defaults (2026-10-07, his call):** the hard cap on a text block is
**400** code points, not the prompt's proposed 300, because his own `instead` example is 396
and he asked for the examples verbatim; and a clip registers at **3–60 s, ≤100 MB**. Both are
marked PLANNING DEFAULT in [[0090-text-block-format-clip-once-with-its-own-sound]]; a ruling
changes one constant each (`TEXT_BLOCK_MAX_CHARS`, `TEXT_BLOCK_DURATION`).

~~**What happens to Service B itself (2026-10-07): park the revamp, add backgrounds, or leave it
as it is.**~~ **RULED 2026-10-20** ([[0120-service-b-look-propped-phone-and-opt-in-demo-cutaways]]):
B stays, revamped by a propped-phone look and opt-in demo cutaways. Decided, not yet built. The
overlay and re-sync routes stay dead ([[0092-service-b-revamp-tests-overlay-and-resync-routes-are-dead]]),
and locked #12 stays locked.

**~~What the next task does with the instants~~ RULED 2026-10-02:** clips are placed from them,
calm preferred, the best-fitting one otherwise ([[0084-clips-are-placed-from-the-footage-instants]]).
**~~Whether an in-place swap is a screen change~~ CLOSED** by the same ruling: nothing in the rule
is called a screen.

**Whether a generated plan should be held to more than a request to prefer calm clips
(2026-10-02).** Today the model is told which moments are calm and which probably show two pages,
and asked to prefer the first and avoid the second; code does not enforce it. **RULED 2026-10-02
after the paid check: "Calm stays a request for now. I will watch real drafts first."** Open again
when he has. **MEASURED by the
paid check, one run on each of five takes:** 7 of its 24 picks were calm where 0 to 12 calm clips
were on offer, 4 carried the amber line, and 3 crossed a real change (all 3 amber). Both runs on
the 84 s recording picked the same amber moment at 13.6 s with a calm one on offer in the same
segment ([[v16-paid-check-2026-10-02]]). His call.

**Two kinds of footage the detector has never seen:** a clean screen recording and a phone-app
demo. One of each from the founder, scored free, before anything relies on the instants
([[footage-screen-changes-2026-10-02]]).

**Housekeeping, unresolved: `decisions/` has two 0046s, two 0047s, two 0049s and two 0059s** —
eight notes, four numbers, from concurrent sessions each taking "the next free number" (the 0059
pair, `emoji-in-burned-text…` and `the-wait-clock…`, was missing from this line until 2026-10-01).
The same race nearly happened again on 2026-10-01: the unmerged `feat/steps-end-on-screen-change`
holds 0070–0072, so the hook-colour note took **0073** rather than reuse 0070. Nothing is lost (slugs are
distinct, every inbound link uses the full filename), but `[[0047]]` is ambiguous. 0050, 0056–0058 and
0059 were taken **above** the highest number rather than filling a gap, because renumbering a
published note breaks the links pointing at it. Renumber or leave it — a founder call.

- **Three open items of the fixed 2 s step — OPEN, 2026-10-01, the founder's call**
  ([[0076-every-step-is-a-fixed-2s-window-inside-its-screen]]):
  - screens shorter than 2 s;
  - caption length at 2 s;
  - what counts as "its screen".

  The facts for them are in [[screen-spans-from-the-footage-2026-10-01]].

- **How a trial user is told about a hand grant — OPEN, 2026-10-01, the founder's call.** `/privacy`
  promises operational email only, and a grant notice is not on its list unless it answers
  something the person wrote. [[0068-prices-stand-no-free-tier-trials-by-hand]] §3. The free-tier
  question itself reopens when there is trial data (do trial users pay?), not before.
- **Three questions from the slim-CLAUDE.md branch — OPEN, 2026-09-29.** (1) Does the migration
  gate's "anything that writes to the database" cover CLI, worker and local-web runs that write
  production rows, or only schema/ledger/ad-hoc SQL writes? (2) What is the report's last line when
  a task stops before it pushes (dirty tree, work not on `origin/main`, branch mismatch)? CLAUDE.md
  requires `Branch: <name>` and says nothing for that case. (3) Should CLAUDE.md forbid agents from
  reading `.env*` files and session transcripts, grepping tracked files only
  ([[credential-echo-incidents]])? All three are the founder's to rule.
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
  ([[0004-service-b-config-is-provisional]]). FOUNDER-REPORTED 2026-10-20: he read it as `1080p` in
  production.

## Unfinished measurement

- **The first unattended cloud run RAN 2026-10-09.** The session's own observations are
  `docs/unattended/runs/2026-10-09-inventory-first-load-retry/log.md`, §First-run checklist (items
  1–4 and 6–10). MEASURED there:
  - **The pre-push hook loads in the cloud.** The SessionStart line said cloud mode, and `--check`
    passed.
  - **`gh api user` is his own account** (`muhammadtaha211`, type User), not an app.
  - **`gh api …/pulls` opens the PR** (REST): PR #85, authored as him.
  - **`spec-reviewer` loads as its own agent type in the cloud.** It ran the review round (CLEAN on
    the first round) and edited nothing; its tool list (Read, Grep, Glob) was read from the agent
    listing.
  - **The gate is 6 of 7, not green.** Lint, typecheck, core (995), worker, web (574) and admin
    pass. The remotion suite's `frame-delivery.test.ts` fails twice the same way: Chrome Headless
    Shell downloads in full from `remotion.media`, then rejects the composition's Heebo fonts from
    `fonts.gstatic.com` with `net::ERR_CERT_AUTHORITY_INVALID`.
    - **What was checked:** `packages/` is identical to main. `curl` through the proxy fetches the
      same font (HTTP 200) with Google's own certificate, issuer Google Trust Services WR2. The
      proxy's two CAs are in `~/.pki/nssdb`, trusted as CAs.
    - **What was not found:** which certificate headless Chrome is shown, and why. Running the
      binary directly timed out without an answer.
    - **What was not done, by his ruling:** nothing under `packages/` changed, the environment was
      not touched, and no certificate workaround was tried.
  - **Still his:** items 5, 11 and 12.

- **The detector on the box (2026-10-02).** MEASURED on one file: the box's 61 instants for the
  84 s recording match this machine's within one frame
  ([[box-and-local-instants-agree-2026-10-02]]). The other six files are unmeasured until the
  backfill runs; its report compares rows that share a file.
- **`plan_demo_steps@v16` with the model (2026-10-02).** Measured once per timeline
  ([[v16-paid-check-2026-10-02]]). Unmeasured: the spread between runs, and which rules the eight
  violating first calls broke (the script kept counts, not text).
- **Label agreement between runs** was never measured: no variant was worth repeating
  ([[label-call-test-2026-10-02]]).
- **Whether the footage decode delays an analysis on the box (2026-10-02).** It runs beside the
  vision calls and is reasoned to finish under them; each analysis logs `waitedMs`
  ("analysis: footage instants"). Read it off the box's log after the first real analysis.

- **Cluster spans on the box — not run.**
  - Re-running `frameHashes` → `clusterStates` on the box should reproduce every analysis's
    clusters exactly. That is REASONED from the box giving identical kept sets for every re-upload
    of a file.
  - The check is mechanical: the recomputed kept list must equal the job's `resumeKey`.
  - Off the box it does not reproduce ([[analysis-clustering-does-not-reproduce-across-machines]]).
  - Needed only if 0076 is built on stored cluster bounds rather than the footage
    ([[screen-spans-from-the-footage-2026-10-01]]).
  - **2026-10-02:** 0076 was built on the footage instants, not the bounds. The backfill
    (`aiugc demo footage-backfill`) is this check, per analysis, and writes only where it holds.

- **No cold render measured on the box** — one including the ~92 MB Chrome Headless Shell download.
  Matters only if the box is rebuilt from scratch rather than from a snapshot.
- **What Supabase does with a provider rejection** once Resend's 100/day is spent — reasoned from two
  published limits, not observed.
- **This container cannot run the full test gate.** (Written of an earlier cloud container. The
  2026-10-09 `tavnit-unattended` run had ffmpeg and a working `remotion.media` download; its one
  red test is the fonts certificate above.) `ffmpeg` missing (5 core suites fail `spawn ffmpeg
ENOENT`) and `remotion.media` 403s for the Chromium Headless Shell (1 remotion test). Environment
  gaps, not repo failures; a session reporting "gate green" from here is reporting 4 of 5 suites.
  It also starts with **no `node_modules`** — `pnpm install --frozen-lockfile` takes ~7s and is worth
  running before anything else, since prettier and every dependency read depends on it.
- **The worst-case analysis is unmeasured.** ~53 states is one 90s demo; a denser one could approach
  the 80-state cap and add a seventh batch.
- **One session refreshed twice by the middleware 14s apart, both 200** — `2ce072ce…` at 11:31:56
  and 11:32:10 UTC, 2026-09-22, in queue item 15's log exports. Inconsistent with the config as
  written (`supabase/config.toml:165` `jwt_expiry = 3600`; `:171`/`:174` rotation with a 10s reuse
  interval): hosted settings differing from the file, or a pass-through `Set-Cookie` that did not
  stick — though that branch predicts a failed second call, not a 200. Not investigated.

---

## How this file is kept

Handovers are retired ([[0066-branch-per-task-and-no-handovers]]). Decisions arrive in task prompts
and are recorded by the task that receives them; every task updates this file at its end, in place
(`git log --follow` is the history), marking what it could not re-verify and deleting what is
finished or has graduated into a vault note.
