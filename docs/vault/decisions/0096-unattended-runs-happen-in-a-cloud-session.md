---
type: decision
status: verified
verified: 2026-10-10
method: "The founder's task prompt of 2026-10-08 (§2 'Decided', items 1–6, 9 and 10), amended by him in that task's plan-mode chat (a run starts in Plan mode; the spec is saved after approval) and his answer there on the cloud gate. The environment's settings are founder-reported. Claude Code's cloud behaviour is from the docs at code.claude.com, read 2026-10-08 and untested in a cloud session: the first-run checklist in docs/unattended/runbook.md proves or kills each claim. Amended 2026-10-10 from his task prompt of that day ('unattended runs, first-run fixes and parallel runs', §2 items 1, 2 and 5–10), checked against the first run's docs/unattended/runs/2026-10-09-inventory-first-load-retry/log.md and `git log origin/main`."
source: founder
---

# 0096 — Unattended feature runs happen in a cloud session

**FOUNDER, 2026-10-08.** He hands one spec to a cloud Claude Code session and gets back a pushed
branch, an open PR and a closing report. He is asked only to approve the plan. In between, the
session:

- implements;
- runs the gate;
- has its work checked against the spec by an agent that wrote none of it, round after round, until
  every criterion a command can prove is proven.

The run follows `docs/unattended/protocol.md`. He uses `docs/unattended/runbook.md`, and specs are
written from `docs/unattended/spec-template.md`. Items 7 and 8 of the same prompt are
[[0097-push-to-main-refused-by-a-git-hook-the-rest-instruction-only]] and
[[0098-paid-claude-calls-pre-approved-up-to-the-specs-cap]].

## The decisions

1. **Unattended runs happen in a cloud session**, in the environment `tavnit-unattended`.
   - **Reason (his):** it runs with his machine off and holds no production credential.
   - **The environment, FOUNDER-REPORTED 2026-10-08:** Trusted network access, no setup script, and
     one variable, `PAID_CHECK_ANTHROPIC_KEY`.
   - **His ruling in the plan chat:** a setup script installs ffmpeg and headless Chrome's libraries,
     and the network moves to Custom (the defaults plus `remotion.media`). Without them the gate
     cannot go green there:
     - 8 core test files spawn ffmpeg;
     - `packages/remotion/test/frame-delivery.test.ts` downloads Chrome Headless Shell from
       `remotion.media`, which the Trusted list does not include.

     He applies this himself (state-of-play, Owed founder actions).
2. **Two stops stay his:** approving the plan before any code is written, and the merge with
   everything after it (migration push, box).
   - **Reason (his):** those are the irreversible and live axes.
