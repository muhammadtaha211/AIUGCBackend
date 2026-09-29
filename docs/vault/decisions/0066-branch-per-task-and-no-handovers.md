---
type: decision
status: verified
verified: 2026-09-29
method: "Founder decision in the task prompt for branch docs/slim-claude-md, 2026-09-29, items 6 and 7, quoted below. The practice it replaces was read from the founder-scoped memory notes (checkout-is-shared-with-concurrent-sessions, migration-owed-llm-cap-1500000, no-gh-cli-open-prs-via-api) and from `git worktree list`, which showed 12 linked worktrees that day. git log -S 'use a worktree' --all finds no commit: the worktree practice was never written into the repo."
source: founder
---

# 0066 — One branch per task, in the checkout; handovers are retired

**Founder-decided, two rules.**

## 1. Branch per task (replaces worktrees)

Quoted from the task prompt:

- **Start.** "fetch, then create `<type>/<short-slug>` from origin/main (e.g. feat/, fix/, docs/,
  tooling/). If the working tree is dirty, stop. If the task depends on work that isn't on
  origin/main, stop and say so."
- **End.** "commit, push the branch, and make the report's last line `Branch: <name>`."
- "Never push to main, never merge, never force-push, never create a worktree."

**What it replaces.** Until now, sessions did branch work in `git worktree`s. The rule "never
switch the live-dev checkout's branch — use a worktree" lived only in memory notes. The branch
itself was sometimes landed with an in-place merge and `git push origin HEAD:main`. On 2026-09-29
`git worktree list` showed 12 linked worktrees. This rule ends all of that: no new worktrees, no
merges, no pushes to main.

## 2. Handovers are retired

Quoted: "Decisions arrive in task prompts and are recorded by the task that receives them;
state-of-play is updated at the end of every task."

**What it replaces.** `state-of-play.md`'s "How to hand over" section held two paste-in prompts, one
for closing a chat and one for opening the next (from `90828f4`, 2026-08-27). That section is now
a few lines saying the above.

## Options and reason

- **Options.** The brief offered none beyond these rules. The alternatives were the practices they
  replace: a worktree per task, and a closing/opening handover per session.
- **Reason.** The brief gives no reason beyond the rules themselves.

## Where the rules live

- CLAUDE.md "How to work", step 1 (start) and step 3 (end, with `Branch:` as the template's last
  line).
- `state-of-play.md`'s closing section.

## Consequence recorded, not re-litigated

REASONED, from the founder-scoped memory note `checkout-is-shared-with-concurrent-sessions` (not
in the repo). Other sessions share
this checkout, so a branch switch by one session moves HEAD for all of them. CLAUDE.md therefore
has the end step check `git branch --show-current` before committing. The dirty-tree stop at the
start guards against the rest.

## Related

- [[0038-lint-is-a-real-stop-condition-again]] — why `.prettierignore` still excludes
  `.claude/worktrees/` while any nested worktree exists.
