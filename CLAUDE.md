# CLAUDE.md

Read this fully before every task. It is the source of truth for what this project is and how we work. If anything here conflicts with an ad-hoc idea mid-task, this file wins unless the founder explicitly overrides it in chat. Topic rules live in `.claude/rules/` and load when you touch matching files: `service-b.md` (the B pipeline, `packages/remotion`, the B wizard) and `migrations.md` (`supabase/`, the schema, the migration tooling).

## What we're building

A Hebrew-first AI UGC ad platform for advertisers targeting Israelis. Two services, one shared pipeline:

- **Service A — Hook+Demo generator.** One fixed format: a 3–4s pre-rendered AI reaction clip (from a closed, founder-curated bank) with a Hebrew text hook burned on → hard cut into the customer's own phone-filmed product demo, composed as the approved **steps** (`demo_step_plans`): trims of the one demo file, back to back, each with a burned Hebrew label. Silent — no voiceover, no script, nothing that has to fit the demo's length. Variants are the product: one demo + one questionnaire → many ads (hook clip × hook line × plan). The older "full" format is **retired** as of 2026-09-05 and its code is reachable only from the CLI's `format: "full"` — do not build on it (vault 0020).
- **Service B — Hebrew AI avatar ads.** 5–10 consistent generated personas, each with a pinned ElevenLabs voice and one **selfie** reference image. A render is that image + ElevenLabs V3 audio through HeyGen lip-sync — **one clip, start to finish; nothing is ever stitched in front of it** — with the Remotion hook animation the customer picks by name (or `none`), performed under their burned hook text. The opener-clip format is **retired** as of 2026-09-06 and its code is reachable only from the CLI's `render-b --opener` — do not build on it (vault 0023). Self-serve behind a founder QC-release gate; DFY tier on the same pipeline. The detail is in `.claude/rules/service-b.md`; the decisions are vault 0017 (the selfie talking head), 0022 (the engine settings), 0023 (the hook) and 0024 (the three animations and how the name travels).

Context: solo founder, side-income scale (₪10–15k/mo target), vibecoded, pre-validation. The founder is user #1, generating cold-outreach sample ads via the CLI and the web wizards (first real B wizard render 2026-09-05, video_renders 1397ffcd…). Full product/backend spec: `docs/00-overview.md` and the numbered docs it indexes — read them when a task touches pipeline logic, schema, or external services.

## Architecture (V0)

- Single monorepo. `apps/web` = Next.js (App Router, TypeScript) on Vercel. `apps/worker` = one Node worker (queue consumer, ffmpeg, Remotion renders). `apps/admin` = the founder console. `apps/cli` = the entrypoint the founder actually uses (`aiugc ...`, ~45 commands). `packages/core` = pipeline logic, jobs, db and provider wrappers, with the pipelines themselves in `packages/core/src/pipelines/` as importable pure-ish functions. `packages/remotion` = every composition. There is no `packages/pipeline` — do not create one.
- Supabase: Postgres, Auth, Storage (signed URLs).
- All heavy work (TTS, lip-sync GPU, renders) runs as async, retryable jobs on the worker. Nothing heavy in a Vercel function, ever.
- External services: Anthropic API (`claude-sonnet-4-6`, all copywriting), ElevenLabs V3 (Hebrew TTS), HeyGen for avatar lip-sync (Service B; it replaced InfiniteTalk-on-fal in 2026-08 — see docs/04 and `providers/lipsync.ts`; `FAL_KEY` stays for nano-banana composites), Remotion via `@remotion/renderer` on the worker, ffmpeg/ffprobe for probing/normalize/stretch.
- Payments: Israeli gateway (Grow/PayPlus/Cardcom) for recurring card billing + Green Invoice/iCount for automatic חשבונית מס. Bit for one-offs. No Stripe (unavailable in Israel), no Paddle.

## Locked decisions — do not reopen, do not "improve"

