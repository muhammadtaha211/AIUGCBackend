---
type: state
status: current
updated: 2026-10-09
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

**Service C phase 2, the customer wizard: BUILT 2026-10-09 on `feat/service-c-phase-2`, not merged.
Migrations 0053–0056 are WRITTEN, NOT PUSHED; the dry run lists exactly those four. Gate all
green (lint, typecheck, remotion 97, core 1038, worker 7, web 604, admin 71).**

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
Service B tests and his rulings; what happens to Service B itself is OPEN).

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
`17.09.2026` and is load-bearing — both /terms' date and the string checkout writes into
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
box runs it.** Founder-reported: Resend is on a paid plan; an
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

Two axes. **Money** (item 0) and **pipeline** (items 1–7, all from the 2026-09-18 diagnosis), then
the older launch items. Item 0 no longer outranks everything the way it did — billing exists and has
taken a real payment — but what is left of it is still the part that decides whether the next
payment is kept.

**Service C phase 2 — BUILT 2026-10-09** on `feat/service-c-phase-2`
([[0099-service-c-phase-2-opens-to-customers]]); its push, merge and go-live are under "Owed
founder actions". The landing, `/pricing` and the legal pages stay as they are (his ruling 10).

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
callers (`plan_demo_steps`, `group_analysis_states`, `copy.ts`/`tts.ts`) still go through
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

**Supabase.** Project `hyaqydcmwbnbaiqqufow`, `eu-central-1` (Frankfurt), Pro, Micro compute.
**Migrations 0000–0049 applied, ledger clean at 50 rows, no gaps, nothing pending** — MEASURED
2026-10-01 right after the founder-authorized 0049 push, read-only against
`supabase_migrations.schema_migrations` (count 50, first `0000`, last `0049`) and by
`migration list` (0000–0049 local = remote). 0049's file lives on `feat/hook-text-color` until the
merge, so `origin/main` holds 49 files against 50 ledger rows meanwhile — expected, not drift
([[production-migration-push-log]]). The earlier 49-row line corrected a stale "0000–0047 / 48 rows" here;
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

- **Service C phase 2 (2026-10-09, `feat/service-c-phase-2`).** In order:
  1. Say yes to the ONE push of 0053–0056 (the dry run lists exactly those). The BEFORE read-back
     is in the task report.
  2. After the push: `apps/cli/node_modules/.bin/tsx packages/core/.work/readback-0053-0056.ts`
     and `apps/cli/node_modules/.bin/tsx packages/core/scripts/verify-credit-costs.ts` on the
     branch (main's copy of the verify script FAILS its key count between push and merge — expected).
  3. The box on `origin/main` (≥ #80, which carries the `c` render handler; this also lands the
     owed #82 restart): pull + install + restart once no job is running. Phase 2 adds no worker code.
  4. Approve the new Hebrew strings (the report's table), then merge. Vercel deploys web and admin.
  5. Admin `/text-blocks`: assign each existing clip to a character. For a character used only
     here, create it with no voice and upload a **preview** image. Until then no customer sees C.
  6. Smoke test as a customer with credits: `/home/c/new` end to end, 25 credits debited.

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
- **Run the footage backfill on the box, report first** (`docs/07-worker-box.md` §15, 2026-10-02).
  Free; `--write` inserts at most one row per ready analysis without one (15 today). Until then
  those analyses have no calm clip.
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
- **Update the address on the עוסק פטור registration** — still כאבול while every public page says
  ברזיל 14, תל אביב. **UNVERIFIED**: he said he is doing it; nobody has seen the file
  ([[0058-the-operator-address-is-a-tel-aviv-street-address]]).
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

**Service C's two planning defaults (2026-10-07, his call):** the hard cap on a text block is
**400** code points, not the prompt's proposed 300, because his own `instead` example is 396
and he asked for the examples verbatim; and a clip registers at **3–60 s, ≤100 MB**. Both are
marked PLANNING DEFAULT in [[0090-text-block-format-clip-once-with-its-own-sound]]; a ruling
changes one constant each (`TEXT_BLOCK_MAX_CHARS`, `TEXT_BLOCK_DURATION`).

**What happens to Service B itself (2026-10-07): park the revamp, add backgrounds, or leave it
as it is.** Open in [[0092-service-b-revamp-tests-overlay-and-resync-routes-are-dead]]; the
overlay and re-sync routes are dead by his ruling, locked #12 stays locked.

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
  ([[0004-service-b-config-is-provisional]]).

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
