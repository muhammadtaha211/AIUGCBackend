---
type: decision
status: verified
verified: 2026-09-28
method: "Founder in chat, 2026-09-28, relayed verbatim in the task brief that built it: no moment is labelled less fitting, because 'the AI could get it wrong and label an important moment as less fitting.' Code read and built at 577272d (branch inventory-one-tier). The fixture line below is MEASURED-ON-FIXTURE 2026-09-28: the OLD pickerPools and isSkippedScreenKind, imported from apps/web/src/lib/service-a-ui.ts at 577272d BEFORE the change, run over every fixtures/timelines/*.json (state index = array position) with apps/cli/node_modules/.bin/tsx from apps/web; reasons counted inside the collapsed tier, overlaps allowed. The PRODUCTION section is MEASURED 2026-09-28: `aiugc demo audit --all --json` at 44a5b7c, prod read-only, the same rule applied to every ready analysis's stored timeline."
source: founder
supersedes: "[[0003-sections-are-a-model-call]] (its pool only) and the two tiers recorded in [[8c-inventory-picker]]"
---

# 0064 — The inventory is one tier: every readable moment, a page per group, add controls always on

## The decision

The founder, in chat, 2026-09-28: **no moment is labelled less fitting.** The reason, in the
founder's words:
_"the AI could get it wrong and label an important moment as less fitting."_ All moments are
treated the same, shown in pages, one group per page under the group's label, each moment with
its own label box and "add" button — disabled until the box is non-empty, always visible, not only
after a tap. The "what is shown on the screen" text leaves the inventory entirely.

## Options

This was the founder's own call, not a menu. The alternative on the table was the status quo it
replaces: 8c's two tiers (a main grid of high-legibility, non-idle, non-repeat, non-skip-kind
states over a collapsed "מסכים שפחות מתאימים" toggle), a grouping over the main grid only with a
trailing "עוד מסכים" bucket, and a tap-to-open add panel carrying "על המסך:".

## What it means in the code

- **One pool.** `isInventoryState` (`packages/core/src/plan-format.ts`, client-safe — the
  `PLAN_SKIP_SCREEN_KINDS` precedent): true iff `legibility !== "unreadable"`. The wizard's pages
  and `handleGroupAnalysisSections` both use it, so the grouping covers exactly what the customer
  sees. Unreadable stays out because `updatePlanSteps` rejects it for human edits.
- **Pages = groups.** `inventoryPages` (`apps/web/src/lib/service-a-ui.ts`) — one page per stored
  section, pages by earliest moment, moments chronological. Out-of-pool indexes drop; a double
  claim stays with its first section. A pool state no section claims joins the page of its
  nearest claimed state by `timestampMs`, tie to the earlier one — **there is no leftover bucket**.
  No grouping, or one claiming nothing → chronological pages of `ANALYSIS_PAGE_SIZE` (12) titled
  `מסכים m:ss–m:ss`, the range in an LTR isolate: a neutral label, never a judgement.
- **One page on screen**, its group title always shown as the heading; above the grid, a pager —
  `קבוצה X מתוך N` between הקודם and הבא — that is hidden when there is only one page. Thumbs
  are signed only for pages opened, batched through `analysisIndexBatches`; no prefetching.
- **Every moment card** is the thumb with its screen name and m:ss beside it, and UNDER them —
  where the panel's "כתבו כיתוב מתחת למסך" says — its label box (placeholder "כיתוב לצעד הזה",
  `MAX_LABEL_CHARS`, the soft word warning below it) with a "הוסיפו" button, always rendered. A
  thumb tap only previews. Per-moment drafts survive page flips and clear on that moment's add.
  An in-plan moment stays in place under its בתוכנית chip with its controls disabled until its
  step is deleted. Grid: **one column below Tailwind `xl` (1280px), two from `xl` up.** The label
  row needs ~220px for the box to stay ≥140px beside its button; inside the dashboard shell (a
  16rem sidebar from `md`, the pane's 0.95 zoom, the wizard's 10.5rem rail from `lg`) two
  columns fit with room to spare only from `xl`, and three fit nowhere.
- **The grouping job** builds its input with `groupingInput` (exported, tested): every
  `isInventoryState` state with its absolute index and its `screenKind`, and
  renders `prompts/group_analysis_states/v2.md` over it: every readable screen including login,
  onboarding, loading, idle and repeated ones; each in exactly one section, the task it serves;
  an opening signup/login run may be its own task section; never rank or judge screens. `v1.md`
  is untouched. `findSectionViolations` and the computed-once rule are unchanged.

## What it supersedes

- **[[8c-inventory-picker]]'s two tiers** — the collapsed tier, `pickerPools` and
  `isSkippedScreenKind` are deleted. The 8c note stays as the record of what 8c shipped.
