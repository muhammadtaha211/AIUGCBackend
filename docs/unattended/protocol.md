# Unattended run protocol

This applies to a **cloud session** (`CLAUDE_CODE_REMOTE=true`) whose first message is a spec written
from `spec-template.md`, or names a run's `log.md` ("Continue the run in …", "Bring main in for the
run in …"). Read all of it before doing anything else. CLAUDE.md still governs. Where a
CLAUDE.md rule can't hold as written in a cloud run, the table at the end says what holds instead.
Decisions: vault 0096 (the run), 0097 (what is refused and how), 0098 (paid checks).

## What is enforced, and what is yours to keep

| What                                                                                                                            | How it holds here                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A push that updates main                                                                                                        | **Enforced.** A git pre-push hook refuses it, however it is spelled. The SessionStart hook installs it in `~/.config/aiugc/hooks` (`git config --global core.hooksPath`) and in the repo's `.git/hooks`, and the cloud copy refuses every time. |
| `db push`, `migration repair`, ssh to the box                                                                                   | **Unreachable.** This environment holds no database URL and no ssh key (its one variable is `PAID_CHECK_ANTHROPIC_KEY`), and neither host is on its network allowlist.                                                                          |
| The two GitHub tools that merge: `mcp__github__merge_pull_request` and `mcp__github__enable_pr_auto_merge`                      | **Enforced.** A PreToolUse hook in `.claude/settings.json`, matched on exactly those two names, refuses both in a cloud session. Locally it lets them through.                                                                                  |
| Merging a PR by any other route (gh, the REST API, the web)                                                                     | **Instruction only.** Merging is the founder's. If a merge looks like the next step, stop and ask.                                                                                                                                              |
| Skipping the pre-push hook: `--no-verify`, or anything that changes git's hooks path (`core.hooksPath`, `GIT_CONFIG_*`, `HOME`) | **Instruction only.** Never do it. If it looks necessary, stop and ask.                                                                                                                                                                         |
| `PAID_CHECK_ANTHROPIC_KEY` appearing in any output                                                                              | **Instruction only.** Never print, echo or log it, and never dump the environment (`env`, `printenv`, `export -p`, `set`). If it appears anyway, stop and ask at once, so the founder can replace it.                                           |
| Settings                                                                                                                        | **Frozen** in a cloud session. A ConfigChange hook refuses any settings change.                                                                                                                                                                 |

- **A wrong-looking refusal is a stop.** If you believe a refusal is wrong (the pre-push hook, the
  settings freeze, auto mode or a permission), stop and ask. Never work around it.
- **Hooks and settings change only locally.** Never edit `.claude/settings.json` or `.claude/hooks/`
  here.

## The two stops that are always the founder's

1. **Approving the plan.** Nothing is written before it: no file, no commit.
2. **The merge, and everything after it:** the migration push and the box. A run never does these.

## The run

### Plan mode (the session starts in it): reading only

1. **Read** the spec (the first message), the vault's README and CONVENTIONS, the notes the spec
   touches, and the code.
2. **Check** that the SessionStart line in your context says "aiugc guard: cloud mode". If it is
   missing or says something else, say so in the plan.
3. **Confirm** every claim under the spec's "Unverified", by reading only. A false claim is a stop.
4. **Check the spec's Touches line.**
   - If the run would change `packages/remotion` or how a render looks, stop. Until the gate's known
     failure (below) is fixed, such a spec runs locally, not in the cloud.
   - If it adds a migration or touches credits or billing, say so at the top of the plan. No other
     run doing the same may be in flight (§Several runs at once).
5. **Write the plan.**
   - Map each List-1 criterion to a step and the proof command that step will run.
   - If the cap is above 0, list each paid check with its worst-case cost against the cap.
   - Say what will be owed (decision 9), and the shipping order.
   - Say so if the session is not running on the model the spec's Model line names.
6. **Stop 1:** present the plan for approval.

### After approval

1. **Bootstrap.**
   - `node .claude/hooks/session-start.mjs --check` must print `aiugc pre-push check passed (cloud
mode)`. If it does not, **stop and ask**. Do not push anything.
   - If `git rev-parse --is-shallow-repository` prints `true`, run `git fetch --unshallow origin`.
     `pnpm repo-map` needs the history.
   - `pnpm install --frozen-lockfile`.
   - `ffmpeg -version`. If ffmpeg is missing, the environment's setup script did not run. Stop and
     ask, because 8 core test files need it.
2. **Confirm the branch.** The run works on the branch the session was assigned: the harness names
   it, and `git branch --show-current` shows it. `<branch>` below means that branch. Before the
   first commit:
   - `git fetch origin`;
   - `git rev-parse HEAD origin/main` must print the same sha twice;
   - `git status --porcelain` must print nothing.

   If either check fails, stop and ask, and do not commit or push anything. If nothing is committed
   yet and HEAD is only behind `origin/main` (main moved while the plan waited), say so. If he answers
   "fast-forward", run `git merge --ff-only origin/main`, re-confirm the spec's Unverified claims on
   the new tree, and repeat this step. Once both checks pass, write the branch and that sha at the
   top of `log.md`.

