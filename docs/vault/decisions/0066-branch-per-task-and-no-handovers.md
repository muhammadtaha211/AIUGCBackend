---
type: decision
status: verified
verified: 2026-09-30
method: "Founder decisions in the task prompts for branch docs/slim-claude-md: 2026-09-29, items 6 and 7, and 2026-09-30, the coding principles; all quoted below. The attribution in rule 3 was checked 2026-09-30: the installed plugin's marketplace entry (~/.claude/plugins/known_marketplaces.json) names forrestchang/andrej-karpathy-skills; curl on that GitHub URL returns 301 to multica-ai/andrej-karpathy-skills, which returns 200; the plugin's README says MIT. The practice rules 1 and 2 replace was read from the founder-scoped memory notes (checkout-is-shared-with-concurrent-sessions, migration-owed-llm-cap-1500000, no-gh-cli-open-prs-via-api) and from `git worktree list`, which showed 12 linked worktrees on 2026-09-29. git log -S 'use a worktree' --all finds no commit: the worktree practice was never written into the repo."
source: founder
---

# 0066 — One branch per task, in the checkout; handovers are retired; coding principles inline

**Founder-decided, three rules.**

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

## 3. Coding principles inline, not the skill (2026-09-30)

Quoted from the task prompt: replace the step-1 skill invocation with four principles "inline, so
they apply in every environment and every subagent without depending on the plugin. Stop invoking
/karpathy-guidelines." CLAUDE.md's "Coding principles (every task)" is the section as given, plus
the one merge the same prompt ordered:

- "Delete the old fallback paraphrase and "prefer deleting over adding"; both contradict
  principle 3. Keep "prefer editing existing code over adding new files"."
- "Where a rule under "During the task" now duplicates a principle …, merge it into the principle;
  don't keep both." One did: "One task = one concern. If you notice something else broken, note it
  at the end — don't fix it silently." Principle 3 took it as "One task = one concern:" at its
  start and a last sentence: "Anything else you notice broken goes in the report too; don't fix it
  silently."

**What it replaces**, verbatim from CLAUDE.md step 1 until 2026-09-30:

> Invoke the `/karpathy-guidelines` skill at the beginning of every coding task and apply its
> concepts to all code written in that task. If the skill can't be found, stop and tell the founder
> instead of guessing, then proceed with its core principles as understood in this repo: simplest
> thing that works first; make it work before making it pretty; no premature abstraction (duplicate
> until a pattern has proven itself ~3 times); minimal dependencies — prefer stdlib/boring over
> clever; small increments that keep the repo runnable at every step; code the founder can hold in
> his head; delete aggressively.

And under "During the task": "Prefer editing existing code over adding new files; prefer deleting
over adding."

"Simplest thing" and the ~3-times rule carry on in principle 2. "Delete aggressively" and "prefer
deleting over adding" are gone on purpose. Four phrases have no new home: "make it work before
making it pretty", "minimal dependencies — prefer stdlib/boring over clever" (locked #10's "boring
tech, minimal moving parts" is the nearest rule), "small increments that keep the repo runnable at
every step" and "code the founder can hold in his head".

## Options and reason

- **Options.** The brief offered none beyond these rules. The alternatives were the practices they
  replace: a worktree per task, a closing/opening handover per session, and invoking the plugin's
  skill with the paraphrase as its fallback.
- **Reason.** Rules 1 and 2: the brief gives no reason beyond the rules themselves. Rule 3: so the
  principles "apply in every environment and every subagent without depending on the plugin"; the
  deletions because they "contradict principle 3".

## Where the rules live

- CLAUDE.md "How to work": "Coding principles (every task)" (rule 3), then step 1 (start) and
  step 3 (end, with `Branch:` as the template's last line).
- `state-of-play.md`'s closing section.

## Consequence recorded, not re-litigated

REASONED, from the founder-scoped memory note `checkout-is-shared-with-concurrent-sessions` (not
in the repo). Other sessions share
this checkout, so a branch switch by one session moves HEAD for all of them. CLAUDE.md therefore
has the end step check `git branch --show-current` before committing. The dirty-tree stop at the
start guards against the rest.

Rule 3 reaches every agent that loads CLAUDE.md. `test-runner` sets `omitClaudeMd: true`
(`.claude/agents/test-runner.md`), so it skips CLAUDE.md where the client honours that flag;
the desktop app 2.1.284 does, the terminal CLI 2.1.196 ignores it (founder-scoped memory note
`two-claude-code-versions`). Either way it writes no code.

## Related

- [[0038-lint-is-a-real-stop-condition-again]] — why `.prettierignore` still excludes
  `.claude/worktrees/` while any nested worktree exists.
