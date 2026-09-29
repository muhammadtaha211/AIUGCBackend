---
type: decision
status: verified
verified: 2026-09-30
method: "Founder decision in the task prompt for branch tooling/repo-map, 2026-09-30, quoted below. The first run was measured the same day: `pnpm repo-map` twice in a row, then `diff` of the two outputs: identical, 297 lines, no section 'not derived'."
source: founder
---

# 0067 — What exists is a generated map, `docs/repo-map.md`, rerun at the end of every task

**Founder-decided, in the task prompt of `tooling/repo-map` (2026-09-30).**

## The decision

Quoted from the task prompt:

- "`pnpm repo-map` writes docs/repo-map.md from the code itself, so a planning session that can see
  only docs/ knows what actually exists."
- "Derive every section from its source of truth in the tree, never from docs prose." The sections:
  a header ("HEAD sha, branch, HEAD's commit date (not "now", so reruns produce no diff)"), the
  workspace packages, apps/web and apps/admin page routes and API routes with their HTTP methods,
  the migration files and the current tables ("account for drops"), the job types the worker
  dispatches, the CLI commands with their descriptions, the Remotion composition IDs, and the env
  var NAMES "from the .env.example files only. Never open a real .env file."
- "If a section can't be derived mechanically, write "not derived: <reason>". Never hand-write it."
- "Deterministic and sorted. Output under ~400 lines; if a section overflows, summarize it (counts +
  top-level groups) and say so in the file."
- The CLAUDE.md end-of-task line: "after the task's last commit, run `pnpm repo-map` and, if it
  changed, commit it alone as "chore: repo-map" (so the header's sha is the task commit)."
- "Replace hand-maintained lists in CLAUDE.md that the map now covers (the CLI command list and the
  like) with one pointer to docs/repo-map.md."

## Options and reason

- **Options.** The brief offered none. The alternative is the practice it replaces: lists kept by
  hand in CLAUDE.md. Those were the CLI command list in the Commands block and the "~45 commands" in
  Architecture. The map's first run lists 49 CLI entries: 11 groups and 38 runnable commands.
- **Reason.** Quoted: "so a planning session that can see only docs/ knows what actually exists."

## Choices made inside the brief — the task's, not the founder's

REASONED:

- **The header's commit is HEAD, stepping back past commits whose only change is the map.** With
  plain HEAD, the `chore: repo-map` commit would itself make the next run differ. With the step-back,
  runs on either side of that commit agree. One consequence: after a PR merge, `main`'s copy still
  names the task branch and the task commit until the next task reruns it.
- **The script is `apps/cli/scripts/repo-map.ts`.** It runs on that package's `tsx`, the runner the
  repo's scripts already use, and parses with the `typescript` compiler API. Every package already
  depends on `typescript`, so there is no new dependency. It is not an `aiugc` subcommand, because
  `apps/cli/src/index.ts` opens with `import "dotenv/config"`, which reads a real .env.
- **`docs/repo-map.md` is in `.prettierignore`.** The generator owns the bytes. A `pnpm format`
  reshape would be undone by the next run and would look like a change.
- **Section line budgets** add up to the ~400-line ceiling. They are packages 10, web pages 35, web
  API routes 55, admin pages 15, admin API routes 25, migrations 60, tables 40, job types 20, CLI
  commands 65 and compositions 10. Migrations are the closest to their budget: 49 of 60.
- **A Next.js folder the script cannot map** (`_private`, `@slot`, `(.)intercepting`) turns that
  app's section into "not derived", rather than printing a wrong path.

## Where it lives

- CLAUDE.md §3 (the end-of-task line), the Commands block (`pnpm repo-map`), and the CLI line's
  pointer to `docs/repo-map.md`, which replaced the command list.