- **[[0003-sections-are-a-model-call]]'s "over the quality pool"** — the grouping now pools
  every readable state. The rest of 0003 stands: one automatic text-only call per analysis,
  computed once, noun-phrase titles, the CLI backfill as the only backfill, and a grouping is a
  nicety that never fails anything.

## What did NOT change — the model keeps its preferences

This is about what the CUSTOMER sees. The plan pass is untouched: `dryRunPlan`'s quality/legal
pools, `findPlanViolations` (including its skip-kind rejection), `subsampleClusters`, the plan
prompt. So is the analyze pipeline, `updatePlanSteps`' unreadable rejection, the step cards'
"על המסך:" line ([[0049-the-label-provenance-rule-is-a-highlight-not-a-gate]]) and the analysis
GET's wire shape — `visibleText` stays on the wire because the step cards use it.

**No migration, no config row, no DB write, no regroup.** Analyses grouped before this keep their
v1 sections over the old quality pool; `inventoryPages`' nearest-neighbour rule gives their other
readable states a page without a paid call. Regrouping them is a paid call that overwrites a
computed-once column, so it waits for the founder.

## MEASURED-ON-FIXTURE — how much the old collapsed tier held

Old `pickerPools` over each `fixtures/timelines/*.json` (method in the frontmatter; reasons
overlap, so they do not sum to the tier):

| Fixture                               | States | Main grid | Collapsed tier | low | repeat | idle | skip-kind | Unreadable |
| ------------------------------------- | -----: | --------: | -------------: | --: | -----: | ---: | --------: | ---------: |
| `dry-run-campaign-app.json`           |     12 |         8 |              3 |   1 |      1 |    2 |         0 |          1 |
| `real-botteacher-file-routing.json`   |     61 |        13 |             47 |  29 |     16 |   32 |        10 |          1 |
| `real-botteacher-six-word-label.json` |     80 |         5 |             75 |  35 |     26 |   38 |        55 |          0 |
| `real-botteacher-study-app.json`      |     80 |        29 |             50 |  19 |     30 |   33 |         0 |          1 |
| `real-tavnit-system-opening.json`     |     53 |        11 |             41 |  22 |     11 |   17 |         8 |          1 |

`dry-run-campaign-app` and `real-botteacher-study-app` carry no `screenKind` on any state (pre-v3
analyses), so their skip-kind 0 is by construction, not a finding.

**REASONED, not measured:** on every real fixture the collapsed tier held more moments than the
main grid — 41 to 75 behind the toggle against 5 to 29 in view — and the task sections organised
only the main grid. A customer who scanned the grid saw a minority of the recording, sorted by a
model's legibility and idle calls; that is the likeliest reason moments read as lost. Production
was counted afterwards and has the same shape (next section). Nothing here says which moment the
founder was looking for.

## MEASURED — the old collapsed tier in production

2026-09-28, audit at 44a5b7c, prod read-only: the collapsed tier held 334 of 494 states across 10
ready analyses (6 distinct recordings) — 58% to 85% of each analysis. Reasons, overlapping: low
183, repeat 135, idle 193, skip-kind 42.

- **The main grid held 154 states.** 6 unreadable states had no tile at all. In every one of the
  ten analyses the collapsed tier held more states than the main grid. That makes the fixture
  reading above measured in production.
- **"low" was the second-largest reason, after idle.** Migration 0028 (`supabase/migrations/0028_split_legibility_gate.sql:5-7`) found on the first
  five real analyses (2026-08-18) that "low" is the model's ordinary verdict on a filmed screen,
  not a refilm signal. 183 of the 334 collapsed states carried it.
- **Six distinct recordings.** Four of the analyses are one 57.5s recording and two are one 89.6s
  recording. The tier still varied within a recording, from 31 to 39 across the first four and 34
  or 41 across the other two, because the labels it sorts by are the model's per-run verdicts.

Per-analysis table: [[old-collapsed-tier-held-most-production-states]].

## Deploy

`renderPrompt` resolves the newest `v<N>.md` on every call (`packages/core/src/prompts.ts`), so
v2's text is live on the worker box the moment the file is pulled; the pool change and the
`screenKind` field need the worker **restarted** on this commit
([[0039-three-deploy-axes-and-the-box-is-the-one-that-forgets]]). The web half ships with the
Vercel deploy.

## Links

- [[8c-inventory-picker]] · [[0003-sections-are-a-model-call]] ·
  [[0049-the-label-provenance-rule-is-a-highlight-not-a-gate]] ·
  [[0039-three-deploy-axes-and-the-box-is-the-one-that-forgets]]
