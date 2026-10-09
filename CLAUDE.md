# CLAUDE.md

Read this fully before every task. It governs how we work and the locked decisions; the vault (`docs/vault/`) governs what is true and what was decided, so where a description here disagrees with a vault note, the note wins. If anything here conflicts with an ad-hoc idea mid-task, this file wins unless the founder explicitly overrides it in chat. Topic rules live in `.claude/rules/` and load when you touch matching files: `service-b.md` (the B pipeline, `packages/remotion`, the B wizard) and `migrations.md` (`supabase/`, the schema, the migration tooling).

## What we're building

A Hebrew-first AI UGC ad platform for advertisers targeting Israelis. Two services, one shared pipeline:

- **Service A — Hook+Demo generator.** One fixed format: a 3–4s pre-rendered AI reaction clip (from a closed, founder-curated bank) with a Hebrew text hook burned on → hard cut into the customer's own phone-filmed product demo, composed as the approved **steps** (`demo_step_plans`): trims of the one demo file, back to back, each with a burned Hebrew label. Silent — no voiceover, no script, nothing that has to fit the demo's length. Variants are the product: one demo + one questionnaire → many ads (hook clip × hook line × plan). The older "full" format is **retired** as of 2026-09-05 and has no customer-facing path (its render runs only from the CLI's `format: "full"`) — do not build on it (vault 0020; the leftover web route is `defects/retired-formats-keep-two-live-web-routes.md`).
- **Service B — Hebrew AI avatar ads.** 5–10 consistent generated personas, each with a pinned ElevenLabs voice and one **selfie** reference image. A render is that image + ElevenLabs V3 audio through HeyGen lip-sync — **one clip, start to finish; nothing is ever stitched in front of it** — with the Remotion hook animation the customer picks by name (or `none`), performed under their burned hook text. The opener-clip format is **retired** as of 2026-09-06 and has no customer-facing path (its render runs only from the CLI's `render-b --opener`) — do not build on it (vault 0023; same defect note). Self-serve with no QC hold: `auto_release_b` is on permanently, so renders release straight to the customer and the founder's eyeball pass happens after release, not before (vault 0036). DFY tier on the same pipeline. The detail is in `.claude/rules/service-b.md`; the decisions are vault 0017 (the selfie talking head), 0022 (the engine settings), 0023 (the hook) and 0024 (the three animations and how the name travels).
- **Service C — גוש טקסט (admin-only, phase 1 since 2026-10-07).** A founder-made 9:16 clip from its own closed bank (`text_block_clips`, registered by hand in admin `/text-blocks` with its speaker gender, text area and colour; never generated at runtime, never listed to a hook picker) played **once, start to finish, with its own recorded sound** — no voice, no music, no hook animation, nothing stitched — under one Hebrew text block burned for the whole length (mostly 25–40 words; the prompt asks for 400 characters at most and the render refuses past 450, a margin so one long text does not fail its batch), looking like text typed in TikTok or Instagram (Heebo 600, a thin edge, no box) and not like our captions. It never reads as an ad: the product is mentioned in passing, never offered (founder ruling 2026-10-07). The texts come from the ten skeletons in `prompts/text_block/v2.md` (v1 frozen for the rows it stamped), whose examples are the founder's own and which every rule matches, one per skeleton that fits the business, in the clip's speaker gender, each with its signature phrase and nothing else lifted from an example; the generator never writes the speaker using the product, never invents a figure and never writes an em or en dash; an edit is free of content rules and of the dash rule. Phase 1 is reachable only through `apps/admin` (`/text-blocks`, `/text-blocks/new`): `createTextBlockRender` refuses a business that is not admin-owned, there is no credit key (25 credits flat is recorded for phase 2 only), and a render releases like a Service A render, never into `qc_pending`. Phase 2 (customer wizard, credits, dashboard card) is a separate prompt — do not start it. Decisions: vault 0089 (exists, phases), 0090 (the format), 0091 (the texts), 0092 (the Service B tests that closed the talking revamp).

Context: solo founder, side-income scale (₪10–15k/mo target), vibecoded, pre-validation. The founder is user #1, generating cold-outreach sample ads via the CLI and the web wizards (first real B wizard render 2026-09-05, video_renders 1397ffcd…). Full product/backend spec: `docs/00-overview.md` and the numbered docs it indexes — read them when a task touches pipeline logic, schema, or external services.

## Architecture (V0)

- Single monorepo. `apps/web` = Next.js (App Router, TypeScript) on Vercel. `apps/worker` = one Node worker (queue consumer, ffmpeg, Remotion renders). `apps/admin` = the founder console. `apps/cli` = the entrypoint the founder actually uses (`aiugc ...`). `packages/core` = pipeline logic, jobs, db and provider wrappers, with the pipelines themselves in `packages/core/src/pipelines/` as importable pure-ish functions. `packages/remotion` = every composition. There is no `packages/pipeline` — do not create one.
- Supabase: Postgres, Auth, Storage (signed URLs).
- All heavy work (TTS, lip-sync GPU, renders) runs as async, retryable jobs on the worker. Nothing heavy in a Vercel function, ever.
- External services: Anthropic API (`claude-sonnet-5-5`, every Claude call — copy, the demo analysis, the steps planner, the content-policy classifier, the TTS tags and גוש טקסט — with thinking off; vault 0093, 0095), ElevenLabs V3 (Hebrew TTS), HeyGen for avatar lip-sync (Service B; it replaced InfiniteTalk-on-fal in 2026-08 — see docs/04 and `providers/lipsync.ts`; `FAL_KEY` stays for nano-banana composites), Remotion via `@remotion/renderer` on the worker, ffmpeg/ffprobe for probing/normalize/stretch.
- Payments: Sumit via Upay — our code calls Sumit's API, never Upay (vault 0054). The first charge is on Sumit's hosted payment page; renewals and upgrades are `/billing/payments/charge/` on the saved card through `SumitGateway`, scheduled by us, never by Sumit's `/billing/recurring/*` (0062). Billing ships as עוסק פטור: a קבלה on every charge, a חשבונית עסקה on request (0046). Bit is off on the payment pages (0062). No Stripe (it doesn't onboard Israeli businesses — `docs/05-billing.md`), no Paddle.

## Locked decisions — do not reopen, do not "improve"

1. One format for Service A. No timeline editor. Steps are cut automatically from the analysis; the customer picks and captions moments, never trims. (Amended 2026-10-01 — vault 0070. Since 2026-10-02 every step is a fixed 2 s clip placed from the footage — vault 0076, 0084.)
2. Hook clips come only from the pre-rendered bank. No runtime face/video generation for hooks.
3. Hebrew captions are rendered in Remotion (browser bidi handles RTL correctly). Never ffmpeg `drawtext` for Hebrew text.
4. _(Moot since 2026-09-05 — Service A has no voiceover; it governs only the retired "full" format. The rule, its 2026-08-08 amendment and the measurements behind it: `docs/vault/decisions/0065-vo-sync-is-loose-by-design.md`.)_
5. Mandatory audio-only preview gate before any voiced video render.
6. Pronunciation = phonetic Hebrew respelling + a server-side find-replace map applied before TTS.
7. No music is ever baked into organic exports. (Amended 2026-09-06: a whoosh SFX on the hook animation is not music — founder ruling in chat — and ships in exports.)
8. Service B renders go through the QC-release queue (`qc_pending → released/rejected`) before the customer sees them. Auto-release is a config flag, not a code path to build around. (Amended 2026-08-09: `app_config.auto_release_b` is **`true` in production, permanently** — founder decision 2026-09-09, final: the settled answer, not a placeholder (vault 0036). The machinery all stays in the tree — `pipelines/qc.ts`, `aiugc qc list|approve|reject`, and the RLS rule hiding `qc_pending`/`rejected` from customers — because the flag is the switch and its off-position has to keep working. Do not flip it to `false`, and do not write code that assumes the gate runs.)
9. All output video: vertical 9:16, 1080×1920, H.264 MP4. All user-facing copy: Hebrew.
10. Boring tech, minimal moving parts. No new infrastructure, framework, or paid service without the founder asking for it.
11. Runtime image generation (nano-banana composites) is founder-approved for Service B product-in-hand composites only. The Service A hook-bank rule (#2 — no runtime face/video generation for hooks) is untouched.
12. Service B renders from a single reference image (or an approved composite) + audio via HeyGen. No video-to-video.

## Project memory — the vault

`docs/vault/` is the source of truth for what is true and what was decided — measured facts, decisions, defects and falsified claims. How to work, and the locked decisions, are this file's. It is git-tracked; a note changes in the same commit as the code it describes.

**Read it:**

- At session start, read `docs/vault/README.md` and `docs/vault/CONVENTIONS.md`.
- Before asserting any project fact — a cap, a balance, a version, a cost, a decision, a file path — grep the vault. If a note exists, use it and name the file. If its `verified` date is more than 14 days old, re-measure before relying on it, then update the note.
- Before proposing an approach, grep `docs/vault/falsified/`. Do not re-derive a dead hypothesis.

**Write to it** at these moments and not otherwise:

- A phase gate closes → `phases/`, with gate results and commit SHAs.
- A number is measured → `facts/`, with the exact command that produced it.
- The founder makes a decision → `decisions/`, with the options offered and the reason chosen.
- A claim is disproved → `falsified/`. Never delete the note that was wrong: move it to `falsified/`, mark it `status: superseded`, keep the original claim verbatim, and record what killed it, when, and who proposed it (CONVENTIONS.md).
- A defect is found and not fixed → `defects/`.

**Never** write speculation, plans in progress, or inference presented as measurement. Every note carries `status:` and `verified:` frontmatter per CONVENTIONS.md. If you cannot fill those in honestly, the note is not ready to write.

`docs/vault/state-of-play.md` is working state, not a note: every task updates it at its end (§3), queue and plans included. The moments above govern notes.

## How to work — every task

### Coding principles (every task)

Adapted from github.com/multica-ai/andrej-karpathy-skills (MIT). For a typo or a one-liner, use judgement; these are for non-trivial work.

1. **Think before coding.** State your assumptions. If the request reads two ways, name both instead of picking silently. If there's a simpler route than the one asked for, say so. If you're confused, stop and ask; in an unattended run, stop and report BLOCKED with what's unclear.
2. **Simplicity first.** Write the least code that solves the problem. No unrequested features, options or config, no handling for cases that can't happen, and no abstraction for a single caller (duplicate until a pattern has appeared ~3 times). If it could be a quarter of the length, rewrite it.
3. **Surgical changes.** One task = one concern: every changed line traces to the task. Don't reformat, re-comment or refactor neighbouring code; match the existing style. Remove what your own change left unused; mention other dead code in the report, don't delete it. Anything else you notice broken goes in the report too; don't fix it silently.
4. **Goal-driven execution.** Turn the task into checks you can run: a bug gets a failing test first, a refactor keeps tests green before and after, validation gets tests for the bad inputs. For multi-step work, state the plan as steps, each with its verification, and loop until every check passes.

### 1. Start: branch

One branch per task, in this checkout. `git fetch`, then create `<type>/<short-slug>` from `origin/main` (`feat/`, `fix/`, `docs/`, `tooling/`, …). If the working tree is dirty, stop. If the task depends on work that isn't on `origin/main`, stop and say so. Never `git push` to main, never merge, never force-push, never create a worktree. These branch rules and the end-of-task block belong to the session doing the founder's task; a subagent never branches, commits or pushes unless its prompt says so, and returns what its caller asked for.

### 2. During the task

- Prefer editing existing code over adding new files.
- Pipeline logic lives in `packages/core/src/pipelines/` as importable functions callable from CLI, worker, and API alike. The web app is a thin shell over the same functions.
- Every external API call (Anthropic, ElevenLabs, GPU, gateway) goes through one wrapper module per service: typed input/output, timeout, retry policy, and cost-relevant params logged. No inline `fetch` to third parties scattered around.
- Jobs must be idempotent and resumable. Assume any step can crash mid-way and be retried.
- Hebrew/RTL: use CSS logical properties (`ms-`/`me-`, `text-start`), isolate LTR islands (URLs, numbers) with bidi isolation, test any text-touching UI with real Hebrew strings, not lorem ipsum.
- Secrets only via env vars; never commit keys, never log full prompts/scripts containing customer data at info level.
- **Never echo a credential in output — including while proving one works.** Not in a report, not in a summary, not in a shell command the founder can read back, not as "here's the value that authenticated". A credential that appears anywhere in a transcript is burned and has to be rotated. Verify by connecting and report the _outcome_: "session pooler authenticated", "auth failed for that user". If a password's exact form is the thing in question — brackets, encoding, trailing whitespace — say which form worked, never what it was ("the bracketed form fails, the bare form authenticates"). Read secrets out of the env file inside the script that uses them; never paste one into a command line. It is its own rule, not a clause in the one above, because it happened twice on 2026-08-26, both times the production DB password and both times rotated — first printed by a command whose redaction missed the direct-connection URL shape, then in a task report showing its brackets were not part of the value, which the founder called "the second occurrence" (`docs/vault/facts/credential-echo-incidents.md`).
- Don't add spend: no code path that calls a paid API in a loop without an explicit cap.
- There is **one** Supabase project, `hyaqydcmwbnbaiqqufow`; it holds real data and all five `.env` files point at it.
- Nothing that writes to the database or the migration ledger (`db push`, `migration repair`, ad-hoc DDL or SQL writes) runs without the founder's explicit instruction for that one operation. `migration list` and `db push --dry-run` are read-only pre-flight and need no permission. Full rules: `.claude/rules/migrations.md`.

### 3. End of task — mandatory protocol

Every task response must end with exactly this block, no exceptions, even for tiny tasks:

```
---
## Next step
<the single most valuable next task, one or two sentences, chosen to keep the validation sequence moving (pipeline → outreach samples → self-serve app)>

## Test it manually
<3–6 numbered steps the founder can run right now — exact commands, URLs, or clicks, plus what he should see if it works and one thing that would indicate it's broken>

Branch: <the branch this task pushed>
```

Before that block, in this order: (1) update the docs, and update `docs/vault/state-of-play.md` with the task's changes, decisions and discoveries — every task; (2) check `git branch --show-current` — other sessions share this checkout — and if it is not this task's branch, stop and report; (3) commit and `git push` the task's branch. `Branch: <name>` is always the report's last line.

After the task's last commit and before the push, run `pnpm repo-map`; if `docs/repo-map.md` changed, commit it alone as `chore: repo-map`, so its header's sha is the task commit.

Handovers are retired. Decisions arrive in task prompts and are recorded by the task that receives them, at the moments the vault section lists.

The manual test must be runnable by the founder without reading the code. If the task produced something not directly runnable, the test is how to verify it; for a pending migration, it is the read-back query the founder runs after he authorizes the `db push`, with the expected result.

If the changes made in the session require a box restart or anything done on the box to take effect, say so in the very beginning of the "Next Step" section of the report.

Never apply a Supabase migration at the end of a task. If one is waiting, say so in the "Next step" section and put its `db push --dry-run` output in a fenced block under that sentence (`.claude/rules/migrations.md`).

### 4. Unattended runs

In a cloud session (`CLAUDE_CODE_REMOTE=true`) whose first message is a spec, follow `docs/unattended/protocol.md`; it says how each rule here holds there (vault 0096). A push to main from any Claude session is refused by the git pre-push hook that `.claude/hooks/session-start.mjs` installs; merging, `--no-verify` and printing the paid-check key are instruction only, and each is a stop-and-ask (vault 0097). Hooks and settings change in local sessions only.

## Commands

Populate this section as scripts land, and keep it current.

```
pnpm dev            # web app (onboarding) — http://localhost:3000
pnpm dev:admin      # admin app (founder console) — http://localhost:3001
pnpm typecheck      # all packages, four at a time (the gate runs them one at a time, below)
pnpm lint / format  # prettier
pnpm repo-map       # regenerate docs/repo-map.md: what exists, derived from the code (apps/cli/scripts/repo-map.ts)

# THE TEST GATE — these seven, one at a time. Not `pnpm test`. See below before changing.
pnpm lint                                    # prettier --check . (decision 0038)
pnpm -r --workspace-concurrency=1 --no-bail typecheck  # `pnpm typecheck`, one package at a time, every package reported
pnpm --filter @aiugc/remotion exec vitest run --fileParallelism=false
pnpm --filter @aiugc/core     exec vitest run --fileParallelism=false  # PGlite, no Docker
pnpm --filter @aiugc/worker   exec vitest run --fileParallelism=false
pnpm --filter @aiugc/web      exec vitest run --fileParallelism=false
pnpm --filter @aiugc/admin    exec vitest run --fileParallelism=false

pnpm --filter @aiugc/remotion studio          # live composition preview (Remotion Studio)
pnpm --filter @aiugc/remotion render:sample   # ServiceB sample -> packages/remotion/out/sample.mp4
pnpm --filter @aiugc/remotion render:sample:a # RETIRED "full" ServiceA composition (hook line + avatar ending) -> out/sample-a.mp4; the live format is render:sample:steps
pnpm --filter @aiugc/remotion render:sample:b-opener # RETIRED (vault 0023): the opener effect over a lavfi clip -> out/sample-b-opener.mp4; the live hook is the customer's pick of the four HOOK_EFFECTS in packages/core/src/hook-effect.ts (none | zoom | focus | whip), mocked with packages/core/.work/b-final-rerender.ts (gitignored)
pnpm --filter @aiugc/remotion render:sample:c # Service C: the tone-carrying lavfi clip once, with its sound, under the sample text block -> out/sample-c.mp4; `-- --quiz` for the line-broken quiz, `-- --clip <file>` for a real clip, `-- --ink black`, `-- --safe-area x,y,w,h`
```

**`pnpm test` is not the test gate — those seven serial runs are.** The root script is `pnpm -r test`, which fans the packages out four at a time, each run itself file-parallel, and that OOMs this machine — so do not collapse the five vitest runs back into one line. Typecheck runs one package at a time as a precaution, never beside a vitest run. `--fileParallelism=false` only reaches vitest after `exec`; after `--` pnpm 9 eats it. `@aiugc/cli` has no tests. Measurement and mechanism: `docs/vault/facts/pnpm-r-test-ooms-this-machine.md`.

Never run `next build` while `pnpm dev` is serving — the build replaces `.next` and the running dev server starts 404-ing its own chunks (every page stuck on its loading state; DevTools shows 404 on `/_next/static/chunks/main-app.js`). Recovery: stop dev, delete `apps/web/.next`, start dev again.

The CLI is `apps/cli` and it is where the pipeline is driven today:

```
pnpm --filter @aiugc/cli dev <cmd>     # aiugc CLI — every command, with its description: docs/repo-map.md
pnpm --filter @aiugc/worker dev        # the job loop (also `aiugc work --once` to drain and exit)
```

Migrations are applied only as `.claude/rules/migrations.md` says, never from this list.

## Delegation

Run the test gate through the `test-runner` subagent (`.claude/agents/test-runner.md`) instead of reading raw test output in the main context.
It runs the seven gate commands above one at a time and returns only the failures with their errors, or "all green" with counts.

## When unsure

Ask the founder rather than assuming — especially about anything touching money (billing, credits), Hebrew copy tone, or the locked decisions above. A wrong guess in those areas is expensive; a question is cheap.
