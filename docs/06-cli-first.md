# 06 — Scripts-First Plan (CLI now, HTTP later)

Everything is an importable function in `packages/core`; `apps/cli` and `apps/worker` are thin.
Even CLI runs go through the real DB + jobs table + storage, so **outreach samples exercise the
production pipeline**, not a shortcut. `DRY_RUN=1` runs the whole thing keyless.

## Founder workflow (cold-outreach sample, today)

Service C (גוש טקסט, 2026-10-07, [vault 0089](vault/decisions/0089-service-c-text-block-exists-admin-only-phase-1.md))
has no CLI path: the founder registers clips and makes a sample in the admin console
(`/text-blocks`, `/text-blocks/new`); `aiugc work` runs its two jobs like any other.

```sh
# one-time
aiugc business create --name "מסעדת הבית" --email founder@me.com --admin   # admin = no credits/watermark
aiugc business questionnaire <bizId> --file questionnaire.json
aiugc bank add-hook clip.mp4 --duration 4086 --safe-area 100,200,880,400   # curate once

# per prospect
aiugc demo ingest footage.mp4 --business <bizId>       # phone-filmed website/IG scroll
aiugc work --once                                      # probe -> normalize -> ready
aiugc copy hooks --business <bizId>                    # pick hook line ids from output
aiugc copy captions --business <bizId> --demo <demoId>
aiugc set create --business <bizId> --demo <demoId> \
  --hooks <clipId> --hook-lines <id1>,<id2> --captions <scriptId>
aiugc work --once                                      # renders -> released, files in storage
aiugc status                                           # paths to final.mp4

# voiced variant — RETIRED (CLI-only since 2026-09-05, vault 0020): the live
# product is hook + steps only, silent, no script/VO/length-fit/ending. The
# commands below still run from the CLI; nothing customer-facing reaches them.
# (--persona derives the voice AND is the avatar-outro face; --voice stays as
# an explicit escape hatch)
aiugc copy vo --business <bizId> --demo <demoId> --advantages "משלוח מהיר" --persona <personaId>
aiugc tts <scriptId>
aiugc work --once && <listen to the mp3>
aiugc audio approve <audioRenderId>                    # the hard gate
aiugc set create ... --audio <audioRenderId> --persona <personaId>
# VO longer than the demo? decided per variant at set create:
#   remainder < a_outro_min_seconds (app_config, default 2) -> freeze ending
#   remainder >= min -> avatar ending (lipsync of the VO tail, then render)

# service B (selfie talking head + optional opener — docs/vault/decisions/0017)
aiugc bank add-persona --name "נועה" --voice <elevenVoiceId>
aiugc persona add-image <personaId> selfie.jpg --kind selfie   # the render source; first image becomes the default
aiugc bank add-opener --persona-image <imageId> --effect hand_cover --label "כף יד" \
  --file opener.mp4 --reveal-at-ms 1600 --safe-area '{"x":60,"y":900,"w":960,"h":300}'
                                                       # play-ready clip; duration probed off the file
aiugc bank add-structure --title "..." --skeleton skeleton.json
aiugc bank seed-structures [--update]                  # the checked-in seed/structures/*.json; --update replaces existing titles' skeletons from the files
aiugc copy b-script --business <bizId> --persona <id> --structure <id>   # prints the draft hook text too
aiugc script edit <scriptId> --text "..."              # b_script: re-derives the hook text into the new row
aiugc tts <scriptId> && aiugc work --once && aiugc audio approve <id>
aiugc render-b --business <bizId> --audio <id> --persona <personaId> \
  --opener <clipId> --hook-text "ככה מזמינים בלי לחכות"   # the FINAL on-screen line (≤8 words, ≤40 chars)
aiugc work --once                                      # lipsync (800ms lead-in) -> render
aiugc qc list && aiugc qc approve <renderId>           # founder gate

# winner loop
aiugc star <variantId>
aiugc set more-like <variantId> --hook-lines <newId1>,<newId2>
```

`aiugc work` without `--once` is the long-running inline worker (same two lanes as
`apps/worker`).

## The HTTP layer is a wrapper, by construction

At launch, `apps/web` (Next.js on Vercel) adds only:

| Web concern                  | Implementation                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Auth                         | Supabase Auth; RLS (already written, 0002) scopes reads; writes are server routes using core functions                                |
| Upload                       | browser → signed upload URL → server route calls `createDemo()`                                                                       |
| Copy/TTS/sets/stars          | server routes call the identical functions the CLI calls                                                                              |
| Render status                | poll `video_renders`/`jobs` (RLS-scoped reads)                                                                                        |
| Checkout + gateway callbacks | the one genuinely new surface: hosted-page creation + the callback endpoint feeding `gateway_events` ([05-billing.md](05-billing.md)) |
| QC console                   | `listQcQueue`/`releaseRender`/`rejectRender` behind an admin check (Studio works meanwhile)                                           |

No pipeline code moves. The worker deploys unchanged.

## Build sequence from here (founder's roadmap)

1. **Provision**: Supabase project (apply migrations 0000–0007, create the three buckets), API
   keys (Anthropic, ElevenLabs, fal), a worker box with ffmpeg — flip `DRY_RUN` off.
2. ~~**Remotion compositions**~~ — **done for Service B**: `@aiugc/remotion` renders the
   `ServiceB` composition against the props contract in `providers/remotion.ts`, wired into
   `renderVideo()` ([04-integrations.md](04-integrations.md)). Still open: the `ServiceA`
   composition (`renderVideo()` throws for `kind: "service_a"`) and calibrating `words_per_second` per voice with test
   renders.
3. ~~**WhisperX fallback**~~ — **not needed**: eleven_v3 returned character alignment in
   production (`alignment_source = "elevenlabs"`), and eleven_v4 does too (2026-10-20, vault 0119). `forcedAlign()` stays in the tree as a
   dormant, unwired fallback; wire the python CLI only if alignment ever comes back absent.
4. **Outreach loop starts here** — everything above is enough to ship samples from the CLI.
5. **Web app** (during outreach): auth + upload + the flows above as thin routes; merchant
   onboarding with Grow + Green Invoice; callback endpoint; checkout.
6. **Launch**: seed real plan prices, set `daily_caps` for stranger traffic, Sentry DSN, done.

## Verification (what exists and runs today)

- `pnpm typecheck` / `pnpm lint` — clean across the workspace.
- `pnpm test` — 25 tests: migrations against real Postgres (PGlite), the job queue's full
  failure matrix, caption chunking properties, the billing state machine, and the **end-to-end
  founder workflow in DRY_RUN** (ingest → copy → silent set → voiced set with the approval gate
  enforced → winner loop → Service B image+audio lipsync/QC/release, including the composite
  path).
- `aiugc --help` and every command above run today (DRY_RUN without keys).
