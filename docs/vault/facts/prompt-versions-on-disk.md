---
type: fact
status: verified
verified: 2026-09-07
method: "for d in prompts/*/; do ls $d | sort -V; done (2026-09-07); packages/core/src/prompts.ts:10-32 read directly; newest DB prompt_version from select ... from demo_step_plans order by created_at desc (DB check 2026-08-23 — not re-run)"
source: code
---

# Ten prompt families, and the newest file always wins

```
analyze_demo          v1 v2 v3                              (latest v3)
b_script              v1..v12                               (latest v12, new 2026-09-07)
benefit_captions      v1 v2                                 (latest v2)
content_policy        v1                                    (latest v1)
group_analysis_states v1                                    (latest v1, new 2026-08-25)
hook_lines            v1..v7                                (latest v7)
hook_text             v1 v2                                 (latest v2)
plan_demo_steps       v1..v13                               (latest v13)
tts_enhance           v1..v4                                (latest v4)
vo_script             v1..v7                                (latest v7)
```

b_script v9 (2026-09-05) is v8's vars and rules with the output changed to the JSON
`{script, hook_text}`; the brief that asked for it cited "v2 from v1", the second time a brief
named a stale version (the first was the tts_enhance v3 regression, 2026-08-05). It was
caught by the stop-and-report rule, not by luck: v1's var set has `target_seconds`, which nothing
passes. `hook_text` v1 is the re-derivation prompt (`deriveHookText`) for an edited script.
**Neither has run in production yet** — the first live `copy b-script` after 2026-09-05 stamps
`b_script@v9`.

b_script v10 (hook_text as a verbatim prefix, word budget as a band) and hook_text v2 landed
together (`9199ece`); v11 is `product_kind` ([[0027-product-kind-is-an-optional-questionnaire-field]]);
v12 (2026-09-07) adds `{{closer_options}}` — a **new var**, so the restart trap below applies:
a worker or web process started before the code change throws `missing variable
"closer_options"` on its next b_script call ([[0028-scripts-end-on-a-closer-from-a-curated-bank]]).

v13 (2026-08-25) adds `{{demo_description}}` — the new-var restart trap below fired in the flesh:
the file landed while two pre-change workers were live, and both had to be restarted in the same
session. Its other change deletes v12's "keep five and write the uncapped ones long" route, which
was arithmetically false under the shipped constants ([[0002-runtime-band-floor-is-15s]]).

## Resolution is "highest number wins", numerically

`latestPromptVersion` (`packages/core/src/prompts.ts:10-18`) does `readdirSync`, matches
`/^v(\d+)\.md$/`, and returns `Math.max(...)`. It parses to `Number` first, so `v12` beats `v9` —
no lexicographic trap. Nothing is pinned anywhere: `renderPrompt`'s third argument can pin a
version and **no caller in the repo passes it** — all seven call sites
(`copy.ts:28`, `copy.ts:158`, `copy.ts:442`, `demo-analysis.ts` ×2 — the vision batch and the
0030 sections grouping — `demo-step-plans.ts`, `tts.ts:183`) omit it. Every prompt in production
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

## Related

- [[v10-is-the-last-working-prompt]]
- [[first-call-violation-rate]] — what every version of `plan_demo_steps` has in common