3. **The spec arrives as the session's first message**, in the template's shape:
   - goal, decided, unverified, limits;
   - the acceptance criteria in two lists: those a command or test proves, each naming its proof,
     and those only he can judge;
   - the paid-check cap for the run in ₪, where 0 means none.

   **Reason (planning's):** the spec replaces the planning chat as what the work is checked against.
   - **Amended by him, 2026-10-08.** A run starts in Plan mode: reading only, then the plan. Only
     after he approves does it bootstrap, branch, save the spec verbatim to
     `docs/unattended/runs/<date>-<slug>/spec.md` (prettier-ignored, so the bytes stay his), and
     push.
     - The original said the spec is saved "before planning".
     - His amendment also opened with a canary check. The canary belonged to the PreToolUse guard and
       went with it (0097).

4. **A reviewer agent that wrote none of the code reads the diff against the spec and returns the
   gaps.** It edits nothing.
   - The agent is `.claude/agents/spec-reviewer.md`, with only Read, Grep and Glob.
   - The run ends when the gate is green and the reviewer finds no gap in the first list.
   - The same gap surviving three rounds is a stop: ask him.
   - **Reason (planning's):** an independent read against the decisions is what pasting reports into
     the planning chat provided.
   - **Its trial run, 2026-10-08,** was on commit `ca2f816`, against a scratch spec with four made-up
     criteria, one deliberately unmet.
     - It found the unmet one.
     - It also found a gap nobody planted: a typecheck proof that could not tell the old signature
       from the new.
     - It ran twice on the same inputs, with the same verdict, GAPS(2), and the same untraced
       change. First, before the new file had loaded, as a read-only Explore agent following the
       file's instructions. Then as its own agent type, which the session listed with only Read,
       Grep and Glob.
     - Whether it loads the same way in a cloud session is on the first-run checklist.
5. **When it needs him, it stops and asks in the session.** No other channel is built now.
   - It asks for what CLAUDE.md's "When unsure" lists, for a spec that contradicts the repo, and for
     anything irreversible.
   - Under 0097 it also stops for a merge, for skipping the pre-push hook, for the key appearing in
     output, and for a refusal it believes is wrong.
6. **It pushes the branch after every finished step.**
   - **Reason (planning's):** an idle cloud VM can be reclaimed, and uncommitted work, background
     commands and subagents are not restored.
7. **What the cloud cannot produce is reported as owed, with the command to run.** The
   `db push --dry-run` output and every production read-back are the known cases. Owed work is never
   written as measured and never skipped silently. (This is item 9 of his §2.)
8. **The closing report** is CLAUDE.md's end-of-task block plus these. (This is item 10 of his §2.)
   - what only he can test;
   - whether shipping needs a migration or the box, and in which order relative to the merge
     ([[0039-three-deploy-axes-and-the-box-is-the-one-that-forgets]]);
   - spend against the cap;
   - each reviewer gap and how it closed;
   - what is owed.

## What the docs say, untested here (read 2026-10-08)

- **What a session loads.** A cloud session with one repository loads that repo's CLAUDE.md,
  `.claude/settings.json` (hooks included), `.claude/rules/` and `.claude/agents/`. It loads nothing
  from `~/.claude`.
  - **A session with several repositories loads no repo hooks.** So the runbook says one repository.
- **The cloud flag.** `CLAUDE_CODE_REMOTE` is `true` in the VM and never locally. Measured locally:
  unset.
- **GitHub.** `gh` is pre-installed and authenticated through the GitHub proxy.
  - Its GraphQL subcommands (`gh pr create`, `gh pr merge`) get 403, and REST `gh api` works. So
    the protocol opens the PR through `gh api`.
  - The proxy does not limit which branch a push updates.
- **Permission modes.** Cloud sessions offer Accept edits, Plan and Auto. Auto mode allows pushes to
  the default branch by default.
- **Time limits.**
  - A foreground command gets 2 minutes by default and 10 at most, then moves to the background.
  - A backgrounded command in a cloud session has a 30-minute limit.
- **Idle VMs.** An idle VM pauses and may be reclaimed. The conversation is restored; background
  work is not.
- **Setup scripts.** A setup script runs as root before Claude Code launches. Its result is cached for
  about seven days. A non-zero exit stops the session from starting.

## Amended 2026-10-10: the branch, the gate's known failure, and several runs at once

From his task prompt of 2026-10-10, numbered as there. The first run (2026-10-09, PR #85)
measured what items 1 and 2 rest on. Its `log.md` is
`docs/unattended/runs/2026-10-09-inventory-first-load-retry/log.md`.

- **Item 1. A run works on the branch its session was assigned.** Before its first commit it
  confirms that branch sits on `origin/main`'s head; if not, it stops and asks. This replaces
  "branch from `origin/main`" in decision 3's amendment above.
  - **Reason (his, 2026-10-09):** he ruled it at the first run's plan approval. The cloud assigns
    the branch, and the session's own tools are built around it.
- **Item 2. One known failure in the cloud gate is owed, not a stop.** It is
  `packages/remotion/test/frame-delivery.test.ts` failing on `fonts.gstatic.com` with
  `net::ERR_CERT_AUTHORITY_INVALID`. The run lists it as owed, with the local command
  `pnpm --filter @aiugc/remotion exec vitest run --fileParallelism=false`. Any other gate failure is
  still a stop.
  - Until that failure is fixed, a spec that changes `packages/remotion` or how a render looks does
    not run in the cloud.
  - **Reason (planning's):** measured in the first run, 2026-10-09. Every run would otherwise stop at
    the same place.
- **Item 5. Several cloud runs may be in flight at once,** each in its own session on its own
  assigned branch. PRs merge one at a time.
  - **Reason (his, 2026-10-10):** he wants to work on unrelated tasks in parallel.
- **Item 6. No PR is merged unless its branch contains the current `origin/main`,** and its gate
  and one review round ran on that combined state. When main has moved since the run finished, he tells the
  session "bring main in". The session then:
  - merges `origin/main` into its branch (no rebase, no force-push);
  - resolves the conflicts, regenerates the repo map, and renumbers its own vault notes if a number
    was taken;
  - re-runs the gate and one review round;
  - pushes, and reports each conflict and how it was resolved.

  If the session has expired, a new session on that branch does the same from `log.md`.
  - **Reason (planning's):** two changes can each pass alone and break together, and git only
    reports the kind where the same lines changed.

- **Item 7. A conflict where the two changes want different behaviour is a stop-and-ask.** The
  session resolves only conflicts where both changes can be kept as written.
  - **Reason (planning's):** choosing between two behaviours is a product decision.
- **Item 8. Never in flight at once:** two runs that each add a migration, or two that each touch
  credits or billing.
  - **Reason (planning's):** migration numbers and the push order to production are a single
    sequence.
- **Item 9. The spec template gains two lines:** the model for the run, and "Touches" (the packages
  and areas the run changes, and whether it adds a migration). The runbook says to use the model the
  spec names.
  - **Reason (planning's):** overlap between two runs has to be visible when the specs are written.
- **Item 10. Conflicts in state-of-play and the repo map are expected between parallel runs.**
  They are resolved in the bring-main-in step. The rule that every task updates state-of-play stays.

His items 3 and 4 (the two merge tools, and what a GitHub rule could not do) are
[[0097-push-to-main-refused-by-a-git-hook-the-rest-instruction-only]]'s amendment of the same day.

**Where they live:** `docs/unattended/protocol.md` (§After approval steps 2 and 5, §Several runs at
once, §Bringing main in), `runbook.md` and `spec-template.md`.

**Choices made in writing them, not ruled by him:**

- Touches also says whether the run touches credits or billing, so item 8 is visible too.
- A bring-main-in review round that is not CLEAN is a stop.
- A new session on a run's branch checks that the cloud assigned it the branch `log.md` names, and
  stops if not. Whether the cloud keeps the branch a session is started on is unmeasured.
