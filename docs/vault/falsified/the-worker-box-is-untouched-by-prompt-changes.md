---
type: falsified
status: verified
verified: 2026-09-10
method: "Killed by reading packages/core/src/handlers.ts:67-83 and :20-63 — `generate_copy` is a worker job type and handleGenerateCopy calls generateHookLines/generateBenefitCaptions/generateVoScript/generateBScript directly. Corroborated by packages/core/src/paths.ts:25 (PROMPTS_DIR = REPO_ROOT/prompts) and :10 (REPO_ROOT from import.meta.url), and `git ls-files prompts | wc -l` = 58 tracked files. Provenance of the claim itself established by grep: it appears NOWHERE in the repo — `grep -rn 'untouched by prompt' docs/`, `'box is untouched'`, `'prompts are read'`, `'Vercel only'` all return 0, as does a repo-wide markdown grep of the paraphrases."
source: code
---

# "The worker box is untouched by prompt changes"

## The claim

That editing or adding a file under `prompts/` is a Vercel-side concern only, and the Hetzner box
needs no deploy for it — that prompts are read in web routes and nowhere else.

**It was never written down in this repo.** That is recorded here on purpose, so nobody hunts for
the note that made the claim: there isn't one. It circulated in sessions, as the kind of thing that
sounds obviously true because the three prompt-reading **web routes** are the ones that have their
own defect note ([[computed-path-reads-are-invisible-to-vercel-tracing]]), and the box does not
appear in it.

## What killed it

`generate_copy` is a **worker job type**. `buildHandlers()` registers it
(`packages/core/src/handlers.ts:73`) along with twelve others, and `apps/worker/src/index.ts:42`
builds the whole registry. `handleGenerateCopy` (`handlers.ts:20-63`) then calls the generators
directly — `generateHookLines` at `:35`, `generateBenefitCaptions` at `:38`, `generateVoScript` at
`:45`, `generateBScript` at `:54`.

So `b_script`, `vo_script`, `hook_lines` and `benefit_captions` are read on the box. Add the
worker-only families — `analyze_demo` and `group_analysis_states` (`plan_demo_steps`,
`analyze_demo` handlers), `plan_demo_steps`, and `tts_enhance` via `synth_tts` — and effectively
every prompt directory is box-side.

The split that does exist runs the **other way** from the claim: `hook_lines` / `vo_script` /
`b_script` are read in Vercel functions **as well as** on the box, while `analyze_demo`,
`group_analysis_states`, `plan_demo_steps` and `tts_enhance` are read on the box **only**.
_(2026-10-20: `tts_enhance` is read by no code at all since [[0119-tts-is-eleven-v4-plain-text]];
the point stands for the rest.)_

## Why it mattered enough to record

If prompts were web-only, a prompt change would be a push and nothing else. They are not: all 58
prompt files are git-tracked, `PROMPTS_DIR` is `REPO_ROOT/prompts` resolved from the running
checkout, and the box gets them by `git pull` — which is the manual axis nobody is reminded about
([[0039-three-deploy-axes-and-the-box-is-the-one-that-forgets]]).

Worse, the claim inverts the actual hazard. Because `renderPrompt` re-reads the file on every call
([[prompt-versions-on-disk]]), a `git pull` on the box makes a new prompt live **instantly** against
a process still running the old TypeScript. Believing the box is untouched leads to pulling without
restarting, which is the strictly more dangerous of the two options.

## The nearest true statement, so it is not re-derived

[[prompt-versions-on-disk]] §"The restart trap, stated precisely" says a new prompt file "takes
effect immediately. No restart." That is true **about a process on a machine that already has the
file**, and silent about which machines have it. Do not read it as a statement about deploys.