3. **Save the spec.** Write the first message to `docs/unattended/runs/<YYYY-MM-DD>-<slug>/spec.md`,
   byte for byte (the folder is prettier-ignored). Create `log.md` beside it (template below). Commit
   both, then `git push -u origin <branch>`.
4. **Implement** step by step, following CLAUDE.md's coding principles. Subagents may do steps; the
   main session commits their work.
   - **After every finished step:** commit, update `log.md` in the same commit, then
     `git push origin <branch>`.
   - Always name the branch when you push. The VM pauses when idle and may be reclaimed, and
     uncommitted files, background commands and subagents are not restored.
5. **Run the gate** through the `test-runner` subagent: the seven commands, one at a time.
   - **One known failure is owed, not a stop.** It qualifies only when all of these hold:
     - the only red test is `packages/remotion/test/frame-delivery.test.ts`;
     - it fails with `NetworkError: A network error occurred.`;
     - the render logged, just before it, that the browser failed to load a font from
       `fonts.gstatic.com` with `net::ERR_CERT_AUTHORITY_INVALID`;
     - the other six commands are green.

     The first run measured it on 2026-10-09 (vault 0096, amended 2026-10-10). Record it in
     `log.md`, and list it as owed (below).

   - **Any other gate failure is a stop.**

6. **Run the review loop,** round n = 1, 2, …
   1. `git diff --no-color origin/main...HEAD > .work/review/round-<n>.diff`.
   2. Run every List-1 proof command, and write each command with its output, failing or not, to
      `.work/review/round-<n>.proofs.md`.
   3. Spawn `spec-reviewer` with the spec path, the diff, the proofs, n, and the previous round's
      gaps.
   4. Record its verdict and gaps in `log.md`. Close each gap, and remove every untraced change or
      justify it in `log.md`.
   5. Start the next round.

   The run is done when the gate is green, or red only on the known failure, **and** the verdict is
   CLEAN. **The same gap id in three rounds is a stop.**

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
- **A spec that would change `packages/remotion` or how a render looks,** while the known failure
  stands.
- **A migration, or a credits or billing change, that the spec's Touches line does not declare,**
  before writing it. Another run in flight may already have one (§Several runs at once).
- **The assigned branch not on `origin/main`'s head,** or a dirty tree, before the first commit.
- **A gate failure other than the known one.**
- **Anything irreversible.**
- **A merge, by any route,** as the next step.
- **A conflict where the two sides want different behaviour,** when bringing main in.
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

- **The Remotion suite,** when the gate's only red is the known failure: run locally before the
  merge, `pnpm --filter @aiugc/remotion exec vitest run --fileParallelism=false`.
- **`db push --dry-run` for a new migration:** run locally per `.claude/rules/migrations.md`.
- **Production read-backs:** the SQL, and the result expected.
- **Vault facts** the work relies on that need production to re-measure.
- **Box deploy steps,** if the work needs them (`docs/07-worker-box.md` §11).

## Opening the PR

`gh pr create` uses GraphQL, which the proxy refuses with 403. REST works:

```
gh api repos/{owner}/{repo}/pulls -f title='<title>' -f head='<branch>' -f base=main -F body=@.work/pr-body.md
```

If it fails, say so in the report, and the founder clicks Create PR. Never merge, and never enable
auto-merge.

## Several runs at once

The founder may have several runs in flight, each in its own cloud session on its own assigned
branch. Their PRs merge one at a time.

- **Never in flight together:** two runs that each add a migration, or two that each touch credits
  or billing. Migration numbers and the push order to production are one sequence. The spec's
  Touches line makes this visible, and he checks it before starting a run.
- **Expected conflicts:** two runs both change `docs/vault/state-of-play.md` and `docs/repo-map.md`.
  Each run still updates state-of-play at its end. The conflicts are resolved when main is brought
  in (below).

## Bringing main in

No PR is merged unless its branch contains the current `origin/main`, and the gate and one review
round ran on that combined state. Two changes can each pass alone and break together, and git
reports a conflict only where the same lines changed.

When main has moved since the run's branch was cut (anything merged to main since its session
started, or the closing report says the branch does not contain `origin/main`), the founder says
**"bring main in"**. Then:

1. **Bootstrap,** unless this VM already did (§After approval, step 1, with its stops). A paused or
   new VM may be a shallow clone with no `node_modules`.
2. **Merge, never rebase.** `git fetch origin`, then `git merge origin/main`. No rebase and no
   force-push. Apart from the fast-forward of §After approval step 2, this is the only merge a run
   makes, and only on those words.
3. **Resolve each conflict only where both changes can be kept as written.**
   - Where the two sides want different behaviour, it is the founder's product decision: run
     `git merge --abort`, then stop and ask, naming the files and the two behaviours.
   - `docs/vault/state-of-play.md`: keep both sides' entries.
   - `docs/repo-map.md`: take either side. Step 6 regenerates it.

   Then commit the merge. Git commits it by itself when nothing conflicts.

