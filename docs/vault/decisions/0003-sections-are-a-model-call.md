---
type: decision
status: verified
verified: 2026-08-25
method: "founder chose in chat (AskUserQuestion, 2026-08-25 session): approve the auto model call, noun-phrase titles"
source: founder
superseded_by: "[[0064-the-inventory-is-one-tier]] (the pool only)"
---

# Inventory sections are one automatic text-only model call per analysis

> **Superseded IN PART 2026-09-28 by [[0064-the-inventory-is-one-tier]]:** the call no longer
> groups "the quality pool" — it groups every readable state (`isInventoryState`), the same set
> the wizard now shows, with prompt v2. Everything else below still stands: one automatic
> text-only call per analysis, computed once, noun-phrase titles, the CLI backfill as the only
> backfill, a grouping as a nicety. `inventorySections` and its flat-grid fallback are gone —
> `inventoryPages` falls back to time-range pages. Kept verbatim below.

The plan step's inventory is grouped into task-level Hebrew sections ("פרסום פוסט",
"מעקב אחרי משתמשים") by `group_analysis_states` — a text-only call over the quality pool,
enqueued automatically when an analysis lands ready (`sections:${analysisId}`, light lane), one
corrective retry, ~the plan pass's cost class (~a cent). Stored on `demo_analyses.sections`
(0030) with its own prompt version.

## Options offered

1. **Auto model call per analysis** — every future upload gets sections; silent flat-grid
   fallback on any failure/budget refusal; CLI backfill for the 6 pre-0030 analyses.
2. **No AI call** — ship the always-open inventory flat; sections later, maybe.

## Chosen: option 1, founder in chat 2026-08-25

With two riders, both the founder's:

- **Titles are noun-phrase task names** ("פרסום פוסט"), not imperatives — chosen over the
  plural-imperative voice the rest of the UI uses, because the sections read as a catalog of
  what the app does.
- **Backfill is a one-shot CLI run** (`aiugc demo sections`), never a GET side-effect — page
  views must not trigger paid calls (CLAUDE.md's no-added-spend rule).

## The contract the code enforces

A grouping is a NICETY. `handleGroupAnalysisSections` ends as `done` with sections NULL on
budget refusal and on invalid-after-retry output; the UI (`inventorySections`) renders the flat
grid whenever sections are absent. Nothing may fail an analysis, park a lane, or show a
customer-facing error over a missing grouping.
