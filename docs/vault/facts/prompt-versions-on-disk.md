---
type: fact
status: verified
verified: 2026-09-08
method: "for d in prompts/*/; do ls $d | sort -V; done (2026-09-08); packages/core/src/prompts.ts:10-32 read directly; newest DB prompt_version from select ... from demo_step_plans order by created_at desc (DB check 2026-08-23 — not re-run); b_script rows by version: select prompt_version, count(*) from scripts where kind = 'b_script' and created_at > now() - interval '30 days' group by 1 (2026-09-08 03:30 UTC: v12 19, v10 8, v9 12)"
source: code
---

# Ten prompt families, and the newest file always wins

```
analyze_demo          v1 v2 v3                              (latest v3)
b_script              v1..v16                               (latest v16, new 2026-09-08)
benefit_captions      v1 v2                                 (latest v2)
content_policy        v1                                    (latest v1)
group_analysis_states v1                                    (latest v1, new 2026-08-25)
hook_lines            v1..v7                                (latest v7)
hook_text             v1 v2 v3                              (latest v3, new 2026-09-08)
plan_demo_steps       v1..v13                               (latest v13)
tts_enhance           v1..v4                                (latest v4)
vo_script             v1..v8                                (latest v8, new 2026-09-08)
```

b_script v9 (2026-09-05) is v8's vars and rules with the output changed to the JSON
`{script, hook_text}`; the brief that asked for it cited "v2 from v1", the second time a brief
named a stale version (the first was the tts_enhance v3 regression, 2026-08-05). It was
caught by the stop-and-report rule, not by luck: v1's var set has `target_seconds`, which nothing
passes. `hook_text` v1 is the re-derivation prompt (`deriveHookText`) for an edited script.
**Neither had run in production as of 2026-09-05**; by 2026-09-08 v9 had 12 production rows and
v12 had 19 (below).

b_script v10 (hook_text as a verbatim prefix, word budget as a band) and hook_text v2 landed
together (`9199ece`); v11 is `product_kind` ([[0027-product-kind-is-an-optional-questionnaire-field]]);
v12 (2026-09-07) adds `{{closer_options}}` — a **new var**, so the restart trap below applies:
a worker or web process started before the code change throws `missing variable
"closer_options"` on its next b_script call ([[0028-scripts-end-on-a-closer-from-a-curated-bank]]).
v12 ran in production on 2026-09-08 (19 rows by 03:30 UTC that day — the query is in `method:`
above — every one with an anthropic `llm_tokens` usage event within 90 s of it). v13 (2026-09-08, same vars as v12 — no restart needed) fixes every closer's
punctuation and adds the imperfections budget; v14 (2026-09-08, same vars again) aims the
opening at 4–6 words with 7 as a ceiling, after the model kept landing exactly on the cap
([[0030-hook-text-falls-back-to-the-extractor-never-trims]]); v15 (2026-09-08, same vars again — no
restart needed) is v14 with **one bullet** changed, carving an exception out of the output rules'
blanket "No English" for a product name the naming policy already allows
([[0033-b-script-may-write-an-allowed-brand-name-in-latin]]). The `hook_text` rule's own "no
English" is deliberately untouched.

`hook_text` v3 (2026-09-08, same single `{{script}}` var as v2 — no restart needed) copies
b_script v14's aim language into the extractor: "the first 4–6 words" and "7 is the hard ceiling,
not the target", twice each, with the cap sentence "At most 7 Hebrew words and at most 40
characters" kept verbatim. It landed alongside the validator going to **8** words, so both
generators now aim a word below what `hookTextError` accepts
([[0030-hook-text-falls-back-to-the-extractor-never-trims]], amended section).

b_script v16 and vo_script v8 (2026-09-08, same vars as v15/v7 — no restart needed) ban `רגע`
outright as a filler, restart or aside — the founder's standing instruction is that it is gone
permanently, after "…וזה, רגע, זה…" kept surfacing as scripts' "A restart" imperfection
example. Both files drop that bullet entirely from their imperfections list and add a `Never
`רגע`` rule in its place; vo_script v8 additionally drops `רגע` from its own slang list
("Slang — one or two, load-bearing"). `packages/core/test/hook-templates.test.ts` and
`packages/core/test/vo-prompt.test.ts` assert the ban and that `רגע` appears nowhere else in
either file. The DRY_RUN stand-in scripts in `copy.ts` (`generateBScript`, `generateVoScript`)
never contained `רגע`, so neither needed a fix.

