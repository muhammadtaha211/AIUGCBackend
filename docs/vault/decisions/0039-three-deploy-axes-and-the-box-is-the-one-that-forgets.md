---
type: decision
status: verified
verified: 2026-09-10
method: "Read at 91e4470. packages/core/src/handlers.ts:67-83 (buildHandlers, 13 keys) and apps/worker/src/index.ts:42 (the worker builds all of them); handlers.ts:20-63 (handleGenerateCopy calls the four generators directly); packages/core/src/prompts.ts:10-18 and :26 (readdirSync/readFileSync per call, no cache); packages/core/src/paths.ts:25 and :10 (PROMPTS_DIR under REPO_ROOT, resolved from import.meta.url); `git ls-files prompts | wc -l` = 58; packages/core/src/jobs/queue.ts:95 (JOB_LEASE_MS = 30 * 60_000) and :107-122 (recoverExpiredLeases); docs/07-worker-box.md:312-331 (§11). The skew hazard is measured in [[worker-box-was-14-commits-behind-2026-09-06]]. The 'deploying to live users' section is REASONED and marked as such."
source: code + founder
---

# 0039 — Three deploy axes, and the box is the one that forgets

This project has been bitten three times by the same shape: code that was believed deployed and was
not ([[bundle-fix-reached-the-worker-box]]), a box fourteen commits behind that silently rendered
the wrong video ([[worker-box-was-14-commits-behind-2026-09-06]]), and a gate cleared against an
uncommitted `sed` edit. The rule was spread across three notes and one line that is flatly wrong.
This note is where it lives now; `docs/07-worker-box.md` §11 stays the executable runbook.

## Three axes, not one

| what                     | how it deploys                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`, `apps/admin` | **Vercel, automatic on push.** Nothing to do.                                                                              |
| `apps/worker` (the box)  | **Manual.** `git pull && pnpm install && sudo systemctl restart aiugc-worker`, then `git log -1 --oneline` **on the box**. |
| Supabase migrations      | **Manual.** A migration file sitting in the repo does nothing until it is applied.                                         |

The `git log -1 --oneline` step is the verify-the-artifact rule, and it cost two incidents to learn:
a succeeding render is **not** evidence a deploy landed, because a restart alone produces one
(`docs/07-worker-box.md:326-331`).

## What the box actually runs — measured

`apps/worker` builds **every** handler in `buildHandlers()`
(`packages/core/src/handlers.ts:67-83`, called at `apps/worker/src/index.ts:42`). All thirteen:
`ingest_demo`, `analyze_demo`, `group_analysis_states`, `plan_demo_steps`, `generate_copy`,
`synth_tts`, `generate_composite`, `lipsync`, `render_video`, `normalize_hook_clip`, `janitor`,
`reap_dead_renders`, `billing_renewals`.

## Prompt files are box-side

This is the part that gets assumed wrong. `generate_copy` is a **worker job type**, and
`handleGenerateCopy` (`handlers.ts:20-63`) calls `generateHookLines` (`:35`),
`generateBenefitCaptions` (`:38`), `generateVoScript` (`:45`) and `generateBScript` (`:54`)
directly. So `b_script`, `vo_script`, `hook_lines` and `benefit_captions` are read **on the box**,
not only in the three web routes [[computed-path-reads-are-invisible-to-vercel-tracing]] names. Add
`plan_demo_steps`, both demo-analysis prompts and `tts_enhance`, and effectively **every prompt
directory is box-side**.

The mechanism is not subtle: `PROMPTS_DIR` is `REPO_ROOT/prompts` (`paths.ts:25`), `REPO_ROOT`
resolves from `import.meta.url` (`paths.ts:10`), and all 58 prompt files are git-tracked. A prompt
version reaches the box by `git pull` and by nothing else — the same mechanism `paths.ts:40-42`
already writes down for the hook-animation SFX.

**This falsifies "the worker box is untouched by prompt changes"** —
[[the-worker-box-is-untouched-by-prompt-changes]].

## Never pull without restarting

`renderPrompt` `readFileSync`s the template on **every call** and `latestPromptVersion`
`readdirSync`s on every call (`prompts.ts:10-18`, `:26`; already recorded in
[[prompt-versions-on-disk]] §"The restart trap, stated precisely"). There is no cache.

So a `git pull` puts a new prompt file live **instantly**, against a process still running the old
TypeScript. A template carrying a new `{{var}}` the old code does not pass throws
`missing variable "x"` (`prompts.ts:29`) on the next **paid** call.

**Pulling without restarting is strictly more dangerous than doing both.** The half-deploy is the
failure mode, not the full one.

## Gate the restart on nothing running

A restart mid-render kills the job, and the lease sweep will not reclaim it for `JOB_LEASE_MS` —
**30 minutes** (`packages/core/src/jobs/queue.ts:95`, swept by `recoverExpiredLeases` at `:107-122`,
called once a minute from `worker.ts:213-216`). A customer eats up to half an hour of dead air
before the retry even starts. Check first:

```sql
select id, type, status, locked_by, locked_at from jobs where status = 'running';
```

## When the box does not need a deploy

Changes confined to `apps/web`, `apps/admin`, `docs/` or tests. Everything else — `packages/core`,
`packages/remotion`, `apps/worker`, **and `prompts/`** — does.

## Deploying to live users — REASONED, not measured

**`source: inference`. None of this section has been observed; it is reasoning from how the
platforms are documented to work and from one incident that did happen.**

- **Vercel is the safe axis.** It builds, then swaps the alias atomically, so in-flight requests
  finish on the old deployment and the database and job queue are untouched. There is no window
  where half a deployment is serving.
- **The real hazard is version skew between the box and Vercel**, and it has already bitten once:
  [[worker-box-was-14-commits-behind-2026-09-06]], where the wizard stored `hookEffect: "zoom"` and
  the worker rendered no effect — no error, no failed job, just a wrong video. Any change spanning
  web + core is live on two machines at different times. **Order it deliberately:** box first when
  new web code depends on new core behaviour; box last when old web code must keep working.
- **A browser holding old JS** can fail a chunk load after a deploy and hard-reload. The A wizard
  survives it — demo id and step index live in the URL (`?demo=&step=`, via `history.replaceState`;
  `a-wizard.tsx:70-73`, `:168-172`) and are restored on mount. `/home/new-business` does **not**:
  [[0015-signed-in-without-business-lands-on-new-business]] records it as `mode: "additional"`,
  in-memory only, with no `saveDraft`. **A deploy while someone is in that wizard loses their
  answers.**

## Related

- `docs/07-worker-box.md` §11 — the runbook. Four notes point at it; it keeps the commands.
- [[worker-box-was-14-commits-behind-2026-09-06]] — the skew incident.
- [[bundle-fix-reached-the-worker-box]] — the believed-deployed incident.
- [[prompt-versions-on-disk]] — why a prompt file is live the instant it lands.
- [[computed-path-reads-are-invisible-to-vercel-tracing]] — the three web routes that read prompts.
- [[local-workers-compete-with-the-box-for-production-jobs]] — the other way a job ends up on the
  wrong machine.
