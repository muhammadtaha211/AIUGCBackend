# Unattended run protocol

This applies to a **cloud session** (`CLAUDE_CODE_REMOTE=true`) whose first message is a spec written
from `spec-template.md`. Read all of it before doing anything else. CLAUDE.md still governs. Where a
CLAUDE.md rule can't hold as written in a cloud run, the table at the end says what holds instead.
Decisions: vault 0096 (the run), 0097 (what is refused and how), 0098 (paid checks).

## What is enforced, and what is yours to keep

| What                                                                                                                            | How it holds here                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A push that updates main                                                                                                        | **Enforced.** A git pre-push hook refuses it, however it is spelled. The SessionStart hook installs it in `~/.config/aiugc/hooks` (`git config --global core.hooksPath`) and in the repo's `.git/hooks`, and the cloud copy refuses every time. |
| `db push`, `migration repair`, ssh to the box                                                                                   | **Unreachable.** This environment holds no database URL and no ssh key (its one variable is `PAID_CHECK_ANTHROPIC_KEY`), and neither host is on its network allowlist.                                                                          |
| Merging a PR by any route (gh, the API, a GitHub tool, the web)                                                                 | **Instruction only.** Merging is the founder's. If a merge looks like the next step, stop and ask.                                                                                                                                              |
| Skipping the pre-push hook: `--no-verify`, or anything that changes git's hooks path (`core.hooksPath`, `GIT_CONFIG_*`, `HOME`) | **Instruction only.** Never do it. If it looks necessary, stop and ask.                                                                                                                                                                         |
| `PAID_CHECK_ANTHROPIC_KEY` appearing in any output                                                                              | **Instruction only.** Never print, echo or log it, and never dump the environment (`env`, `printenv`, `export -p`, `set`). If it appears anyway, stop and ask at once, so the founder can replace it.                                           |
| Settings                                                                                                                        | **Frozen** in a cloud session. A ConfigChange hook refuses any settings change.                                                                                                                                                                 |

- **A wrong-looking refusal is a stop.** If you believe a refusal is wrong (the pre-push hook, the
  settings freeze, auto mode or a permission), stop and ask. Never work around it.
- **Hooks and settings change only locally.** Never edit `.claude/settings.json` or `.claude/hooks/`
  here.

## The two stops that are always the founder's

1. **Approving the plan.** Nothing is written before it: no branch, no file, no commit.
2. **The merge, and everything after it:** the migration push and the box. A run never does these.

## The run

### Plan mode (the session starts in it): reading only

1. **Read** the spec (the first message), the vault's README and CONVENTIONS, the notes the spec
   touches, and the code.
2. **Check** that the SessionStart line in your context says "aiugc guard: cloud mode". If it is
   missing or says something else, say so in the plan.
3. **Confirm** every claim under the spec's "Unverified", by reading only. A false claim is a stop.
4. **Write the plan.**
   - Map each List-1 criterion to a step and the proof command that step will run.
   - If the cap is above 0, list each paid check with its worst-case cost against the cap.
   - Say what will be owed (decision 9), and the shipping order.
5. **Stop 1:** present the plan for approval.

### After approval

1. **Bootstrap.**
   - `node .claude/hooks/session-start.mjs --check` must print `aiugc pre-push check passed (cloud
mode)`. If it does not, **stop and ask**. Do not push anything.
   - If `git rev-parse --is-shallow-repository` prints `true`, run `git fetch --unshallow origin`.
     `pnpm repo-map` needs the history.
   - `pnpm install --frozen-lockfile`.
   - `ffmpeg -version`. If ffmpeg is missing, the environment's setup script did not run. Stop and
     ask, because 8 core test files need it.
2. **Branch** from `origin/main`, whatever branch the session started on:
   `git fetch origin`, then `git switch -c <type>/<slug> origin/main`, then
   `git branch --unset-upstream`. Unsetting the upstream means a bare `git push` has no target.
3. **Save the spec.** Write the first message to `docs/unattended/runs/<YYYY-MM-DD>-<slug>/spec.md`,
   byte for byte (the folder is prettier-ignored). Create `log.md` beside it (template below). Commit
   both, then `git push -u origin <type>/<slug>`.
4. **Implement** step by step, following CLAUDE.md's coding principles. Subagents may do steps; the
   main session commits their work.
   - **After every finished step:** commit, update `log.md` in the same commit, then
     `git push origin <type>/<slug>`.
   - Always name the branch when you push. The VM pauses when idle and may be reclaimed, and
     uncommitted files, background commands and subagents are not restored.
5. **Run the gate** through the `test-runner` subagent: the seven commands, one at a time.
6. **Run the review loop,** round n = 1, 2, …
   1. `git diff --no-color origin/main...HEAD > .work/review/round-<n>.diff`.
   2. Run every List-1 proof command, and write each command with its output, failing or not, to
      `.work/review/round-<n>.proofs.md`.
   3. Spawn `spec-reviewer` with the spec path, the diff, the proofs, n, and the previous round's
      gaps.
   4. Record its verdict and gaps in `log.md`. Close each gap, and remove every untraced change or
      justify it in `log.md`.
   5. Start the next round.

   The run is done when the gate is green **and** the verdict is CLEAN. **The same gap id in three
   rounds is a stop.**

7. **End of task,** per CLAUDE.md §3:
   - docs and state-of-play;
   - `git branch --show-current`;
   - commit;
   - `pnpm repo-map`, committed alone if it changed;
   - push.

   Then open the PR (below), and write the closing report.

## Paid checks (vault 0098)