> **Corrected 2026-09-11.** "Appears nowhere else in **either file**" is wrong, and the error is
> load-bearing: both tests match `/רגע/g` against the **rendered** prompt, not the template file on
> disk. `b_script` interpolates `{{hook_options}}` from a random 3-of-25 draw of curated openers, and
> one of them — `packages/core/src/hook-templates.ts:25`, `"תראי רגע את זה"` — contains the word, so
> `hook-templates.test.ts:125` fails on **12.0%** of runs (`3/25`).
> [[ban-rule-test-collides-with-a-curated-hook]] has the mechanism and the arithmetic. The
> `vo-prompt.test.ts` twin pins every variable to a literal and is genuinely deterministic; only the
> `b_script` one flakes. `hook-templates.ts` was never audited for the ban — it is not in `f40bc72`'s
> file list.

plan_demo_steps v13 (2026-08-25) adds `{{demo_description}}` — the new-var restart trap below fired in the flesh:
the file landed while two pre-change workers were live, and both had to be restarted in the same
session. Its other change deletes v12's "keep five and write the uncapped ones long" route, which
was arithmetically false under the shipped constants ([[0002-runtime-band-floor-is-15s]]).

## Resolution is "highest number wins", numerically

`latestPromptVersion` (`packages/core/src/prompts.ts:10-18`) does `readdirSync`, matches
`/^v(\d+)\.md$/`, and returns `Math.max(...)`. It parses to `Number` first, so `v12` beats `v9` —
no lexicographic trap. Nothing is pinned anywhere: `renderPrompt`'s third argument can pin a
version and **no caller in the repo passes it** — all eight call sites (re-grepped 2026-09-08:
`copy.ts:31` the shared `callClaude`, `copy.ts:161` hook_lines dry-run, `copy.ts:469` b_script
dry-run, `copy.ts:528` hook_text dry-run; `demo-analysis.ts:496` and `:880` — the vision batch
and the 0030 sections grouping; `demo-step-plans.ts:1084`; `tts.ts:183`) omit it. Every prompt in production
is whatever the highest-numbered file happens to be.

As of the 2026-08-23 DB check, `plan_demo_steps@v12` was both the newest file and the version on
the newest production plan row (`0d1b5f41`, 2026-08-22 10:29). **v13 has not run in production
yet** — the first live plan after 2026-08-25 stamps it.

## The restart trap, stated precisely

`renderPrompt` `readFileSync`s the template on **every call**, and `latestPromptVersion`
`readdirSync`s on every call. So:

- **Adding `prompts/<name>/v13.md` takes effect immediately.** No restart. The next call picks it
  up. (Which also means dropping a file into that directory is a live production change.)
- **Adding a new `{{var}}` to a template does need a restart** — but the file is not why.
  `renderPrompt` throws `missing variable "x"` unless the _caller_ passes it
  (`prompts.ts:27-29`), and the caller is TypeScript in a long-lived `tsx` worker or web process
  that does not hot-reload. The restart is for the code change, not the prompt change.

The asymmetry is the hazard: a prompt file edit goes live instantly against a process running the
old variable set, and the failure mode is a thrown error on the next paid call.

**"Immediately" means "on a machine that already has the file", and this section is silent about
which machines do** — which is how it gets misread into
[[the-worker-box-is-untouched-by-prompt-changes]]. Prompt files are git-tracked, so the Hetzner box
has a version only after `docs/07-worker-box.md` §11, and `generate_copy` is a worker job type, so
the box reads them. Both halves together are the actual trap: a `git pull` without the restart puts
a new template live against old code. See
[[0039-three-deploy-axes-and-the-box-is-the-one-that-forgets]].

## Related

- [[v10-is-the-last-working-prompt]]
- [[first-call-violation-rate]] — what every version of `plan_demo_steps` has in common