4. **Check the decision numbers, whether or not anything conflicted.** A clash is not a git
   conflict, because the two notes have different file names.
   - The run's own new decisions:
     `git diff --name-only --diff-filter=A origin/main HEAD -- docs/vault/decisions/`.
   - Main's: `git ls-tree --name-only origin/main docs/vault/decisions/`.
   - If main has a different note with the number of one of the run's, renumber the run's note to
     the next free number, update every link and mention of it, and commit.
5. **Re-run the gate** (§After approval, step 5, with the same known failure) **and one review
   round** (§After approval, step 6). If that round's verdict is not CLEAN, stop and ask.
6. **Record and push.** Add a "Main brought in" entry to `log.md` and commit it. Run
   `pnpm repo-map`, commit it alone as `chore: repo-map` if it changed, then
   `git push origin <branch>`.
7. **Report** each conflict and how it was resolved, the gate, and the review verdict.

If main moves again before he merges, he says it again.

If the session has expired, he starts a new session on the run's branch and says "Bring main in for
the run in `docs/unattended/runs/<date>-<slug>/log.md`".

**A new session on a run's branch,** whether it continues a run or brings main in, reads `log.md`
first. Then it checks that its assigned branch is the branch `log.md` names. If the harness assigned
another branch, stop and ask, naming both. Then it bootstraps (§After approval, step 1, with its
stops). The `origin/main` check (§After approval, step 2) is for a run's first commit only: a run's
branch is ahead of main by design.

## The closing report

Before CLAUDE.md's end-of-task block (Next step, Test it manually, Branch), give these, in order:

1. **What only the founder can test:** List 2, and anything else.
2. **Shipping:** whether a migration or the box is needed, and in which order relative to the merge
   (vault 0039).
3. **Spend against the cap:** each check's tokens and agorot, then the total.
4. **Each reviewer gap,** and how it closed.
5. **What is owed,** with the commands.
6. **Whether the branch contains `origin/main`:** yes or no, from
   `git fetch origin && git merge-base --is-ancestor origin/main HEAD && echo yes || echo no`.
7. **The PR link,** or "click Create PR".

## log.md template

```
# Run log: <slug>

Spec: spec.md. Cap: ₪<n>. Started <YYYY-MM-DD>.
Branch: <assigned branch>, on origin/main <sha> before the first commit.

## Steps
- [x] <step> (<commit sha>)

## Spend
| check | calls | input tokens | output tokens | reserved (agorot) | actual (agorot) |
Total: <x> of <cap × 100> agorot.

## Review rounds
| round | verdict | gaps (id: status) |

## Owed
- <item>: `<command>`

## Main brought in
- <YYYY-MM-DD>, origin/main <sha>: <each conflict and how it was resolved>. Gate: <result>. Review: <verdict>.
```

## CLAUDE.md in a cloud run

| CLAUDE.md says                                                                                                          | In a cloud run                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The file wins unless the founder overrides it in chat; ask when unsure                                                  | He is not watching. Every such question is a stop-and-ask in the session.                                                                                                                                                                                                                        |
| §1: branch "in this checkout"; stop if the tree is dirty                                                                | The clone is the checkout. Work on the assigned branch, once it is confirmed on `origin/main`'s head and clean (above).                                                                                                                                                                          |
| Re-measure a vault fact older than 14 days before relying on it                                                         | A fact that needs production can't be re-measured here. It is owed, with its command, and never asserted as current.                                                                                                                                                                             |
| §3 and migrations.md: put the `db push --dry-run` output in Next step; run `migration list`; read back before and after | There is no database credential here. Each is owed with its command (decision 9). The `supabase.exe` path in migrations.md is Windows-only.                                                                                                                                                      |
| Read secrets out of the env file inside the script                                                                      | There are no `.env` files. The only secret is `PAID_CHECK_ANTHROPIC_KEY`, passed as above.                                                                                                                                                                                                       |
| Run the gate through the `test-runner` subagent                                                                         | Unchanged. It uses Bash when it has no PowerShell tool.                                                                                                                                                                                                                                          |
| The `pnpm dev`, worker and CLI commands                                                                                 | They need `.env` files that point at production. Not used here.                                                                                                                                                                                                                                  |
| Don't add spend; ask before any paid call                                                                               | Claude calls are pre-approved up to the spec's cap (decision 8, vault 0098). Everything else is unchanged.                                                                                                                                                                                       |
| The gate's serial runs ("OOMs this machine")                                                                            | That was measured on the founder's machine. Keep them serial here anyway.                                                                                                                                                                                                                        |
| Never push to main, never merge, never force-push                                                                       | Pushing to main is enforced by the pre-push hook. The two GitHub merge tools are refused by a PreToolUse hook; merging by any other route is instruction only and a stop. Merging `origin/main` into the run's own branch happens only when he says "bring main in". Force-push stays forbidden. |
| §3: every task updates state-of-play and the repo map                                                                   | Unchanged. Parallel runs conflict in both; the conflicts are resolved when main is brought in.                                                                                                                                                                                                   |
| Commit and push at the end of the task                                                                                  | Push after every finished step (decision 6).                                                                                                                                                                                                                                                     |