1. One format for Service A. No timeline editor. No automatic scene detection.
2. Hook clips come only from the pre-rendered bank. No runtime face/video generation for hooks.
3. Hebrew captions are rendered in Remotion (browser bidi handles RTL correctly). Never ffmpeg `drawtext` for Hebrew text.
4. _(Moot since 2026-09-05 — Service A has no voiceover; it governs only the retired "full" format. The rule, its 2026-08-08 amendment and the measurements behind it: `docs/vault/decisions/0065-vo-sync-is-loose-by-design.md`.)_
5. Mandatory audio-only preview gate before any voiced video render.
6. Pronunciation = phonetic Hebrew respelling + a server-side find-replace map applied before TTS.
7. No music is ever baked into organic exports. (Amended 2026-09-06: a whoosh SFX on the hook animation is not music — founder ruling in chat — and ships in exports.)
8. Service B renders go through the QC-release queue (`qc_pending → released/rejected`) before the customer sees them. Auto-release is a config flag, not a code path to build around. (Amended 2026-08-09: `app_config.auto_release_b` is **`true` in production and stays true** — founder instruction, standing until he says otherwise in chat (vault 0036). The machinery all stays in the tree — `pipelines/qc.ts`, `aiugc qc list|approve|reject`, and the RLS rule hiding `qc_pending`/`rejected` from customers — because the flag is the switch and its off-position has to keep working. Do not flip it to `false`, and do not write code that assumes the gate runs.)
9. All output video: vertical 9:16, 1080×1920, H.264 MP4. All user-facing copy: Hebrew.
10. Boring tech, minimal moving parts. No new infrastructure, framework, or paid service without the founder asking for it.
11. Runtime image generation (nano-banana composites) is founder-approved for Service B product-in-hand composites only. The Service A hook-bank rule (#2 — no runtime face/video generation for hooks) is untouched.
12. Service B renders from a single reference image (or an approved composite) + audio via HeyGen. No video-to-video.

## Project memory — the vault

`docs/vault/` is the project's source of truth for decisions, measured facts, defects and falsified claims. It is git-tracked; a note changes in the same commit as the code it describes.

**Read it:**

- At session start, read `docs/vault/README.md` and `docs/vault/CONVENTIONS.md`.
- Before asserting any project fact — a cap, a balance, a version, a cost, a decision, a file path — grep the vault. If a note exists, use it and name the file. If its `verified` date is more than 14 days old, re-measure before relying on it, then update the note.
- Before proposing an approach, grep `docs/vault/falsified/`. Do not re-derive a dead hypothesis.

**Write to it** at these moments and not otherwise:

- A phase gate closes → `phases/`, with gate results and commit SHAs.
- A number is measured → `facts/`, with the exact command that produced it.
- The founder makes a decision → `decisions/`, with the options offered and the reason chosen.
- A claim is disproved → `falsified/`. Never delete it; the original note gets `status: superseded`.
- A defect is found and not fixed → `defects/`.

**Never** write speculation, plans in progress, or inference presented as measurement. Every note carries `status:` and `verified:` frontmatter per CONVENTIONS.md. If you cannot fill those in honestly, the note is not ready to write.

## How to work — every task

### 1. Start: load the guidelines skill

Invoke the `/karpathy-guidelines` skill at the beginning of every coding task and apply its concepts to all code written in that task. If the skill can't be found, stop and tell the founder instead of guessing, then proceed with its core principles as understood in this repo: simplest thing that works first; make it work before making it pretty; no premature abstraction (duplicate until a pattern has proven itself ~3 times); minimal dependencies — prefer stdlib/boring over clever; small increments that keep the repo runnable at every step; code the founder can hold in his head; delete aggressively.

### 2. During the task

- Prefer editing existing code over adding new files; prefer deleting over adding.
- One task = one concern. If you notice something else broken, note it at the end — don't fix it silently.
- Pipeline logic lives in `packages/core/src/pipelines/` as importable functions callable from CLI, worker, and API alike. The web app is a thin shell over the same functions.
- Every external API call (Anthropic, ElevenLabs, GPU, gateway) goes through one wrapper module per service: typed input/output, timeout, retry policy, and cost-relevant params logged. No inline `fetch` to third parties scattered around.
- Jobs must be idempotent and resumable. Assume any step can crash mid-way and be retried.
- Hebrew/RTL: use CSS logical properties (`ms-`/`me-`, `text-start`), isolate LTR islands (URLs, numbers) with bidi isolation, test any text-touching UI with real Hebrew strings, not lorem ipsum.
- Secrets only via env vars; never commit keys, never log full prompts/scripts containing customer data at info level.
- **Never echo a credential in output — including while proving one works.** Not in a report, not in a summary, not in a shell command the founder can read back, not as "here's the value that authenticated". A credential that appears anywhere in a transcript is burned and has to be rotated. Verify by connecting and report the _outcome_: "session pooler authenticated", "auth failed for that user". If a password's exact form is the thing in question — brackets, encoding, trailing whitespace — say which form worked, never what it was ("the bracketed form fails, the bare form authenticates"). Read secrets out of the env file inside the script that uses them; never paste one into a command line. It is its own rule, not a clause in the one above, because it happened twice — the founder flagged the second on 2026-08-26: the DB password, printed in a task report to show its brackets were not part of the value, had to be rotated.
- Don't add spend: no code path that calls a paid API in a loop without an explicit cap.
- There is **one** Supabase project, `hyaqydcmwbnbaiqqufow`; it holds real data and all five `.env` files point at it.
- Never `db push`, `migration repair` or ad-hoc DDL without the founder's explicit instruction for that one push — the full rules are in `.claude/rules/migrations.md`.

### 3. End of task — mandatory protocol

Every task response must end with exactly this block, no exceptions, even for tiny tasks:

```
---
## Next step
<the single most valuable next task, one or two sentences, chosen to keep the validation sequence moving (pipeline → outreach samples → self-serve app)>

## Test it manually
<3–6 numbered steps the founder can run right now — exact commands, URLs, or clicks, plus what he should see if it works and one thing that would indicate it's broken>
```

The manual test must be runnable by the founder without reading the code. If the task produced something not directly runnable (e.g., a schema migration), the test is how to verify it applied (query to run, expected rows/columns).

Update the docs and, if needed, `docs/vault/state-of-play.md` with the session's changes, decisions and discoveries. Vault notes are written only at the moments the vault section lists.

If the changes made in the session require a box restart or anything done on the box to take effect, say so in the very beginning of the "Next Step" section of the report.

Never apply a Supabase migration at the end of a task. If one is waiting, say so in the "Next step" section and include its `db push --dry-run` output (`.claude/rules/migrations.md`).

## Commands

Populate this section as scripts land, and keep it current.

```
pnpm dev            # web app (onboarding) — http://localhost:3000
pnpm dev:admin      # admin app (founder console) — http://localhost:3001
pnpm typecheck      # all packages
pnpm lint / format  # prettier

# THE TEST GATE — these five, one at a time. Not `pnpm test`. See below before changing.
pnpm --filter @aiugc/remotion exec vitest run --fileParallelism=false
pnpm --filter @aiugc/core     exec vitest run --fileParallelism=false  # PGlite, no Docker
pnpm --filter @aiugc/worker   exec vitest run --fileParallelism=false
pnpm --filter @aiugc/web      exec vitest run --fileParallelism=false
pnpm --filter @aiugc/admin    exec vitest run --fileParallelism=false

pnpm --filter @aiugc/remotion studio          # live composition preview (Remotion Studio)
pnpm --filter @aiugc/remotion render:sample   # ServiceB sample -> packages/remotion/out/sample.mp4
pnpm --filter @aiugc/remotion render:sample:a # RETIRED "full" ServiceA composition (hook line + avatar ending) -> out/sample-a.mp4; the live format is render:sample:steps
pnpm --filter @aiugc/remotion render:sample:b-opener # RETIRED (vault 0023): the opener effect over a lavfi clip -> out/sample-b-opener.mp4; the live hook is the zoom animation, mocked with packages/core/.work/b-final-rerender.ts
```

**`pnpm test` is not the test gate — those five serial runs are.** The root script is `pnpm -r test`, which fans the packages out four at a time, each run itself file-parallel, and that OOMs this machine — so do not collapse the five back into one line. `--fileParallelism=false` only reaches vitest after `exec`; after `--` pnpm 9 eats it. `@aiugc/cli` has no tests. Measurement and mechanism: `docs/vault/facts/pnpm-r-test-ooms-this-machine.md`.

Never run `next build` while `pnpm dev` is serving — the build replaces `.next` and the running dev server starts 404-ing its own chunks (every page stuck on its loading state; DevTools shows 404 on `/_next/static/chunks/main-app.js`). Recovery: stop dev, delete `apps/web/.next`, start dev again.

The CLI is `apps/cli` and it is where the pipeline is driven today:

```
pnpm --filter @aiugc/cli dev <cmd>     # aiugc CLI: demo (audit: read-only moment-loss accounting — needs ffmpeg; S1/S2 are exact only where it reports "recompute: exact"), plan, copy, script, set, bank (add-hook; add-opener is retired 2026-09-06 with the opener bank), persona, render-b, qc, work, status, costs
pnpm --filter @aiugc/worker dev        # the job loop (also `aiugc work --once` to drain and exit)
```

Migrations are applied only as `.claude/rules/migrations.md` says, never from this list.

## Delegation

Run the test gate through the `test-runner` subagent (`.claude/agents/test-runner.md`) instead of reading raw test output in the main context.
It runs the five commands above one at a time and returns only the failing tests with their errors, or "all green" with counts.

## When unsure

Ask the founder rather than assuming — especially about anything touching money (billing, credits), Hebrew copy tone, or the locked decisions above. A wrong guess in those areas is expensive; a question is cheap.
