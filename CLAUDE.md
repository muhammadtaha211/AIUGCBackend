# CLAUDE.md

Read this fully before every task. It is the source of truth for what this project is and how we work. If anything here conflicts with an ad-hoc idea mid-task, this file wins unless the founder explicitly overrides it in chat.

## What we're building

A Hebrew-first AI UGC ad platform for advertisers targeting Israelis. Two services, one shared pipeline:

- **Service A — Hook+Demo generator.** One fixed format: a 3–4s pre-rendered AI reaction clip (from a closed, founder-curated bank) with a Hebrew text hook burned on → hard cut into the customer's own phone-filmed product demo → burned Hebrew RTL captions (v1: evenly-paced benefit captions) → optional Hebrew voiceover (ElevenLabs V3), loosely synced by design. Variants are the product: one demo + one questionnaire → many ads (hook clip × hook line × copy angle × voiced/silent).
- **Service B — Hebrew AI avatar ads.** 5–10 consistent generated personas, each with a pinned ElevenLabs voice and one default **selfie** reference image (`persona_images.kind='selfie'` — a render resolved from a persona's default refuses any other kind; an explicit image or an approved composite bypasses that). A render is that single image + ElevenLabs V3 audio, with ~800ms of leading silence prepended (`lipsync_lead_in_ms`, pinned on `params.leadInMs`), through HeyGen lip-sync — a single-setting selfie talking head, optionally behind a founder-made **opener clip** from the `opener_clips` bank (one per selfie image × effect, play-ready) with the customer's **hook text** burned over its palm phase and a hard cut at `reveal_at_ms`. `b_script` (v9+) emits the draft `hook_text` with the script; the FINAL string is copied into render params at enqueue, never pointed at (vault 0017). The layout is `serviceBTimeline` in core; the composition only converts to frames. The web wizard (`apps/web/src/components/b-wizard`) is persona → pointers → script → audio → opener effect → render — no image step, no product step: the persona card shows its selfie (`personaSelfie` in `apps/web/src/lib/service-b.ts`, the one resolver for the card, the opener list and the render source), the wizard sends that image's id with the render, and the render route refuses anything that is not that persona's live selfie or an opener made from it; nothing on the customer path depends on `is_default`. Self-serve behind a founder QC-release gate; DFY tier on the same pipeline. Format decision: `docs/vault/decisions/0017-service-b-single-setting-selfie-talking-head.md`.

Context: solo founder, side-income scale (₪10–15k/mo target), vibecoded, pre-validation. The founder is user #1, generating cold-outreach sample ads via CLI before the UI exists. Full product/backend spec: `docs/00-overview.md` and the numbered docs it indexes — read them when a task touches pipeline logic, schema, or external services.

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
4. VO sync is loose by design: the word budget from demo length is a target, not a cap; time-stretch ≤ ~5% (`atempo`) absorbs the rest. Anything past that is an ending, decided by `planAOutro` and priced in the advisory before confirm — never a regeneration. No per-moment sync logic. (Amended 2026-08-08: the length-fit regeneration in `handleSynthTts` was removed. It silently repointed `audio_renders.scriptId`, so customers approved audio for text they never saw, and it converted an overrun that has machinery into an undershoot that has none. Measured before removal: it fired 3 times in 14 renders and landed inside its target band 0 of 3 — once converting a 1.15x overrun into a 0.69x undershoot, twice spending an extra Claude call and an extra synthesis to reach the ending `planAOutro` would have chosen for free.)
5. Mandatory audio-only preview gate before any voiced video render.
6. Pronunciation = phonetic Hebrew respelling + a server-side find-replace map applied before TTS.
7. No music is ever baked into organic exports.
8. Service B renders go through the QC-release queue (`qc_pending → released/rejected`) before the customer sees them. Auto-release is a config flag, not a code path to build around. (Amended 2026-08-09: `app_config.auto_release_b` is **`true` in production and stays true** — founder instruction, standing until he says otherwise in chat. Service B therefore releases today without passing through `qc_pending`; the live `events` table holds zero `qc_release`/`qc_reject` rows. The machinery all stays in the tree — `pipelines/qc.ts`, `aiugc qc list|approve|reject`, and the RLS rule hiding `qc_pending`/`rejected` from customers — because the flag is the switch and its off-position has to keep working. Do not flip it to `false`, and do not write code that assumes the gate runs.)
9. All output video: vertical 9:16, 1080×1920, H.264 MP4. All user-facing copy: Hebrew.
10. Boring tech, minimal moving parts. No new infrastructure, framework, or paid service without the founder asking for it.
11. Runtime image generation (nano-banana composites) is founder-approved for Service B product-in-hand composites only. The Service A hook-bank rule (#2 — no runtime face/video generation for hooks) is untouched.
12. Service B renders from a single reference image (or an approved composite) + audio via HeyGen. No video-to-video.

## Project memory — the vault

`docs/vault/` is the project's source of truth for decisions, measured facts, defects and falsified
claims. It is git-tracked; a note changes in the same commit as the code it describes.

**Read it:**

- At session start, read `docs/vault/README.md` and `docs/vault/CONVENTIONS.md`.
- Before asserting any project fact — a cap, a balance, a version, a cost, a decision, a file path —
  grep the vault. If a note exists, use it and name the file. If its `verified` date is more than 14
  days old, re-measure before relying on it, then update the note.
- Before proposing an approach, grep `docs/vault/falsified/`. Do not re-derive a dead hypothesis.

**Write to it** at these moments and not otherwise:

- A phase gate closes → `phases/`, with gate results and commit SHAs.
- A number is measured → `facts/`, with the exact command that produced it.
- The founder makes a decision → `decisions/`, with the options offered and the reason chosen.
- A claim is disproved → `falsified/`. Never delete it; the original note gets `status: superseded`.
- A defect is found and not fixed → `defects/`.

**Never** write speculation, plans in progress, or inference presented as measurement. Every note
carries `status:` and `verified:` frontmatter per CONVENTIONS.md. If you cannot fill those in
honestly, the note is not ready to write.

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
- **Never echo a credential in output — including while proving one works.** Not in a report, not in a summary, not in a shell command the founder can read back, not as "here's the value that authenticated". A credential that appears anywhere in a transcript is burned and has to be rotated. Verify by connecting and report the *outcome*: "session pooler authenticated", "auth failed for that user". If a password's exact form is the thing in question — brackets, encoding, trailing whitespace — say which form worked, never what it was ("the bracketed form fails, the bare form authenticates"). Read secrets out of the env file inside the script that uses them; never paste one into a command line. The founder flagged 2026-08-26 as the **second** occurrence — the DB password was printed in a task report while demonstrating that the brackets around it were not part of the value, and had to be rotated. Twice is why this is its own rule and not a clause in the one above.
- Don't add spend: no code path that calls a paid API in a loop without an explicit cap.
- Migrations are gated by reversibility, not by the word "production" — there are two Supabase projects now. The new, still-empty one: run `npx -y supabase db push` against it as often as you like; while it holds no data and nothing points at it, any mistake is undone by deleting and recreating the project in three minutes (`docs/08-supabase-project-rebuild.md` §1). The old project (`mtpmrqltldfwhziyyzdu`): its contents are test data and it is being deleted, but until then it is what every `.env` still points at — so it keeps the old regime, never `db push`, never `migration repair`, never ad-hoc DDL. The new project joins that regime at the env flip (`docs/08-supabase-project-rebuild.md` §8): the moment `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_URL` in the web app or on Vercel, or `DATABASE_URL` on the Hetzner worker box (`docs/07-worker-box.md`), points at it, it is production and the gate covers it too. The ledger has been clean at 0000–0030 since 2026-08-26, so a push now genuinely runs — that makes the gate more necessary, not less.

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

## Commands

Populate this section as scripts land, and keep it current.

```
pnpm dev            # web app (onboarding) — http://localhost:3000
pnpm dev:admin      # admin app (founder console) — http://localhost:3001
pnpm typecheck      # all packages
pnpm test           # core tests (PGlite, no Docker)
pnpm lint / format  # prettier

pnpm --filter @aiugc/remotion studio          # live composition preview (Remotion Studio)
pnpm --filter @aiugc/remotion render:sample   # ServiceB sample -> packages/remotion/out/sample.mp4
pnpm --filter @aiugc/remotion render:sample:a # ServiceA sample (hook line + avatar ending) -> out/sample-a.mp4
pnpm --filter @aiugc/remotion render:sample:b-opener # ServiceB opener effect over a lavfi clip -> out/sample-b-opener.mp4
```

Never run `next build` while `pnpm dev` is serving — the build replaces `.next` and the running dev server starts 404-ing its own chunks (symptom: every page stuck on its loading state, DevTools shows 404 on `/_next/static/chunks/main-app.js`). Recovery: stop dev, delete `apps/web/.next`, start dev again.

The CLI is `apps/cli` and it is where the pipeline is driven today:

```
pnpm --filter @aiugc/cli dev <cmd>     # aiugc CLI: demo, plan, copy, script, set, bank (add-hook, add-opener), persona, render-b, qc, work, status, costs
pnpm --filter @aiugc/worker dev        # the job loop (also `aiugc work --once` to drain and exit)

npx -y supabase db push --db-url <session-pooler url>   # apply new migrations (see below)
```

Migrations: apply with `npx -y supabase db push --db-url <url>`, where `<url>` is `DATABASE_URL` from `.env` with `:6543/` swapped to `:5432/` (session pooler; no Supabase CLI is installed — npx fetches it). The ledger was repaired to 0000–0030 on 2026-08-26 (`scripts/verify-migration-ledger.sql` is the proof file). If a migration is ever applied by hand instead, immediately run `npx -y supabase migration repair --status applied <version>` with the same `--db-url` — otherwise the ledger drifts again and `db push` goes back to being unusable.

## When unsure

Ask the founder rather than assuming — especially about anything touching money (billing, credits), Hebrew copy tone, or the locked decisions above. A wrong guess in those areas is expensive; a question is cheap.