- **What's covered.** Claude calls are pre-approved up to the spec's cap. Anything above the cap, or
  any other provider (ElevenLabs, HeyGen, fal …), is a stop.
- **The script.** Write it under `packages/core/.work/<slug>/`, which is gitignored and lives only in
  the VM. Call the shipped function the spec names.
- **The database.** Use `createTestDb()` from `packages/core/test/helpers/pglite.ts` and seed the
  rows the function reads. Never set `DATABASE_URL`.
- **The key** goes to the one command that spends, in exactly this form, and nowhere else:

  ```
  ANTHROPIC_API_KEY="$PAID_CHECK_ANTHROPIC_KEY" DRY_RUN=0 packages/core/node_modules/.bin/tsx packages/core/.work/<slug>/<script>.ts
  ```

- **Before each call,** reserve its worst case in `log.md`. Spent plus reserved never passes the cap.
  The script enforces this; PGlite's `assertBudget` caps nothing.
- **Each check reports its own** calls, input tokens, output tokens and agorot. Agorot come from
  `llmCostAgorot` (`packages/core/src/pricing.ts`), an estimate at $2/$10 per million and 370 agorot
  to the dollar, not an invoice. Production's usage ledger is out of reach, so these numbers are the
  record.

## Stop and ask

Commit and push first. Then ask in the session, and do nothing else until the founder answers. Stop
for any of these:

- **Anything in CLAUDE.md's "When unsure":** money (billing, credits), Hebrew copy tone, the locked
  decisions.
- **A spec that is wrong for the repo:** it contradicts the repo, or an Unverified claim is false.
- **Anything irreversible.**
- **A merge, by any route,** as the next step.
- **Skipping the pre-push hook** looking necessary.
- **The key** appearing in any output.
- **Spend or setup problems:**
  - a paid call that would pass the cap, or any other paid provider;
  - `--check` failing, ffmpeg missing, or the Chrome download from `remotion.media` failing.
- **A refusal you believe is wrong.**
- **The same reviewer gap three rounds running.**

## What is owed (decision 9)

A cloud run can't produce these. List each with its exact command. Never write one as measured, and
never drop one silently.

- **`db push --dry-run` for a new migration:** run locally per `.claude/rules/migrations.md`.
- **Production read-backs:** the SQL, and the result expected.
- **Vault facts** the work relies on that need production to re-measure.
- **Box deploy steps,** if the work needs them (`docs/07-worker-box.md` §11).

## Opening the PR

`gh pr create` uses GraphQL, which the proxy refuses with 403. REST works:

```
gh api repos/{owner}/{repo}/pulls -f title='<title>' -f head='<type>/<slug>' -f base=main -F body=@.work/pr-body.md
```

If it fails, say so in the report, and the founder clicks Create PR. Never merge, and never enable
auto-merge.

## The closing report

Before CLAUDE.md's end-of-task block (Next step, Test it manually, Branch), give these, in order:

1. **What only the founder can test:** List 2, and anything else.
2. **Shipping:** whether a migration or the box is needed, and in which order relative to the merge
   (vault 0039).
3. **Spend against the cap:** each check's tokens and agorot, then the total.
4. **Each reviewer gap,** and how it closed.
5. **What is owed,** with the commands.
6. **The PR link,** or "click Create PR".

## log.md template

```
# Run log: <slug>

Spec: spec.md. Cap: ₪<n>. Started <YYYY-MM-DD>.

## Steps
- [x] <step> (<commit sha>)

## Spend
| check | calls | input tokens | output tokens | reserved (agorot) | actual (agorot) |
Total: <x> of <cap × 100> agorot.

## Review rounds
| round | verdict | gaps (id: status) |

## Owed
- <item>: `<command>`
```

## CLAUDE.md in a cloud run

| CLAUDE.md says                                                                                                          | In a cloud run                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| The file wins unless the founder overrides it in chat; ask when unsure                                                  | He is not watching. Every such question is a stop-and-ask in the session.                                                                   |
| §1: branch "in this checkout"; stop if the tree is dirty                                                                | The clone is the checkout. Branch from `origin/main` after plan approval (above).                                                           |
| Re-measure a vault fact older than 14 days before relying on it                                                         | A fact that needs production can't be re-measured here. It is owed, with its command, and never asserted as current.                        |
| §3 and migrations.md: put the `db push --dry-run` output in Next step; run `migration list`; read back before and after | There is no database credential here. Each is owed with its command (decision 9). The `supabase.exe` path in migrations.md is Windows-only. |
| Read secrets out of the env file inside the script                                                                      | There are no `.env` files. The only secret is `PAID_CHECK_ANTHROPIC_KEY`, passed as above.                                                  |
| Run the gate through the `test-runner` subagent                                                                         | Unchanged. It uses Bash when it has no PowerShell tool.                                                                                     |
| The `pnpm dev`, worker and CLI commands                                                                                 | They need `.env` files that point at production. Not used here.                                                                             |
| Don't add spend; ask before any paid call                                                                               | Claude calls are pre-approved up to the spec's cap (decision 8, vault 0098). Everything else is unchanged.                                  |
| The gate's serial runs ("OOMs this machine")                                                                            | That was measured on the founder's machine. Keep them serial here anyway.                                                                   |
| Never push to main, never merge, never force-push                                                                       | Pushing to main is enforced by the pre-push hook. Merging is instruction only and a stop. Force-push stays forbidden.                       |
| Commit and push at the end of the task                                                                                  | Push after every finished step (decision 6).                                                                                                |
