---
type: fact
status: verified
verified: 2026-08-26
method: "grep -l mtpmrqltldfwhziyyzdu supabase/.temp/* → project-ref, linked-project.json, pooler-url. Then rm -rf supabase/.temp && npx -y supabase migration list → LegacyProjectNotLinkedError; npx -y supabase migration list --db-url <session pooler> → 32 rows, local == remote."
source: code
---

# `supabase/.temp/` linked-project state is gone, on purpose

Three files in `supabase/.temp/` named the **old** project (`mtpmrqltldfwhziyyzdu`) —
`project-ref`, `linked-project.json`, and `pooler-url` (which also embedded a connection string).
Any `npx supabase …` command that resolves the linked project rather than taking an explicit
`--db-url` therefore targeted the project CLAUDE.md's migration gate puts off-limits, silently and
with no indication of which database it had chosen.

The whole directory was removed on 2026-08-26. It is gitignored (`supabase/.gitignore:3`),
untracked, and entirely regenerable — `supabase link` rewrites it.

## What changed

| Command shape                                   | Before                       | After                                     |
| ----------------------------------------------- | ---------------------------- | ----------------------------------------- |
| `npx supabase <cmd>` (no `--db-url`)            | silently hit the OLD project | `LegacyProjectNotLinkedError`, exit 1     |
| `npx supabase <cmd> --db-url <session pooler>`  | worked                       | works, unchanged                          |

Verified after removal: `migration list --db-url <new session pooler>` returns 32 rows with local
and remote in agreement through `0031`. Nothing in the documented workflow needed the link state.

**Do not re-link.** The loud failure is the feature — every command in `docs/08` and `CLAUDE.md`
passes `--db-url` explicitly, so a resolvable link only re-creates the ambiguity about which of the
two projects a command is about to touch.
